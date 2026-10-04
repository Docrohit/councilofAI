import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { Store } from "./store.ts";
import { prepareAttachment } from "./attachments.ts";
import type { CouncilEvent, Run, RunConfig } from "../shared/types.ts";
import type { Attachment } from "../shared/attachments.ts";

interface TelegramConfig {
  enabled: boolean;
  offset?: number;
  username?: string;
  firstName?: string;
  lastError?: string;
  chats?: Record<string, { runId?: string; updatedAt: string }>;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    photo?: {
      file_id: string;
      file_unique_id?: string;
      file_size?: number;
      width: number;
      height: number;
    }[];
    document?: {
      file_id: string;
      file_unique_id?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    chat: { id: number; type: string; title?: string; username?: string };
    from?: { id: number; username?: string; first_name?: string };
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunks(text: string, limit = 3800) {
  const result: string[] = [];
  for (let i = 0; i < text.length; i += limit)
    result.push(text.slice(i, i + limit));
  return result.length ? result : [""];
}

function parseGoal(text: string) {
  const match = /^\/goal(?:@\S+)?(?:\s+(\d+)(?:-(\d+))?m)?\s+([\s\S]+)$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  const minMinutes = match[1] ? Number(match[1]) : 10;
  const maxMinutes = match[2] ? Number(match[2]) : Math.max(minMinutes, 20);
  return { goal: match[3].trim(), minMinutes, maxMinutes };
}

function isNewChatCommand(text: string) {
  return /^\/\s*new(?:@\S+)?(?:\s+chat)?\s*$/i.test(text.trim());
}

export class TelegramBridge {
  private loops = new Map<string, AbortController>();
  private watches = new Set<string>();

  constructor(
    private db: DB,
    private store: Store,
    private engine: Orchestrator,
    private startRun: (
      userId: string,
      input: {
        prompt: string;
        config: RunConfig;
        goalMode?: boolean;
        minGoalMinutes?: number;
        maxGoalMinutes?: number;
        attachmentIds?: string[];
      },
    ) => Promise<Run>,
    private chargeMessage: (userId: string) => void,
  ) {}

  status(userId: string) {
    const row = this.row(userId);
    if (!row)
      return { enabled: false, hasToken: false, polling: false, chats: 0 };
    const config = JSON.parse(row.config) as TelegramConfig;
    return {
      enabled: !!config.enabled,
      hasToken: !!row.secret,
      polling: this.loops.has(row.id),
      username: config.username,
      firstName: config.firstName,
      lastError: config.lastError,
      chats: Object.keys(config.chats || {}).length,
    };
  }

  async configure(userId: string, input: { token?: string; enabled: boolean }) {
    const existing = this.row(userId);
    const config: TelegramConfig = existing
      ? JSON.parse(existing.config)
      : { enabled: false, chats: {} };
    let secret = existing?.secret || "";
    if (input.token?.trim()) {
      const me = await this.call(input.token.trim(), "getMe", {});
      config.username = me.username;
      config.firstName = me.first_name;
      config.lastError = undefined;
      config.offset = undefined;
      secret = this.store.secrets.encrypt(input.token.trim());
    }
    config.enabled = input.enabled;
    config.chats ||= {};
    if (!secret && config.enabled)
      throw new Error("Paste a Telegram bot token before enabling the bridge.");
    const id = existing?.id || randomUUID();
    this.db
      .prepare(
        "INSERT INTO integrations(id,user_id,kind,config,secret) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET config=excluded.config,secret=excluded.secret",
      )
      .run(id, userId, "telegram", JSON.stringify(config), secret);
    this.restart(userId);
    return this.status(userId);
  }

  clear(userId: string) {
    const row = this.row(userId);
    if (row) this.loops.get(row.id)?.abort();
    this.db
      .prepare("DELETE FROM integrations WHERE user_id=? AND kind='telegram'")
      .run(userId);
  }

  startAll() {
    for (const row of this.db
      .prepare("SELECT user_id FROM integrations WHERE kind='telegram'")
      .all() as any[])
      this.restart(row.user_id);
  }

  restart(userId: string) {
    const row = this.row(userId);
    if (!row) return;
    this.loops.get(row.id)?.abort();
    this.loops.delete(row.id);
    const config = JSON.parse(row.config) as TelegramConfig;
    if (!config.enabled || !row.secret) return;
    const controller = new AbortController();
    this.loops.set(row.id, controller);
    void this.loop(userId, row.id, controller.signal);
  }

  private row(userId: string) {
    return this.db
      .prepare("SELECT * FROM integrations WHERE user_id=? AND kind='telegram'")
      .get(userId) as any;
  }

  private saveConfig(userId: string, patch: (config: TelegramConfig) => void) {
    const row = this.row(userId);
    if (!row) return;
    const config = JSON.parse(row.config) as TelegramConfig;
    patch(config);
    this.db
      .prepare("UPDATE integrations SET config=? WHERE id=?")
      .run(JSON.stringify(config), row.id);
  }

  private async loop(userId: string, id: string, signal: AbortSignal) {
    while (!signal.aborted) {
      const row = this.row(userId);
      if (!row || row.id !== id) return;
      const token = this.store.secrets.decrypt(row.secret);
      const config = JSON.parse(row.config) as TelegramConfig;
      try {
        const result = await this.call(
          token,
          "getUpdates",
          {
            offset: config.offset,
            timeout: 25,
            allowed_updates: ["message"],
          },
          signal,
        );
        for (const update of (result || []) as TelegramUpdate[]) {
          await this.handleUpdate(userId, token, update);
          this.saveConfig(userId, (next) => {
            next.offset = Math.max(next.offset || 0, update.update_id + 1);
            next.lastError = undefined;
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        this.saveConfig(userId, (next) => {
          next.lastError = (error as Error).message.slice(0, 400);
        });
        await sleep(5000);
      }
    }
  }

  private async handleUpdate(
    userId: string,
    token: string,
    update: TelegramUpdate,
  ) {
    const message = update.message;
    if (!message) return;
    const attachments = await this.telegramAttachments(userId, token, message);
    const text = (message.text || message.caption || "").trim();
    if (!text && !attachments.length) return;
    const effectiveText = text || "Review the attached Telegram file.";
    const chatId = String(message.chat.id);
    if (/^\/start(?:@\S+)?/i.test(effectiveText)) {
      await this.send(
        token,
        chatId,
        "Council connected. Send /goal 10-180m your goal to start goal mode, or send a message to start a normal council session. While a session runs, ordinary messages become board guidance. Send /new chat to detach from the current session and start fresh.",
      );
      return;
    }
    if (/^\/status(?:@\S+)?/i.test(effectiveText)) {
      const active = this.activeRun(userId, chatId);
      await this.send(
        token,
        chatId,
        active
          ? `Active Council session: ${active.id} (${active.status}).`
          : "No active Telegram-linked Council session.",
      );
      return;
    }
    const active = this.activeRun(userId, chatId);
    if (isNewChatCommand(effectiveText)) {
      const stopped =
        active && ["queued", "running"].includes(active.status)
          ? this.engine.cancel(userId, active.id)
          : false;
      this.clearChat(userId, chatId);
      await this.send(
        token,
        chatId,
        stopped
          ? "New chat ready. I stopped the previous Telegram-linked session; send your next message or /goal to start fresh."
          : "New chat ready. Send your next message or /goal to start fresh.",
      );
      return;
    }
    const goal = parseGoal(effectiveText);
    if (goal && active && ["queued", "running"].includes(active.status)) {
      try {
        this.chargeMessage(userId);
      } catch (error) {
        await this.send(token, chatId, (error as Error).message);
        return;
      }
      const result = this.engine.updateGoal(userId, active.id, goal.goal, {
        minMinutes: goal.minMinutes,
        maxMinutes: goal.maxMinutes,
      });
      if (result.ok && attachments.length) {
        const attached = this.engine.addAttachments(
          userId,
          active.id,
          attachments,
          `Telegram goal file input: ${goal.goal}`,
        );
        if (!attached.ok)
          await this.send(
            token,
            chatId,
            attached.error || "Goal updated, but file attach failed.",
          );
      }
      await this.send(
        token,
        chatId,
        result.ok
          ? "Goal updated. I’ll only relay board progress and the final answer."
          : result.error || "Goal update failed.",
      );
      return;
    }
    if (active && ["queued", "running"].includes(active.status)) {
      try {
        this.chargeMessage(userId);
      } catch (error) {
        await this.send(token, chatId, (error as Error).message);
        return;
      }
      if (attachments.length) {
        const result = this.engine.addAttachments(
          userId,
          active.id,
          attachments,
          text ? `Telegram input: ${text}` : "Telegram file input.",
        );
        if (!result.ok)
          await this.send(
            token,
            chatId,
            result.error || "Could not attach this file.",
          );
        return;
      }
      if (
        !this.engine.postBoard(
          userId,
          active.id,
          `Telegram input: ${effectiveText}`,
        )
      )
        await this.send(
          token,
          chatId,
          "The session is no longer accepting messages.",
        );
      return;
    }
    const config = this.teamConfig(userId);
    if (!config) {
      await this.send(
        token,
        chatId,
        "Configure and save a Council team in the web app or CLI before starting Telegram sessions.",
      );
      return;
    }
    if (goal) {
      config.goalMode = true;
      config.minGoalMinutes = goal.minMinutes;
      config.maxMinutes = Math.max(config.maxMinutes, goal.maxMinutes);
      config.maxCalls = Math.max(
        config.maxCalls,
        config.members.length * 6 + 12,
      );
    }
    let run: Run;
    try {
      run = await this.startRun(userId, {
        prompt: goal?.goal || effectiveText,
        config,
        attachmentIds: await this.persistAttachments(userId, attachments),
        ...(goal
          ? {
              goalMode: true,
              minGoalMinutes: goal.minMinutes,
              maxGoalMinutes: goal.maxMinutes,
            }
          : {}),
      });
    } catch (error) {
      await this.send(token, chatId, (error as Error).message);
      return;
    }
    this.saveConfig(userId, (next) => {
      next.chats ||= {};
      next.chats[chatId] = {
        runId: run.id,
        updatedAt: new Date().toISOString(),
      };
    });
    this.watchRun(userId, token, chatId, run.id);
    await this.send(
      token,
      chatId,
      `${goal ? "Goal" : "Session"} started: ${run.title}\nI’ll reply with board progress and the final answer.`,
    );
  }

  private activeRun(userId: string, chatId: string) {
    const row = this.row(userId);
    if (!row) return undefined;
    const config = JSON.parse(row.config) as TelegramConfig;
    const runId = config.chats?.[chatId]?.runId;
    return runId ? this.store.getRun(userId, runId) : undefined;
  }

  private clearChat(userId: string, chatId: string) {
    this.saveConfig(userId, (next) => {
      if (next.chats) delete next.chats[chatId];
    });
  }

  private teamConfig(userId: string): RunConfig | undefined {
    const row = this.db
      .prepare("SELECT config FROM preferences WHERE user_id=?")
      .get(userId) as any;
    return row ? JSON.parse(row.config) : undefined;
  }

  private watchRun(
    userId: string,
    token: string,
    chatId: string,
    runId: string,
  ) {
    const key = `${userId}:${chatId}:${runId}`;
    if (this.watches.has(key)) return;
    this.watches.add(key);
    const unsubscribe = this.store.subscribe(runId, (event) => {
      void this.forwardEvent(token, chatId, event).catch(() => {});
      if (
        event.type === "run.status" &&
        !["queued", "running"].includes(event.data.status)
      ) {
        unsubscribe();
        this.watches.delete(key);
      }
    });
  }

  private async forwardEvent(
    token: string,
    chatId: string,
    event: CouncilEvent,
  ) {
    if (event.type === "board.post") {
      const post = event.data.post;
      if (post.author === "user") return;
      await this.send(
        token,
        chatId,
        `Board · ${post.kind || "broadcast"}\n${post.content}`.slice(0, 3900),
      );
    }
    if (event.type === "run.final")
      for (const part of chunks(`Final answer\n\n${event.data.text}`))
        await this.send(token, chatId, part);
    if (
      event.type === "run.status" &&
      ["failed", "cancelled", "interrupted", "needs_review"].includes(
        event.data.status,
      )
    )
      await this.send(
        token,
        chatId,
        `Session ${event.data.status}${event.data.message ? `: ${event.data.message}` : ""}`,
      );
  }

  private async send(token: string, chatId: string, text: string) {
    for (const part of chunks(text)) {
      await this.call(token, "sendMessage", {
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true,
      });
    }
  }

  private async telegramAttachments(
    userId: string,
    token: string,
    message: NonNullable<TelegramUpdate["message"]>,
  ): Promise<Attachment[]> {
    const specs: { fileId: string; name: string }[] = [];
    if (message.photo?.length) {
      const photo = [...message.photo].sort(
        (a, b) => (b.file_size || 0) - (a.file_size || 0),
      )[0];
      specs.push({
        fileId: photo.file_id,
        name: `telegram-photo-${message.message_id}.jpg`,
      });
    }
    if (message.document)
      specs.push({
        fileId: message.document.file_id,
        name:
          message.document.file_name ||
          `telegram-document-${message.message_id}.txt`,
      });
    const attachments: Attachment[] = [];
    for (const spec of specs) {
      const file = await this.call(token, "getFile", { file_id: spec.fileId });
      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      );
      if (!response.ok)
        throw new Error(`Telegram file download failed: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      attachments.push(await prepareAttachment(buffer, spec.name));
    }
    return attachments;
  }

  private async persistAttachments(userId: string, attachments: Attachment[]) {
    const ids: string[] = [];
    for (const item of attachments) {
      this.db
        .prepare(
          "INSERT INTO attachments(id,user_id,expires,data) VALUES(?,?,?,?)",
        )
        .run(item.id, userId, Date.now() + 86400_000, JSON.stringify(item));
      ids.push(item.id);
    }
    return ids;
  }

  private async call(
    token: string,
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok)
      throw new Error(
        `Telegram ${method} failed: ${payload.description || response.status}`,
      );
    return payload.result;
  }
}
