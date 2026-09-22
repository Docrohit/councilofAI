import { emitKeypressEvents } from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  NativeCouncil,
  loadModels,
  saveModel,
  nativeDefaults,
} from "./native.ts";
import type { CouncilEvent, Run, RunConfig } from "../shared/types.ts";
import type { ProjectPermission } from "../shared/project.ts";
export const cleanTerminal = (text: string) =>
  text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
export function wrapTerminal(text: string, width: number) {
  const result: string[] = [];
  for (const line of cleanTerminal(text).replace(/\t/g, "  ").split("\n")) {
    const chars = Array.from(line);
    if (!chars.length) result.push("");
    for (let i = 0; i < chars.length; i += width)
      result.push(chars.slice(i, i + width).join(""));
  }
  return result;
}
const tabs = [
  "Activity",
  "Board",
  "Conversations",
  "Tools",
  "Files",
  "Answer",
  "Help",
];
const help = `COUNCIL — standalone, no OpenCode installation or web login required.

Enter a goal to let your agents work in this directory.
/connect ID KIND MODEL [URL] [KEY_ENV]   Add a model; keys stay in environment variables
/models                                Show your direct model connections
/use ID1,ID2                            Select the team's models
/agents 5                               Five agents, independent of model count
/budget 40                              Maximum Council model calls
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
For cloud models, export OPENAI_API_KEY / ANTHROPIC_API_KEY / ZAI_API_KEY before launching Council.
Use /models to check the exact environment variable and model ID.

Tab / Shift+Tab switches views. PageUp/PageDown scrolls; End follows live output.
Esc stops active work. Ctrl+C stops a run, or exits when idle.
Writes and commands ask permission. Local shell commands have your OS access;
the project path is not a sandbox. Public output and files read by agents go to
the selected model providers. Session history stays in your local Council data folder.
PDF/Word parsing, web browsing, LSP and MCP are not built-in tools yet.
`;
export interface TuiOptions {
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
    tab = 6,
    scroll = 0,
    busy = false,
    closing = false,
    suspended = false,
    status = "Ready",
    notice = "";
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
    if (config) {
      const { members, providerIds } = next;
      config = { ...config, members, providerIds };
      config.maxCalls = Math.max(config.maxCalls, count + 2);
      if (config.maxAgents !== null)
        config.maxAgents = Math.max(config.maxAgents, count);
    } else {
      config = next;
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
    if (tab === 6) return help;
    if (tab === 4)
      return filesContent || "Use /files, /read path, /search text or /diff.";
    if (tab === 5)
      return (
        current?.final ||
        events.findLast((e) => e.type === "run.final")?.data.text ||
        "The team has not produced a final answer yet."
      );
    if (tab === 1)
      return (
        events
          .filter((e) => e.type === "board.post")
          .map((e) => {
            const p = e.data.post;
            return `${(p.coauthors || [p.author]).map(name).join(" + ")}${p.threadId ? " · joint conclusion" : ""}\n${p.content}`;
          })
          .join("\n\n") || "Shared broadcasts will appear here."
      );
    if (tab === 2) {
      const threads = new Map();
      for (const e of events)
        if (e.type === "conversation.updated")
          threads.set(e.data.conversation.id, e.data.conversation);
      return (
        [...threads.values()]
          .map(
            (t) =>
              `${t.participants.map(name).join(" ↔ ")} · ${t.topic}\n${t.messages.map((m: any) => `${name(m.author)}: ${m.content}`).join("\n")}\n${t.proposal ? `Conclusion r${t.proposal.revision}: ${t.proposal.summary}\n${t.participants.map((id: string) => `${name(id)}: ${t.proposal.reviews[id]?.agree === true ? "agrees" : t.proposal.reviews[id]?.agree === false ? "disagrees" : "awaiting review"}`).join(" · ")}${t.proposal.publishedPostId ? "\nPublished to board" : ""}` : ""}`,
          )
          .join("\n\n") || "Direct agent conversations will appear here."
      );
    }
    if (tab === 3) {
      const tools = new Map();
      for (const e of events)
        if (e.type === "coding.activity") tools.set(e.data.id, e.data);
      return (
        additionalTools +
        "\n" +
        [...tools.values()]
          .map(
            (t) => `${name(t.agentId)} · ${t.title} · ${t.status}\n${t.detail}`,
          )
          .join("\n\n")
      );
    }
    let text = "";
    for (const e of events) {
      const d = e.data;
      if (e.type === "turn.start")
        text += `\n\n${d.name} · ${d.model} · ${d.phase}\n`;
      if (e.type === "turn.delta") text += d.text;
      if (e.type === "agent.message")
        text += `\n${d.name} → ${d.to === "all" ? "everyone" : name(d.to)}: ${d.content}\n`;
      if (e.type === "agent.spawn") text += `\nNew peer ${d.name}: ${d.task}\n`;
      if (e.type === "warning" || e.type === "turn.error")
        text += `\n${d.message}\n`;
      if (e.type === "run.status")
        text += `\nSession ${d.status}${d.message ? ": " + d.message : ""}\n`;
    }
    return (
      text ||
      "Enter a goal. Every peer can discuss, delegate, investigate and propose an answer."
    );
  }
  function draw() {
    if (suspended || closing) return;
    const width = Math.max(20, process.stdout.columns || 80),
      height = Math.max(10, process.stdout.rows || 24),
      area = height - 7;
    const lines = wrapTerminal(body(), width - 2);
    const bottom =
      editor && !permission
        ? Math.max(
            0,
            Math.min(lines.length - area, editor.row - Math.floor(area / 2)),
          )
        : Math.max(0, lines.length - area - scroll);
    const visible = lines.slice(bottom, bottom + area);
    const row = (text: string) =>
      cleanTerminal(text).slice(0, width).padEnd(width);
    const frame = [
      row(` Council  |  ${council.directory}`),
      row(
        ` ${status} · ${config?.members.length || 0} agents · ${config?.providerIds.join(", ") || "no models"} · ${events.filter((e) => e.type === "turn.start").length}/${config?.maxCalls || 24} calls · ${events.filter((e) => e.type === "turn.done").reduce((sum, e) => sum + (e.data.inputTokens || 0) + (e.data.outputTokens || 0), 0)} tokens`,
      ),
      row(tabs.map((t, i) => (i === tab ? `[${t}]` : t)).join("  ")),
      row("─".repeat(width)),
      ...Array.from({ length: area }, (_, i) => row(visible[i] || "")),
      row(notice),
      row(
        permission
          ? " [y] Allow once  [a] Allow this kind for session  [n] Reject"
          : editor
            ? " Ctrl+S save · Ctrl+Z undo · Ctrl+Y redo · Esc close editor"
            : busy
              ? " Esc stop · Tab views · PageUp/PageDown scroll · End follow"
              : " > " + input,
      ),
      row(" Tab views · /help commands · Ctrl+C stop/quit"),
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
    busy = true;
    notice = "";
    events.length = 0;
    tab = 0;
    scroll = 0;
    status = "Starting";
    draw();
    try {
      current = await council.run(goal, config, notify, previous, resume);
      status = current.status;
    } finally {
      busy = false;
      draw();
    }
  }
  async function external(command: string, args: string[]) {
    suspended = true;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
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
      process.stdout.write("\x1b[?1049h\x1b[?25l");
      suspended = false;
      draw();
    }
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
    if (cmd === "help") {
      tab = 6;
      scroll = 0;
      return;
    }
    if (cmd === "connect") {
      const [id, kind, model, url, keyEnv] = words;
      const defaults = nativeDefaults[kind];
      if (!id || !model || !defaults)
        throw new Error(
          "Use /connect ID KIND MODEL [URL] [KEY_ENV]. Kinds: openai, anthropic, glm, ollama, vllm, compatible.",
        );
      saveModel({
        id,
        kind,
        model,
        baseUrl: url || defaults.url,
        keyEnv: keyEnv || defaults.keyEnv,
      });
      configure();
      notice = `Saved ${id}. ${keyEnv || defaults.keyEnv ? `Key source: ${keyEnv || defaults.keyEnv}. Restart Council after exporting it.` : "No API key required by this configuration."}`;
      return;
    }
    if (cmd === "models") {
      filesContent =
        loadModels()
          .map(
            (m) =>
              `${m.id} · ${m.kind} · ${m.model}\n${m.baseUrl}\nKey: ${m.keyEnv ? `${m.keyEnv} (${process.env[m.keyEnv] ? "set" : "not set"})` : "none"}`,
          )
          .join("\n\n") || "No models configured. Use /connect.";
      tab = 4;
      scroll = 0;
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
      tab = 4;
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
      tab = 4;
      scroll = 0;
      return;
    }
    if (cmd === "read") {
      const f = await council.project.read(arg);
      if (f.sha === null) throw new Error("File not found.");
      filesContent = `${arg}\n\n${f.content}`;
      tab = 4;
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
        tab = 4;
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
      tab = 4;
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
      tab = 4;
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
      tab = 3;
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
      process.stdout.write("\x1b[?25h\x1b[?1049l");
      finish();
    }
  }
  function terminate() {
    void quit();
  }
  function key(str: string, k: any = {}) {
    if (suspended || closing) return;
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
    if (k.name === "return") {
      void submit();
      return;
    }
    if (k.name === "backspace") {
      input = Array.from(input).slice(0, -1).join("");
      draw();
      return;
    }
    if (k.ctrl && k.name === "u") {
      input = "";
      draw();
      return;
    }
    if (!k.ctrl && !k.meta && str && str !== "\n") {
      input = (input + cleanTerminal(str)).slice(0, 20000);
      draw();
    }
  }
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", key);
  process.stdout.on("resize", draw);
  process.on("SIGTERM", terminate);
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  draw();
  if (options.prompt) {
    input = options.prompt;
    void submit();
  }
  await finished;
}
