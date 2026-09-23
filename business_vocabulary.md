# Council vocabulary

Draft 2026-09-23. Separate user-facing concepts from current implementation IDs.

| Term                             | Meaning                                                       | Current source / caveat                                        |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Council                          | Team working toward one shared user goal                      | Run configuration plus orchestrator                            |
| Model                            | An inference model served locally or by an API                | Exact provider model identifier                                |
| Connection/provider              | Configured endpoint, model and credentials                    | `Provider` in `shared/types.ts`; not an agent                  |
| Agent/member/peer                | Independently prompted team identity                          | Multiple peers may use one connection                          |
| Role                             | A peer's chosen responsibility                                | Can change; not a permission grant                             |
| Coordinator                      | A voluntarily chosen organizing role                          | No permanently privileged reasoning leader                     |
| Orchestrator                     | Software scheduler and state/permission controller            | `server/orchestrator.ts`; not itself a model                   |
| Task/session (planned allowance) | One user goal including follow-ups                            | Five daily per account; one shared agent token budget          |
| Run                              | One persisted execution attempt                               | `Run.id`; continuation creates a new run                       |
| Login session                    | Authentication credential with expiry                         | `sessions` table; not a billable task                          |
| Continue                         | Resume saved team state with new execution budgets today      | Active candidate/reviews are currently omitted                 |
| Follow-up                        | New request using bounded earlier goal/answer context today   | Not equivalent to checkpoint continuation                      |
| Board                            | Shared authored broadcasts and published conclusions          | Latest posts in prompt; older posts can be read                |
| Direct conversation              | Two-peer thread, visible to account owner                     | Draft contents routed to participants; not secret from user    |
| Finding                          | Versioned claim with evidence and a stable key                | An established claim is not automatically verified truth       |
| Dispute                          | Challenge requiring explicit acceptance of the same revision  | `server/knowledge.ts`                                          |
| Work claim                       | Named task ownership used to reduce duplicate work            | Stable-key deduplication is not semantic deduplication         |
| Candidate                        | Proposed final answer and its reviews                         | Current active candidate held in memory                        |
| Consensus                        | Agreement under the harness's review rules                    | Can be wrong; unavailable-peer rejection bug remains           |
| Skill assessment                 | Evidence-linked peer evaluation within a task                 | Not Agent Skills or globally learned expertise                 |
| Agent Skill                      | Planned instruction package such as `SKILL.md`                | Loading/discovery not implemented                              |
| Bridge                           | Outbound worker connecting hosted Council to a local endpoint | Hosted server still receives routed task/output data           |
| Native project                   | Local/server directory operated through Council's CLI tools   | Requires tool approvals; not an OS sandbox                     |
| Hosted project                   | Temporary restricted Docker workspace                         | Separate from account virtual files; expires/restart-sensitive |
| Virtual file                     | Account-owned text persisted in SQLite                        | Not an arbitrary file on the server                            |
| BYOK                             | Bring your own API key/model connection                       | Key connections exist; paid activation is planned              |
| Managed usage                    | Proposed Council-billed provider usage                        | Credit accounting/pricing not implemented                      |
| Credit                           | Proposed prepaid spend balance                                | Denomination and conversion policy undecided                   |
| BTC / satoshi                    | Bitcoin / its smallest on-chain unit                          | Payment support planned; no wallet/provider configured by docs |
| Lightning                        | Proposed Bitcoin payment-network option                       | Payment integration and settlement policy open                 |
| LSP                              | Language Server Protocol for code intelligence                | Planned                                                        |
| MCP                              | Model Context Protocol for external tools/resources           | Planned                                                        |
| SSE                              | Server-sent events                                            | Browser event replay/live updates                              |
| PTY / TUI                        | Pseudo-terminal / terminal user interface                     | Native TUI exists; full embedded web PTY remains unfinished    |

## Run statuses

| Status                 | Meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `queued` / `running`   | Execution admitted or in progress                                             |
| `completed`            | Current code considers completion conditions met; not a correctness guarantee |
| `needs_review`         | A qualified result with unresolved work/disagreement or limits reached        |
| `interrupted`          | Recovery recognized a previously active run after restart                     |
| `cancelled` / `failed` | Stopped or failed execution; a final synthesized answer is not guaranteed     |

Use **public discussion**, **tool evidence** and **provider-returned summaries**
accurately. Do not call all generated discussion a model's private thinking.
Use **independent AI review** for a different reviewer's code/document review;
this development gate is separate from in-product candidate consensus.
