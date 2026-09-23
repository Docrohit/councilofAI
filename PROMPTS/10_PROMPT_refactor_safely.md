# Refactor Council safely

Target/reason: [module]. Trace callers, contracts, ordering and side effects.
Define preserved behavior and characterize meaningful cases. Keep defects
visible; don't combine their correction with a structural refactor silently.

For orchestrator extraction preserve action validation, event/checkpoint order,
permissions, tool serialization, failure and completion semantics. Better types
do not imply new runtime authority or features. Make scoped steps and verify
observable outcomes; fixtures cannot prove equivalence for every possible input.

Avoid unrelated dependencies/formatting churn. Update source maps, obtain an
independent review and report residual risk. Deployment follows deploy_rules.md.
