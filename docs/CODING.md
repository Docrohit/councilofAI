# Coding with a Council

Council is a standalone coding harness. Its own terminal UI and local project
runtime work without OpenCode. The web app also has a bounded hosted workspace.
An optional OpenCode adapter remains available for existing users.

Start with [standalone installation, models, sessions and editing](NATIVE.md).
Run `council` inside a repository or ordinary project directory: it can use many
files, nested folders and project instructions, rather than a single upload.

## Capability status

| Capability                                                      | Native Council today                                                          | Remaining work                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Model/API selection, mixed local/cloud, independent agent count | Native CLI/TUI and web                                                        | Provider discovery, OAuth and broader model-specific validation         |
| Board, direct peer conversations, evidence/disputes, delegation | Same Council engine in native and web                                         | Real-model quality and scale evaluations                                |
| Files, search, edits, patches, commands and tests               | Native project tools with approvals                                           | Richer navigation, semantic search and rollback                         |
| Terminal UI                                                     | Own TUI, no OpenCode executable                                               | Mouse, richer layouts and command palette                               |
| Editor                                                          | Own text editor with save/undo/redo; optional external editor                 | Inline syntax intelligence and advanced diffs                           |
| Terminal                                                        | Approved commands and a handoff to an interactive local shell                 | Embedded web PTY and managed long-running processes                     |
| Sessions and recovery                                           | Local project history and checkpoint continuation; web sessions               | Session branching, selective rewind, export/share and cross-client sync |
| Usage                                                           | Calls and provider-reported tokens                                            | Reliable cost accounting and spend enforcement                          |
| Real multi-file web coding                                      | Temporary isolated Node workspace                                             | Persistent Git repositories and native local-project web bridge         |
| LSP and Skills                                                  | Native read-only stdio LSP and project Skills loading; [setup](LSP_SKILLS.md) | Hosted integrations, editor overlays and Skills activation UI           |
| MCP, plugins, formatters                                        | Can invoke installed tools through approved commands                          | First-class integrations                                                |
| Git projects                                                    | Open existing directories; inspect diffs; approved Git commands               | Managed worktrees, conflict UI and review/revert workflow               |
| General work                                                    | Text files, approved commands and opt-in web search/page reading              | Interactive browser automation and document extraction                  |
| OpenCode compatibility                                          | Optional adapter documented below                                             | Never required by native Council                                        |

**Full OpenCode parity is unfinished.** This table tracks actual native features;
OpenCode's own features are not counted as implemented Council features. The
0.2 foundation has fixture-verified project execution and a real terminal-editor
smoke test. It does not establish math/coding benchmark superiority.

## Optional: connect an existing OpenCode project

Use an existing OpenCode installation on the computer containing your project.
The worker was exercised with **OpenCode 1.18.31**; source/API review is pinned to
`fe3f3a41f79ad292cc3c7c629567385a20ec5130`.

1. Configure models in OpenCode and check their exact IDs with `opencode models`.
   Models can be local Ollama/vLLM or cloud providers. Their API keys stay in
   OpenCode. A Council OpenAI connection is not automatically imported into it.
2. In the project terminal, run `opencode serve --hostname 127.0.0.1 --port 4096`.
   `opencode web` can be used instead when you also want the native web interface.
   Use the same loopback port in the worker. If the runtime has HTTP basic auth,
   set `OPENCODE_SERVER_PASSWORD` (and optionally `OPENCODE_SERVER_USERNAME`) in
   the worker environment. Do not put the password in its URL or command line.
3. In Council → Connections, add **OpenCode coding runtime**. Use a model ID such
   as `openai/gpt-4o`, or the exact `provider/model` ID from your local runtime.
   Give the connection a name identifying the model and project.
4. From this repository, start the outbound worker:

```sh
npm ci
npm run cli -- login --server https://councilofai.nftforger.com
npm run cli -- connections
npm run cli -- coding-worker --provider CONNECTION_ID \
  --url http://127.0.0.1:4096 --directory /absolute/path/to/project
```

The directory is chosen locally and resolved to its real path. Hosted requests
cannot substitute a different runtime URL or project directory. Run **one worker
per connection**. Use another OpenCode connection/worker for each additional
model; pin all workers in a team to the same intended project. Start with one
concurrent Council call to avoid overlapping edits to the same working tree.

5. Test the connection in Council, configure your agent count independently of
   model count, and start a coding goal. A model-only connection can participate
   as a reviewer and delegate real project work to a coding peer.

Each peer gets its own persistent OpenCode session. The discussion shows native
tool calls, outputs, available session diffs, and session IDs. Completed tool
results are included in the peer's contribution to the shared board. Peers must
publish reusable findings and coordinate file ownership before editing.

## Permissions and project access

By default, new coding sessions ask for tools. **Allow once**, **Reject**, and
answers to native questions appear in the Council discussion. Requests belong
to the signed-in account and the active worker job. Replayed or cancelled
requests cannot authorize later work. Connection tests deny tools.

The local operator can explicitly add `--native-permissions` to use OpenCode's
configured policy for new sessions. Review that policy first. Council does not
silently grant every tool access. Existing sessions retain their original policy.

OpenCode runs with the operating-system permissions of its process. A pinned
working directory is **not an OS sandbox**: shell commands, MCP servers and
plugins can reach resources available to that process. Use a disposable worktree
and a container/VM for untrusted code. These OpenCode commands run on the worker computer; Council routes authenticated jobs to the worker you launch. The separate hosted workspace described below uses a constrained container. Do not run
visitor workers on the Hostinger application host.

Project prompts, public output, tool inputs/results, requested permissions and
available diffs flow through your Council account and selected models. Use a
fully local Council and local model for local-only storage/processing. Do not
include secrets in project context; output redaction is a secondary precaution,
not a sandbox or a complete secret scanner.

Stop/timeout tells the worker to abort its owned OpenCode sessions. A connection
failure invalidates jobs and normal worker heartbeats cancel abandoned work.
Force-killing the worker or losing the machine cannot guarantee immediate
cancellation inside a separately running OpenCode process; inspect/abort that
native session before restarting. Changes already made to files are not rolled
back by cancelling a run.

## Optional OpenCode interface

Use the installed OpenCode terminal interface for its native project navigation,
commands, session history, editor integration, LSP/MCP configuration and recovery
features:

```sh
npm run cli -- opencode --url http://127.0.0.1:4096 \
  --directory /absolute/path/to/project --session SESSION_ID
```

The session ID is visible in Council's coding activity. Viewing the same session
is supported; stop the Council run before issuing competing prompts in the native
interface. This is the native OpenCode UI, not a copied/reimplemented Council TUI.

## Budgets and present limits

Council's call budget counts **Council turns**. One OpenCode turn may perform
several model calls and tool invocations. Configure native agent `steps`, model
output limits and provider spend limits in OpenCode for inner-loop control;
Council's `maxOutputTokens` does not override native OpenCode settings. The
worker currently limits a turn to four minutes (including permission wait),
within the overall Council time limit. Native reported usage is accumulated for
the contribution. This is not a dollar-budget enforcement system.

Tool and diff cards retain bounded previews; the native session is the full
record. LSP, formatters, MCP, browser tools and plugins require their normal
OpenCode configuration and dependencies. They are not installed or configured
by connecting a worker. Native subagents stay native; use Council delegation
when a specialist must participate in Council's peer ledger and budgets.

## Validation

`npm test` covers request ownership, stale approval rejection, session reuse,
model mapping and protocol handling with fixtures. `npm run test:e2e` exercises
connection setup, permission responses and tool transcripts on desktop/mobile.

For a real installed runtime, with no paid model calls:

```sh
npx tsx scripts/verify-opencode.ts
```

This starts an isolated OpenCode process and a deterministic local model fixture
in a disposable Git directory. It verifies an actual file write, an actual Node
test invocation, tool outputs and a public answer, then removes its test data.
It does not touch an existing model server or certify model reasoning quality.

## RunPod handoff

No RunPod changes are needed to deploy the hosted app. When the separate Rigveda
job is deliberately paused/completed, update the Council checkout on the pod,
launch standalone Council with the existing model endpoint against a
**separate coding project**. The optional OpenCode worker is also available. Do not attach it to the Rigveda
working directory while that job is running. Volume resizing and BF16 model
changes remain with the session coordinating that work.

## Hosted coding workspace

1. Open **Coding project** from the sidebar and create an isolated project.
2. Create or import files. Enable **Allow agents to edit and run commands**.
   This authorizes project tool execution for subsequently started councils;
   it does not give agents shell access to the application server.
3. Start a goal such as “Create a two-file Node project that solves and tests
   x^4 - 5x^2 + 4 = 0; verify every root by substitution.”
4. Inspect tool outputs in Discussion. Open the project to read the files.
   Manual writes/commands are disabled during a council to avoid competing edits.
5. Export the project as JSON before it expires. Import accepts an empty project.

Model-only peers can use `project_tree`, `project_read`, `project_write`, and
`project_exec` when enabled. Writes require the SHA from the last read, or null
for new files. Operations serialize across peers; outdated writes are rejected.
The command terminal executes real shell commands; it is not a PTY and does not
support interactive programs. Each command starts afresh in `/workspace`.
Cancellation stops new tool work; an already running foreground command is
bounded by its 30-second timeout. Background processes remain contained until
project deletion/expiration.

Projects are deliberately temporary: 30-minute idle timeout, two-hour absolute
lifetime, and deletion on broker restart/deployment. Export is limited to 500
text files / 240 KB; individual editor files to 128 KB. `node_modules`, `.git`,
symlinks and binary files are not exported. Keep large/persistent projects in a
[standalone Council directory](NATIVE.md). Imported files may partially succeed if a later
file is invalid; the error is shown and existing files remain inspectable.

The root-owned broker listens only on a Unix socket accessible to the Council
service group. It offers fixed operations, not arbitrary Docker flags. Containers
run as uid 1000 with no host bind mounts, no credentials, no network, read-only
root, dropped capabilities, no-new-privileges, default Docker seccomp, 0.5 CPU,
256 MB memory/no swap, 64 processes, and bounded tmpfs mounts. At most four
containers and one per account are active. The web service is **not** in the
Docker group and receives no Docker socket. Containers share the host kernel;
this is not VM isolation or a security audit. See Docker's
[resource limits](https://docs.docker.com/engine/containers/resource_constraints/),
[tmpfs documentation](https://docs.docker.com/engine/storage/tmpfs/) and
[security model](https://docs.docker.com/engine/security/).

CI exercises actual Docker file writes, Node tests, path/symlink rejection,
read-only root, network denial, owner separation and conflicting operations.
`node --import tsx scripts/verify-council-sandbox.mjs` additionally connects a
scripted model to the real Council API and Docker broker to verify a two-agent
multi-file coding run end to end. These fixtures establish system behavior,
not model quality or benchmark superiority. Math/logic benchmarks keep hosted
tools disabled for both council and single-model sides.
