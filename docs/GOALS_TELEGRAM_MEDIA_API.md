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
- `/new chat`, `/new`, `/ new chat` or `/ new` detaches the Telegram chat from its current Council
  session. If that session is still queued/running, Council stops it so the next
  Telegram message can start a fresh session.
- `/goal 10-180m TEXT` starts or updates a goal-mode run.
- Ordinary messages start a normal run when no Telegram-linked run is active.
- Ordinary messages during an active run are posted as board guidance.
- Ordinary messages after a final answer continue the linked session with the
  previous goal/answer as context. Use `/new` when you want a clean session.
- Photos and documents sent with text or captions are downloaded into the same
  attachment pipeline as web uploads. A caption such as `/goal 10-180m review
this image and fix the mountain colors` starts/updates goal mode and attaches
  the file in one Telegram message.
- Telegram receives board progress from agents and final/status messages.
- Generated image artifacts are sent back to Telegram as photos, with a document
  fallback if Telegram rejects photo upload.
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

Image generation and editing are available as agent tools when the run includes
a direct OpenAI connection with an image-capable model/key:

- `media_generate_image`
- `media_edit_image`

Generated images are saved as run attachments and sent to later provider turns
for review. Agents are instructed to review the output against the goal and
iterate when limits allow. If no compatible image provider is configured, agents
must report that blocker instead of claiming pixels were changed.

## Market Data And Options

Each Council account can connect its own Zerodha Kite Connect app in
**Connections**. Setup:

1. On developers.kite.trade, set the app's Redirect URL to the callback URL
   shown in Connections (`<APP_ORIGIN>/api/integrations/kite/callback`).
   Historical candles need the app's Historical Chart data add-on.
2. Paste the app's API key and API secret and click **Save Kite app**. Both are
   stored encrypted; changing either clears the previous session.
3. Click **Connect Kite** and sign in to Zerodha. The login URL carries a
   single-use, 15-minute `state` value in `redirect_params`. The public callback
   uses that value to find the account, because the `SameSite=strict` session
   cookie is not sent when Kite redirects back. The callback exchanges the
   `request_token` for the day's access token and records the Kite user ID.

Kite ends every session at 06:00 IST, so users connect once per trading day.
Council treats tokens issued before the latest 06:00 IST as expired. A Kite
`TokenException` clears the saved token and shows a reconnect message. If an
app's Redirect URL must point at another site, the manual section accepts a
`request_token` copied from the address bar or a pasted access token.

Agents see the Kite tool instructions only while the account is connected. A
configured but disconnected account gets a short note telling agents not to call
the tools and to ask the user to reconnect. The tools are:

- `kite_instruments`: search symbols, instrument tokens, expiries and lot
  sizes on NSE, BSE, NFO, BFO, CDS, BCD or MCX.
- `kite_quote`: compact `full`, `ohlc` or `ltp` quotes for up to 100
  instruments. Full quotes include the best bid/ask, without full depth.
- `kite_historical`: OHLCV candles by `EXCHANGE:SYMBOL` or numeric token, with
  optional OI/continuous data. It returns a summary over all candles: change,
  range, average volume, SMA20 and SMA50. Only the latest 120 candles are
  returned by default (maximum 250), trimmed further to fit the tool-result
  budget.
- `kite_option_chain`: strikes nearest spot for the nearest or requested
  expiry. Each strike has CE/PE LTP, bid/ask, volume, OI, IV and delta. The
  result also includes ATM strike, lot size, put-call OI ratio, highest-OI
  strikes and max pain. Index spot instruments are inferred for NIFTY,
  BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, SENSEX and BANKEX. Other
  underlyings default to `NSE:<SYMBOL>` (or `BSE:<SYMBOL>` on BFO); pass
  `spotInstrument` when that is not the right spot symbol, for example
  SENSEX50. Expiries whose 15:30 IST close has passed are skipped.

IV and delta are Black-Scholes estimates made by Council, not Kite data. They
assume a 6.5% risk-free rate (overridable with `riskFreeRate`), no dividends
and expiry at 15:30 IST. The summary figures cover only the returned strikes.
Instrument dumps are public reference data. They are cached in process memory
per exchange per trading day and shared across accounts. Each account still
needs its own connected session to use them. Quote and historical requests are
spaced per user to stay within Kite's limits (quotes at 1 per second,
historical at 3 per second). The shared instrument download is not spaced. All
requests retry briefly on HTTP 429.

There are no order-placement tools. Agents must never place, modify or cancel
trades. For stock and options goals, agents should combine user-provided data,
read-only Kite data, attachments and web research when enabled, then publish
evidence to the board before recommending a strategy. Fundamentals, revenue,
ratios and news should come from user data or web research unless supplied in
attachments; Kite itself is primarily market/quote/instrument data.

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
- `GET/PUT/DELETE /api/integrations/kite`
  - read-only Kite market-data credential status/configuration
- `POST /api/integrations/kite/connect`, `POST /api/integrations/kite/test`
  - start a Kite login with single-use state; check the session via
    `/user/profile`
- `GET /api/integrations/kite/callback`
  - public Kite redirect target, authorized only by the single-use state

These endpoints are a practical base for an MCP server. MCP should wrap them as
tools such as `start_goal`, `send_board_message`, `attach_file`,
`watch_events`, and `cancel_run`, while preserving authentication and file-size
limits.

## Planned Media Loop

The next implementation step is a richer media/artifact contract:

1. Additional `media_generate` and `media_edit` provider adapters beyond OpenAI.
2. Generated-file storage with owner/run scoping outside the run JSON.
3. Board-visible media artifact cards and Telegram file return.
4. Agent role presets for reviewer, prompt designer, generator and critic.
5. Iteration policy: review output against goal, revise prompt, regenerate, and
   stop only when the goal is met or limits force a qualified answer.

Until then, do not claim general image editing support from Council itself.
