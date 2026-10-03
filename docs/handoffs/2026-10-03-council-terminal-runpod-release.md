# Council terminal and RunPod release handoff

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-10-03.

## Objective

Implement the Council improvement plan without diluting the core concept: a team
of AI peers that reason together, challenge each other, require evidence for
agreement, maintain a shared board of proven work, and converge on the best
answer. The release also needed terminal CLI parity and clear self-hosted
RunPod/vLLM guidance for desktop use.

## Source changes

- Persisted active answer candidates and peer reviews in shared checkpoint state,
  and replayed them on continuation.
- Preserved negative candidate reviews from unavailable peers as unresolved
  objections that block `completed`.
- Added live user messaging to a run:
  - `POST /api/runs/:id/message`
  - board broadcast aliases for `all` / `board`
  - direct peer messages by ID or single-token name
- Added terminal commands:
  - `/board-msg TEXT`
  - `/broadcast TEXT`
  - `/dm AGENT TEXT`
  - `/chat AGENT TEXT`
- Invalidated stale candidate proposal/review actions after both global board
  instructions and addressed direct user instructions.
- Added RunPod/self-hosted vLLM documentation for Mac desktop tunnels, pod-local
  endpoints, hosted bridge boundaries and terminal setup.
- Updated desktop connection copy, README, native CLI docs, architecture and
  known-issues documentation.

## Independent review

An independent review found:

- P2: direct user messages could leave stale candidate endorsements in place.
- P3: architecture docs still described completion as every available peer
  endorsement without the preserved unavailable-negative-review caveat.

Both findings were addressed before release preparation. No P0/P1 blocker was
reported by the reviewer.

## Local verification

Passed:

- `npm test -- tests/integration.test.ts`
  - The package script ran the full test suite plus the integration target:
    89 tests passed.
- `npm run check`
- `npm run build`
  - Existing Vite large chunk warning remained.
- `python3 scripts/verify-tui.py`
- `python3 scripts/verify-tui-workspace.py`
- `npm run test:e2e`
  - 12 Playwright tests passed on desktop and mobile.
- `bash -n deploy/deploy.sh && node --check deploy/environment.mjs`
- `git diff --check`

Blocked locally:

- `docker pull node:22-bookworm-slim && node scripts/verify-sandbox.mjs`
  failed because `docker` is not available in this shell.
- `node --import tsx scripts/verify-council-sandbox.mjs` failed through the
  same sandbox runtime path.

The GitHub workflow includes Docker-capable sandbox checks and must be inspected
before calling production deployed.

## Deployment notes

`deploy_rules.md` says pushes to `main` can deploy production through GitHub
Actions. This handoff is not production proof. Verify the workflow result,
deployed revision, service status, app and broker health, HTTPS, sanitized logs
and representative workflows after the push.

Other self-hosted installs, including RunPod setups, do not update
automatically. The new RunPod guide documents how to connect them, but no live
RunPod endpoint was tested in this session.

## Follow-up checks

- Inspect GitHub Actions for the pushed revision.
- Confirm public `/api/health` and deployed revision through a source stronger
  than health alone.
- Smoke test web board broadcast, direct peer message and terminal `/dm` /
  `/broadcast` flows against the deployed build.
- Run a real-provider RunPod/vLLM smoke test when the current pod endpoint is
  available.
