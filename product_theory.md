# Product theory

Draft for owner review, 2026-09-23. Implementation baseline: `ef0a1da`, v0.2.5.
The [architecture](docs/ARCHITECTURE.md) describes mechanisms; this document
explains their purpose, limitations and intended direction.

## What Council is for

Council should let a user give a goal to a team of models and agents that can
work together on the same problem. Coding entire projects is a primary use
case, alongside maths, deductions, research and general work. Collaboration
should improve results through shared evidence and useful disagreement, not
just produce more conversation.

The user chooses models separately from agents: one model can serve several
agents, several models can form a team, and selected local/cloud models can mix.
Peers can change roles and delegate without a permanently privileged reasoning
leader. The harness still controls access, budgets, scheduling and completion.

## Architecture decisions and trade-offs

The effects below are evident in the implementation; where the original choice
was not documented, they are engineering interpretations rather than invented
historical explanations.

| Choice                                 | Purpose / practical benefit                                | Trade-off                                                             |
| -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| One engine in native and hosted modes  | Share collaboration behavior and fixes                     | Runtime-specific tool permissions must stay explicit                  |
| TypeScript across UI/server/CLI        | Shared contracts and one development toolchain             | Large files can accumulate too many responsibilities                  |
| React/Vite web and Express API         | Responsive browser UI with streaming backend               | Native desktop applications remain separate future work               |
| SQLite and in-process scheduling       | Small self-hosted installation                             | No coordinated multi-replica execution or financial ledger yet        |
| Persisted events plus checkpoints      | Inspectable history and interrupted-run recovery           | Separate writes and incomplete continuation state are known gaps      |
| Validated text action protocol         | Multiple providers without requiring native function calls | Small models can emit invalid/truncated actions; repair costs turns   |
| Stable finding/work keys and revisions | Reuse work and review an exact version                     | Different keys can still represent duplicate semantic work            |
| Explicit peer review                   | Make disagreements visible                                 | Agreement can be wrong; unavailable-peer rejection handling has a bug |
| Temporary hosted container broker      | Separate untrusted project execution from web process      | Networkless, short-lived projects are not full persistent workspaces  |
| Opt-in web research                    | User controls external research                            | Provider coverage and total context management remain limited         |

## Three current request paths

1. **Create account:** `server/app.ts` signup route → Zod credentials and signup/
   invite policy → `server/security.ts` password hashing → parameterized user
   and demo-provider inserts → hashed login session and cookie → user response.
   There is no email verification or credit/trial provisioning yet.
2. **Save/test connection:** authenticated provider route → owner and endpoint
   validation → encrypted credential storage → secret-free connection response.
   The separate test route loads that owner's provider, calls the adapter or
   bridge, and returns bounded test text. Testing may use paid model tokens.
3. **Start/watch work:** authenticated run route → config/provider/budget checks
   → saved queued `Run` → `Orchestrator.start` → provider calls, validated
   actions and domain state → persisted events/checkpoints → authenticated SSE
   replay and live browser updates. Closing the browser does not cancel work.

Native mode constructs `NativeCouncil`, Store and LocalProject without a hosted
login and calls the same orchestrator. This matters when designing future
account verification: it is a behavior change, not an existing entitlement.

## Design principles

- Separate claims, peer agreement, independently checked evidence and proof.
  An objection must not become resolved merely because its author disconnects.
- Share established work and corrections with provenance; recheck disputed or
  stale evidence. Do not force consensus or hide uncertainty to finish a run.
- Let domain-specific capability inform delegation. Current assessments are
  task-local peer observations, not durable learned model rankings.
- Preserve ownership/version checks across tools and agents. Native approvals
  do not turn a local process into an OS sandbox; hosted tools remain isolated.
- Separate product concepts from implementation IDs. A future billable/free
  task can include multiple runs and follow-ups under one shared allowance.
- Measure both quality and efficiency against a single agent. More agents,
  tokens or endorsements alone are not a success metric.

## Planned direction and things not to build against

Self-hosted PostgreSQL is the owner's future database direction. Timing,
migration design and the role of SQLite for standalone installations are open.
Do not require a PostgreSQL server for native use without a separate decision.
PostgreSQL alone would not make queues, tools or payments crash-safe.

Commercial direction: one account across browser, future desktop apps and CLI;
five free tasks daily with shared per-task token budgets; prepaid BTC/Lightning
credits for managed models; once-per-account BYOK activation. See the
[business plan](docs/BUSINESS_ARCHITECTURE.md). These do not exist in v0.2.5.

Prioritize consensus recovery, bounded context and evidence-based evaluation.
Extract a typed tool boundary before expanding LSP/MCP/Skills. Keep the
deferred board-evidence labelling proposal as a plan. Full OpenCode parity,
persistent hosted repositories and rich editor/PTY features remain unfinished.

## Technical debt and maintenance

The orchestrator combines scheduling, prompts, parsing, dispatch and consensus;
the API file mixes request handling and direct SQL. Some checkpoint construction
is repeated. These are actual boundaries to improve incrementally, not a reason
to impose imaginary clean layers in documentation. No deprecation/TODO marker
should be treated as the complete debt inventory.

See [known issues and acceptance targets](docs/KNOWN_ISSUES.md) for recovery,
context and operational gaps. Keep an explicit correction history when product
decisions change; the interview record is in [planning decisions](docs/PLANNING_DECISIONS.md).
