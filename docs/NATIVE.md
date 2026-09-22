# Standalone Council: repositories, models and terminal UI

Council 0.2 includes its own terminal UI and project runtime. It runs from the
current directory with no OpenCode installation, web server or Council account.
You still need a reachable model endpoint and, for paid providers, your own key.
This is an early native implementation, not complete OpenCode feature parity.

## Install and open a project

Requires Node.js 22.18+ and npm. macOS and Linux are the tested platforms.

```sh
git clone https://github.com/Docrohit/councilofAI.git
cd councilofAI
npm ci
npm link
council --version

# Use the exact tag installed in your Ollama server.
council models add --name local --kind ollama --model YOUR_INSTALLED_MODEL
cd /absolute/path/to/your/project
council --providers local --agents 5
```

If global npm links are unavailable, run `node /absolute/path/to/councilofAI/bin/council.mjs`
from your project. Keep the Council checkout and your coding project separate.
No build or web login is required for terminal use. A project can be a Git
repository or an ordinary directory containing many files and subdirectories.
Council reads root and applicable nested `AGENTS.md` (or `agents.md`) instructions.
Markdown and other text documentation can be read directly. PDF/Word extraction
is not a built-in tool; an agent can use an appropriate installed program through
an approved command.

## Local and cloud models together

```sh
council models add --name pod --kind vllm --model YOUR_SERVED_MODEL --url http://127.0.0.1:8000/v1
council models add --name cloud --kind openai --model YOUR_OPENAI_MODEL
council models add --name claude --kind anthropic --model YOUR_CLAUDE_MODEL
council models list
council --providers pod,cloud,claude --agents 5 --concurrency 1
```

Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `ZAI_API_KEY` in the launching shell
using your normal secret-management method. `--key-env MY_KEY_VARIABLE` chooses
a different environment variable. Do not put the key itself in `--key-env`.
Supported kinds are `ollama`, `vllm`, `openai`, `anthropic`, `glm`, `compatible`.
Models and keys must be available to your account; Council does not download
weights or transfer your ChatGPT/Claude website subscription to API billing.

One model can drive five peers; five models can drive ten peers. Peers share the
same orchestration, evidence, direct-conversation, board, delegation and recovery
logic as the web app. Public contributions are visible, not extracted private
chain-of-thought. Messages arriving during generation enter the next model turn.
Start with concurrency 1 for a small model or shared working tree.

## Terminal controls

| Command                                                 | What it does                                               |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `/connect ID KIND MODEL [URL] [KEY_ENV]`                | Add a persistent model connection                          |
| `/models`, `/use ID1,ID2`                               | Inspect connections or select the model pool               |
| `/agents 5`                                             | Set starting peers independently of models                 |
| `/budget 40`, `/concurrency 1`                          | Set call and concurrency limits                            |
| `/limits 12 3`                                          | Set total agent count and spawn depth                      |
| `/limits unlimited unlimited`                           | Let peers grow within call/time budgets                    |
| `/files`, `/read path`, `/search text`                  | Browse and search the current project                      |
| `/diff`                                                 | Inspect Git status and eligible file differences           |
| `/edit path`                                            | Council's built-in text editor, including new files        |
| `/external-edit path`                                   | Optional `$EDITOR` integration (defaults to `vi`)          |
| `/shell`                                                | Open an interactive local shell; `exit` returns to Council |
| `/shell node --test`                                    | Run a command with output in the Tools tab                 |
| `/history`, `/session SESSION_ID`, `/resume SESSION_ID` | List, inspect or continue saved sessions                   |
| `/new`                                                  | Start a fresh goal without changing project files          |
| `/permissions`                                          | Clear temporary grants                                     |
| `/quit`                                                 | Stop work and exit                                         |

Tab/Shift+Tab switches Activity, Board, Conversations, Tools, Files, Answer and
Help. PageUp/PageDown scrolls; End follows output. Escape stops active work.
In the editor, Ctrl+S saves, Ctrl+Z undoes, Ctrl+Y redoes, and Escape closes it
(with a second confirmation for discarding edits). This is a plain text editor;
syntax intelligence, LSP diagnostics, mouse selection and rich diffs are pending.

Model selection and agent-count changes apply to subsequent goals. Resuming
restores that session's team configuration. Model connections and session data
persist; terminal team settings should be supplied again on a fresh launch.

## Real execution and permissions

Agents can list/search/read files, inspect Git differences, create files,
replace exact text and execute shell commands. Every model write or command
asks for approval: allow once, reject, or allow that action kind for the current
process. Write previews include before/after text. Reads return a content hash;
stale edits are rejected and must be reread. Project tool operations serialize
across peers. Cancelling does not roll back completed edits.

Automatic file tools reject paths outside the project, symbolic links, common
secret filenames and excluded directories such as `.git` and `node_modules`.
Git's ignore rules determine file discovery. Discovery is bounded to 2,000 paths;
files can also be read directly. Text files are capped at 1 MB, editor buffers at
200 KB, and model read pages at 12,000 characters. This is not a secret scanner.
Commands have a 120-second timeout and bounded output. Cancellation terminates
the process group on macOS/Linux. Model commands do not inherit API-key environment
variables, but **approved commands have your OS permissions** and can access
resources outside the project. Use an isolated account/container for untrusted
projects. `/shell` is your own interactive shell and inherits your environment.

Selected cloud models receive the goal, retrieved file content, public evidence
and tool results. Fully local processing requires local model endpoints too.
There is no automatic synchronization between native sessions and hosted accounts.

## Headless mode

```sh
council local-run "Fix the failing tests and verify the fix" \
  --directory /absolute/path/to/project --providers local,cloud --agents 5 \
  --max-calls 40 --max-agents 12 --max-depth 3 \
  --allow-write --allow-exec
```

Without the last two flags, edits and commands are denied. These flags authorize
those kinds of action for the run; use the TUI for individual approval. A completed
council exits 0; stopped, failed or incomplete councils exit nonzero. Session IDs
are printed and can be resumed in the TUI.

## Storage and upgrades

Connections are stored in `~/.config/council/native-models.json` (key variable
names, not key values). Each project has a separate database and encryption key
under `~/.local/share/council/projects/<project-path-hash>/`. Back up this whole
directory while Council is stopped; the encryption key must stay with its DB.
Provider keys are encrypted in that local DB. `COUNCIL_CONFIG_DIR` and
`COUNCIL_DATA_HOME` override those locations. One Council process may own a
project's history at a time. Interrupted teams can be resumed after restart.

To update a clean installation, stop Council, enter its installation checkout:

```sh
git status --short
git pull --ff-only origin main
npm ci
council --version
```

Preserve or commit local modifications before pulling; do not reset them. The
`npm link` points at this checkout and normally needs no relinking. Then launch
Council again from your project directory. For a web installation also run
`npm run build` and restart its existing app service; back up its configured
data directory and vault key first. On RunPod use the persistent `/workspace`
checkout and existing model URL. Upgrading Council does not require restarting
or replacing model servers or interrupting another model workload.

## Verification and remaining scope

`npm test` includes a standalone CLI fixture that reads project instructions,
repairs a file, runs actual Node tests and records a peer-reviewed conclusion.
`python3 scripts/verify-tui.py` exercises the actual terminal editor and permission
prompt in a disposable pseudoterminal. Neither test needs OpenCode or paid models.
They validate harness behavior, not model quality.

See [capability status](CODING.md#capability-status) for missing features. The next
major gaps include persistent repo access from the web, embedded interactive PTY,
LSP/MCP/plugins, richer session management and automated project rollback. There
is no claim of full parity or benchmark superiority in this release.
