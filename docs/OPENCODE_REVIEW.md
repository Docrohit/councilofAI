# OpenCode source review and reuse

Reviewed repository: https://github.com/anomalyco/opencode

Pinned source inspected: `fe3f3a41f79ad292cc3c7c629567385a20ec5130` (reviewed 2026-09-22).

Inspected the root MIT license, package/workspace layout, plugin API (`packages/plugin/src/index.ts`, `tool.ts`), task/subagent tool (`packages/opencode/src/tool/task.ts`), web prompt/session layout sources, and UI color tokens. The task implementation illustrates separate sessions for specialists, parent metadata, permission inheritance, background completion injection, depth limits, and model assignment.

Council adopts the session sidebar, task composer, model labels, streaming activity, expandable reasoning, and durable event concepts. The agent collaboration engine is independently implemented to support peer messaging, shared evidence, dynamic organization, and a web account boundary.

**Directly copied:** `packages/ui/src/styles/colors.css` is retained as `src/vendor/opencode-colors.css`, with OpenCode’s MIT license in `src/vendor/OPENCODE-LICENSE`.

**Adapted interaction patterns, independently implemented components:** the React web app layout and activity controls. Council is not an exact UI clone or a fork containing all of OpenCode. It does not copy OpenCode branding, claim affiliation, or provide its full terminal, editor, LSP, shell, permission, and coding-agent feature set. This scope is explicit because the intended product now includes hosted signup, mobile access, mixed model pools, and peer-to-peer collaboration.

Provider implementation references:

- Ollama chat: https://docs.ollama.com/api/chat
- OpenAI reasoning summaries: https://developers.openai.com/api/docs/guides/reasoning
- Claude streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- Z.ai API setup: https://docs.z.ai/guides/overview/quick-start
- vLLM OpenAI-compatible serving: https://docs.vllm.ai/en/latest/serving/openai_compatible_server/

## Native coding engine integration

The optional outbound coding worker now uses the upstream session, message, permission, question, path and diff APIs. Inspected generated v2 SDK types and native permission/session implementations at the same pinned revision. Council keeps peer coordination while OpenCode performs real project tools. The installed 1.18.31 runtime was exercised with a local model fixture: a real file write and Node shell test succeeded. Native TUI access is delegated to `opencode attach`; the Council web editor/PTY has not been ported. See [Coding](CODING.md) for exact availability and limits.
