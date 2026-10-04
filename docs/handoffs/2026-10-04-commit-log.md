# 2026-10-04 Commit Log

Created on 2026-10-04 in IST. This records the Council commits made today on
`main` through `775e0da`, plus the documentation-only commit that adds this file.
Times below are local `Asia/Calcutta` commit times.

## Summary

Today moved Council from a goal/media/market alpha into a more usable hosted beta
shape:

- Telegram can explicitly start a new chat and can continue a session after a
  final answer until `/new` is sent.
- Connections gained model shortcuts and reasoning-effort controls.
- Hosted signup now supports email confirmation, billing gates, payment
  screenshot submission, admin approval, quarterly pricing copy and password
  reset.
- Telegram image delivery now sends generated image artifacts back to the user.
- Zerodha Kite now supports a daily request-token refresh flow with encrypted
  API secret storage.

## Commits

### `68ea12e` - Add Telegram new chat reset

Time: 2026-10-04 08:34 IST

Purpose:
- Added Telegram `/new` and `/new chat` handling so Telegram users can detach
  from the current Council session and begin a fresh one.
- Added coverage around session reset behavior.

Files changed:
- `docs/GOALS_TELEGRAM_MEDIA_API.md`
- `server/telegram.ts`
- `src/App.tsx`
- `tests/integration.test.ts`

Verification:
- No standalone GitHub Actions run was found for this exact head SHA. It was
  included in later pushed branch states.

### `4093d77` - Add model shortcuts and reasoning effort settings

Time: 2026-10-04 08:50 IST

Purpose:
- Added connection shortcuts for newly requested model/provider choices.
- Added reasoning-effort plumbing through web, CLI and provider requests.
- Updated documentation and provider tests for reasoning effort settings.

Files changed:
- `README.md`
- `cli/index.ts`
- `cli/native.ts`
- `cli/tui.ts`
- `server/app.ts`
- `server/providers.ts`
- `shared/types.ts`
- `src/App.tsx`
- `tests/providers.test.ts`

Verification:
- GitHub Actions run `37173873883` failed for this head SHA. The failure was
  addressed by later commits.

### `e059b9c` - Update TUI workspace verifier for effort field

Time: 2026-10-04 08:53 IST

Purpose:
- Updated the TUI workspace verifier for the new reasoning-effort field.

Files changed:
- `scripts/verify-tui-workspace.py`

Verification:
- GitHub Actions run `37173950865` failed for this head SHA. The failure was
  addressed by the later browser selector fix.

### `fe94c56` - Fix connection model selector e2e

Time: 2026-10-04 10:24 IST

Purpose:
- Fixed the browser test selector around the connection/model UI after the
  shortcut and effort changes.

Files changed:
- `tests/browser/coding.spec.ts`

Verification:
- GitHub Actions run `37178359297` completed successfully.
- This successful run verified and deployed the branch state containing the
  earlier model/effort changes.

### `7308acd` - Add hosted signup confirmation and billing gate

Time: 2026-10-04 10:41 IST

Purpose:
- Added hosted email confirmation.
- Added free-message gating and backend access approval support.
- Added payment screenshot storage and email notification plumbing.
- Updated Telegram and benchmark paths to honor account limits.

Files changed:
- `README.md`
- `deploy/environment.mjs`
- `package-lock.json`
- `package.json`
- `server/app.ts`
- `server/billing.ts`
- `server/db.ts`
- `server/telegram.ts`
- `src/App.tsx`
- `src/styles.css`
- `tests/benchmarks.test.ts`
- `tests/integration.test.ts`

Verification:
- GitHub Actions run `37179143646` completed successfully and deployed.

### `24a5e6f` - Add in-app paid user approval workflow

Time: 2026-10-04 10:51 IST

Purpose:
- Added an in-app paid-user approval area for billing admins.
- Added payment screenshot review and approval workflow.
- Updated CLI/account status handling for paid access.

Files changed:
- `README.md`
- `cli/index.ts`
- `deploy/environment.mjs`
- `server/app.ts`
- `server/billing.ts`
- `server/db.ts`
- `src/App.tsx`
- `src/styles.css`
- `tests/integration.test.ts`

Verification:
- GitHub Actions run `37179677471` completed successfully and deployed.

### `070f239` - Add quarterly billing pricing and password reset

Time: 2026-10-04 12:44 IST

Purpose:
- Added quarterly fee copy for the 100,000 satoshi plan.
- Added BTC/USD pricing support with configured fallback.
- Added forgot-password and reset-password flow.
- Added billing-admin unlimited-use handling for configured admin accounts.

Files changed:
- `.env.example`
- `README.md`
- `cli/index.ts`
- `deploy/environment.mjs`
- `server/app.ts`
- `server/billing.ts`
- `src/App.tsx`
- `tests/integration.test.ts`

Verification:
- GitHub Actions run `37185195032` completed successfully and deployed.

### `6b16b8e` - Fix Telegram session flow and image delivery

Time: 2026-10-04 12:59 IST

Purpose:
- Fixed Telegram continuation behavior so a final answer does not force a new
  session by default.
- Improved Telegram `/new` command handling.
- Fixed OpenAI image generation payload shape.
- Added Telegram photo/document delivery for generated image artifacts.

Files changed:
- `docs/GOALS_TELEGRAM_MEDIA_API.md`
- `server/app.ts`
- `server/media.ts`
- `server/telegram.ts`
- `src/App.tsx`
- `tests/integration.test.ts`
- `tests/providers.test.ts`

Verification:
- GitHub Actions run `37185944981` completed successfully and deployed.

### `775e0da` - Add Kite daily token refresh

Time: 2026-10-04 13:17 IST

Purpose:
- Added encrypted Kite API-secret storage.
- Added Kite Connect request-token exchange with SHA-256 checksum generation.
- Added callback endpoint for direct Kite redirects.
- Added manual request-token refresh for cases where the Zerodha app redirects
  to an older TradingAgents callback.
- Updated Connections UI with API key, API secret, request token, login,
  disable and clear actions.
- Seeded the saved TradingAgents Kite API key and API secret only into the
  `cosmicwisdomyt@gmail.com` Council account after deployment. The stale access
  token was not copied.

Files changed:
- `server/app.ts`
- `server/kite.ts`
- `src/App.tsx`
- `tests/kite.test.ts`

Verification:
- Local `npm run check` passed.
- Local `npm test` passed with 100 tests.
- Local `npm run build` passed.
- Local `npm run test:e2e` passed with 12 Playwright tests.
- GitHub Actions run `37186881758` completed successfully and deployed.
- Production `/api/health` returned `{"ok":true}`.

### This documentation commit - Document 2026-10-04 work

Purpose:
- Adds this handoff-style commit log so the day can be reviewed later without
  reconstructing context from chat history.

Verification target:
- Documentation-only change. Push to `main` will still run the normal GitHub
  Actions verification and deployment pipeline.

## Deployment Notes

Successful deployment runs observed today:

- `37178359297` - `fe94c56` - selector fix and earlier model-effort branch state
- `37179143646` - `7308acd` - signup confirmation and billing gate
- `37179677471` - `24a5e6f` - in-app paid user approval
- `37185195032` - `070f239` - quarterly pricing and password reset
- `37185944981` - `6b16b8e` - Telegram session/image delivery fixes
- `37186881758` - `775e0da` - Kite daily token refresh

Failed intermediate runs:

- `37173873883` - `4093d77`
- `37173950865` - `e059b9c`

Those failures were superseded by later successful runs on `main`.

## Current Operational State After `775e0da`

- Hosted app: `https://councilofai.nftforger.com`
- Latest deployed revision verified before this doc: `775e0da`
- Public health verified before this doc: `{"ok":true}`
- Kite credentials are account-scoped. The saved Kite API key and secret were
  applied only to `cosmicwisdomyt@gmail.com`; access token remains empty until a
  daily Kite request-token refresh is completed.
