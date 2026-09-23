# Council of AI

[![Check](https://github.com/Docrohit/councilofAI/actions/workflows/check.yml/badge.svg)](https://github.com/Docrohit/councilofAI/actions/workflows/check.yml)

**A team of coding models and agents working toward one shared goal.**

Council is a personal, self-hostable multi-LLM orchestration project with a mobile-friendly web workspace and developer CLI. Agents are peers: they choose roles, talk directly, ask one another to investigate, invite specialists, establish shared evidence, and challenge proposed answers. There is no permanent coordinator.

> Working alpha. Includes a clearly labelled scripted demo. Automated protocol, browser, terminal and container checks validate system behavior; they do not establish real-model quality or superiority over a single model. Council is an independent project, not affiliated with OpenCode.

Read the [full architecture](docs/ARCHITECTURE.md) for execution modes, peer
collaboration, tools, storage, security, deployment and the planned LSP/MCP/skills
integrations. [Web research](docs/RESEARCH.md) is available as an opt-in feature;
LSP, MCP and Agent Skills loading remain unimplemented.

## Standalone coding CLI / TUI

Council includes its **own terminal UI, editor and local project runtime**. No
OpenCode installation, Council web server or account is required for this mode.
Use an existing repository or any directory of project files.

```sh
git clone https://github.com/Docrohit/councilofAI.git
cd councilofAI
npm ci
npm link
council models add --name local --kind ollama --model YOUR_INSTALLED_MODEL
cd /absolute/path/to/your/project
council --providers local --agents 5
```

Requires Node.js 22.18+. Use `/connect` and `/use` for mixed local/cloud models,
`/files`, `/edit`, `/diff` and `/shell` for project work, and `/history` or
`/resume` for saved sessions. Agents request permission before editing files or
running commands. See [native setup and upgrades](docs/NATIVE.md).
**Full OpenCode parity is still unfinished**; see the [capability table](docs/CODING.md#capability-status).

## Start the web app locally

Requires **Node.js 22.18+** (Node 24 LTS recommended).

```sh
git clone https://github.com/Docrohit/councilofAI.git
cd councilofAI
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:4310**, create an account, and try the scripted demo. Add actual model connections in **Connections**, test them, then select them in **Configure team**. No API key or model download is needed for the demo. Demo and real providers cannot be mixed in one run.

Production build:

```sh
npm run build
npm start
```

The project uses React, TypeScript, Express, SQLite, and server-sent events. Its default configuration binds to loopback. All state lives in `.council/`, which is excluded from Git. A local encryption key is created automatically; back it up with the database.

## Code with real project tools

Use `council` from the project directory for native multi-file coding, shell
commands and tests. The web **Coding project** offers a temporary isolated Node
workspace. The optional OpenCode adapter remains for existing installations;
it is not required by Council's own runtime. See [coding capabilities](docs/CODING.md).

## Model count and agent count are separate

| Setup                |                            Model pool | Starting agents | Delegation                                               |
| -------------------- | ------------------------------------: | --------------: | -------------------------------------------------------- |
| Small local model    |                        1 Ollama model |               5 | Optional specialist growth                               |
| Several perspectives |                    5 different models |               5 | Any peer can delegate                                    |
| Larger shared team   |                              3 models |              10 | Distributed or individually assigned                     |
| Mixed local/cloud    | Ollama + vLLM + OpenAI + Claude + GLM |     Your choice | All selected models available                            |
| Free delegation      |                     Any selected pool |     Your choice | No fixed count/depth cap; shared call/time budgets apply |

The web app supports 1–32 **starting** agents, up to 20 model connections in a pool, a configurable total-agent cap up to 128, or free delegation. Configure up to 8 simultaneous calls, 256 total calls per run, and 120 minutes. These are operational limits, not authority or reporting rules. Budget-limited work can be continued with saved agents, findings, and work ownership.

One model can back multiple independently prompted agents. It does not need five copies of its model weights. With concurrency 1, agents take turns on the same model; with higher concurrency the endpoint must have enough capacity. Multiple personas on one small model do **not** guarantee independent reasoning or improved quality.

## How collaboration works

1. Every initial peer receives the original goal and the same shared board.
2. Each peer has an inbox, its own role/task, latest contribution, and access to all shared findings and work ownership.
3. Complete action blocks are executed during generation. Peers can send direct messages or broadcasts, delegate to an existing peer, spawn a specialist on a selected model, and choose reporting relationships.
4. Established findings are stored with evidence and a stable key. Other peers are instructed to reuse them. Duplicate work claims with the same key return the existing owner/result.
5. A concrete challenge opens a dispute with a proposed discriminating recheck. Revised findings are versioned. **All involved parties, including the author and challenger, must explicitly accept the same revision before it closes.** A majority cannot close someone else’s objection.
6. Any peer can propose a final answer. The current proposal must receive explicit peer endorsements, with no open finding disputes or unfinished claimed work, to be marked complete.
7. When a budget ends first, the system returns a qualified conclusion, preserves objections, and marks the session **needs review**. Continue resumes the same goal and shared state; it does not label the goal achieved.

The model APIs used here generally accept a fixed input for each request. Messages are routed immediately, but input arriving during an active generation is delivered on that peer’s **next model turn**. Other newly scheduled peers can observe partial public findings while a model is still streaming. No hidden chain-of-thought is fabricated or extracted. Provider-returned reasoning/summaries are separately labelled; peer discussion is public generated content.

Evidence in the ledger is an **agent claim**, not automatically proven truth. Deduplication is deterministic for stable keys; agents must choose consistent keys. Semantically equivalent checks with different keys are not guaranteed to deduplicate. Unanimity can still be wrong. No harness can guarantee that every model becomes convinced or that an arbitrary goal is achievable.

## Adaptive delegation and recovery

Peers can assess one another in specific domains using established shared findings as evidence. Self-ratings do not affect the summaries, and assessments stop contributing when their evidence is disputed or revised. These are task-specific peer assessments, not independent proof of expertise. Agents can use them to change assignments and reporting relationships as work progresses.

If a provider fails, Council can move the same agent identity to another selected model while retaining its task, partial public contribution, inbox, and shared findings. State is checkpointed for continuation after interruption. Recovery requires another available model or a later restart; an unresolved objection is preserved.

## Benchmarks

The web benchmark screen compares the council with a single-model baseline on identical tasks. Choose one baseline call or give the baseline the same number of calls for sequential self-review. Reports record deterministic correctness, calls, elapsed time, and provider-reported tokens when available. Equal calls do not imply equal compute or cost.

The default thirteen original tasks are integration smoke tests, not evidence of general reasoning superiority. To prepare a reproducible sample from the official GSM8K test set:

```sh
npm run import:gsm8k -- 50 council-pilot-v1
# Set BENCHMARK_SUITE_PATH to the printed JSON path, then restart Council.
```

The importer pins the upstream revision, records the sample seed, saves the license, and makes no model calls. Use repeated paired runs, include failures, and report accuracy alongside latency and token usage. No real-model benchmark results are claimed for this checkout yet.

## Connections

| Provider                  | Base URL example               | Notes                                                          |
| ------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Ollama                    | `http://127.0.0.1:11434`       | Native streaming `/api/chat`; use an exact installed model tag |
| vLLM                      | `http://127.0.0.1:8000/v1`     | OpenAI-compatible chat completions                             |
| OpenAI                    | `https://api.openai.com/v1`    | Responses API; optional reasoning summaries                    |
| Claude                    | `https://api.anthropic.com/v1` | Messages API; optional adaptive thinking on compatible models  |
| GLM / Z.ai                | `https://api.z.ai/api/paas/v4` | Chat completions; check the endpoint for your account/plan     |
| Other compatible endpoint | Your configured base URL       | OpenAI chat-completions streaming contract                     |

Use model IDs available to **your** account or local runtime. Council does not silently choose a model or download weights. “Test” makes a small real model call and may incur usage. Reasoning is opt-in because support and parameter semantics differ by model. Native model tool-calling is not required: Council uses a validated streaming text action protocol, making small-model instruction following an important live acceptance test.

A direct `localhost` URL points to the **Council server machine**. For an Ollama/vLLM model on a visitor’s computer, use a local bridge.

### Connect a visitor’s local model to a hosted Council

1. Add an Ollama/vLLM connection with **Bridge from my computer**.
2. On that computer, clone this project and run:

```sh
npm ci
npm run cli -- login --server https://council.example.com
npm run cli -- connections
npm run cli -- worker --provider CONNECTION_ID --url http://127.0.0.1:11434
```

The worker makes outbound authenticated requests and forwards streamed output. Ollama is not exposed publicly. It only connects to a loopback model URL pinned by the person launching the worker. If the local endpoint needs a key, set `COUNCIL_MODEL_API_KEY` in that shell. Stopping a run invalidates its jobs; worker heartbeats abort abandoned calls. Model-specific cancellation latency depends on the serving runtime.

**Privacy:** bridging a local model to a hosted Council sends the task, public outputs, and any provider-exposed reasoning through the hosted server. For fully local processing and storage, run both Council and the model locally.

## Hosted-account CLI

```sh
npm run cli -- login --server http://localhost:4310
npm run cli -- connections

# One model, five independent agents, serial local inference
npm run cli -- run "Investigate this problem" --providers LOCAL_ID --agents 5 --concurrency 1

# Three models, ten agents, unrestricted delegation within a call budget
npm run cli -- run "Solve this task" --providers ID1,ID2,ID3 --agents 10 --max-agents unlimited --max-depth unlimited --max-calls 80 --concurrency 3

npm run cli -- watch RUN_ID
npm run cli -- stop RUN_ID
npm run cli -- logout
```

Tokens last 30 days, are hashed on the server, and are stored with mode `0600` under `~/.config/council/config.json`. `COUNCIL_SERVER` and `COUNCIL_TOKEN` override saved settings. The web app’s Developer CLI dialog can create or revoke tokens. These hosted commands stream activity; use plain `council` for the standalone terminal UI. Native connections and sessions are separate from your hosted account.

## Workspace tools

Agents can list/read the account’s virtual text files and propose changes. Proposed writes show the original and proposed content for review. Accepting checks the original version to prevent stale overwrites. Files belong to a Council account and are stored in SQLite; they are not arbitrary files on the server or visitor’s computer.

For real repositories, the standalone Council CLI/TUI executes its own file and
command tools in the selected directory. Its text editor includes save, undo and
redo. The hosted Coding project uses an isolated temporary Docker container with
a file tree, editor and noninteractive command console. Persistent web repositories,
embedded PTY, native LSP/MCP and advanced rollback remain unfinished. The OpenCode
adapter is optional. See [Coding](docs/CODING.md) for exact limits.

## Verification

```sh
npm run check
npm test
python3 scripts/verify-tui.py
npx playwright install chromium
npm run test:e2e
npm run build
```

Tests cover model protocol adapters, fragmented SSE/NDJSON, truncation, shared findings and dispute revision rules, work ownership, account isolation, secret encryption, replay, cancellation, live specialist startup, larger teams, resumable budget stops, and desktop/mobile browser flows. Tests use local fixtures and a labelled scripted model. They do not certify reasoning quality, live provider compatibility for every model, or hosting security at scale.

See [Architecture](docs/ARCHITECTURE.md), [Hosting](docs/HOSTING.md), [OpenCode review](docs/OPENCODE_REVIEW.md), and [Third-party notices](THIRD_PARTY_NOTICES.md).

### Broadcasts and direct collaboration

Open **Board** in a session to see the shared message board, or **Conversations**
to follow two-agent discussions. New specialists inherit the board. A direct
thread can propose a conclusion, collect explicit reviews from both participants
on the same revision, and publish their joint conclusion. Editing the proposal
clears prior votes. Unresolved proposals prevent a completed status; consensus
is a peer judgment, never proof of truth. See [Communication](docs/COMMUNICATION.md).

### Try a hosted coding project

Open **Coding project → Create isolated project**, then enable agent access.
Your next council can read, create and edit multiple files and run Node tests.
Use the editor and command terminal to inspect the result. Export your project:
these workspaces expire after 30 minutes idle, two hours total, or a broker
restart. They have no network, a 64 MB project, 256 MB memory, and 30-second
commands. For dependency installation, larger projects and full native coding
tools, use standalone Council in your local or server project directory. Details: [Coding](docs/CODING.md).

### Verification and action errors

Normal sessions include a bounded `factor_integer` tool for positive integers up
to 10^12. It computes prime factors, divisor count and a reconstructed product
using exact integer arithmetic, then publishes the observed result to the board.
The `calculate` tool evaluates bounded arithmetic expressions using exact rational numbers, and `solve_linear` handles up to eight equations/variables with exact substitution checks. These tools require no shell or coding project. This is a specific arithmetic check, not
a general guarantee of mathematical correctness. Benchmark sessions disable it
to preserve the existing comparison with an unaided single-model baseline.

Malformed action JSON is rejected with a field/format error sent back to the
agent for correction. Rejected actions are not described as successfully
published. Completion requires a work key and result; only the claim needs a
description. Repeated discussion without recorded evidence triggers a request
for a concrete check or blocker, then an early qualified stop if it continues. Models may still make errors or fail to converge.

The Answer tab contains the final answer or a qualified conclusion after the
run ends. While running, it explains that no final answer is ready. Existing
historical answers are not rewritten by an upgrade; start a fresh session when
retesting corrected behavior.
