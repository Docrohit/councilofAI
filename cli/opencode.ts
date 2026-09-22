import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Chunk, CodingReply, Provider } from "../shared/types.ts";
import type { CompletionRequest } from "../server/providers.ts";

// Only the person starting this worker chooses the runtime and directory. Neither
// a hosted account nor a model response can change either of them.
export class OpenCodeWorker {
  readonly directory: string;
  readonly endpoint: string;
  private sessions: Record<string, string> = {};
  private active = new Map<string, { kind: string; sessionId: string }>();
  private answered = new Set<string>();
  constructor(
    public options: {
      url: string;
      directory: string;
      stateFile?: string;
      password?: string;
      username?: string;
      nativePermissions?: boolean;
    },
  ) {
    const url = new URL(options.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "OpenCode must use a loopback URL without embedded credentials.",
      );
    this.endpoint = url.toString().replace(/\/$/, "");
    this.directory = realpathSync(options.directory);
    if (options.stateFile) {
      try {
        this.sessions = JSON.parse(readFileSync(options.stateFile, "utf8"));
      } catch {}
    }
  }
  private async api(
    route: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<any> {
    const url = new URL(this.endpoint + route);
    url.searchParams.set("directory", this.directory);
    const result = await fetch(url, {
      method,
      redirect: "error",
      signal: signal || AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        ...(this.options.password
          ? {
              authorization:
                "Basic " +
                Buffer.from(
                  `${this.options.username || "opencode"}:${this.options.password}`,
                ).toString("base64"),
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Do not relay runtime error bodies: they may contain local credentials.
    if (!result.ok)
      throw new Error(
        `OpenCode ${method} ${route.split("?")[0]} returned HTTP ${result.status}. Check the local runtime terminal.`,
      );
    const text = await result.text();
    if (text.length > 8_000_000)
      throw new Error("OpenCode response exceeded 8 MB.");
    return text ? JSON.parse(text) : null;
  }
  async verify() {
    const health = await this.api("/global/health");
    if (!health?.healthy) throw new Error("OpenCode runtime is not healthy.");
    const location = await this.api("/path");
    if (realpathSync(location.directory) !== this.directory)
      throw new Error("OpenCode did not select the pinned project directory.");
    return health;
  }
  async reply(reply: CodingReply) {
    if (this.answered.has(reply.id)) return;
    const prompt = this.active.get(reply.id);
    if (!prompt || prompt.kind !== reply.kind)
      throw new Error("OpenCode request is no longer pending in this worker.");
    const id = encodeURIComponent(reply.id);
    if (reply.kind === "permission")
      await this.api(`/permission/${id}/reply`, "POST", { reply: reply.reply });
    else if (reply.reply === "reject")
      await this.api(`/question/${id}/reject`, "POST", {});
    else
      await this.api(`/question/${id}/reply`, "POST", {
        answers: reply.answers,
      });
    this.answered.add(reply.id);
    this.active.delete(reply.id);
  }
  private save() {
    if (!this.options.stateFile) return;
    mkdirSync(path.dirname(this.options.stateFile), {
      recursive: true,
      mode: 0o700,
    });
    const temporary = this.options.stateFile + `.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.sessions), { mode: 0o600 });
    renameSync(temporary, this.options.stateFile);
  }
  async *complete(
    provider: Provider,
    request: CompletionRequest,
  ): AsyncGenerator<Chunk> {
    const split = provider.model.indexOf("/");
    if (split < 1 || split === provider.model.length - 1)
      throw new Error(
        "OpenCode model ID must be provider/model, as listed by opencode models.",
      );
    const model = {
      providerID: provider.model.slice(0, split),
      modelID: provider.model.slice(split + 1),
    };
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          this.endpoint,
          this.directory,
          provider.id,
          request.context || { test: Date.now() },
        ]),
      )
      .digest("hex");
    let sessionId = this.sessions[key];
    if (sessionId) {
      const session = await this.api(
        `/session/${encodeURIComponent(sessionId)}`,
        "GET",
        undefined,
        request.signal,
      );
      if (
        session.directory &&
        realpathSync(session.directory) !== this.directory
      )
        throw new Error("Saved coding session belongs to a different project.");
    } else {
      const session = await this.api(
        "/session",
        "POST",
        {
          title: `Council ${request.context?.runId || "connection test"} / ${request.context?.agentId || provider.name}`,
          // Default to explicit requests. --native-permissions is an intentional
          // opt-in by the local operator to the runtime's configured policy.
          ...(this.options.nativePermissions && request.context
            ? {}
            : {
                permission: [
                  {
                    permission: "*",
                    pattern: "*",
                    action: request.context ? "ask" : "deny",
                  },
                ],
              }),
        },
        request.signal,
      );
      if (!session?.id) throw new Error("OpenCode returned no session ID.");
      sessionId = session.id;
      if (request.context) {
        this.sessions[key] = sessionId;
        this.save();
      }
    }
    const route = `/session/${encodeURIComponent(sessionId)}`;
    const baseline = new Set(
      (
        await this.api(route + "/message", "GET", undefined, request.signal)
      ).map((m: any) => m.info.id),
    );
    const seenText = new Map<string, string>(),
      seenTools = new Map<string, string>(),
      usage = new Map<string, { input: number; output: number }>();
    const ownedSessions = new Set<string>([sessionId]);
    const safe = (value: unknown, limit = 12000) => {
      let text =
        typeof value === "string" ? value : JSON.stringify(value) || "";
      for (const secret of [
        this.options.password,
        process.env.COUNCIL_TOKEN,
        process.env.COUNCIL_MODEL_API_KEY,
      ])
        if (secret) text = text.split(secret).join("[REDACTED]");
      const cleaned = text
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
      if (cleaned.length <= limit) return cleaned;
      const half = Math.max(1, Math.floor((limit - 40) / 2));
      return (
        cleaned.slice(0, half) +
        "\n[preview truncated; see native session]\n" +
        cleaned.slice(-half)
      );
    };
    yield {
      type: "coding",
      activity: {
        kind: "session",
        sessionId,
        id: sessionId,
        title: "OpenCode project session",
        detail: this.directory,
        status: "running",
      },
    };
    let finished = false,
      success = false,
      response: any,
      failure: unknown;
    const pending = this.api(
      route + "/message",
      "POST",
      {
        model,
        agent: "build",
        system: request.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n"),
        parts: [
          {
            type: "text",
            text:
              request.messages
                .filter((m) => m.role !== "system")
                .map((m) => m.content)
                .join("\n\n") +
              "\n\nKeep this contribution bounded. Use native tools for the connected project. Publish verifiable results and coordinate through council action blocks. Do not expose private chain-of-thought.",
          },
        ],
      },
      request.signal,
    )
      .then(
        (value) => {
          response = value;
        },
        (error) => {
          failure = error;
        },
      )
      .finally(() => {
        finished = true;
      });
    const emitMessages = function* (messages: any[]): Generator<Chunk> {
      for (const message of messages) {
        if (
          baseline.has(message.info?.id) ||
          message.info?.role !== "assistant"
        )
          continue;
        if (message.info.tokens)
          usage.set(message.info.id, {
            input:
              (message.info.tokens.input || 0) +
              (message.info.tokens.cache?.read || 0),
            output: message.info.tokens.output || 0,
          });
        for (const part of message.parts || []) {
          if (part.type === "text") {
            const before = seenText.get(part.id) || "";
            const current = String(part.text || "");
            if (current.startsWith(before) && current.length > before.length) {
              const delta =
                (!seenText.has(part.id) && seenText.size ? "\n\n" : "") +
                current.slice(before.length);
              for (let i = 0; i < delta.length; i += 6000)
                yield {
                  type: "text",
                  text: safe(delta.slice(i, i + 6000), 8000),
                };
            }
            seenText.set(part.id, current);
          }
          if (part.type === "tool") {
            const value = safe(part.state);
            if (seenTools.get(part.id) === value) continue;
            seenTools.set(part.id, value);
            yield {
              type: "coding",
              activity: {
                kind: "tool",
                sessionId: part.sessionID || sessionId,
                id: part.id,
                title: safe(part.tool, 500),
                status: part.state?.status,
                detail: safe({
                  input: part.state?.input,
                  output: part.state?.output,
                  error: part.state?.error,
                }),
              },
            };
          }
        }
      }
    };
    try {
      while (!finished) {
        request.signal.throwIfAborted();
        const messages = await this.api(
          route + "/message",
          "GET",
          undefined,
          request.signal,
        );
        yield* emitMessages(messages);
        // Discover only descendants of this peer's session; never forward other
        // projects' pending approvals, questions, messages or tool results.
        const all = await this.api(
          "/session",
          "GET",
          undefined,
          request.signal,
        );
        for (let depth = 0; depth < 16; depth++) {
          const size = ownedSessions.size;
          for (const s of all)
            if (ownedSessions.has(s.parentID)) ownedSessions.add(s.id);
          if (size === ownedSessions.size) break;
        }
        for (const kind of ["permission", "question"] as const) {
          const prompts = await this.api(
            "/" + kind,
            "GET",
            undefined,
            request.signal,
          );
          for (const p of prompts) {
            if (
              !ownedSessions.has(p.sessionID) ||
              this.active.has(p.id) ||
              this.answered.has(p.id)
            )
              continue;
            this.active.set(p.id, { kind, sessionId: p.sessionID });
            yield {
              type: "coding",
              activity: {
                kind,
                sessionId: p.sessionID,
                id: p.id,
                title:
                  kind === "permission"
                    ? safe(p.permission, 500)
                    : "OpenCode needs your input",
                detail: safe(
                  kind === "permission"
                    ? { patterns: p.patterns, metadata: p.metadata }
                    : p.questions,
                ),
                status: "pending",
                ...(kind === "question"
                  ? {
                      questions: p.questions.slice(0, 10).map((q: any) => ({
                        question: safe(q.question, 2000),
                        options: (q.options || [])
                          .slice(0, 20)
                          .map((o: any) => safe(o.label, 500)),
                        multiple: !!q.multiple,
                      })),
                    }
                  : {}),
              },
            };
          }
        }
        if (!finished) await delay(400, undefined, { signal: request.signal });
      }
      await pending;
      if (failure) throw failure;
      yield* emitMessages(
        await this.api(route + "/message", "GET", undefined, request.signal),
      );
      yield* emitMessages([response]);
      if (response?.info?.error)
        throw new Error(
          `OpenCode model failed (${safe(response.info.error.name || "provider error", 100)}). Check the local runtime and model billing.`,
        );
      if (![...seenText.values()].some((t) => t.trim()))
        throw new Error("OpenCode returned no public answer text.");
      const diffRoute =
        route +
        "/diff" +
        (response?.info?.parentID
          ? "?messageID=" + encodeURIComponent(response.info.parentID)
          : "");
      let diff = await this.api(diffRoute, "GET", undefined, request.signal);
      // OpenCode computes session diffs asynchronously after finishing a turn.
      // Give a completed edit a short bounded window to publish its snapshot.
      for (
        let retry = 0;
        retry < 4 && !diff?.length && seenTools.size;
        retry++
      ) {
        await delay(300, undefined, { signal: request.signal });
        diff = await this.api(diffRoute, "GET", undefined, request.signal);
      }
      if (diff?.length)
        yield {
          type: "coding",
          activity: {
            kind: "diff",
            sessionId,
            id: sessionId + "-diff",
            title: "Project changes",
            detail: safe(diff),
            status: "completed",
          },
        };
      const total = [...usage.values()].reduce(
        (a, b) => ({ input: a.input + b.input, output: a.output + b.output }),
        { input: 0, output: 0 },
      );
      yield { type: "usage", ...total };
      success = true;
    } finally {
      if (!success)
        for (const id of ownedSessions)
          await this.api(
            `/session/${encodeURIComponent(id)}/abort`,
            "POST",
            {},
          ).catch(() => {});
      await pending;
      for (const [id, p] of this.active)
        if (ownedSessions.has(p.sessionId)) this.active.delete(id);
    }
  }
}
