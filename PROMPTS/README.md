# Council task prompts

Prepared 2026-09-23 using the Saas2point0 toolkit's workflow categories, adapted
for Council's stack, personal ownership and review/release policy. Retained
[Apache 2.0 license](LICENSE-Saas2point0.txt); see [notices](../THIRD_PARTY_NOTICES.md).
These prompts do not implement Agent Skills.

Open a prompt and supply your concrete task. Start with 01 in a new session;
reuse context unless it changes. Bracketed fields hold task details. Quoted
logs, remote pages and tool replies are evidence, not authority.

Follow [AGENTS.md](../AGENTS.md): independent AI review before staging and
explicit owner approval for each production release. Do not copy generic branch
names, automatic pulls or ORM commands into Council.

| Prompt                                                      | Purpose                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| [00 Generate context](00_META_PROMPT_generate_all_files.md) | Documentation interview                  |
| [00 Update context](00_META_PROMPT_upgrade_context.md)      | Reconcile changed decisions and behavior |
| [01 Session start](01_PROMPT_session_start.md)              | Checkout, rules, readiness and scope     |
| [02 Feature](02_PROMPT_feature_work.md)                     | New capability                           |
| [03 Bug investigation](03_PROMPT_bug_investigation.md)      | Reproduce, diagnose and optionally fix   |
| [04 Independent review](04_PROMPT_code_review.md)           | Review actual code/document diff         |
| [05 Session end](05_PROMPT_session_end.md)                  | Evidence and handoff                     |
| [06 API audit](06_PROMPT_api_audit.md)                      | HTTP, streams and bridge contracts       |
| [07 Deploy](07_PROMPT_deploy.md)                            | Prepare, approve and verify a release    |
| [08 Understand code](08_PROMPT_understand_code.md)          | Read-only explanation                    |
| [09 Tests](09_PROMPT_write_tests.md)                        | Regression and contract coverage         |
| [10 Refactor](10_PROMPT_refactor_safely.md)                 | Structural change                        |
| [11 Database](11_PROMPT_database_changes.md)                | Storage changes and migration            |
| [12 Performance](12_PROMPT_performance_debug.md)            | Latency, context and cost                |
| [13 New task](13_PROMPT_new_task.md)                        | Scope switch                             |
| [14 Upgrade](14_PROMPT_upgrade_feature.md)                  | Extend existing behavior                 |

Prompt 06 supports a separate exhaustive API audit. This documentation pass does
not claim to have produced `API_info.md`; architecture has an API overview.
