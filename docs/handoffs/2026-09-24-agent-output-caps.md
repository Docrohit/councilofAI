# Handoff 2026-09-24 — per-agent output caps, agent instructions and team profiles

Branch: `codex/agent-output-caps` (local). Objective: stop reasoning models
from hitting the per-call output token limit and let specific agents get
custom system instructions and larger output budgets when forming teams.

## What changed

- `shared/types.ts` — optional `Member.maxOutputTokens` and
  `Member.systemPrompt`.
- `server/orchestrator.ts` — per-agent `maxTokens` override
  (`peer.member.maxOutputTokens ?? config.maxOutputTokens`) and
  `AGENT INSTRUCTIONS:` injected into the per-agent system prompt after
  `ROLE:`.
- `server/app.ts` — hosted member schema accepts both optional fields;
  run-wide default raised 4096 → 8192.
- `src/App.tsx` — hosted web UI default raised 4096 → 8192.
- `cli/native.ts` — default 8192; exported `applyTeamProfile(config, file)`
  (zod-validated JSON: run-wide cap plus per-agent name-matched overrides,
  unmatched names ignored); `NativeCouncil.teamFile` reapplied by `config()`;
  per-agent cap validation in `run()`.
- `cli/tui.ts` — `/tokens N` (256–16384) and `/team FILE`; `--team`/`--max-output-tokens`
  startup options; help text.
- `cli/index.ts` — `--max-output-tokens` and `--team` for the TUI, `local-run`
  and hosted `run`; validation of the hosted flag.
- `docs/NATIVE.md` — "Team profiles and per-agent output limits" section.
- `tests/agent-limits.test.ts` — profile application unit tests plus an
  end-to-end test asserting per-agent `max_tokens` and prompt injection reach
  the provider request.

## Checks actually run

- `npm run check` — passes.
- `npm test` — 84/84 pass, including the two new tests.

## Independent review

A separate AI reviewer examined the working-tree diff. Blocking finding
(hosted web UI still at 4096 in `src/App.tsx`) fixed; also fixed
validate-before-assign for `/team`, single-line team-profile errors, hosted
`run` now honors `--team` and rejects invalid `--max-output-tokens`, schema
consistency for empty `systemPrompt`, and documentation wording. Residual
risks: the Ctrl+P command menu does not list `/tokens`/`/team` (consistent
with the pre-existing omission of `/limits`); a team profile's `systemPrompt`
is trusted local configuration like the goal prompt.

## State

Local branch only; nothing committed to `main`, pushed, deployed or released.
Release approval is the owner's decision. GitHub PR: pending push.
