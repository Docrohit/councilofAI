# Goal, vision and best case

Owner interview draft, 2026-09-23. Decisions are recorded in
[planning decisions](docs/PLANNING_DECISIONS.md); numerical targets remain open.

## Purpose and positioning

Build an independent work environment where a configurable team of models and
agents tackles a shared goal, exchanges findings, resolves disagreements with
evidence and completes useful work. Entire-project coding is the initial major
use case; maths, deductions and research also matter.

For developers and people doing demanding technical work, Council aims to be a
multi-model work harness with visible peer collaboration and shared evidence,
usable through web, terminal and eventually native desktop apps. It should
combine capable coding tools with team collaboration, without requiring
OpenCode or any other coding assistant to be installed.

The ambition is broad global adoption. No user, revenue or valuation target has
been approved. Reliable measured outcomes take precedence over a claim to be
the best at every task or to have already achieved full OpenCode parity.

## Users and distribution

Initial users: the owner and invited beta testers, especially developers working
with local/cloud models and existing repositories. Gradually involve selected
human contributors. Open registration follows evaluation of reliability,
coding quality and costs; the documentation does not change live signup policy.

| Surface                 | Current                                             | Intended direction                                                     |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| Desktop/mobile browser  | Responsive web app with signup/login                | Common account, daily free tasks and prepaid managed usage             |
| CLI/TUI                 | Native account-free mode plus hosted-account client | Online account verification and shared commercial entitlements         |
| macOS/Windows/Linux app | No native desktop package                           | Same account and payment model; packaging/runtime design open          |
| Self-hosting            | Available with local/cloud connections              | BYOK activation once per account; offline and distribution policy open |

## Confirmed business model

- Five free sessions daily per account, shared across interfaces.
- One session means one task with follow-ups and a fixed token budget shared
  by all its agents. A new task uses another session. Token cap/reset rules
  remain undecided.
- Managed-model usage uses prepaid credits purchased with BTC/Lightning
  satoshis, with proceeds reaching the owner's wallet. Pricing remains open.
- BYOK activation is a one-time fee per account across devices and self-hosted
  installations. Provider API usage is distinct from Council's activation fee.
- Billing, daily allowances, cross-client entitlement enforcement and desktop
  applications are planned, not shipped. See [business architecture](docs/BUSINESS_ARCHITECTURE.md).

## What beta must measure

The owner selected **both quality and efficiency**, evaluated separately.

| Measure               | Evaluation                                                        | Target                             |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| Answer quality        | Correctness with independently scored maths/reasoning tasks       | Numerical threshold undecided      |
| Coding success        | Completed repository tasks validated by tests/review              | Task suite and threshold undecided |
| Budget efficiency     | Council vs single agent under comparable cost/token limits        | Required improvement undecided     |
| Time to useful result | End-to-end latency, including repair and failures                 | Threshold undecided                |
| Reliability           | Completion, unresolved objections, recovery and repeated failures | Threshold undecided                |
| Operating economics   | Provider/tool/hosting costs versus proposed charges               | Pricing not selected               |
| Adoption              | Invited-user use, repeat use and feedback                         | Counts/dates undecided             |

Compare against capable single-agent baselines with comparable tools and clearly
stated budgets. Record model versions, prompts, dataset revisions, seeds,
attempts, failures and usage. Do not equate calls with tokens or tokens with
money. Current thirteen-task smoke tests do not prove broad superiority.

## Best case and decision criteria

Best case: people choose Council because it reliably finishes meaningful work,
uses disagreement productively and shows when the additional collaboration is
worth its cost. Self-hosting remains practical, hosted use is convenient and
the product can sustain its operating costs. Adoption and financial targets
will be chosen after beta evidence rather than invented for this document.

Alternative workflows include a single coding agent, OpenCode-like tools and
manually coordinating several models. Council's proposed differentiation is
shared evidence, flexible peer delegation and cross-model collaboration. This
is positioning, not a current competitive performance ranking.

Prioritize changes that improve useful completion, preserve evidence/objections,
support real projects and make quality/cost measurable. Do not trade honest
`needs_review` outcomes for a cosmetic increase in completed tasks.
