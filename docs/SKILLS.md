# Account Skills and the Skills Agent

Skills are reusable expert playbooks in the
[Agent Skills format](https://agentskills.io/specification) (`SKILL.md` with YAML
frontmatter). The same format is used by Claude Code. Built-in and
account skills work in hosted web runs and Telegram-started runs. Native CLI/TUI
runs get the built-in skills; there is no native command to add account skills
yet. Native project Skills under `.agents/skills/` remain separate; see
[LSP and project Skills](LSP_SKILLS.md).

## Kinds of skills

| Kind     | Where it lives                        | Who sees it                 |
| -------- | ------------------------------------- | --------------------------- |
| Built-in | `server/skills/<name>/` in this repo  | Every account               |
| Account  | `skills` table, added in **Skills**   | Only the account that added |
| Project  | `.agents/skills/` in a native project | Native runs in that project |

Built-in skills shipped today:

- `option-chain-analysis`: spot, ATM, IV against HV20/HV60, skew, OI support
  and resistance, PCR, max pain and expected move from live Kite data.
- `option-buying-strategy`: long calls/puts, debit spreads, straddles and
  strangles, priced and compared with `option_strategy`.
- `option-spread-strategy`: verticals, credit spreads, iron condors and
  butterflies, with management, margin and gap-risk checks.

Built-in names are reserved; an account skill cannot reuse one.

## Adding a skill

Open **Skills** in the sidebar. Then do one of the following:

- Upload a skill folder: `SKILL.md` plus `references/`, `scripts/` or
  `assets/`.
- Pick `SKILL.md` with any reference files. Loose files are stored under
  `references/`.
- Paste `SKILL.md` text.

`SKILL.md` needs frontmatter. The `name` must be lowercase letters, digits and
single hyphens, at most 64 characters. The `description` says when to use the
skill, at most 1024 characters. Uploading a skill with an existing name
replaces it.

Limits:

- `SKILL.md` up to 32,000 characters
- up to 20 text resources of 32,000 characters each
- 200,000 characters in total per skill
- 50 skills per account

Binary files are skipped in the browser and rejected by the server. Each skill
can be switched off without deleting it.

API (authenticated):

- `GET /api/skills`
- `GET /api/skills/view/:name`
- `POST /api/skills` with `{files:[{path,content}]}`
- `PATCH /api/skills/:id` with `{enabled}`
- `DELETE /api/skills/:id`

Account skills are owner-scoped.

## How agents use skills

Every peer prompt lists enabled skills by name, source and a shortened
description, up to 40; the rest are available through `skill_list`. The tools
are:

```json
{"tools":[{"name":"skill_list"}]}
{"tools":[{"name":"skill_load","skill":"option-buying-strategy"}]}
{"tools":[{"name":"skill_load","skill":"my-skill","resource":"references/guide.md"}]}
```

`skill_load` returns 8,000-character pages; peers follow `nextOffset`. Loading a
skill posts a short board note so other peers know it is in use. A goal update
(`/goal`), board message, direct message or Telegram message changes the task.
Peers, including the Skills Agent, are instructed to re-check which skills
apply; this is prompt guidance, not an enforced step.

Skills are guidance only. They cannot grant tools, permissions or budget. They
never override the user, Council's rules or project permissions. Scripts are
stored as text and never executed. An account skill can steer only its owner's
runs.

## Skills Agent

New runs include a **Skills Agent** peer unless the team setting is off. Turn it
off in Configure team on the web, with `/skills-agent off` in the TUI, or with
`skillsAgent: false` in the API run config. It uses the connection of the first
team member on a chat model, otherwise the first selected chat model.
It counts toward model calls like any peer. It is skipped when the team has only
OpenCode coding connections, when the team already fills the maximum-agents
limit, or when the call budget is below the team size plus three. Benchmarks never
include it, and they disable skills and `option_strategy`.

Its standing instructions are to:

1. match the task against the skill list on its first turn and after guidance
   changes;
2. post which skills apply and their required steps;
3. apply them or assign steps to peers;
4. review proposed answers against each applied skill's required checks,
   rejecting answers that skip them.

It is a peer, not a supervisor: the normal consensus and objection rules apply.

## option_strategy

`option_strategy` is a deterministic calculator for 1-8 legs with a single
expiry (CE, PE or FUT; buy or sell; strike, premium, lots, optional per-leg IV).
It returns:

- net debit/credit
- max profit and loss, including unlimited detection
- breakevens
- an expiry payoff table
- probability of profit (lognormal)
- expected move
- net delta, gamma, theta per day and vega

All amounts are for the whole position. Results exclude brokerage, taxes,
margin and skew; the output states these assumptions. Calendars and diagonals
are not modelled. `kite_historical` daily summaries now include HV20 and HV60
for IV comparisons.

## Source and verification

- `shared/skills.ts`: the SKILL.md parser shared with native project Skills.
- `server/skills.ts`: built-in loading, account storage, validation, paging,
  prompt text and the Skills Agent instructions.
- `server/skills/*/SKILL.md`: built-in skills.
- `server/options.ts`: Black-Scholes, implied volatility and the strategy
  calculator.
- `server/orchestrator.ts`: tools, prompt catalog and Skills Agent membership.
- `src/SkillsWorkspace.tsx`: the Skills page.
- `tests/skills.test.ts` and the Skills API test in `tests/integration.test.ts`.

Not implemented: marketplaces or installers, sharing skills between accounts,
executing skill scripts, and per-skill tool permissions.
