# Council documentation interview

Updated: 2026-09-23. Working record for the requested Saas2point0
`00_META_PROMPT_generate_all_files.md` workflow. This is an interview draft,
not an assertion that the planned features or operational controls exist.
The six root context files and Council-specific `PROMPTS/` have been drafted
for review. Remaining commercial details are explicitly open and can be decided
later; they do not prevent documenting the agreed direction. Start with the
[documentation index](README.md).

## Scope and established direction

- Personal project owned by Rohit under `Docrohit/councilofAI`; separate from
  Hygaar and its infrastructure/accounts.
- Independent multi-model work harness, with coding as a primary use case and
  support for mathematics, research and other work. Council must not require
  OpenCode to operate.
- Flexible model and agent counts; local/cloud mixtures; peers exchange direct
  messages and broadcasts, share evidence, challenge findings and adapt roles.
  Permission, resource and completion controls remain enforced by the harness.
- Assess usefulness against single-model baselines; do not claim superior
  accuracy merely because several agents agree.
- Current task is documentation and interactive planning, before implementing
  the reviewed recovery fixes. Board evidence labels remain deferred.

## Confirmed development decisions

| Area               | User decision                                                                                                     | Implementation status / qualification                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Team               | Owner plus AI coding agents now; selected human collaborators gradually                                           | Governance direction                                                             |
| Environments       | Local development, private staging, production                                                                    | Staging is planned; no staging provisioned in this interview                     |
| Addresses          | Existing production domain plus proposed `staging.councilofai.nftforger.com`                                      | Proposed staging hostname; DNS and setup not verified                            |
| Isolation          | Plan separate staging services, data and configuration                                                            | Target design, not deployed configuration                                        |
| Review             | Every change receives independent AI review before staging, including documentation/cosmetic changes              | Mandatory workflow requirement; enforcement not yet built/verified               |
| Releases           | Every production release, including small fixes, requires the owner's explicit approval                           | Passing checks does not authorize production deployment                          |
| Technical Q&A      | Use option c: inspect source for technical/operational answers; ask the owner for decisions code cannot establish | Do not invent historical reasons for stack choices                               |
| Database direction | Later move toward self-hosted PostgreSQL                                                                          | No migration date or scope selected; native/local storage treatment remains open |

The checked-in GitHub Actions workflow currently verifies changes and deploys
eligible `main` runs to production. It does not implement the newly selected
staging promotion workflow. External GitHub approval/protection settings are
not established by reading the YAML. Avoid triggering the existing production
pipeline without release-specific owner approval.

## Confirmed business direction

All of this section describes the owner's intended business model, not existing
billing functionality.

**Launch strategy:** controlled beta with the owner and invited testers first.
Evaluate reliability, coding quality and costs before opening registration
broadly. This decision does not change the current deployment's signup settings;
beta access configuration and measurable launch gates still need implementation
or confirmation as appropriate.

**Confirmed beta evaluation priorities: both quality and efficiency.** Evaluate
answer correctness and successful coding-task completion against single-agent
baselines, reporting additional cost and latency. Separately compare outcomes
under comparable token/cost budgets. Keep these evaluations distinct: an
unconstrained quality improvement is not evidence of better budget efficiency.
Numerical success thresholds and benchmark selection remain open; no superiority
claim is established by this planning decision.

1. **Browser:** people sign up and log in to use the responsive desktop/mobile
   web application. Five sessions per day per account are free, shared across
   web, desktop and CLI. Paid usage accepts BTC or
   Lightning satoshis, with proceeds reaching the owner's wallet.
2. **Desktop later:** native applications for macOS, Windows and Linux, using
   the same account and payment model, drawing from the shared daily allowance.
3. **CLI:** online account verification will be required, with the same payment
   model. This is a deliberate proposed change from today's account-free
   standalone native runtime.
4. **Managed model usage:** users recharge credits using BTC/Lightning;
   usage pricing is based on token costs. Rates, markup, exchange-rate policy
   and the budget per free session have not been decided.
5. **BYOK:** users may supply their own API keys, as the owner does today, across
   self-hosted, browser and desktop-app use. The requested Council charge is
   a one-time BYOK activation fee, once per account across the user's devices
   and self-hosted installations. The amount remains undecided; detailed
   billing and activation mechanics will be planned later.

**Confirmed free-session definition:** one task, including follow-up messages,
with a fixed token budget shared across all agents working on that task.
Starting a new task consumes another session from the daily allowance.
The numerical token limit remains undecided. This product definition must not
be equated automatically with today's individual run IDs: continuations and
follow-ups will need to share the task's allowance and budget.

Do not add a wallet address, payment vendor, custody arrangement, exchange rate,
refund policy, price or billing implementation without establishing those
decisions. No payment provider has been selected and no funds are being moved.

## Source-backed baseline

- React/TypeScript browser frontend; Express/Node.js backend; shared TypeScript
  orchestrator for native and hosted execution.
- SQLite via `node:sqlite` in `server/db.ts`, used by hosted and native stores.
- Existing hosted signup and login, encrypted provider credentials, and a
  standalone CLI/TUI. See `server/app.ts`, `server/store.ts`, `cli/native.ts`.
- Current native CLI does not require a hosted account. Account enforcement,
  shared billing entitlements, payment credits, daily free-session allowances and BYOK
  activation fees are planned changes, not current capabilities.
- Release/build checks: `.github/workflows/check.yml`; release mechanics:
  `deploy/deploy.sh`; existing reference: `docs/HOSTING.md`.
- Known recovery issues: unavailable peers' negative candidate reviews can cease
  blocking completion; continuation does not restore the active candidate and
  reviews. Preserve these as unresolved issues until fixed and tested.

## Questions still open

- What numerical token cap applies to each free session? The allowance is five
  tasks per day per account across interfaces, with follow-ups included and a
  shared agent token budget. Reset timezone or rolling-window mechanics remain
  undecided.
- How does account verification work for self-hosted/offline installations?
  BYOK activation is confirmed as once per account across devices and
  self-hosted installations, not a separate fee per installation.
- Are fully local Ollama/vLLM models treated like BYOK for activation purposes?
- What functionality and hosted resources are included in the activation fee?
- How should paid credits handle token prices, other tool costs, failed calls,
  concurrent work, reservations, rounding and refunds?
- BTC/Lightning payment integration, confirmation policy and wallet setup.
- Pricing, target adoption/revenue and first-release success thresholds.
- Staging branch/promotion mechanics and production approval enforcement.
- PostgreSQL migration scope, triggers and native SQLite compatibility.

Further questions should be asked individually, using established conversation
answers and source inspection wherever possible.
