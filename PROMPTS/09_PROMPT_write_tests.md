# Add meaningful Council tests

Target: [behavior/regression]. Inspect source and neighboring tests. Choose
Node test/tsx, Playwright, PTY or actual Docker for the boundary. Explain the
expected behavior and why each scenario matters.

Tests-only scope does not authorize runtime changes. Report discovered bugs or
retain a failing reproduction; don't weaken assertions. Avoid tests mirroring
implementation. Use disposable providers/data and distinguish fixtures from
live model quality evaluation.

Cover relevant malformed streams, ownership, permissions, disputes, continuation,
failures and concurrency. Future billing tests must include duplicate events
and shared-budget races. Run new/adjacent checks and report actual results,
not invented coverage percentages. Obtain independent review before staging.
