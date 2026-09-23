# Upgrading Council

After installing a version containing this command, run it from any directory:

```sh
council upgrade --check
# Finish/stop Council sessions first, then:
council upgrade
```

macOS and Linux Git installations are supported. This updates Council's
installation checkout, not the coding project you are currently in. It requires
a clean `main` checkout with the official `Docrohit/councilofAI` origin, fetches
`main`, fast-forwards without rewriting history, and runs `npm ci`. It refuses
local modifications, divergent history, other branches, forks and managed release
directories. `--check` fetches metadata but does not update source or dependencies.
No global relink is normally needed. Restart your TUI after the upgrade.

For a self-hosted web installation:

1. Finish active tasks and export temporary hosted projects.
2. Stop the web service. Back up its whole configured data directory and vault key.
3. Run `council upgrade --web` to update dependencies and build the web frontend.
4. Restart the existing service using your installation's service manager and
   verify health and login. Browsers then use that upgraded server.

The command checks native session locks in the current user's standard data home
and probes local web health on `$PORT` (default 4310). It cannot discover all
custom services, other users' sessions or a custom constructor data directory.
The operator must stop those first. It does not restart services, change `.env`,
update model weights or stop shared Ollama/vLLM workloads. RunPod uses the same
procedure in its persistent Council checkout; do not interrupt unrelated jobs.

On the owner's Hostinger managed deployment, use the approved GitHub release
pipeline instead; the updater refuses `/releases/` installations. The deployment
approval rules still apply. Updating the hosted website does not upgrade an
independent laptop or RunPod installation. There are no native desktop-app
packages or app-store update mechanism yet.

For versions predating `council upgrade`, bootstrap from the installation checkout:

```sh
git status --short
# Continue only after preserving local changes, on main with the official origin.
git pull --ff-only origin main
npm ci
# For web installations only:
npm run build
```

If fetching fails, source stays unchanged. If dependency installation or the web
build fails after fast-forwarding, the command reports both old and new revisions;
keep Council stopped, resolve the reported failure and rerun `npm ci` / the build
in the installation directory. The updater is not an atomic release switch or
automatic rollback mechanism. It never resets a dirty checkout. Version and
revision can be checked with `council --version` and `git rev-parse HEAD`.
