# Deployment rules

Draft 2026-09-23. Source inspection at `ef0a1da`; this is not a fresh deployment
or audit of GitHub protection settings. Owner approval policy below is confirmed.

## Environments and authority

| Environment                | Current state                                                               | Release policy                                                                     |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Local                      | Web, CLI/TUI, fixtures and disposable test projects                         | Work within the requested task; preserve unrelated files                           |
| Staging                    | Planned private environment at proposed `staging.councilofai.nftforger.com` | Independent AI review and automated checks before staging                          |
| Production                 | Checked-in deployment targets `councilofai.nftforger.com`                   | Explicit owner approval for every release, including small fixes                   |
| Other self-hosted installs | Independent installs, including the owner's RunPod setup                    | Separate authorization and verification; updating the website does not update them |

One repository contains UI, backend, CLI and deployment code:
`git@github.com:Docrohit/councilofAI.git`. Verify the remote and the personal
GitHub identity before any write. Do not switch to employer credentials.

**Current hazard:** pushes and manual workflow runs on `main` are eligible for
production deployment. The YAML names a `production` environment, but required
reviewer settings are configured outside the repository and have not been
verified here. Do not push/merge to `main` or dispatch its workflow without
release-specific owner approval, even for documentation-only changes.

## Existing pipeline

Source: [workflow](.github/workflows/check.yml),
[deployment script](deploy/deploy.sh), [hosting reference](docs/HOSTING.md).

1. Pushes and pull requests run `npm ci`, `npm test`,
   `python3 scripts/verify-tui.py`, both Docker verification scripts,
   `npm run build`, deployment-script syntax checks and Playwright browser tests.
2. Eligible non-PR runs on `main` package a verified artifact containing `dist`,
   server/shared/CLI/bin/deploy sources and package manifests. Docs are excluded.
3. The deploy job uses `SERVER_HOST`, `SERVER_SSH_KEY` and `SERVER_KNOWN_HOSTS`;
   transfers the artifact over authenticated SSH with pinned host keys; and
   runs the checked-in deployment script. Do not disable host-key validation.
4. The script locks deployment, installs production dependencies into a
   commit-named release, prepares configuration, backs up existing state,
   switches `current`, restarts app/broker and checks app and broker health.
5. Nginx/TLS setup and HTTPS checks run; a backup is made. The job checks public
   HTTPS health again. Inspect the actual result before claiming completion.

App restarts interrupt running tasks. Broker restarts discard temporary hosted
projects. Before an approved release, account for active tasks and export any
temporary project the owner needs to retain.

## Required target workflow — not implemented yet

Feature branch → independent AI review → checks → private staging → owner tests
and approves exact release → promote the same tested artifact to production.

Staging needs its own service, database/state, configuration, account data,
broker isolation, port and domain routing. It must not share production keys or
write to production data. Staging branch naming, artifact retention/promotion
and GitHub approval enforcement remain implementation decisions. There is no
staging deployment command to run today.

## Release evidence and rollback

Before seeking production approval, provide the concrete revision/artifact,
independent review outcome, checks actually run, staging result when available,
schema impact, active-work impact and rollback plan. Missing staging must be
reported; do not describe a local test as staging validation.

The current script restores the previous application symlink when its local
app/broker health loop fails. This is not an all-stage rollback guarantee:
later failures may occur after activation. It does not reverse incompatible
database changes. Record previous and candidate revisions before release.

For a faulty release, prepare a revert or restoration of a known artifact through
the approved pipeline. Database restoration requires an appropriate consistent
backup and explicit approval; it can lose newer data. Preserve encryption
material alongside the database. Do not improvise production SQL or edit code
over SSH. Off-server backups and restore drills are not established here.

After deployment verify workflow success, running release revision, service
status, app and broker health, HTTPS, sanitized logs and representative user
flows. `/api/health` returns `{ok:true}` and does not establish the running SHA.
Report GitHub, production and other self-hosted installations separately.
