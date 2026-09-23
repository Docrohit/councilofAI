# Native language servers and Skills

These capabilities are implemented in the candidate source revision. They require
Council's native CLI/TUI project runtime; the hosted web sandbox does not expose
them. No OpenCode installation is required. Production and independently installed
copies must be upgraded before these commands are available.

## Language servers

A language server supplies diagnostics, hover information, definitions and
references for files in your project. Install the appropriate server yourself;
Council never downloads or starts one merely because a repository asks it to.
Configure installed stdio servers in `~/.config/council/lsp.json`, or in
`$COUNCIL_CONFIG_DIR/lsp.json`:

```json
[
  {
    "id": "typescript",
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "languages": {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript"
    }
  }
]
```

The command must be on your PATH or use an absolute executable path. Install a
compatible TypeScript version in the project for a TypeScript server to use.
Other stdio servers can be configured, but have not all been verified. Where
extensions overlap, the first matching configuration is selected.

Inside the TUI:

```text
/lsp status
/lsp diagnostics src/main.ts
/lsp hover src/main.ts 10 5
/lsp definition src/main.ts 10 5
/lsp references src/main.ts 10 5
```

Positions entered in Council are **one-based lines and UTF-16 columns**. Raw
returned LSP ranges use the protocol's zero-based coordinates. Agents use the
same `project_lsp` tools and share one process per configured server in a native
project. Changed open files are synchronized before each request. Closed or
inaccessible files are removed from the language service's open-document set.

Starting a server requests command permission. Like an approved local shell,
a server has your OS access, may invoke project tooling and may access files
outside the project. API-key environment variables are not inherited. Keep this
configuration under your control. Council denies server-initiated edits; apply
changes through the existing approved file tools with content hashes.

Requests and writes have timeouts; Escape/Ctrl+C cancels a manual TUI operation.
Council stops language-server processes on exit. A crashed or failed-start server
can be started again on a later request, subject to permission. Diagnostics may
be pending or unversioned; neither an empty pending result nor a stale report
proves a file correct. Diagnostics and navigation supplement actual tests.

This is a read-only LSP integration, not full IDE parity: completion, rename,
code actions, formatting, editor overlays, file-watching coverage for unopened
files and hosted language-server installations remain future work. Responses
can contain external file locations, but Council's own file tools still enforce
project path restrictions.

## Project Skills

Add Skills under your project's `.agents/skills/` directory:

```text
.agents/skills/test-review/
  SKILL.md
  references/checklist.md
  scripts/check.sh
```

`SKILL.md` uses the [Agent Skills format](https://agentskills.io/specification):

```markdown
---
name: test-review
description: Review tests and look for missing regression coverage.
---

Read the project's instructions and tests. Inspect references/checklist.md.
Report actual checks and any gaps. Ask for normal command permission before
running scripts/check.sh.
```

Names must match the directory and use lowercase letters, digits and single
hyphens. Council validates YAML metadata, duplicate keys and size bounds.
Discovery follows native project file discovery, including Git ignore rules,
excluded paths and the 2,000-file discovery limit. Up to 50 candidate Skills are
examined; list results are paged eight at a time with shortened descriptions.
The system prompt includes initial metadata; full instruction bodies are fetched
only when a peer requests them.

```text
/skills
/skills 8
/skill test-review
/skill test-review - 8000
/skill test-review references/checklist.md
```

Follow the returned `nextOffset` rather than assuming a page size. Agents use
`project_skills` and `project_skill`, with `skill`, optional `resource`, and
`offset`. Bodies and resources are bounded pages; paths and file hashes identify
the source. SKILL.md is limited to 32,000 characters. References must be text
within `references/`, `scripts/` or `assets/`. Symbolic links, secret paths and
traversal are rejected. Resource scripts are read as text; loading a skill never
executes them or grants permissions. `allowed-tools` is not an approval.

Skill instructions remain subordinate to the user's task, applicable project
rules and runtime permissions. Local code and instructions sent to cloud peers
are part of their model context. `AGENTS.md` and evidence-based peer expertise
scores remain distinct from Skills.

Global skill directories, installers/marketplaces, persistent per-session skill
activation and web Skills management are not implemented. MCP remains planned.

## Source and verification

- `cli/lsp.ts`: process lifecycle, JSON-RPC, synchronization and read-only requests.
- `cli/skills.ts`: metadata parsing, discovery and paged instruction/resource reads.
- `cli/project.ts`: native permission/path boundary; `server/orchestrator.ts`: shared agent tools.
- `tests/native-tools.test.ts`: protocol, denied launch, cancellation, environment
  filtering, blocked writes, path escape, denied script execution and paging.

The integration uses Microsoft's `vscode-jsonrpc` transport and the `yaml`
parser; they do not install servers or execute Skill scripts. A disposable real
TypeScript language-server 5.0.0 probe detected an assignment error, navigated to
a definition in another file and cleared the diagnostic after a fix. This does
not establish support for every language server or model quality.
