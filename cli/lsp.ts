import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
  type MessageConnection,
  type Message,
} from "vscode-jsonrpc/node";
import { z } from "zod";
import type { ProjectPermission } from "../shared/project.ts";
// JSON-RPC's async request executor rethrows failed writes after rejecting the
// request. Dispose the connection ourselves (rejecting all pending requests)
// and contain the transport rejection so it cannot terminate the CLI process.
class LspWriter extends StreamMessageWriter {
  constructor(
    stream: NodeJS.WritableStream,
    private failed: () => void,
  ) {
    super(stream);
  }
  override async write(message: Message): Promise<void> {
    try {
      await super.write(message);
    } catch {
      this.failed();
    }
  }
}
const configuration = z
  .array(
    z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
      command: z.string().min(1).max(1000),
      args: z.array(z.string().max(2000)).max(30).default([]),
      languages: z.record(
        z.string().regex(/^\.[a-zA-Z0-9]+$/),
        z.string().min(1).max(60),
      ),
    }),
  )
  .max(10)
  .refine(
    (a) => new Set(a.map((x) => x.id)).size === a.length,
    "Server IDs must be unique.",
  );
type Config = z.infer<typeof configuration>[number];
type Document = {
  path: string;
  uri: string;
  content: string;
  version: number;
  hash: string;
};
type Server = {
  config: Config;
  child: ChildProcessWithoutNullStreams;
  rpc: MessageConnection;
  capabilities: any;
  documents: Map<string, Document>;
  diagnostics: Map<string, { version?: number; items: any[] }>;
  dead: boolean;
};
export type LspAction = {
  action: "lsp";
  operation: "status" | "diagnostics" | "hover" | "definition" | "references";
  path?: string;
  line?: number;
  character?: number;
};
export class ProjectLsp {
  private servers = new Map<string, Server>();
  private queue: Promise<unknown> = Promise.resolve();
  private stopping = new AbortController();
  constructor(
    private root: string,
    private read: (
      p: string,
    ) => Promise<{ content: string; sha: string | null }>,
    private approve: (p: ProjectPermission, s: AbortSignal) => Promise<boolean>,
    private configPath = path.join(
      process.env.COUNCIL_CONFIG_DIR ||
        path.join(homedir(), ".config", "council"),
      "lsp.json",
    ),
  ) {}
  async configs() {
    let text: string;
    try {
      text = await readFile(this.configPath, "utf8");
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    if (text.length > 64000) throw new Error("LSP configuration is too large.");
    return configuration.parse(JSON.parse(text));
  }
  private async request(
    server: Server,
    method: string,
    params: any,
    signal: AbortSignal,
    timeout = 15000,
  ): Promise<any> {
    signal.throwIfAborted();
    const token = new CancellationTokenSource();
    let timer: NodeJS.Timeout | undefined;
    let abort: () => void = () => {};
    try {
      return await Promise.race([
        server.rpc.sendRequest(method, params, token.token),
        new Promise((_, reject) => {
          abort = () => {
            token.cancel();
            reject(new Error("LSP request cancelled."));
          };
          signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            token.cancel();
            reject(new Error("LSP request timed out."));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      token.dispose();
    }
  }
  private kill(server: Server) {
    server.dead = true;
    server.rpc.dispose();
    try {
      if (process.platform !== "win32" && server.child.pid)
        process.kill(-server.child.pid, "SIGKILL");
      else server.child.kill("SIGKILL");
    } catch {}
    if (this.servers.get(server.config.id) === server)
      this.servers.delete(server.config.id);
  }
  private async notify(
    server: Server,
    method: string,
    params: any,
    signal: AbortSignal,
    timeout = 5000,
  ) {
    signal.throwIfAborted();
    let timer: NodeJS.Timeout | undefined;
    let abort: () => void = () => {};
    try {
      await Promise.race([
        server.rpc.sendNotification(method, params),
        new Promise((_, reject) => {
          abort = () => reject(new Error("LSP write cancelled."));
          signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(
            () => reject(new Error("LSP write timed out.")),
            timeout,
          );
        }),
      ]);
      if (server.dead)
        throw new Error("Language server stopped while writing.");
    } catch (e) {
      this.kill(server);
      throw e;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  private async start(config: Config, signal: AbortSignal) {
    const previous = this.servers.get(config.id);
    if (
      previous &&
      !previous.dead &&
      JSON.stringify(previous.config) === JSON.stringify(config)
    )
      return previous;
    if (previous) this.kill(previous);
    if (
      !(await this.approve(
        {
          kind: "exec",
          title: "Start language server",
          detail: `${JSON.stringify([config.command, ...config.args])}\nDirectory: ${this.root}\nRuns with your OS access until Council exits; no API-key environment variables are inherited.`,
        },
        signal,
      ))
    )
      throw new Error("User rejected language server execution.");
    signal.throwIfAborted();
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "HOME",
      "USER",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "SystemRoot",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const child = spawn(config.command, config.args, {
      cwd: this.root,
      env,
      detached: process.platform !== "win32",
      stdio: "pipe",
    });
    // Do not write initialize into pipes for a process that failed to launch.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        signal.removeEventListener("abort", abort);
        child.removeListener("spawn", ready);
        if (error) {
          child.kill("SIGKILL");
          reject(error);
        } else resolve();
      };
      const abort = () => finish(new Error("LSP startup cancelled."));
      const ready = () => finish();
      child.once("spawn", ready);
      child.once("error", (error) => finish(error));
      signal.addEventListener("abort", abort, { once: true });
    });
    let server: Server;
    const rpc = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new LspWriter(child.stdin, () => this.kill(server)),
    );
    server = {
      config,
      child,
      rpc,
      capabilities: {},
      documents: new Map(),
      diagnostics: new Map(),
      dead: false,
    };
    this.servers.set(config.id, server);
    child.stderr.resume();
    child.on("error", () => this.kill(server));
    child.on("exit", () => {
      server.dead = true;
      rpc.dispose();
      if (this.servers.get(config.id) === server)
        this.servers.delete(config.id);
    });
    rpc.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason:
        "Council applies changes only through its approved file tools.",
    }));
    rpc.onRequest("workspace/configuration", (params: any) =>
      (params?.items || []).map(() => null),
    );
    rpc.onRequest("workspace/workspaceFolders", () => [
      { uri: pathToFileURL(this.root).href, name: path.basename(this.root) },
    ]);
    rpc.onNotification("textDocument/publishDiagnostics", (p: any) => {
      if (
        typeof p?.uri === "string" &&
        server.documents.has(p.uri) &&
        Array.isArray(p.diagnostics)
      )
        server.diagnostics.set(p.uri, {
          version: p.version,
          items: p.diagnostics.slice(0, 200),
        });
    });
    rpc.listen();
    try {
      const init = await this.request(
        server,
        "initialize",
        {
          processId: process.pid,
          rootUri: pathToFileURL(this.root).href,
          workspaceFolders: [
            {
              uri: pathToFileURL(this.root).href,
              name: path.basename(this.root),
            },
          ],
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            textDocument: {
              synchronization: { dynamicRegistration: false },
              publishDiagnostics: { versionSupport: true },
              diagnostic: { dynamicRegistration: false },
            },
            workspace: { applyEdit: false, configuration: true },
          },
        },
        signal,
      );
      server.capabilities = init?.capabilities || {};
      if (
        server.capabilities.positionEncoding &&
        server.capabilities.positionEncoding !== "utf-16"
      )
        throw new Error(
          "Language server requires an unsupported position encoding.",
        );
      await this.notify(server, "initialized", {}, signal);
      return server;
    } catch (e) {
      this.kill(server);
      throw e;
    }
  }
  private async sync(server: Server, relative: string, signal: AbortSignal) {
    const read = await this.read(relative);
    if (read.sha === null) throw new Error("LSP file not found.");
    const uri = pathToFileURL(path.join(this.root, relative)).href;
    const old = server.documents.get(uri);
    const hash = createHash("sha256").update(read.content).digest("hex");
    if (old?.hash === hash) return old;
    const document = {
      path: relative,
      uri,
      content: read.content,
      hash,
      version: (old?.version || 0) + 1,
    };
    server.documents.set(uri, document);
    server.diagnostics.delete(uri);
    if (!old)
      await this.notify(
        server,
        "textDocument/didOpen",
        {
          textDocument: {
            uri,
            languageId: server.config.languages[path.extname(relative)],
            version: 1,
            text: read.content,
          },
        },
        signal,
      );
    else {
      const sync = server.capabilities.textDocumentSync;
      const kind = typeof sync === "number" ? sync : sync?.change;
      if (!kind)
        throw new Error(
          "Language server does not support changed documents; restart Council.",
        );
      const lines = old.content.split("\n");
      const changes =
        kind === 2
          ? {
              range: {
                start: { line: 0, character: 0 },
                end: {
                  line: lines.length - 1,
                  character: lines.at(-1)!.length,
                },
              },
              text: read.content,
            }
          : { text: read.content };
      await this.notify(
        server,
        "textDocument/didChange",
        {
          textDocument: { uri, version: document.version },
          contentChanges: [changes],
        },
        signal,
      );
    }
    return document;
  }
  execute(action: LspAction, signal: AbortSignal) {
    const next = this.queue.then(() =>
      this.perform(action, AbortSignal.any([signal, this.stopping.signal])),
    );
    this.queue = next.catch(() => {});
    return next;
  }
  private async perform(action: LspAction, signal: AbortSignal) {
    signal.throwIfAborted();
    const configs = await this.configs();
    if (action.operation === "status")
      return {
        configuration: this.configPath,
        servers: configs.map((c) => ({
          id: c.id,
          languages: c.languages,
          running: !!this.servers.get(c.id) && !this.servers.get(c.id)!.dead,
        })),
        note: "Native stdio servers only. No auto-install. Positions are one-based UTF-16 line/column.",
      };
    if (!action.path) throw new Error("A project-relative file is required.");
    await this.read(action.path); // Validate path before process launch.
    const config = configs.find((c) => c.languages[path.extname(action.path!)]);
    if (!config)
      throw new Error(
        "No language server configured for this file. See docs/LSP_SKILLS.md.",
      );
    const server = await this.start(config, signal);
    // Refresh all open documents, so navigation sees changes made by any peer.
    for (const document of [...server.documents.values()]) {
      try {
        await this.sync(server, document.path, signal);
      } catch {
        signal.throwIfAborted();
        if (server.dead)
          throw new Error(
            "Language server stopped while refreshing documents.",
          );
        await this.notify(
          server,
          "textDocument/didClose",
          {
            textDocument: { uri: document.uri },
          },
          signal,
        );
        server.documents.delete(document.uri);
        server.diagnostics.delete(document.uri);
      }
    }
    const document = await this.sync(server, action.path, signal);
    if (action.operation === "diagnostics") {
      if (server.capabilities.diagnosticProvider) {
        const result = await this.request(
          server,
          "textDocument/diagnostic",
          { textDocument: { uri: document.uri } },
          signal,
        );
        return {
          path: action.path,
          version: document.version,
          source: "language-server-pull",
          diagnostics: result?.items?.slice(0, 200) || [],
          kind: result?.kind,
        };
      }
      const end = Date.now() + 3000;
      while (!server.diagnostics.has(document.uri) && Date.now() < end) {
        signal.throwIfAborted();
        await new Promise((r) => setTimeout(r, 50));
      }
      const result = server.diagnostics.get(document.uri);
      const fresh =
        result &&
        (result.version === undefined || result.version === document.version);
      return {
        path: action.path,
        version: document.version,
        source: "language-server-push",
        status: fresh ? "received" : "pending",
        versionVerified: result?.version === document.version,
        diagnostics: fresh ? result.items : [],
        note: "Missing or pending diagnostics do not prove the file is correct. Unversioned server diagnostics may be stale.",
      };
    }
    const line = (action.line || 0) - 1,
      character = (action.character || 0) - 1;
    const lines = document.content.split("\n");
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(character) ||
      line < 0 ||
      character < 0 ||
      line >= lines.length ||
      character > lines[line].length
    )
      throw new Error("Use valid one-based line and UTF-16 column positions.");
    const capability = {
      hover: "hoverProvider",
      definition: "definitionProvider",
      references: "referencesProvider",
    }[action.operation];
    if (!server.capabilities[capability])
      throw new Error(`Server does not support ${action.operation}.`);
    const result = await this.request(
      server,
      `textDocument/${action.operation}`,
      {
        textDocument: { uri: document.uri },
        position: { line, character },
        ...(action.operation === "references"
          ? { context: { includeDeclaration: true } }
          : {}),
      },
      signal,
    );
    const encoded = JSON.stringify(result);
    return {
      path: action.path,
      version: document.version,
      operation: action.operation,
      result:
        encoded.length > 16000
          ? encoded.slice(0, 16000) + " [truncated]"
          : result,
    };
  }
  async close() {
    this.stopping.abort();
    await this.queue;
    for (const server of [...this.servers.values()]) {
      try {
        await this.request(
          server,
          "shutdown",
          null,
          new AbortController().signal,
          1000,
        );
        await this.notify(
          server,
          "exit",
          undefined,
          new AbortController().signal,
          1000,
        );
      } catch {
      } finally {
        this.kill(server);
      }
    }
  }
}
