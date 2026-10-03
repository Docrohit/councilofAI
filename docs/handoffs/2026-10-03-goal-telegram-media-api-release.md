# Council goal, Telegram, media and API release handoff

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-10-03.

## Objective

Upgrade Council from primarily problem-solving sessions into a more general
goal-oriented agent team that can accept goals, ordinary guidance, files/images,
Telegram input and API-driven control while preserving the original Council
principle: peers work together, challenge each other, require evidence and use
the board for shared progress.

## Source changes

- Added goal mode:
  - `/goal [MIN-MAXm] TEXT` in native TUI.
  - `/goal 10-180m ...` in the web composer.
  - `POST /api/runs/:id/goal`.
  - hosted CLI `run --goal --min-goal-minutes --max-goal-minutes`.
  - Telegram `/goal`.
- Goal updates now:
  - record `run.goal`;
  - post a `user-goal` board item;
  - clear stale candidate endorsements;
  - queue every available peer to re-review against the goal;
  - ask peers to stress-test early consensus before the configured minimum
    window closes.
- Added Telegram bridge:
  - encrypted per-account bot token in `integrations`;
  - long polling with stored offsets;
  - web setup in Connections;
  - hosted CLI `telegram status|set|clear`;
  - ordinary Telegram messages start normal sessions or become board guidance;
  - Telegram receives board progress and final/status messages only.
- Added image input support:
  - accepts `.png`, `.jpg`, `.jpeg`, `.webp`;
  - stores bounded data URLs as run attachments;
  - passes image parts to OpenAI Responses, Anthropic Messages,
    OpenAI-compatible/vLLM chat and Ollama adapters;
  - text-only providers see metadata/warnings.
- Added docs:
  - `docs/GOALS_TELEGRAM_MEDIA_API.md`
  - doc index and native CLI updates.

## Verification

Passed locally:

- `npm run check`
- `npm test -- tests/integration.test.ts`
  - 92 tests passed.
- `npm run build`
  - Existing Vite large chunk warning remained.
- `npm run test:e2e`
  - 12 Playwright tests passed on desktop and mobile.
- `python3 scripts/verify-tui.py`
- `python3 scripts/verify-tui-workspace.py`
- `git diff --check`

Not run locally:

- Docker sandbox release checks, because Docker is not available in this shell.
  The GitHub workflow runs those checks before deploy.

## Limits and follow-up

- This release supports image input/review for capable models. It does not yet
  implement general image generation or image editing as Council tools.
- Planned media loop remains:
  `media_generate`, `media_edit`, generated-file storage, media artifacts on the
  board, and reviewer/generator/prompt-designer role presets.
- Telegram was unit/integration tested with a mocked Bot API response; no live
  bot token or live Telegram chat was used in this session.
- The API primitives are suitable groundwork for an MCP server, but the MCP
  server itself is not implemented yet.

## Deployment notes

`main` deployment is controlled by `.github/workflows/check.yml`. Verify the
workflow result, deployed revision, public HTTPS health and representative user
flows before calling production complete. Other self-hosted installs, including
RunPod deployments, do not update automatically.
