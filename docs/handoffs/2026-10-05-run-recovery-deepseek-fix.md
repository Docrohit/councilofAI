# Stuck-session recovery and DeepSeek allowlist fix

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-10-05.

## Incident

- **Run never started.** After the Kite and Skills release, the owner's first
  live run ("fetch the options chain data for nifty 50") never started.
  - The production log showed
    `Run failure: Unsupported state or unable to authenticate data`.
  - Two saved OpenAI connections had API keys encrypted under the encryption
    key in use before the 2026-10-04 server environment restore.
  - `store.providers(userId, true)` decrypted every connection and threw.
- **Session blocked.**
  - `engine.start` had already registered the run in `engine.active`. The
    exception escaped before the run's main `try/finally`.
  - The run stayed `queued` with no events, and the leaked slot rejected all
    new runs with "Stop or finish your active session first".
  - Stop only aborted a controller, so it could not clear the run.
- **Recovery:**
  - The owner re-entered both keys.
  - With owner approval, `councilofai.service` was restarted at 06:57 UTC. A
    read-only check showed no other running or queued runs first. Startup
    recovery marked the stuck run `interrupted`.
  - A read-only check confirmed all of the owner's saved keys now decrypt.
- **DeepSeek rejected.** Separately, adding DeepSeek V4 from the Connections
  shortcut failed with "This server does not allow that provider origin".
  - The shortcut, added in `4093d77`, points at `https://api.deepseek.com`.
  - That origin was not in the hosted default `ALLOWED_PROVIDER_ORIGINS`.
  - Production does not set that variable, so the code default applies.

## Source changes

- `server/security.ts`: the default allowlist adds `https://api.deepseek.com`.
  `.env.example` and `docs/HOSTING.md` are updated.
- `server/store.ts`: `providers()` catches decrypt errors per connection and
  sets `keyUnreadable`. It does not throw.
- `server/app.ts`:
  - `unreadableKeys` rejects new runs, continuations and benchmarks that select
    a connection with an unreadable key. The message names the connection.
  - The provider Test route returns the same message.
  - All three `engine.start(...).catch` sites call `engine.failStart`.
  - Stop marks a `queued` or `running` run `cancelled` when nothing is
    executing it.
- `server/orchestrator.ts`: `failStart` releases the active slot. If the run
  is still `queued` or `running`, it marks it `failed` with a sanitized reason.
  It never throws.
- `server/benchmarks.ts`: calls `failStart` when a council benchmark run fails
  to start.
- `src/App.tsx`, `src/styles.css`: a "Key needs re-entry" tag in Connections.
- Tests:
  - `tests/providers.test.ts`: every shortcut origin passes the hosted
    allowlist.
  - `tests/integration.test.ts`: unreadable-key flag and refusal, start
    failure releasing the session, and Stop clearing an orphaned run.

## Verification

Passed locally:

- `npm run check`
- `npm test`: 116 tests.
- `npm run build`
- `npm run test:e2e`: 12 tests.
- `git diff --check`

## Independent review

A separate reviewer agent examined the diff.

- **P2:** `failStart` could throw inside a detached `.catch` and crash the
  process on a database fault.
- **P2:** the HOSTING.md example allowlist omitted DeepSeek.
- **P3:** the provider Test button gave an unauthenticated 401 for an
  unreadable key.
- **P3:** the benchmark start path lacked cleanup.

These were fixed and re-verified.

Residual:

- Listing connections now decrypts each saved key in memory to compute the
  flag. Plaintext is never returned.
- The integration test stubs `engine.start`, not the real failure path.

## Release

The owner approved building and deploying this fix on 2026-10-05.
