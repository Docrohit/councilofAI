# Server reference

Draft, source-inspected 2026-09-23 at `ef0a1da`. Values below come from checked-in
service/deploy files. They are not proof of current live state. This is a public
repository reference; credentials and private account data do not belong here.

## Access and boundaries

The owner uses a personal Hostinger server. Use the operator's established SSH
alias or the securely configured deployment host/key; do not put a private IP
inventory, key contents or passwords in this file. The existing pipeline uses
`SERVER_HOST`, `SERVER_SSH_KEY`, `SERVER_KNOWN_HOSTS` and a privileged deployment
identity. The web application itself runs as the unprivileged `councilofai` user.

Manual SSH inspection is read-only by default: inspect release links, service
state and sanitized logs. Production mutations require the approval and release
procedure in [deploy rules](deploy_rules.md). Do not inspect unrelated app
secrets or change other hosted products. RunPod is a separate installation;
no current pod/endpoint or operational access is assumed here.

## Production paths and services

| Item                | Checked-in value                                           |
| ------------------- | ---------------------------------------------------------- |
| Public app          | `https://councilofai.nftforger.com`                        |
| Release directories | `/srv/councilofai/releases/<commit>`                       |
| Active release      | `/srv/councilofai/current` symlink                         |
| App state/database  | `/var/lib/councilofai/council.sqlite`                      |
| Environment         | `/etc/councilofai/council.env` — root-only; never print it |
| App service         | `councilofai.service`                                      |
| Broker service      | `councilofai-sandbox.service`                              |
| Backup units        | `councilofai-backup.service`, `councilofai-backup.timer`   |
| App listener        | Loopback port `4310`                                       |
| Broker socket       | `/run/council-sandbox/broker.sock`                         |
| Nginx site          | `/etc/nginx/sites-available/councilofai.nftforger.com`     |
| Backup root         | `/var/backups/councilofai`                                 |

Read-only examples on the authorized server:

```sh
readlink -f /srv/councilofai/current
systemctl status councilofai.service councilofai-sandbox.service --no-pager
systemctl list-timers councilofai-backup.timer --no-pager
journalctl -u councilofai.service --since '15 minutes ago' --no-pager
curl --fail --silent --show-error http://127.0.0.1:4310/api/health
```

App/broker logs use the system journal. Nginx log locations should be checked
against its active configuration rather than assumed. Redact user goals,
provider output and credentials before attaching logs to issues or prompts.

## Runtime and persistence

Node.js >=22.18, locked npm dependencies and built frontend assets. Production
uses Node with `tsx` to run TypeScript. The schema is bootstrapped in
`server/db.ts`; there is no ORM migration command. SQLite uses WAL, foreign
keys and a busy timeout. Queues and bridge jobs remain process-local.

`deploy/backup.py` uses SQLite's backup API, copies `council.env` and retains
fourteen snapshot directories. The timer specifies 03:25 in systemd's applicable
server timezone; this document has not checked the live timezone. Secure the
backups as credentials. Recheck key storage if vault configuration changes;
database files without the correct encryption key cannot recover saved keys.

Native installs use separate project data and configuration as described in
[NATIVE.md](docs/NATIVE.md). Do not copy production account data into native or
staging installations for convenience.

## Planned environments

Staging is planned at `staging.councilofai.nftforger.com`, with isolated services,
state and credentials. Its ports, unit names and paths are not provisioned or
assigned by this document. PostgreSQL is a future direction, not an installed
replacement for the SQLite paths above.
