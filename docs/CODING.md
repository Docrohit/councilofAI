# Coding with a Council

Coding is the primary product direction. Council adds a shared goal, peer messages,
work ownership, evidence, challenges and adaptive delegation to an **actual
OpenCode coding runtime**. It does not approximate shell execution with proposed
text files.

## Connect a project

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
and a container/VM for untrusted code. The public Council server never executes
these commands; it routes authenticated jobs to a worker you launch. Do not run
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

## Full native interface

Use the installed OpenCode terminal interface for its native project navigation,
commands, session history, editor integration, LSP/MCP configuration and recovery
features:

```sh
npm run cli -- code --url http://127.0.0.1:4096 \
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

| Capability | Current availability |
| --- | --- |
| Peer discussion, delegation, evidence/disputes, mixed models | Council web and CLI |
| Real file reads/edits, commands and tests | OpenCode worker; write/bash verified against installed runtime |
| Live tool results, approvals, questions, diff previews | Council web; CLI prints activity and directs approvals to web |
| Persistent coding session per peer | Worker session mapping survives worker restart |
| Full OpenCode terminal UI | `council code` / native OpenCode attach |
| Native OpenCode web UI, LSP, MCP, skills, plugins, formatters | Provided by configured OpenCode runtime; not all combinations tested |
| Full native editor, file tree, PTY, undo/revert controls inside Council web | Not yet integrated |
| One-click hosted isolated coding sandboxes | Not implemented; bring a worker/container |
| Distributed replicas and durable worker leases | Not implemented; single Council server |
| Real-model coding benchmark superiority | Not established |

This is a working coding integration, **not yet full web-feature parity with
OpenCode**. The remaining UI and hosted workspace work must be tracked and tested
before making that claim.

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
use the prepared OpenCode configuration/model endpoint and launch the coding
worker against a **separate coding project**. Do not attach it to the Rigveda
working directory while that job is running. Volume resizing and BF16 model
changes remain with the session coordinating that work.
