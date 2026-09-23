# Audit Council APIs

Scope: [all / named feature]. Inspect server/app.ts, middleware, schemas, web
callers, hosted CLI, bridge and sandbox contracts. This is documentation work
unless fixes were requested.

For every route record method/path, purpose, request/response schemas, status,
auth/ownership, side effects, external calls, consumers and event behavior.
Trace asynchronous work, SSE replay and cancellation explicitly. Don't infer
latency measurements, unused status or model compatibility from source alone.
Exclude secrets and real account payloads.

Document configurable models as configuration. Mark billing/trial/desktop APIs
unimplemented rather than inventing endpoints. Produce API_info.md for the
declared scope with conventions, call paths and gaps. Validate route coverage
and links, obtain independent review, and report audit limitations.
