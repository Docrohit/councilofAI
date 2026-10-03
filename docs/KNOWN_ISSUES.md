# Known issues and acceptance targets

Draft, 2026-09-23; updated 2026-10-03 for the candidate recovery fixes. The
original recovery findings were reported in a separate review at `ef0a1da`.

## Consensus and continuation

| Issue                          | Current candidate status                                                                                                                                                 | Regression target                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: unavailable peer rejection | Fixed in candidate source by keeping negative candidate reviews from every peer, including unavailable peers, as unresolved objections that block `completed`; verify the deployed revision before calling production fixed. | Peer rejects candidate, then fails with no working replacement: unchanged answer must not become completed merely due to unavailability; objection remains visible until explicitly resolved |
| P2: lost active candidate      | Fixed in candidate source by saving the active candidate and reviews in shared checkpoint state and replaying them on continuation; verify the deployed revision before calling production fixed.                          | Resume restores the exact candidate/revision and outstanding objections without incorrectly retaining stale endorsements                                                                    |

Finding disputes and unresolved direct-thread proposals have separate state and
can still block completion. Do not conflate them with final-answer reviews.
Test failure, cancellation, budget stops, changed/identical candidates, multiple
reviewers and restart paths still need continued coverage as the engine evolves.

## Architecture and product gaps

| Area              | Limitation                                                                     | Acceptance direction, not shipped behavior                                                                 |
| ----------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Context           | Individual slices do not enforce a global input token budget                   | Budget all prompt sections; preserve goal, unresolved objections and evidence references during compaction |
| Durable execution | Events/checkpoints separate; queues/jobs in memory                             | Recover ownership and uncertain side effects without duplicate external actions                            |
| Tool dispatch     | Large orchestrator mixes several responsibilities                              | Typed tool contracts and runtime/permission boundaries with unchanged behavior                             |
| Model quality     | Fixture tests and small smoke benchmark suite                                  | Paired real-model trials for quality and cost efficiency, including failures                               |
| Auth              | Hosted signup lacks email verification/recovery flows                          | Define beta identity/access and anti-abuse requirements before daily free usage                            |
| Release process   | Existing main-to-production pipeline                                           | Private staging, independently reviewed changes and enforced owner-approved promotion                      |
| Billing           | No credit ledger, payment settlement, daily allowance or paid BYOK activation  | Specify policies first, then implement idempotent accounting and shared entitlements                       |
| Local accounts    | Native runtime is account-free                                                 | Explicit migration design for required account verification and offline behavior                           |
| Coding interfaces | Persistent web projects, rich editor/PTY and native apps unfinished            | Validate real project workflows; do not claim full OpenCode parity                                         |
| Extensions        | Native LSP/Skills added in candidate source; hosted extensions and MCP pending | Follow the scoped plans in architecture; share permission and evidence handling                            |
| Database          | SQLite and process-local scheduling                                            | Planned self-hosted PostgreSQL with an explicit migration/backup/native compatibility design               |

Evidence labels on the board remain **deferred by the owner**. This is not a
request to implement them alongside a recovery fix. Numerical priorities,
dates and release scope must be selected for an actual implementation task.
