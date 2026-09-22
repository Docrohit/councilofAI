#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
bundle=${1:?release archive required}
revision=${2:?git revision required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ $(id -u) == 0 ]] || { echo 'Deployment requires root for service setup'; exit 2; }
exec 9>/var/lock/councilofai-deploy.lock
flock -w 300 9
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
command -v certbot >/dev/null
command -v nginx >/dev/null
getent passwd councilofai >/dev/null || useradd --system --home /var/lib/councilofai --shell /usr/sbin/nologin councilofai
install -d -m 755 /srv/councilofai /srv/councilofai/releases
install -d -m 700 /etc/councilofai /var/backups/councilofai
install -d -m 700 -o councilofai -g councilofai /var/lib/councilofai
release=/srv/councilofai/releases/$revision
install -d -m 755 "$release"
tar -xzf "$bundle" -C "$release"
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# tsx uses esbuild's optional platform package; no package install hooks are required.
chmod -R a+rX "$release"
MODEL_ENV_SOURCE=${MODEL_ENV_SOURCE:-/var/www/html/youtube_doodle_project/.env} node deploy/environment.mjs
if [[ -L /srv/councilofai/current ]]; then python3 deploy/backup.py; fi
previous=$(readlink -f /srv/councilofai/current || true)
install -m 644 deploy/councilofai.service /etc/systemd/system/councilofai.service
install -m 644 deploy/councilofai-backup.service deploy/councilofai-backup.timer /etc/systemd/system/
ln -sfn "$release" /srv/councilofai/next
mv -Tf /srv/councilofai/next /srv/councilofai/current
systemctl daemon-reload
systemctl enable councilofai.service councilofai-backup.timer
systemctl restart councilofai.service
systemctl start councilofai-backup.timer
healthy=false
for attempt in $(seq 1 30); do
 if curl -fsS http://127.0.0.1:4310/api/health >/dev/null; then healthy=true; break; fi
 sleep 1
done
if [[ "$healthy" != true ]]; then
 echo 'Council failed health check; rolling back application release'
 if [[ -n "$previous" && "$previous" != "$release" ]]; then
  ln -sfn "$previous" /srv/councilofai/next
  mv -Tf /srv/councilofai/next /srv/councilofai/current
  systemctl restart councilofai.service
 fi
 exit 1
fi
install -d -m 755 /var/www/councilofai-acme
site=/etc/nginx/sites-available/councilofai.nftforger.com
# Retain an existing HTTPS site while renewing/redeploying.
if [[ ! -f "$site" ]]; then
 cat > "$site" <<'NGINX'
server {
    listen 80;
    server_name councilofai.nftforger.com;
    location /.well-known/acme-challenge/ { root /var/www/councilofai-acme; }
    location / { return 503 'Council is being prepared. HTTPS activation is pending.\n'; add_header Content-Type text/plain; }
}
NGINX
 chmod 644 "$site"
 ln -sfn "$site" /etc/nginx/sites-enabled/councilofai.nftforger.com
 nginx -t
 systemctl reload nginx
fi
if [[ ! -f /etc/letsencrypt/live/councilofai.nftforger.com/fullchain.pem ]]; then
 if ! PUBLIC_IPV4=${PUBLIC_IPV4:?server address required} python3 - <<'PY'
import os, socket, sys
try: records = socket.gethostbyname_ex('councilofai.nftforger.com')[2]
except socket.gaierror: records = []
sys.exit(0 if os.environ['PUBLIC_IPV4'] in records else 1)
PY
 then
  echo 'Service is healthy. HTTPS awaits the domain A record; rerun this workflow when DNS is ready.'
  exit 0
 fi
 certbot certonly --webroot -w /var/www/councilofai-acme -d councilofai.nftforger.com --non-interactive --agree-tos --email cosmicwisdomyt@gmail.com
fi
cat > "$site" <<'NGINX'
server {
    listen 80;
    server_name councilofai.nftforger.com;
    location /.well-known/acme-challenge/ { root /var/www/councilofai-acme; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name councilofai.nftforger.com;
    ssl_certificate /etc/letsencrypt/live/councilofai.nftforger.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/councilofai.nftforger.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
NGINX
chmod 644 "$site"
nginx -t
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/councilofai-reload
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/councilofai-reload
# Reload returns before all new workers are ready. Retry with certificate checks
# intact so the retiring worker's previous default certificate cannot fail a release.
curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-all-errors --max-time 10 --resolve councilofai.nftforger.com:443:127.0.0.1 https://councilofai.nftforger.com/api/health
python3 deploy/backup.py
printf '\nCouncil deployed: %s\n' "$revision"
