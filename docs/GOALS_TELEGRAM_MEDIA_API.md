# Goals, Telegram, Media and API

This guide describes the current implementation surface. It separates shipped
behavior from planned provider-specific media generation and MCP work.

## Goal mode

Council now distinguishes a normal message from a top-priority goal.

- Web: start a message with `/goal 10-180m ...`, or use **Set goal** while a
  run is active.
- Native TUI: `/goal [MIN-MAXm] TEXT`.
- Hosted CLI: `council run "TEXT" --providers ID --goal`.
- Telegram: `/goal 10-180m TEXT`.

A goal update:

- records `run.goal` with `mode`, text, minimum window, maximum window and
  timestamp;
- posts a `user-goal` board item;
- clears stale candidate endorsements;
- queues every available peer to re-review against the goal;
- asks peers to stress-test early consensus before the minimum goal window
  closes.

Resource limits still apply. The minimum goal window is an effort floor, not a
guarantee of unlimited model calls or provider availability.

## Telegram bridge

Each account can save one encrypted Telegram bot token.

- Web: **Connections** -> **Telegram bridge**.
- Hosted CLI:

```bash
council telegram status
council telegram set BOT_TOKEN
council telegram clear
```

The server uses Telegram long polling with stored offsets. This works for local,
desktop and hosted deployments without requiring per-user public webhook URLs.

Telegram behavior:

- `/start` returns setup hints.
- `/status` reports the active Telegram-linked session.
- `/goal 10-180m TEXT` starts or updates a goal-mode run.
- Ordinary messages start a normal run when no Telegram-linked run is active.
- Ordinary messages during an active run are posted as board guidance.
- Telegram receives board progress from agents and final/status messages.
- User-originated board posts are not echoed back to Telegram.

Configure and save a team before starting Telegram sessions. Other self-hosted
installs need their own token and process.

## Files and Images

Text/document attachments remain bounded owner-scoped run inputs:

- `.md`
- `.txt`
- `.pdf`
- `.docx`
- `.apk`

Image attachments are now accepted:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

Images up to 8 MB are stored as run attachments and passed as image content to
vision-capable provider adapters. Text-only providers see only metadata such as
name, hash and warning text.

Supported image input adapters:

- OpenAI Responses
- Anthropic Messages
- OpenAI-compatible / vLLM chat payloads
- Ollama chat image arrays

Image generation and image editing are not yet a general Council tool. A team
can reason about image goals when a capable vision model is present, but true
generate-review-regenerate loops require provider-specific media tools that
return files and feed those files back into the run.

## API Surface

Hosted authenticated API clients can use the same primitives as the web app.

- `POST /api/runs`
  - `prompt`
  - `config`
  - optional `goalMode`, `minGoalMinutes`, `maxGoalMinutes`
  - optional `attachmentIds`
- `POST /api/runs/:id/board`
  - ordinary live board guidance
- `POST /api/runs/:id/message`
  - direct message to one peer, or `all` / `board`
- `POST /api/runs/:id/goal`
  - top-priority live goal update
- `GET /api/runs/:id/events`
  - SSE stream
- `POST /api/attachments`
  - binary upload with `X-File-Name`
- `GET/PUT/DELETE /api/integrations/telegram`
  - Telegram bridge status/configuration

These endpoints are a practical base for an MCP server. MCP should wrap them as
tools such as `start_goal`, `send_board_message`, `attach_file`,
`watch_events`, and `cancel_run`, while preserving authentication and file-size
limits.

## Planned Media Loop

The next implementation step is a media tool contract:

1. `media_generate` and `media_edit` provider adapters.
2. Generated-file storage with owner/run scoping.
3. Board-visible media artifacts.
4. Agent role presets for reviewer, prompt designer, generator and critic.
5. Iteration policy: review output against goal, revise prompt, regenerate, and
   stop only when the goal is met or limits force a qualified answer.

Until then, do not claim general image editing support from Council itself.
