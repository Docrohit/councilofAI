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
- Virtual workspace files are separate from real projects. Hosted coding uses an optional per-account temporary Docker workspace through a restricted Unix-socket broker. The standalone CLI/TUI works directly in local repositories without OpenCode; an OpenCode worker is an optional adapter. Do not run visitor workers on the application host. See [Coding](CODING.md) for workspace expiration/export limits and [Architecture](ARCHITECTURE.md) for the runtime and security boundaries.

Confirm the latest GitHub Actions deployment and public HTTPS health endpoint before considering a release live.

## Council of AI deployment

The deployment workflow in `.github/workflows/check.yml` verifies tests, builds the app, and deploys a verified artifact on pushes to `main`. Pull requests only run checks. Manual workflow dispatch repeats verification and deployment, including HTTPS activation when DNS becomes ready.

Repository secrets required: `SERVER_HOST`, `SERVER_SSH_KEY`, and `SERVER_KNOWN_HOSTS`. Pin the known SSH host key using a previously trusted connection. Never disable host-key verification. Initial system provisioning requires a privileged deployment identity; the application itself runs as the dedicated unprivileged `councilofai` user.

Deployment manages only Council's own service and virtual host:

- URL: `https://councilofai.nftforger.com`
- Immutable application releases: `/srv/councilofai/releases/<commit>`; current symlink at `/srv/councilofai/current`
- Service: `councilofai.service`, loopback port 4310
- Persistent database: `/var/lib/councilofai/council.sqlite`
- Root-only environment: `/etc/councilofai/council.env`; stable encryption key retained across deployments
- Daily consistent SQLite and environment backups: `/var/backups/councilofai`, last 14 snapshots; copy these to off-server storage separately
- TLS: Let's Encrypt via webroot, with an Nginx reload hook after renewal

The server's existing model environment can be read through `MODEL_ENV_SOURCE` during initial setup. Only selected OpenAI/Anthropic/GLM settings are copied when missing; source files are untouched. These server keys are not automatically granted to signups. Users can add their own account-scoped model connections.

A failed application health check restores the previous application symlink. Database schema rollback is not automatic; restore a consistent backup for an incompatible migration. Existing environment settings are retained. A service deployment before DNS is ready leaves a setup-only HTTP page; rerun the workflow after the A record resolves to activate HTTPS.
