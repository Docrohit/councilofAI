# Kite Connect per-account connection and agent market-data tools

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-10-05.

## Objective

Make Zerodha Kite usable by any Council account. A user enters their own Kite
Connect app credentials and connects daily. Agents can then examine stocks,
pull option chains and answer strategy questions from live read-only data.

## Diagnosis

- The automatic callback could not work. The Council session cookie is
  `SameSite=strict`, so the browser does not send it when Kite redirects back
  from `kite.zerodha.com`. The old authenticated callback therefore had no
  user.
- The earlier "Invalid api_key" failure on the owner's account matched a
  lapsed Kite Connect subscription. The owner has since reactivated the app and
  has a new key and secret to enter. Earlier sessions inserted credentials
  server-side; this session did not. The owner enters credentials in
  Connections.
- A Kite app has one Redirect URL. The owner's app still pointed at
  TradingAgents. The owner decided to change it to Council's callback.

## Source changes

- `server/kite.ts`
  - `startKiteConnect` stores a sha256 hash of a single-use, 15-minute state.
    The state travels in Kite's `redirect_params`.
  - `completeKiteConnect` finds the account by state, consumes the state, then
    exchanges the `request_token` for an access token.
  - `kiteStatus` reports:
    - `connected`
    - `tokenExpired` (tokens issued before the latest 06:00 IST)
    - `canConnect`
    - the Kite user ID and name
  - A Kite `TokenException` clears the token, but only if the token is still
    the one that was rejected.
  - A token refresh re-reads the row before writing.
  - Credentials must be alphanumeric. Changing them clears the session.
  - Requests are throttled per user (quotes 1 per second, historical 3 per
    second) and retry briefly on HTTP 429. The shared instrument download is
    not spaced.
  - Instrument dumps are cached per exchange per trading day. Every account
    still needs its own connected session.
  - Tools:
    - `kite_instruments` (new).
    - `kite_quote`: compact output, `full`/`ohlc`/`ltp` modes, normalised
      symbols.
    - `kite_historical`: accepts `EXCHANGE:SYMBOL`, validates the interval and
      dates, returns a summary, and returns at most 250 newest candles sized
      for the tool budget.
    - `kite_option_chain`:
      - Matches the underlying name exactly and skips expired expiries.
      - Rejects a malformed `spotInstrument` with a format error.
      - Infers the index spot symbol and returns the nearest strikes.
      - Includes LTP, bid/ask, OI, volume and lot size.
      - Adds Black-Scholes IV and delta, labelled as Council estimates.
      - Summarises PCR, highest-OI strikes and max pain over the returned
        strikes.
  - `kitePromptGuide` documents the tools only while the account is connected.
    A configured but disconnected account gets a note telling agents not to
    call them.
- `server/app.ts`
  - Public `GET /api/integrations/kite/callback`, registered before session
    auth and protected by `authLimit`. It returns an HTML-escaped result page.
  - Authenticated `POST /api/integrations/kite/connect` and
    `POST /api/integrations/kite/test` (the test calls `/user/profile`).
  - The GET, PUT, test and request-token routes return status that includes
    `callbackUrl`.
- `server/orchestrator.ts`
  - Updated tool schemas: interval/exchange enums, `kite_instruments`, quote
    mode and historical options.
  - Dispatch for the new tool.
  - The prompt uses `kitePromptGuide` instead of a static Kite sentence.
- `src/App.tsx`, `src/styles.css`
  - Rebuilt the Kite section of Connections:
    - Status line and first-time setup steps.
    - Callback URL with a Copy button.
    - Save Kite app, Connect Kite (same tab) and Test connection.
    - Disable and Clear.
    - Manual request-token and access-token fallback.
- `tests/kite.test.ts`: 9 tests covering:
  - encryption and refresh
  - the state flow (single use, expiry)
  - 06:00 IST expiry
  - `TokenException` handling and prompt gating
  - option chain (exact underlying, nearest strikes, IV round trip,
    PCR/max pain, caching, mixed-case spot)
  - historical resolution and summary
  - IV bounds
  - the public callback without a cookie
  - review regressions
- `docs/GOALS_TELEGRAM_MEDIA_API.md`: Kite setup, tools, assumptions and API
  routes.

## Verification

Passed locally before release:

- `npm run check`
- `npm test`: 109 tests.
- `npm run build`: the existing Vite large-chunk warning remains.
- `npm run test:e2e`: 12 Playwright tests, desktop and mobile. This run came
  before the final server-only spot-symbol fix; the CI run covers the final
  revision.
- `git diff --check`
- A local browser preview on a throwaway data directory with fake credentials:
  - the setup steps render
  - Save Kite app works
  - Connect Kite appears
  - `/connect` returns a `kite.zerodha.com/connect/login` URL with `v=3`,
    `api_key` and `redirect_params=state=…`

Not run locally: the Docker sandbox checks (Docker is not installed here). The
GitHub workflow runs them before deploy.

No live Kite request, login or market-data call was made in this session.

## Independent review

A separate reviewer agent examined the diff:

- No P0/P1 findings.
- One P2: historical output could exceed the 20k tool budget and lose the
  newest candles.
- Seven P3s:
  - the instrument cache bypassed the per-account session check
  - stale token writes
  - the default expiry on expiry day after 15:30 IST
  - the manual-token gating
  - lowercase symbols
  - the 429 retry left the response body unread
  - doc mismatches

All were fixed. The reviewer's second pass confirmed the fixes and found one new
P3: mixed-case spot symbol lookup. It was fixed and tested.

Residual: if the shared instrument download fails, accounts waiting on it all
see the initiating account's error text. No credential is exposed.

## Release

The owner explicitly approved this release on 2026-10-05. Record the GitHub
Actions run, deployed revision and post-deploy checks in the session report.
Other self-hosted installs, including RunPod, do not update automatically.

## Owner steps after deploy

1. In developers.kite.trade, set the app Redirect URL to
   `https://councilofai.nftforger.com/api/integrations/kite/callback`.
2. In Council, open Connections, then Zerodha Kite. Paste the API key and
   secret, then click Save Kite app.
3. Click Connect Kite, sign in, then click Test connection. Reconnect each
   trading day after 06:00 IST.

TradingAgents' automatic Kite login stops once the Redirect URL changes.

## Open follow-ups

- A live smoke test: quote, historical candles and option chain for NIFTY and
  one F&O stock during market hours.
- Options strategy skills and a skills-aware agent were requested in the same
  session. They are a separate design task.
