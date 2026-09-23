import { emitKeypressEvents } from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  NativeCouncil,
  loadModels,
  saveModel,
  nativeDefaults,
  nativeConfigDirectory,
  removeModel,
  type NativeModel,
} from "./native.ts";
import type { CouncilEvent, Run, RunConfig } from "../shared/types.ts";
import type { ProjectPermission } from "../shared/project.ts";
import { hasNativeKey, saveNativeKey } from "./credentials.ts";
import { Dialog } from "./tui-dialog.ts";
import {
  commands,
  livePeers,
  viewNames,
  sessionView,
  fit,
  wrapCells,
} from "./tui-workspace.ts";
export const cleanTerminal = (text: string) =>
  text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
export const terminalRow = (text: string, width: number) =>
  fit(cleanTerminal(text).replace(/[\r\n\t]+/g, " "), width);
export function wrapTerminal(text: string, width: number) {
  return wrapCells(cleanTerminal(text).replace(/\t/g, "  "), width);
}
const tabs = viewNames;
const help = `COUNCIL — standalone, no OpenCode installation or web login required.

Enter a goal to let your agents work in this directory.
/connections                           Add/edit connections; masked encrypted API keys
/models                                Choose models with Space, then Enter
/sessions                              Search saved sessions in this project
/connect ID KIND MODEL [URL] [KEY_ENV]   Add a connection with environment-based keys
/use ID1,ID2                            Select the team's models
/agents 5                               Five agents, independent of model count
/budget 40                              Maximum Council model calls
/web on | off                           Enable/disable public web research
/skills [OFFSET]                       List project Skills
/skill NAME [RESOURCE|-] [OFFSET]       Read paged skill instructions or resources
/lsp status                            Show configured language servers
/lsp diagnostics PATH                  Read language-server diagnostics
/lsp hover|definition|references PATH LINE COLUMN  Inspect a symbol (one-based)
/concurrency 1                          Concurrent agents (start with one for coding)
/limits 12 3                            Total agents and spawn depth; unlimited allowed
/files                                  Browse the project file list
/read docs/design.md                    View a text file
/search timeout                         Find literal text across project files
/diff                                   Review Git changes
/delete path                            Delete a text file after approval; save recovery copy
/move source destination                Move a text file without overwriting the destination
/edit src/main.js                       Open Council’s built-in text editor
/external-edit src/main.js              Open a file in $EDITOR (defaults to vi)
/shell                                  Open your interactive shell; exit to return
/shell node --test                      Run a command and inspect its output
/history                                List saved sessions for this directory
/session SESSION_ID                     Open saved activity without making model calls
/resume SESSION_ID                      Continue a checkpointed team
/new                                    Start a fresh conversation
/permissions                            Clear session permission grants
/help                                   Show this page
/quit                                   Exit Council

Examples:
/connect local ollama YOUR_INSTALLED_MODEL
/connect cloud openai gpt-4o
Use /connections to enter keys privately, or export the connection’s key environment variable.
Keys entered here are encrypted in your local Council config folder, never in project files.
These local connections and sessions are separate from your web account.

Type / or Ctrl+P for the command menu. Enter sends; Ctrl+J adds a line.
/discussion /engagement /board /conversations /findings /answer open team views.
Tab / Shift+Tab switches views. PageUp/PageDown scrolls; End follows live output.
Esc stops active work. Ctrl+C stops a run, or exits when idle.
Writes and commands ask permission. Local shell commands have your OS access;
the project path is not a sandbox. Public output and files read by agents go to
the selected model providers. Session history stays in your local Council data folder.
Web research is opt-in: /web on. Search uses a selected OpenAI API connection.
LSP servers require configuration and command permission. Skills are project-local.
PDF/Word parsing, interactive browsing and MCP integrations remain pending.
`;
export interface TuiOptions {
  webResearch?: boolean;
  directory: string;
  agents?: number;
  ids?: string[];
  maxCalls?: number;
  concurrency?: number;
  maxAgents?: number | null;
  maxDepth?: number | null;
  prompt?: string;
}
export async function startTui(options: TuiOptions) {
  if (
    options.maxCalls !== undefined &&
    (!Number.isInteger(options.maxCalls) ||
      options.maxCalls < 4 ||
      options.maxCalls > 256)
  )
    throw new Error("Choose a call budget of 4–256.");
  if (
    options.concurrency !== undefined &&
    (!Number.isInteger(options.concurrency) ||
      options.concurrency < 1 ||
      options.concurrency > 8)
  )
    throw new Error("Choose concurrency of 1–8.");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Council TUI needs an interactive terminal. Use council local-run for noninteractive work.",
    );
  let input = "",
    tab = 0,
    scroll = 0,
    busy = false,
    closing = false,
    suspended = false,
    status = "Ready",
    notice = "";
  let dialog: Dialog | undefined;
  let cursor = 0,
    menuIndex = 0,
    menuDismissed = false,
    pasting = false,
    pasteText = "";
  let activeGoal = "";
  let displayModels: NativeModel[] = [];
  let config: RunConfig | undefined, current: Run | undefined;
  const events: CouncilEvent[] = [];
  let filesContent = "",
    additionalTools = "";
  type EditState = {
    path: string;
    text: string;
    saved: string;
    sha: string | null;
    row: number;
    col: number;
    undo: string[];
    redo: string[];
    discard?: boolean;
  };
  let editor: EditState | undefined;
  let manualController: AbortController | undefined;
  const grants = new Set<string>();
  let permission:
    | { request: ProjectPermission; resolve: (value: boolean) => void }
    | undefined;
  let repaint: NodeJS.Timeout | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const council = new NativeCouncil(
    options.directory,
    (request, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        if (grants.has(request.kind)) {
          resolve(true);
          return;
        }
        const abort = () => {
          if (permission?.resolve === answer) permission = undefined;
          resolve(false);
          draw();
        };
        const answer = (value: boolean) => {
          signal.removeEventListener("abort", abort);
          permission = undefined;
          resolve(value);
          scroll = 0;
          draw();
        };
        dialog = undefined; // Approval details always take priority over menus.
        permission = { request, resolve: answer };
        signal.addEventListener("abort", abort, { once: true });
        scroll = 0;
        draw();
      }),
  );
  function configure(
    ids?: string[],
    count = config?.members.length ?? options.agents ?? 3,
  ) {
    const next = council.config(ids, count);
    displayModels = loadModels();
    if (config) {
      const { members, providerIds } = next;
      config = { ...config, members, providerIds };
      config.maxCalls = Math.max(config.maxCalls, count + 2);
      if (config.maxAgents !== null)
        config.maxAgents = Math.max(config.maxAgents, count);
    } else {
      config = next;
      config.webResearch = !!options.webResearch;
      if (options.maxCalls !== undefined) config.maxCalls = options.maxCalls;
      if (options.concurrency !== undefined)
        config.concurrency = options.concurrency;
      if (options.maxAgents !== undefined) config.maxAgents = options.maxAgents;
      if (options.maxDepth !== undefined) config.maxDepth = options.maxDepth;
    }
  }
  try {
    configure(options.ids);
  } catch (e) {
    notice = (e as Error).message;
  }
  const name = (id: string) =>
    current?.sharedState?.peers.find((p) => p.member.id === id)?.member.name ||
    config?.members.find((m) => m.id === id)?.name ||
    events.find(
      (e) => ["agent.join", "agent.spawn"].includes(e.type) && e.data.id === id,
    )?.data.name ||
    id;
  function body() {
    if (permission)
      return `${permission.request.title}\n\n${permission.request.detail}\n\n[User approval required]`;
    if (editor)
      return (
        `${editor.path} · ${editor.text === editor.saved ? "saved" : "modified"} · line ${editor.row + 1}, column ${editor.col + 1}\n` +
        editor.text
          .split("\n")
          .map(
            (line, i) =>
              `${i === editor!.row ? ">" : " "}${String(i + 1).padStart(4)} ${i === editor!.row ? line.slice(0, editor!.col) + "│" + line.slice(editor!.col) : line}`,
          )
          .join("\n")
      );
    if (tabs[tab] === "Help") return help;
    if (tabs[tab] === "Files")
      return filesContent || "Use /files, /read path, /search text or /diff.";
    const content = sessionView(tabs[tab], events, current, name);
    return tabs[tab] === "Tools" ? additionalTools + "\n" + content : content;
  }
  function suggestions() {
    if (
      menuDismissed ||
      busy ||
      dialog ||
      editor ||
      permission ||
      !/^\/[^\s]*$/.test(input)
    )
      return [];
    return commands.filter((c) =>
      c.command.startsWith(input.slice(1).toLowerCase()),
    );
  }
  function draw() {
    if (suspended || closing) return;
    const width = Math.max(20, process.stdout.columns || 80),
      height = Math.max(10, process.stdout.rows || 24);
    const row = (text: string, w = width) => terminalRow(text, w);
    const draft = input.slice(0, cursor) + "│" + input.slice(cursor);
    const draftLines = wrapTerminal(draft || "│", width - 4);
    const inputRows = Math.min(3, Math.max(1, draftLines.length));
    const area = Math.max(1, height - 9 - inputRows);
    const sidebar = width >= 115 && !editor && !permission && !dialog ? 30 : 0;
    const mainWidth = width - (sidebar ? sidebar + 3 : 0);
    const lines = wrapTerminal(
      dialog && !permission ? dialog.lines(area) : body(),
      mainWidth - 2,
    );
    const bottom = dialog
      ? 0
      : editor && !permission
        ? Math.max(
            0,
            Math.min(lines.length - area, editor.row - Math.floor(area / 2)),
          )
        : Math.max(0, lines.length - area - scroll);
    const visible = lines.slice(bottom, bottom + area);
    const menu = suggestions();
    if (menu.length) {
      menuIndex = Math.min(menuIndex, menu.length - 1);
      const start = Math.max(0, menuIndex - Math.min(4, area - 2));
      const choices = menu.slice(
        start,
        start + Math.max(1, Math.min(7, area - 1)),
      );
      const menuLines = [
        "Commands · ↑/↓ choose · Enter open · Esc dismiss",
        ...choices.map(
          (c, i) =>
            `${start + i === menuIndex ? "›" : " "} /${c.command}  ${c.description}`,
        ),
      ];
      while (visible.length < area) visible.push("");
      visible.splice(
        Math.max(0, area - menuLines.length),
        menuLines.length,
        ...menuLines,
      );
    }
    const tokenCount = events
      .filter((e) => e.type === "turn.done" || e.type === "research.done")
      .reduce(
        (n, e) => n + (e.data.inputTokens || 0) + (e.data.outputTokens || 0),
        0,
      );
    const calls = events.filter(
      (e) => e.type === "turn.start" || e.type === "research.start",
    ).length;
    const peers = livePeers(
      current?.sharedState?.peers.map((p) => p.member) || config?.members || [],
      events,
    );
    const side = [
      "THE COUNCIL",
      "",
      ...peers.flatMap((p) => [
        p.name + (p.unavailable ? " (unavailable)" : ""),
        "  " +
          (displayModels.find((m) => m.id === p.providerId)?.model ||
            p.providerId),
      ]),
      "",
      `${calls}/${config?.maxCalls || 24} calls`,
      `${tokenCount.toLocaleString()} tokens reported`,
      `Web research: ${config?.webResearch ? "on" : "off"}`,
      "",
      "/models · /agents",
      "/sessions · /connections",
    ];
    // Keep the active view visible even when all labels will not fit.
    let nav = tabs.map((t, i) => (i === tab ? `[${t}]` : t)).join("  ");
    if (nav.length > width)
      nav = `‹ Tab  [${tabs[tab]}]  ${tab + 1}/${tabs.length}  Shift+Tab ›`;
    const frame = [
      row(` Council  |  ${current?.title || activeGoal || council.directory}`),
      row(
        ` ${status} · ${config?.members.length || 0} agents · ${config?.providerIds.join(", ") || "no models"} · ${calls}/${config?.maxCalls || 24} calls`,
      ),
      row(nav),
      row("─".repeat(width)),
      ...Array.from({ length: area }, (_, i) =>
        sidebar
          ? row(visible[i] || "", mainWidth) +
            " │ " +
            row(side[i] || "", sidebar)
          : row(visible[i] || ""),
      ),
      row(dialog?.error || notice),
      row(
        "┌─ " +
          (busy ? "Working · Esc stop" : "Ask Council") +
          " ─".repeat(Math.ceil(width / 2)),
      ),
      ...Array.from(
        { length: inputRows },
        (_, i) =>
          row(
            "│ " +
              (permission
                ? i
                  ? ""
                  : "[y] once · [a] session · [n] reject"
                : editor
                  ? i
                    ? ""
                    : "Ctrl+S save · Ctrl+Z undo · Esc close"
                  : dialog
                    ? i
                      ? ""
                      : "Complete the dialog above · Esc cancel"
                    : busy
                      ? i
                        ? ""
                        : "Tab views · Ctrl+P commands · PageUp/PageDown scroll"
                      : input
                        ? draftLines.slice(
                            Math.max(
                              0,
                              wrapTerminal(input.slice(0, cursor), width - 4)
                                .length - inputRows,
                            ),
                          )[i] || ""
                        : i
                          ? ""
                          : "Ask anything… Type / for commands  │"),
            width - 1,
          ) + "│",
      ),
      row(
        `└─ ${config?.members.length || 0} agents · ${config?.providerIds.join(" + ") || "/connections to add models"}`,
      ),
      row(" Enter send · Ctrl+J newline · Ctrl+P commands · Tab views · /quit"),
    ];
    process.stdout.write(
      "\x1b[H" + frame.slice(0, height).join("\r\n") + "\x1b[J",
    );
  }
  function schedule() {
    if (!repaint)
      repaint = setTimeout(() => {
        repaint = undefined;
        draw();
      }, 50);
  }
  function notify(event: CouncilEvent) {
    events.push(event);
    if (event.type === "run.status") status = event.data.status;
    if (event.type === "run.final") tab = 5;
    schedule();
  }
  async function run(goal: string, previous = current, resume = false) {
    if (!config) throw new Error("Configure a model first with /connect.");
    const previousDisplay = {
      current,
      events: [...events],
      activeGoal,
      tab,
      status,
    };
    busy = true;
    notice = "";
    events.length = 0;
    current = undefined;
    activeGoal = goal;
    tab = 0;
    scroll = 0;
    status = "Starting";
    draw();
    try {
      current = await council.run(goal, config, notify, previous, resume);
      status = current.status;
    } catch (error) {
      // Admission errors happen before the first event. Keep the selected
      // conversation so a corrected retry remains a follow-up.
      if (!events.length) {
        current = previousDisplay.current;
        events.push(...previousDisplay.events);
        activeGoal = previousDisplay.activeGoal;
        tab = previousDisplay.tab;
        status = previousDisplay.status;
      }
      throw error;
    } finally {
      busy = false;
      draw();
    }
  }
  async function external(command: string, args: string[]) {
    suspended = true;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: council.directory,
          stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", () => resolve());
      });
    } finally {
      process.stdin.resume();
      process.stdin.setRawMode(true);
      process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
      suspended = false;
      draw();
    }
  }
  function numberDialog(cmd: string, title: string, value: number) {
    const fields = [
      {
        label: title,
        value: String(value),
        hint: "Applies to subsequent goals in this chat.",
      },
    ];
    dialog = new Dialog(
      title,
      [],
      async () => {
        await command(`/${cmd} ${fields[0].value}`);
        dialog = undefined;
      },
      fields,
    );
  }
  function modelDialog() {
    const models = loadModels();
    if (!models.length) {
      connectionDialog();
      return;
    }
    const d = new Dialog(
      "Models for this team",
      models.map((m) => ({
        id: m.id,
        title: m.id,
        detail: `${m.kind} · ${m.model}`,
      })),
      (ids) => {
        if (!ids.length)
          throw new Error("Select at least one model with Space.");
        configure(ids);
        dialog = undefined;
        notice =
          "Model pool updated. Models are shared across the selected agent count.";
      },
      undefined,
      true,
    );
    d.selected = new Set(config?.providerIds || models.map((m) => m.id));
    dialog = d;
  }
  function connectionDialog() {
    dialog = new Dialog(
      "Local connections · separate from your web account",
      [
        { id: "+", title: "Add connection" },
        ...loadModels().map((m) => ({
          id: m.id,
          title: m.id,
          detail: `${m.kind} · ${m.model}`,
        })),
      ],
      ([id]) => {
        if (!id) return;
        if (id === "+") {
          dialog = new Dialog(
            "Choose provider",
            Object.keys(nativeDefaults).map((id) => ({
              id,
              title: id,
              detail:
                id === "ollama"
                  ? "Local model server"
                  : id === "vllm"
                    ? "RunPod or another vLLM server"
                    : undefined,
            })),
            ([kind]) => {
              if (kind) connectionForm(kind);
            },
          );
        } else {
          const m = loadModels().find((m) => m.id === id)!;
          dialog = new Dialog(
            `${m.id} · ${m.model}`,
            [
              { id: "edit", title: "Edit model, endpoint or API key" },
              {
                id: "clear",
                title: "Remove saved API key",
                detail: "Environment key, if configured, still applies",
              },
              { id: "delete", title: "Delete connection" },
            ],
            ([action]) => {
              if (action === "edit") connectionForm(m.kind, m);
              if (action === "clear") {
                saveNativeKey(nativeConfigDirectory(), m.id, "");
                notice = "Saved key removed.";
                dialog = undefined;
              }
              if (action === "delete")
                dialog = new Dialog(
                  `Delete ${m.id}?`,
                  [
                    { id: "cancel", title: "Keep connection" },
                    { id: "delete", title: "Delete connection and saved key" },
                  ],
                  ([answer]) => {
                    if (answer === "delete") {
                      removeModel(m.id);
                      const ids =
                        config?.providerIds.filter((id) => id !== m.id) || [];
                      if (ids.length) configure(ids);
                      else config = undefined;
                      notice =
                        "Connection removed. Existing session transcripts are retained.";
                    }
                    connectionDialog();
                  },
                );
            },
          );
        }
      },
    );
  }
  function connectionForm(kind: string, existing?: NativeModel) {
    const defaults = nativeDefaults[kind];
    const fields = [
      {
        label: "Connection ID",
        value: existing?.id || kind,
        hint: existing
          ? "Use the same ID when editing. Add a separate connection for a new ID."
          : "A short name, e.g. gemma, codex or runpod.",
      },
      {
        label: "Model ID",
        value: existing?.model || (kind === "openai" ? "gpt-5.3-codex" : ""),
        hint: "Exact served model ID. For Ollama use ollama list; for vLLM use /v1/models.",
      },
      {
        label: "Base URL",
        value: existing?.baseUrl || defaults.url,
        hint: "For vLLM, include /v1. Endpoint changes clear saved keys AND environment bindings; re-enter a key below or rebind after saving.",
      },
      {
        label: "API key (paste here; masked)",
        value: "",
        secret: true,
        hint:
          existing && hasNativeKey(nativeConfigDirectory(), existing.id)
            ? "Blank keeps the saved key if the endpoint is unchanged."
            : "Paste the actual API key here. Optional for local servers without authentication.",
      },
      {
        label: "Environment variable NAME (advanced)",
        value: existing?.keyEnv || "",
        hint: "Alternative to pasting a key: e.g. OPENAI_API_KEY. Leave blank when using the masked field above.",
        validate: (value: string) =>
          !value || /^[A-Z][A-Z0-9_]*$/.test(value)
            ? undefined
            : "Use a variable NAME such as OPENAI_API_KEY, or leave blank. Paste keys in the masked API key field above.",
      },
    ];
    dialog = new Dialog(
      `Connection · ${kind}`,
      [],
      () => {
        const [id, model, baseUrl, key, keyEnv] = fields.map((f) =>
          f.value.trim(),
        );
        if (existing && existing.id !== id)
          throw new Error(
            "Keep this ID unchanged; use Add connection for a new ID.",
          );
        if (/[\r\n\x00]/.test(key)) throw new Error("Enter a single API key.");
        if (!id || !/^[a-zA-Z0-9_-]{1,60}$/.test(id))
          throw new Error(
            "Use a connection ID of 1–60 letters, numbers, underscores or hyphens.",
          );
        if (!model || model.length > 200)
          throw new Error("Enter the exact model ID (1–200 characters).");
        if (!baseUrl) throw new Error("Enter the model server's base URL.");
        saveModel({ id, kind, model, baseUrl, keyEnv: keyEnv || undefined });
        if (key) saveNativeKey(nativeConfigDirectory(), id, key);
        const ids = [...new Set([...(config?.providerIds || []), id])];
        configure(ids);
        fields[3].value = "";
        dialog = undefined;
        notice =
          existing && (existing.baseUrl !== baseUrl || existing.kind !== kind)
            ? `Saved ${id}. Old key/environment binding cleared; edit again to bind an environment key.`
            : `Saved ${id}. /models selects the pool; /agents sets the team size.`;
      },
      fields,
    );
  }
  function sessionsDialog() {
    dialog = new Dialog(
      "Saved sessions · this project only",
      council.store.runs(council.userId).map((r) => ({
        id: r.id,
        title: r.title,
        detail: `${r.status} · ${r.createdAt}`,
      })),
      async ([id]) => {
        if (id) {
          await command(`/session ${id}`);
          dialog = undefined;
        }
      },
    );
  }
  async function chooseCommand(value: string) {
    const cmd = value.split(" ")[0];
    const direct = [
      "connections",
      "models",
      "agents",
      "sessions",
      "new",
      "files",
      "web",
      "skills",
      "lsp",
      "budget",
      "concurrency",
      "resume",
      "diff",
      "permissions",
      "quit",
      ...tabs.map((t) => t.toLowerCase()),
    ];
    if (direct.includes(cmd)) {
      try {
        await command("/" + value);
      } catch (e) {
        notice = (e as Error).message;
      }
    } else {
      input = "/" + value + " ";
      cursor = input.length;
      notice = "Add arguments, then Enter. /help shows usage.";
    }
    draw();
  }
  function palette() {
    const available = busy
      ? commands.filter((c) =>
          tabs.some((t) => t.toLowerCase() === c.command && t !== "Files"),
        )
      : commands;
    dialog = new Dialog(
      busy ? "Views · team is working" : "Council commands",
      available.map((c) => ({
        id: c.command,
        title: "/" + c.command,
        detail: c.description,
      })),
      async ([value]) => {
        if (value) {
          dialog = undefined;
          await chooseCommand(value);
        }
      },
    );
  }
  async function command(value: string) {
    if (!value.startsWith("/")) {
      await run(value);
      return;
    }
    const [cmd, ...words] = value.slice(1).trim().split(/\s+/),
      arg = words.join(" ");
    if (cmd === "quit") {
      await quit();
      return;
    }
    const view = tabs.findIndex(
      (t) => t.toLowerCase() === cmd && t !== "Files",
    );
    if (view >= 0) {
      tab = view;
      scroll = 0;
      return;
    }
    if (cmd === "connections" || (cmd === "connect" && !arg)) {
      connectionDialog();
      return;
    }
    if (cmd === "sessions") {
      sessionsDialog();
      return;
    }
    if (cmd === "agents" && !arg) {
      numberDialog(cmd, "Starting agents (1–32)", config?.members.length || 5);
      return;
    }
    if ((cmd === "budget" || cmd === "concurrency") && !arg) {
      numberDialog(
        cmd,
        cmd,
        cmd === "budget" ? config?.maxCalls || 24 : config?.concurrency || 1,
      );
      return;
    }
    if (cmd === "web" && !arg) {
      dialog = new Dialog(
        "Web research",
        [
          { id: "off", title: "Off" },
          { id: "on", title: "On", detail: "May incur OpenAI search fees" },
        ],
        async ([mode]) => {
          if (mode) {
            await command("/web " + mode);
            dialog = undefined;
          }
        },
      );
      return;
    }
    if (cmd === "connect") {
      const [id, kind, model, url, keyEnv] = words;
      const defaults = nativeDefaults[kind];
      if (!id || !model || !defaults)
        throw new Error(
          "Use /connect ID KIND MODEL [URL] [KEY_ENV]. Kinds: openai, anthropic, glm, ollama, vllm, compatible.",
        );
      const saved = saveModel({
        id,
        kind,
        model,
        baseUrl: url || defaults.url,
        keyEnv: keyEnv || defaults.keyEnv,
      });
      configure();
      notice = `Saved ${id}. ${saved.keyEnv ? `Key source: ${saved.keyEnv}. Restart Council after exporting it.` : "No API key required by this configuration."}`;
      return;
    }
    if (cmd === "skills" || cmd === "skill" || cmd === "lsp") {
      busy = true;
      manualController = new AbortController();
      status = "Reading project tools";
      draw();
      try {
        const signal = manualController.signal;
        let result;
        if (cmd === "skills")
          result = await council.project.execute(
            { action: "skills", offset: Number(words[0] || 0) },
            signal,
          );
        else if (cmd === "skill")
          result = await council.project.execute(
            {
              action: "skill",
              name: words[0] || "",
              resource: words[1] === "-" ? undefined : words[1],
              offset: Number(words[2] || 0),
            },
            signal,
          );
        else {
          const operation = words[0] || "status";
          if (
            ![
              "status",
              "diagnostics",
              "hover",
              "definition",
              "references",
            ].includes(operation)
          )
            throw new Error(
              "Use /lsp status|diagnostics|hover|definition|references [PATH LINE COLUMN].",
            );
          result = await council.project.execute(
            {
              action: "lsp",
              operation: operation as "status",
              path: words[1],
              line: Number(words[2]),
              character: Number(words[3]),
            },
            signal,
          );
        }
        filesContent = JSON.stringify(result, null, 2);
        tab = 7;
        scroll = 0;
      } finally {
        busy = false;
        manualController = undefined;
        status = "Ready";
      }
      return;
    }
    if (cmd === "models") {
      modelDialog();
      return;
    }
    if (cmd === "use") {
      configure(arg.split(","));
      notice = "Model pool updated.";
      return;
    }
    if (cmd === "agents") {
      configure(config?.providerIds, Number(arg));
      notice = "Agent count updated.";
      return;
    }
    if (cmd === "web") {
      if (!config) throw new Error("Configure a model first.");
      if (!["on", "off"].includes(arg))
        throw new Error("Use /web on or /web off.");
      config.webResearch = arg === "on";
      notice = `Web research ${config.webResearch ? "enabled; search may incur OpenAI search fees" : "disabled"}. Applies to subsequent goals.`;
      return;
    }
    if (cmd === "budget" || cmd === "concurrency") {
      if (!config) throw new Error("Configure a model first.");
      const n = Number(arg),
        min = cmd === "budget" ? config.members.length + 2 : 1,
        max = cmd === "budget" ? 256 : 8;
      if (!Number.isInteger(n) || n < min || n > max)
        throw new Error(`Choose ${min}–${max}.`);
      if (cmd === "budget") config.maxCalls = n;
      else config.concurrency = n;
      notice = `${cmd} updated to ${n}.`;
      return;
    }
    if (cmd === "limits") {
      if (!config) throw new Error("Configure a model first.");
      const [agents, depth] = words.map((v) =>
        v === "unlimited" ? null : Number(v),
      );
      if (
        words.length !== 2 ||
        (agents !== null &&
          (!Number.isInteger(agents) ||
            agents < config.members.length ||
            agents > 128)) ||
        (depth !== null &&
          (!Number.isInteger(depth) || depth < 0 || depth > 16))
      )
        throw new Error(
          "Use /limits AGENTS DEPTH: agents up to 128, depth 0–16, or unlimited.",
        );
      config.maxAgents = agents;
      config.maxDepth = depth;
      notice = `Delegation: ${agents ?? "unlimited"} agents, depth ${depth ?? "unlimited"}. Call and time budgets still apply.`;
      return;
    }
    if (cmd === "permissions") {
      grants.clear();
      notice = "Session grants cleared; future writes and commands will ask.";
      return;
    }
    if (cmd === "new") {
      current = undefined;
      activeGoal = "";
      events.length = 0;
      tab = 0;
      status = "Ready";
      notice = "New conversation; project files remain.";
      return;
    }
    if (cmd === "history") {
      filesContent =
        council.store
          .runs(council.userId)
          .map((r) => `${r.id} · ${r.status}\n${r.title}`)
          .join("\n\n") || "No saved sessions.";
      tab = 7;
      scroll = 0;
      return;
    }
    if (cmd === "session") {
      const saved = arg ? council.store.getRun(council.userId, arg) : undefined;
      if (!saved) throw new Error("Choose a session ID from /history.");
      current = saved;
      config = saved.config;
      events.length = 0;
      for (const event of council.store.events(saved.id)) events.push(event);
      status = saved.status;
      tab = saved.final ? 5 : 0;
      scroll = 0;
      notice =
        "Saved session opened. A new goal follows up; /resume continues its checkpoint.";
      return;
    }
    if (cmd === "resume") {
      const prior = arg ? council.store.getRun(council.userId, arg) : current;
      if (!prior) throw new Error("Choose a session from /history.");
      config = prior.config;
      await run(prior.prompt, prior, true);
      return;
    }
    if (cmd === "files") {
      filesContent =
        (await council.project.files()).join("\n") ||
        "No text project files found.";
      tab = 7;
      scroll = 0;
      return;
    }
    if (cmd === "read") {
      const f = await council.project.read(arg);
      if (f.sha === null) throw new Error("File not found.");
      filesContent = `${arg}\n\n${f.content}`;
      tab = 7;
      scroll = 0;
      return;
    }
    if (cmd === "delete" || cmd === "move") {
      const source = cmd === "delete" ? arg : words[0];
      if (!source || (cmd === "move" && words.length !== 2))
        throw new Error(
          "Use /delete path or /move source destination (paths without spaces for /move).",
        );
      const original = await council.project.read(source);
      if (!original.sha) throw new Error("File not found.");
      busy = true;
      manualController = new AbortController();
      try {
        const result = await council.project.execute(
          cmd === "delete"
            ? { action: "delete", path: source, sha: original.sha }
            : {
                action: "move",
                path: source,
                destination: words[1],
                sha: original.sha,
              },
          manualController.signal,
        );
        filesContent = JSON.stringify(result, null, 2);
        tab = 7;
        notice = "File operation completed; recovery copy saved.";
      } finally {
        busy = false;
        manualController = undefined;
      }
      return;
    }
    if (cmd === "search" || cmd === "diff") {
      if (cmd === "search" && !arg) throw new Error("Supply text to search.");
      filesContent = JSON.stringify(
        await council.project.execute(
          cmd === "diff"
            ? { action: "diff" }
            : { action: "search", query: arg },
          new AbortController().signal,
        ),
        null,
        2,
      );
      tab = 7;
      scroll = 0;
      return;
    }
    if (cmd === "shell" && !arg) {
      await external(process.env.SHELL || "/bin/sh", []);
      return;
    }
    if (cmd === "edit") {
      if (!arg) throw new Error("Use /edit relative/file/path.");
      const file = await council.project.read(arg);
      if (file.content.length > 200000)
        throw new Error("Use /external-edit for files over 200 KB.");
      editor = {
        path: arg,
        text: file.content,
        saved: file.content,
        sha: file.sha,
        row: 0,
        col: 0,
        undo: [],
        redo: [],
      };
      tab = 7;
      scroll = 0;
      return;
    }
    if (cmd === "external-edit") {
      if (!arg) throw new Error("Use /external-edit relative/file/path.");
      await council.project.read(arg);
      const [editor, ...args] = (process.env.EDITOR || "vi").split(/\s+/);
      await external(editor, [...args, path.join(council.directory, arg)]);
      return;
    }
    if (cmd === "shell") {
      busy = true;
      status = "Running command";
      tab = 6;
      draw();
      try {
        manualController = new AbortController();
        const result = await council.project.execute(
          { action: "exec", command: arg },
          manualController.signal,
        );
        additionalTools += `\n$ ${arg}\n${result.stdout}${result.stderr}\nExit ${result.exitCode}\n`;
        status = "Ready";
      } finally {
        busy = false;
        manualController = undefined;
      }
      return;
    }
    throw new Error("Unknown command. Use /help.");
  }
  async function submit() {
    if (busy) return;
    const value = input.trim();
    input = "";
    cursor = 0;
    menuDismissed = false;
    if (!value) return;
    notice = "";
    try {
      await command(value);
    } catch (e) {
      notice = (e as Error).message;
      busy = false;
      status = "Ready";
    }
    draw();
  }
  async function quit() {
    if (closing) return;
    closing = true;
    permission?.resolve(false);
    council.stop();
    manualController?.abort(new Error("Stopped by user"));
    if (repaint) clearTimeout(repaint);
    try {
      await council.close();
    } finally {
      process.stdin.off("keypress", key);
      process.stdout.off("resize", draw);
      process.off("SIGTERM", terminate);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
      finish();
    }
  }
  function terminate() {
    void quit();
  }
  function key(str: string, k: any = {}) {
    if (suspended || closing) return;
    if (k.sequence === "\x1b[200~") {
      pasting = true;
      pasteText = "";
      return;
    }
    if (k.sequence === "\x1b[201~") {
      pasting = false;
      const text = cleanTerminal(pasteText.replace(/\r/g, "\n"));
      pasteText = "";
      if (permission || busy || editor) {
        notice =
          "Paste ignored during work or in the editor. Use ordinary keys.";
        draw();
        return;
      }
      if (dialog) void dialog.key(text, {}, true).then(draw);
      else {
        input = (input.slice(0, cursor) + text + input.slice(cursor)).slice(
          0,
          20000,
        );
        cursor = Math.min(input.length, cursor + text.length);
        menuDismissed = true;
        draw();
      }
      return;
    }
    if (pasting) {
      pasteText = (pasteText + (str || k.sequence || "")).slice(0, 20000);
      return;
    }
    if (dialog && !permission) {
      if (k.name === "escape" || (k.ctrl && k.name === "c")) {
        dialog = undefined;
        notice = "Dialog closed.";
        draw();
      } else void dialog.key(cleanTerminal(str || ""), k).then(draw);
      return;
    }
    if (!permission && !editor && k.ctrl && k.name === "p") {
      palette();
      draw();
      return;
    }
    const menu = suggestions();
    if (menu.length && !permission && !editor) {
      if (k.name === "escape") {
        menuDismissed = true;
        draw();
        return;
      }
      if (k.name === "up" || k.name === "down") {
        menuIndex =
          (menuIndex + (k.name === "up" ? menu.length - 1 : 1)) % menu.length;
        draw();
        return;
      }
      if (k.name === "tab") {
        input = "/" + menu[Math.min(menuIndex, menu.length - 1)].command;
        cursor = input.length;
        menuDismissed = true;
        draw();
        return;
      }
      if (k.name === "return") {
        const c = menu[Math.min(menuIndex, menu.length - 1)];
        input = "";
        cursor = 0;
        menuIndex = 0;
        void chooseCommand(c.command);
        return;
      }
    }
    if (k.ctrl && k.name === "c") {
      if (editor && !busy) {
        notice = "Close the editor with Esc before quitting.";
        draw();
        return;
      }
      if (busy) {
        council.stop();
        manualController?.abort(new Error("Stopped by user"));
        permission?.resolve(false);
        notice = "Stopping…";
      } else void quit();
      draw();
      return;
    }
    if (k.name === "escape") {
      if (editor && !permission && !busy) {
        if (editor.text !== editor.saved && !editor.discard) {
          editor.discard = true;
          notice = "Unsaved edits. Ctrl+S saves; press Esc again to discard.";
        } else {
          editor = undefined;
          notice = "Editor closed.";
        }
        draw();
        return;
      }
      council.stop();
      manualController?.abort(new Error("Stopped by user"));
      permission?.resolve(false);
      notice = "Stop requested.";
      draw();
      return;
    }
    if (permission) {
      if (["y", "a", "n"].includes(str)) {
        if (str === "a") grants.add(permission.request.kind);
        permission.resolve(str !== "n");
      } else if (k.name === "pageup") {
        scroll += Math.max(1, (process.stdout.rows || 24) - 8);
        draw();
      } else if (k.name === "pagedown") {
        scroll = Math.max(0, scroll - 10);
        draw();
      }
      return;
    }
    if (editor && !busy) {
      const e = editor,
        lines = e.text.split("\n");
      e.discard = false;
      const clamp = () => {
        e.row = Math.max(0, Math.min(e.row, e.text.split("\n").length - 1));
        e.col = Math.max(0, Math.min(e.col, e.text.split("\n")[e.row].length));
      };
      if (k.ctrl && k.name === "s") {
        busy = true;
        manualController = new AbortController();
        void council.project
          .execute(
            { action: "write", path: e.path, content: e.text, sha: e.sha },
            manualController.signal,
          )
          .then((file) => {
            e.saved = file.content;
            e.sha = file.sha;
            notice = "Saved " + e.path;
          })
          .catch((error) => {
            notice = error.message;
          })
          .finally(() => {
            busy = false;
            manualController = undefined;
            draw();
          });
        return;
      }
      if (k.ctrl && (k.name === "z" || k.name === "y")) {
        const from = k.name === "z" ? e.undo : e.redo,
          to = k.name === "z" ? e.redo : e.undo;
        if (from.length) {
          to.push(e.text);
          e.text = from.pop()!;
          clamp();
        }
        draw();
        return;
      }
      if (k.name === "up") {
        e.row--;
        clamp();
        draw();
        return;
      }
      if (k.name === "down") {
        e.row++;
        clamp();
        draw();
        return;
      }
      if (k.name === "left") {
        if (e.col) e.col--;
        else if (e.row) {
          e.row--;
          e.col = lines[e.row].length;
        }
        draw();
        return;
      }
      if (k.name === "right") {
        if (e.col < lines[e.row].length) e.col++;
        else if (e.row < lines.length - 1) {
          e.row++;
          e.col = 0;
        }
        draw();
        return;
      }
      if (k.name === "home") {
        e.col = 0;
        draw();
        return;
      }
      if (k.name === "end") {
        e.col = lines[e.row].length;
        draw();
        return;
      }
      const offset =
        lines.slice(0, e.row).reduce((n, line) => n + line.length + 1, 0) +
        e.col;
      let before = e.text.slice(0, offset),
        after = e.text.slice(offset),
        insertion = "";
      if (k.name === "backspace") {
        if (!offset) return;
        before = before.slice(0, -1);
      } else if (k.name === "delete") after = after.slice(1);
      else if (k.name === "return") insertion = "\n";
      else if (k.name === "tab") insertion = "  ";
      else if (!k.ctrl && !k.meta && str) insertion = cleanTerminal(str);
      else return;
      const next = before + insertion + after;
      if (next.length > 200000) {
        notice = "Editor limit: 200 KB.";
        draw();
        return;
      }
      e.undo.push(e.text);
      if (e.undo.length > 50) e.undo.shift();
      e.redo = [];
      e.text = next;
      const cursor = (before + insertion).split("\n");
      e.row = cursor.length - 1;
      e.col = cursor.at(-1)!.length;
      draw();
      return;
    }
    if (k.name === "tab") {
      tab = (tab + (k.shift ? tabs.length - 1 : 1)) % tabs.length;
      scroll = 0;
      draw();
      return;
    }
    if (k.name === "pageup") {
      scroll += Math.max(1, (process.stdout.rows || 24) - 8);
      draw();
      return;
    }
    if (k.name === "pagedown") {
      scroll = Math.max(
        0,
        scroll - Math.max(1, (process.stdout.rows || 24) - 8),
      );
      draw();
      return;
    }
    if (k.name === "end") {
      scroll = 0;
      draw();
      return;
    }
    if (busy) return;
    if ((k.ctrl && k.name === "j") || k.name === "enter") {
      input = input.slice(0, cursor) + "\n" + input.slice(cursor);
      cursor++;
      menuDismissed = true;
      draw();
      return;
    }
    if (k.name === "return") {
      void submit();
      return;
    }
    if (k.name === "left")
      cursor = Math.max(
        0,
        cursor - (Array.from(input.slice(0, cursor)).at(-1)?.length || 1),
      );
    else if (k.name === "right")
      cursor = Math.min(
        input.length,
        cursor + (Array.from(input.slice(cursor))[0]?.length || 1),
      );
    else if ((k.ctrl && k.name === "a") || k.name === "home") cursor = 0;
    else if (k.ctrl && k.name === "e") cursor = input.length;
    else if (k.name === "backspace") {
      const before = Array.from(input.slice(0, cursor)).slice(0, -1).join("");
      input = before + input.slice(cursor);
      cursor = before.length;
    } else if (k.name === "delete")
      input =
        input.slice(0, cursor) +
        Array.from(input.slice(cursor)).slice(1).join("");
    else if (k.ctrl && k.name === "u") {
      input = "";
      cursor = 0;
    } else if (!k.ctrl && !k.meta && str) {
      const text = cleanTerminal(str);
      input = (input.slice(0, cursor) + text + input.slice(cursor)).slice(
        0,
        20000,
      );
      cursor = Math.min(input.length, cursor + text.length);
    }
    menuDismissed = false;
    menuIndex = 0;
    draw();
  }

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", key);
  process.stdout.on("resize", draw);
  process.on("SIGTERM", terminate);
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
  draw();
  if (options.prompt) {
    input = options.prompt;
    cursor = input.length;
    void submit();
  }
  await finished;
}
