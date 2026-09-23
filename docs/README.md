# Council documentation

Documentation draft assembled 2026-09-23 from source and the owner's interview.
Initial implementation baseline: `ef0a1da`, v0.2.5. Feature guides and architecture
now describe the v0.2.6 candidate source; its deployment is a separate release gate. Planned business and release
policies do not imply that their infrastructure is implemented or live.

## Start here

| Document                                          | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| [AGENTS](../AGENTS.md)                            | Working rules, real layer map, tests and handoffs                    |
| [Product theory](../product_theory.md)            | Design rationale and architecture direction                          |
| [Vision](../goal_vision_bestcase.md)              | Users, controlled beta, quality and efficiency goals                 |
| [Deployment rules](../deploy_rules.md)            | Current pipeline, required review/approval gates and planned staging |
| [Server reference](../server_info.md)             | Source-backed paths/services without secrets                         |
| [Vocabulary](../business_vocabulary.md)           | Agents, sessions, runs, findings, consensus and billing terms        |
| [Business architecture](BUSINESS_ARCHITECTURE.md) | Confirmed product model, proposed components and open decisions      |
| [Known issues](KNOWN_ISSUES.md)                   | Recovery defects, limitations and future acceptance targets          |
| [Interview record](PLANNING_DECISIONS.md)         | Owner answers and unresolved planning details                        |
| [Task prompts](../PROMPTS/README.md)              | Council-specific development, review and release workflows           |

## Existing technical and user guides

- [Chat attachments](ATTACHMENTS.md): main-chat uploads and extraction limits.
- [Architecture](ARCHITECTURE.md): runtime modes, domain state, tools and roadmap.
- [Benchmarks](BENCHMARKS.md): individual problems, custom proofs and saved comparisons.
- [LSP and Skills](LSP_SKILLS.md): native configuration, tools and limitations.
- [Upgrading](UPGRADING.md): one-command native/self-hosted updates.
- [Native CLI/TUI](NATIVE.md): model configuration, local projects and upgrades.
- [Coding](CODING.md): native/hosted capabilities and exact limitations.
- [Communication](COMMUNICATION.md): broadcasts, direct threads and shared conclusions.
- [Research](RESEARCH.md): opt-in web tools and provider limitations.
- [Hosting](HOSTING.md): installation and existing release mechanics.
- [OpenCode review](OPENCODE_REVIEW.md): reference-product observations and boundaries.

## Status and maintenance

The owner confirmed independent AI review before staging and explicit approval
for every production release. The existing workflow can deploy from `main`;
the new staging/promotion path is not built. Documentation updates must respect
that distinction, including when a docs-only main push would trigger deployment.

Current capabilities are determined by source and verified behavior. Accepted
product requirements are recorded in the root context files and interview log.
Mark proposed designs and unresolved choices explicitly, and update guides when
features land. Do not silently turn an aspiration into a capability claim.

No new deployment, paid model benchmark, payment integration or runtime fix was
performed to create this documentation. The prior deferred board plan remains
in the architecture roadmap. Final draft review and the outstanding business
decisions can be completed without implementing them first.
