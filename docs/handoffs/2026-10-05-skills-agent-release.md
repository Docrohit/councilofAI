# Account Skills, options skills and Skills Agent release

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-10-05.

## Objective

The owner asked for three things:

- Council should use skills of any kind, and users can add their own.
- Three options-trading skills should be available to everyone.
- An always-on "skills agent" should find relevant skills for each goal or
  message, then suggest or apply them.

The motivating request: "I want a call and put buying strategy for stock X
using real-time option chain data" should produce the best evidence-based
answer.

## Decisions

- Owner chose a real peer with a toggle, on by default, over a free matcher.
- Owner chose user uploads in this phase, with the three options skills
  universal.
- Third-party "options skills" from a Gemini answer were not imported. Their
  sources could not be verified, and they depend on executing Python scripts
  and on US data sources. Council's own skills use the read-only Kite tools
  and a deterministic calculator instead.

## Source changes

- `shared/skills.ts`: the SKILL.md parser, moved from `cli/skills.ts`, which
  re-exports it. Native project Skills are unchanged.
- `server/skills.ts`:
  - built-in skill loading from `server/skills/<name>/`
  - account skill storage, validation, paging and the prompt catalog
  - Skills Agent instructions
- `server/skills/*/SKILL.md`: `option-chain-analysis`,
  `option-buying-strategy`, `option-spread-strategy`.
- `server/db.ts`: a new `skills` table, owner-scoped with `ON DELETE CASCADE`.
- `server/options.ts`:
  - Black-Scholes and IV, moved from `kite.ts`
  - `analyzeStrategy`: profit and loss regions, breakevens, lognormal
    probability of profit and Greeks
- `server/kite.ts`: HV20 and HV60 in the daily historical summary.
- `server/orchestrator.ts`:
  - New tools: `skill_list`, `skill_load` and `option_strategy`.
  - Prompt catalog of skills.
  - The Skills Agent is added to new runs unless `skillsAgent === false`. It
    is skipped for benchmarks, OpenCode-only teams, a full `maxAgents` cap, or
    `maxCalls` below team size plus three.
  - Board notes for loaded skills are de-duplicated.
- `server/app.ts`:
  - `/api/skills` routes (list, view, upload, enable/disable, delete).
  - `skillsAgent` defaults to true in the run config; benchmarks force it off.
- `src/SkillsWorkspace.tsx`, `src/App.tsx`, `src/styles.css`:
  - Skills page with upload, view, toggle and delete.
  - Sidebar entry.
  - Skills Agent toggle in Configure team.
- `cli/tui.ts`: `/skills-agent on|off` and a status line.
- Tests:
  - `tests/skills.test.ts`: new.
  - `tests/integration.test.ts`:
    - a Skills API and Skills Agent test
    - the scripted `cfg` helper now sets `skillsAgent: false`, because those
      scenarios count peers exactly
- Docs:
  - `docs/SKILLS.md`: new.
  - `docs/LSP_SKILLS.md`, `docs/README.md` and `AGENTS.md`: updated.

## Verification

Passed locally:

- `npm run check`
- `npm test`: 114 tests.
- `npm run build`: the existing chunk-size warning remains.
- `npm run test:e2e`: 12 tests.
- `python3 scripts/verify-tui.py` and `python3 scripts/verify-tui-workspace.py`
- `git diff --check`
- A local browser preview of the Skills page (upload, toggle, view) and of the
  Configure team toggle.

Not run locally: the Docker sandbox checks. The workflow runs them.

Not done: live model runs using the skills, and live Kite data.

## Independent review

A separate reviewer agent examined the diff.

- **P1:** `option_strategy` breakevens and probability of profit were wrong for
  zero-plateau payoffs such as zero-cost risk reversals.
- **P2:** the Skills Agent could exceed `maxAgents` and the call-budget
  assumptions.
- **Eight P3s:**
  - prototype-key resource lookup
  - mismatched upload limits
  - inverted toggle notice
  - hidden-folder uploads
  - inconsistent expected-move guidance
  - doc mismatches
  - snapshot and board-note duplication
  - demo coverage

All were fixed. On its second pass the reviewer confirmed the fixes; it also
fuzzed 3,000 random strategies against numerical integration. Its remaining
nits about wording were applied.

Residual: when the cap or budget skips the Skills Agent, the run does not
notify the user.

## Release

The owner approved this release on 2026-10-05. Record the workflow run,
deployed revision and live checks in the session report.

## Follow-ups

- A live market-hours run, for example "call and put buying strategy for
  RELIANCE".
- A notice when the Skills Agent is skipped.
- Native account-skill management.
- Skill sharing between accounts, if wanted.
