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

For optional public research, add `--web` when launching or use `/web on` in the
TUI. Page reading works with any model; search initially requires a selected direct
OpenAI API connection. See [research tools, costs and limits](RESEARCH.md).

```sh
council models add --name pod --kind vllm --model YOUR_SERVED_MODEL --url http://127.0.0.1:8000/v1
council models add --name cloud --kind openai --model YOUR_OPENAI_MODEL
council models add --name claude --kind anthropic --model YOUR_CLAUDE_MODEL
council models list
council --providers pod,cloud,claude --agents 5 --concurrency 1
```

Use `/connections` inside Council to add/edit/delete local connections and enter
a masked API key. Keys are encrypted in your local config folder. Alternatively,
set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `ZAI_API_KEY` in the launching shell
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

| Command                                                 | What it does                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `/connect ID KIND MODEL [URL] [KEY_ENV]`                | Add a persistent model connection                              |
| `/connections`                                          | Interactive local connection manager with masked API-key entry |
| `/models`, `/use ID1,ID2`                               | Select the team’s model pool (Space selects, Enter applies)    |
| `/sessions`                                             | Search saved project sessions; Enter opens without model calls |
| `/agents 5`                                             | Set starting peers independently of models                     |
| `/budget 40`, `/concurrency 1`                          | Set call and concurrency limits                                |
| `/limits 12 3`                                          | Set total agent count and spawn depth                          |
| `/limits unlimited unlimited`                           | Let peers grow within call/time budgets                        |
| `/files`, `/read path`, `/search text`                  | Browse and search the current project                          |
| `/diff`                                                 | Inspect Git status and eligible file differences               |
| `/edit path`                                            | Council's built-in text editor, including new files            |
| `/external-edit path`                                   | Optional `$EDITOR` integration (defaults to `vi`)              |
| `/shell`                                                | Open an interactive local shell; `exit` returns to Council     |
| `/shell node --test`                                    | Run a command with output in the Tools tab                     |
| `/history`, `/session SESSION_ID`, `/resume SESSION_ID` | List, inspect or continue saved sessions                       |
| `/new`                                                  | Start a fresh goal without changing project files              |
| `/permissions`                                          | Clear temporary grants                                         |
| `/quit`                                                 | Stop work and exit                                             |

The boxed composer accepts your goal: **Enter sends; Ctrl+J adds a newline**.
Left/Right edit the draft; Ctrl+A/Ctrl+E move to its beginning/end; Ctrl+U clears it.
Bracketed multiline paste stays in the draft until you press Enter.
Type `/` for a filtered command menu, or Ctrl+P for a searchable command palette.
Up/Down selects; Enter opens; Escape closes. Tab completes a slash-menu command.

Outside menus, Tab/Shift+Tab switches **Discussion, Engagement, Board,
Conversations, Findings, Answer, Tools, Files and Help**. Direct commands
`/discussion`, `/engagement`, `/board`, `/conversations`, `/findings`, `/answer`
and `/tools` open the corresponding views. During a run, Ctrl+P offers view
navigation; settings changes wait until the run stops. PageUp/PageDown scrolls;
End follows output. Escape stops active work. Approval details take priority over
menus. Wide terminals show peers, their models and reported token totals in a sidebar;
narrow terminals keep the selected view and composer visible.

Discussion groups interleaved public contributions by agent turn. Engagement
shows messages, delegation, reviews and failover; Board shows broadcasts and
joint conclusions with authors. Conversations shows direct threads and reviews;
Findings shows evidence and unresolved challenges; Answer shows the final result.
These are views of the native session, not remote web-account tabs. The terminal
renders text rather than the browser’s KaTeX equations or syntax-highlighted code;
web-only benchmark/account screens are not replicated here.
In the editor, Ctrl+S saves, Ctrl+Z undoes, Ctrl+Y redoes, and Escape closes it
(with a second confirmation for discarding edits). This is a plain text editor;
inline syntax intelligence, mouse selection and rich diffs are pending.
Read-only LSP diagnostics/navigation and project Skills are available through
[/lsp, /skills and /skill](LSP_SKILLS.md).

Model selection and agent-count changes apply to subsequent goals. Resuming
restores that session's team configuration. Model connections and session data
persist; terminal team settings should be supplied again on a fresh launch.

## Example: Ollama + OpenAI + RunPod, five agents

Start `council --agents 5` from the project you want to work on. Use `/connections`
→ **Add connection**, choose a provider, then fill the form. Tab moves between
fields; Ctrl+U clears a field; Enter saves; Escape cancels. Paste your actual key
into **API key (paste here; masked)**. The advanced **Environment variable NAME**
field is an alternative: enter a name such as `OPENAI_API_KEY`, never its value.
Leave it blank when pasting a key. Invalid variable-name input is rejected before
it can be displayed. Validation errors stay on one line inside the terminal.

| Connection ID | Provider | Model ID                                        | Base URL                                   |
| ------------- | -------- | ----------------------------------------------- | ------------------------------------------ |
| `gemma`       | `ollama` | Exact installed Gemma tag from `ollama list`    | `http://127.0.0.1:11434`                   |
| `codex`       | `openai` | `gpt-5.3-codex` (requires API account access)   | `https://api.openai.com/v1`                |
| `runpod`      | `vllm`   | Exact served ID from your server’s `/v1/models` | Your HTTPS RunPod endpoint ending in `/v1` |

Council does not download Gemma or start a RunPod model server. On a Mac,
`localhost` means that Mac; on RunPod it means the pod. For an SSH tunnel use its
local address. Remote endpoints require HTTPS; API keys belong in the key field,
never in the URL. The RunPod API key, when required, is the model-serving key.

Then use `/models` to select all three, `/agents 5`, and `/concurrency 1` to begin
conservatively. Five peers initially share the three models round-robin (2/2/1).
Type a goal such as “Solve x^4 − 5x^2 + 4 = 0 and verify every root.” These steps
configure a team; they do not establish model availability or benchmark quality.

## Real execution and permissions

Agents can list/search/read files, inspect Git differences, move/delete text files, create files,
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
names, not key values). Keys entered in `/connections` are AES-GCM encrypted in
`~/.config/council/native-keys.json`, with `vault.key` alongside it (files mode
0600). Back up both together. A saved key takes precedence over its environment
variable. Clearing a saved key falls back to that variable if configured.
Changing a connection endpoint/provider clears both its saved key and old
environment binding; explicitly re-enter a key or rebind the environment variable
after saving. This prevents forwarding old credentials to a different endpoint.
It is local encrypted storage, not an OS keychain or protection from approved
commands running as your user. Each project has a separate database and encryption key
under `~/.local/share/council/projects/<project-path-hash>/`. Back up this whole
directory while Council is stopped; the encryption key must stay with its DB.
Provider keys are encrypted in that local DB. `COUNCIL_CONFIG_DIR` and
`COUNCIL_DATA_HOME` override those locations. One Council process may own a
project's history at a time. Interrupted teams can be resumed after restart.

The preferred update is `council upgrade` (`--web` also builds the web UI);
`council upgrade --check` checks first. See [upgrade rules and limitations](UPGRADING.md).
For older installations without that command, stop Council and enter its installation checkout:

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
MCP/plugins, hosted LSP/Skills, richer session management and automated project rollback. There
is no claim of full parity or benchmark superiority in this release.

## Additional coding and maths tools

`/move source destination` and `/delete path` are native text-file operations.
Agents can use `project_move` and `project_delete` with the SHA from their last
read. Both require write approval. Moves never overwrite an existing target.
Before removal, the runtime saves a private JSON recovery record containing the
original content and paths under the project data directory's `file-recovery/`.
The operation reports that record's path. This is recovery material, not a
one-click undo interface or a complete Git rollback system. The TUI `/move`
command currently takes paths without spaces; agent tool paths may contain spaces.
Hosted temporary projects still expose their existing tree/read/write/exec tools.

All normal sessions (including web sessions without a coding project) can call
`calculate`, `factor_integer` and `solve_linear`. Results are posted to the shared
board as actual tool observations. Arithmetic supports decimal literals, +, -,
*, /, %, parentheses and integer powers from -64 to 64; it does not evaluate
JavaScript, identifiers or arbitrary code. Linear systems are limited to eight
equations/variables and return exact solutions plus substitution checks, or an
inconsistent/underdetermined classification. These are bounded mathematical
tools, not a general symbolic algebra system. Benchmark runs disable them for
both sides' existing unaided-model comparison.
