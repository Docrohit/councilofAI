# Session handoff — benchmark controls, native tools and upgrades

Prepared under `PROMPTS/05_PROMPT_session_end.md` on 2026-09-23.
Candidate version: 0.2.6. Branch: `codex/council-tools-upgrades`.
Parent documentation commit: `4e382f7`; production/source baseline: `ef0a1da`.
The branch includes the documentation/architecture work previously published in
PR #1, plus the feature changes below. This handoff does not authorize a release.

## Objective and result

The active implementation goal covers individual-problem comparison, LSP and
Skills, deployment, and a simple upgrade command. Three source capabilities are
implemented; deployment remains pending independent review/CI and specific owner
release approval. The owner requested ending this session with a commit and PR,
not a production change.

- `src/BenchmarkWorkspace.tsx`, `server/benchmarks.ts`, `server/app.ts`: one-problem
  default, custom problems, manual proof grading, full paired answers, model/task
  snapshots, report download, owner-scoped retrieval, partial result preservation
  and corrected restart status. Reference solutions never enter solver requests.
- `cli/lsp.ts`, `cli/project.ts`, `server/orchestrator.ts`: shared native stdio
  language servers, permission-gated start, synchronized files, diagnostics,
  hover/definition/references, bounded requests/writes, cancellation and shutdown.
  Failed launches and broken pipes are contained. Server-initiated edits are denied.
- `cli/skills.ts`: project-local `.agents/skills` discovery, validated metadata,
  paged bodies/resources, source hashes, path protections and no implicit execution.
  `cli/tui.ts` exposes `/lsp`, `/skills`, `/skill` with cancellation and paging.
- `cli/upgrade.ts`, `cli/index.ts`: `council upgrade`, `--check` and `--web`, with
  official-origin, clean-main, fast-forward and native-session checks. Builds the
  web UI on request, preserves configuration/data, and does not restart services.
- New user guides: `docs/BENCHMARKS.md`, `docs/LSP_SKILLS.md`, `docs/UPGRADING.md`.
  Architecture, capability tables, vocabulary and contributor context updated.
- Dependencies: Microsoft `vscode-jsonrpc` for LSP transport; `yaml` for frontmatter.
  Neither automatically installs language servers or executes Skill scripts.

## Independent review

The separate documentation-review agent reviewed actual benchmark, native tools,
upgrade and documentation diffs before staging. Findings addressed: stale benchmark
progress after restart; upgrade help entering mutation dispatch; manual TUI LSP
cancellation; truncation/pagination of Skills; stalled language-server writes;
missing-executable/broken-pipe crashes; TUI offset wiring; stale capability docs.
Regression coverage was added for these paths. Final reviewer result and CI status
must be checked with the PR; passing local checks is not production verification.

## Validation and boundaries

Local checks include the full Node test suite, TypeScript/build, all desktop/mobile
Playwright tests, and the actual PTY script with long Skills pagination and LSP
permission/cancellation. A separate disposable TypeScript language-server 5.0.0
probe detected TS2322, navigated to another file's definition, then cleared the
error after the fix (document version 2). No paid model calls were made.

Upgrade preflight/help is regression-tested. A real user's installation has not
been upgraded through the new mutation path during this session. Upgrades are
fast-forward + dependency installation, not an atomic release/rollback system.
Docker code was unchanged; the GitHub verification job exercises Docker tests.
No private staging environment is provisioned. No web UI claims hosted LSP/Skills.

## Remaining work

1. Check the candidate PR's exact head, independent review and GitHub checks.
2. Obtain approval for that specific production release, then use the existing
   pipeline and verify the actual release SHA, services, HTTPS and representative
   user flows. Back up state and account for active tasks/temporary projects.
3. Do not treat this branch as fixing the two consensus defects in
   `docs/KNOWN_ISSUES.md`: unavailable-peer rejections and lost candidate/reviews
   on continuation. They remain open, along with total-context budgeting.
4. Hosted LSP/Skills, MCP, persistent skill activation, full editor parity,
   commercial billing/accounts, PostgreSQL, desktop packages and board evidence
   labels remain future work. Do not implement them solely from this handoff.
5. Native laptops/RunPod installations require their own upgrade. Shared model
   servers and the separate research workload have not been changed.

## Safe continuation

Read `AGENTS.md`, `deploy_rules.md`, this handoff and the new guides. Inspect
`git status`, branch, remote and personal GitHub identity first. Use Docrohit,
not employer credentials. Useful checks:

```sh
npm test
npm run build
npm run test:e2e
python3 scripts/verify-tui.py
```

Do not reset local changes, blindly pull over them, merge to `main`, dispatch a
production workflow or edit the server merely to finish the handoff.
