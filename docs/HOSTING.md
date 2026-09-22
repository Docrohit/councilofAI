# Hosting Council

Council is currently a **single-server alpha**. It can be packaged for a private beta, but it is not an audited, production-hardened public SaaS. There is no billing, email verification, password reset, MFA, admin console, or abuse-response workflow yet.

## Server configuration

Use an HTTPS reverse proxy, a persistent data volume, and a stable encryption key. The server refuses hosted mode without an HTTPS origin and a 32-byte encryption key encoded as 64 hex characters.

```dotenv
HOST=0.0.0.0
PORT=4310
DEPLOYMENT_MODE=hosted
APP_ORIGIN=https://council.example.com
COUNCIL_ENCRYPTION_KEY=<output of openssl rand -hex 32>
COOKIE_SECURE=true
TRUST_PROXY=1
ALLOW_SIGNUP=true
INVITE_CODE=<private-beta invitation code>
ALLOWED_PROVIDER_ORIGINS=https://api.openai.com,https://api.anthropic.com,https://api.z.ai
DATA_DIR=/data
```

Only set `TRUST_PROXY=1` when exactly one trusted reverse proxy sits between the user and this service. Do not expose the application port directly when trusting forwarded client IP headers. `ALLOWED_PROVIDER_ORIGINS` is an exact origin allowlist controlled by the operator. Add a trusted custom HTTPS model server if needed; never allow arbitrary visitor-controlled destinations in hosted mode. Redirects are rejected by provider requests.

Visitors with local models should use bridge connections. Direct loopback model URLs are intentionally rejected in hosted mode. The operator must understand where tasks and outputs are stored; a local bridge does not make the hosted discussion private from the host.

Build and start:

```sh
npm ci
npm run build
npm start
```

Or build the included Dockerfile and use `compose.yaml` behind your existing HTTPS proxy. Supply environment variables externally; never bake credentials into an image or commit `.env`.

## Persistence and operations

- Back up SQLite consistently (SQLite backup API or a stopped-service copy), and separately back up `COUNCIL_ENCRYPTION_KEY`. Losing the key makes saved provider credentials unrecoverable.
- Run one application instance. In-memory run scheduling and local bridge queues are not coordinated across replicas.
- SSE needs proxy buffering disabled and a sufficiently long read timeout. Example Nginx location directives: `proxy_buffering off; proxy_read_timeout 3600s;` plus normal Web proxy headers.
- Current guardrails include scrypt password hashes, hashed session tokens, secure HttpOnly/SameSite cookies in hosted mode, same-origin request checks, account scoping, per-IP limits, one active run per account, global run capacity, bounded outputs, and encrypted provider keys.
- Before broad public signup, add email verification/recovery, account deletion/retention controls, stronger shared abuse limits, monitoring, backups/restore drills, and an independent security review. Resource controls are not dollar-denominated billing caps. Users should also configure provider-side spending limits.
- Current tools work only with virtual text files. Shell/browsing/code execution requires a separate per-user sandbox design; do not grant untrusted hosted agents access to the server host.

No infrastructure has been provisioned and no public deployment is implied by these files.
