import { quickReply } from "../server/quick-reply.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  realpathSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";
import { Orchestrator } from "../server/orchestrator.ts";
import { LocalProject } from "./project.ts";
import { readNativeKey, saveNativeKey } from "./credentials.ts";
import { validateEndpoint } from "../server/security.ts";
import type {
  CouncilEvent,
  Provider,
  Run,
  RunConfig,
} from "../shared/types.ts";
import type { ProjectPermission } from "../shared/project.ts";

const modelSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  kind: z.enum(["openai", "anthropic", "glm", "ollama", "vllm", "compatible"]),
  model: z.string().min(1).max(200),
  baseUrl: z.string().max(500),
  keyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
});
export type NativeModel = z.infer<typeof modelSchema>;

const teamProfileSchema = z.object({
  maxOutputTokens: z.number().int().min(256).max(16384).optional(),
  agents: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        role: z.string().trim().min(1).max(200).optional(),
        systemPrompt: z.string().trim().min(1).max(4000).optional(),
        maxOutputTokens: z.number().int().min(256).max(16384).optional(),
      }),
    )
    .max(32)
    .optional(),
});

/**
 * Apply a team profile file to a run config: a global output-token cap plus
 * per-agent overrides matched case-insensitively by agent name. Agents listed
 * in the profile but not currently on the team are ignored, so one profile
 * can cover several team sizes.
 */
export function applyTeamProfile(config: RunConfig, file: string): RunConfig {
  let profile: z.infer<typeof teamProfileSchema>;
  try {
    profile = teamProfileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : (error as Error).message;
    throw new Error(`Team profile rejected (${file}): ${message}`);
  }
  if (profile.maxOutputTokens !== undefined)
    config.maxOutputTokens = profile.maxOutputTokens;
  for (const agent of profile.agents ?? []) {
    const member = config.members.find(
      (m) => m.name.toLowerCase() === agent.name.toLowerCase(),
    );
    if (!member) continue;
    if (agent.role !== undefined) member.role = agent.role;
    if (agent.systemPrompt !== undefined) member.systemPrompt = agent.systemPrompt;
    if (agent.maxOutputTokens !== undefined)
      member.maxOutputTokens = agent.maxOutputTokens;
  }
  return config;
}

export const nativeConfigDirectory = () =>
  process.env.COUNCIL_CONFIG_DIR || path.join(homedir(), ".config", "council");
export function loadModels(): NativeModel[] {
  try {
    return z
      .array(modelSchema)
      .max(20)
      .parse(
        JSON.parse(
          readFileSync(
            path.join(nativeConfigDirectory(), "native-models.json"),
            "utf8",
          ),
        ),
      );
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw new Error("Invalid native-models.json configuration: " + e.message);
  }
}
export function saveModel(input: unknown) {
  const model = modelSchema.parse(input);
  validateEndpoint(model.baseUrl, false);
  const all = loadModels();
  const previous = all.find((m) => m.id === model.id);
  const models = all.filter((m) => m.id !== model.id);
  models.push(model);
  if (models.length > 20)
    throw new Error("At most 20 model connections are supported.");
  const directory = nativeConfigDirectory();
  if (
    previous &&
    (previous.baseUrl !== model.baseUrl || previous.kind !== model.kind)
  ) {
    saveNativeKey(directory, model.id, "");
    // An old environment binding is a credential too. Rebind it explicitly
    // after saving the new endpoint, never implicitly forward it to a new host.
    delete model.keyEnv;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "native-models.json");
  writeFileSync(file, JSON.stringify(models, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return model;
}
export function removeModel(id: string) {
  saveNativeKey(nativeConfigDirectory(), id, "");
  const directory = nativeConfigDirectory(),
    file = path.join(directory, "native-models.json");
  const models = loadModels().filter((m) => m.id !== id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(models, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
export const modelKey = (model: NativeModel) =>
  readNativeKey(nativeConfigDirectory(), model.id) ||
  (model.keyEnv ? process.env[model.keyEnv] || "" : "");
export const nativeDefaults: Record<string, { url: string; keyEnv?: string }> =
  {
    openai: { url: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
    anthropic: {
      url: "https://api.anthropic.com",
      keyEnv: "ANTHROPIC_API_KEY",
    },
    glm: { url: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY" },
    ollama: { url: "http://127.0.0.1:11434" },
    vllm: { url: "http://127.0.0.1:8000/v1" },
    compatible: { url: "http://127.0.0.1:8000/v1" },
  };
export class NativeCouncil {
  readonly userId = "local-operator";
  readonly directory: string;
  readonly dataDirectory: string;
  readonly project: LocalProject;
  readonly db: ReturnType<typeof openDb>;
  readonly store: Store;
  readonly engine: Orchestrator;
  /** Team profile applied to every config built by config(); set via --team or /team. */
  teamFile?: string;
  private lockFile: string;
  constructor(
    directory: string,
    approve: (p: ProjectPermission, s: AbortSignal) => Promise<boolean>,
    dataDirectory?: string,
  ) {
    this.directory = realpathSync(directory);
    this.dataDirectory =
      dataDirectory ||
      path.join(
        process.env.COUNCIL_DATA_HOME ||
          path.join(homedir(), ".local", "share", "council"),
        "projects",
        createHash("sha256").update(this.directory).digest("hex").slice(0, 24),
      );
    mkdirSync(this.dataDirectory, { recursive: true, mode: 0o700 });
    this.lockFile = path.join(this.dataDirectory, "session.lock");
    // One local council per directory; never mark another live process's runs interrupted.
    try {
      const pid = Number(readFileSync(this.lockFile, "utf8"));
      if (!Number.isInteger(pid) || pid < 1)
        throw new Error(
          "Invalid project lock; inspect session.lock before removing it.",
        );
      try {
        process.kill(pid, 0);
        throw new Error("A Council process already has this project open.");
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
      unlinkSync(this.lockFile);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const fd = openSync(this.lockFile, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    let opened: ReturnType<typeof openDb> | undefined;
    try {
      opened = openDb(this.dataDirectory);
      this.db = opened;
      this.store = new Store(this.db, this.dataDirectory);
      this.store.recover();
      this.db
        .prepare(
          "INSERT OR IGNORE INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          this.userId,
          "local@council.invalid",
          "Local operator",
          "no-network-login",
          new Date().toISOString(),
        );
      this.project = new LocalProject(
        this.directory,
        approve,
        path.join(this.dataDirectory, "file-recovery"),
      );
      this.engine = new Orchestrator(this.store, undefined, this.project);
      this.syncModels();
    } catch (e) {
      opened?.close();
      unlinkSync(this.lockFile);
      throw e;
    }
  }
  syncModels() {
    const models = loadModels();
    const present = new Set(models.map((m) => m.id));
    for (const provider of this.store.providers(this.userId))
      if (!present.has(provider.id))
        this.db
          .prepare("DELETE FROM providers WHERE id=? AND user_id=?")
          .run(provider.id, this.userId);
    for (const model of models) {
      const provider: Provider = {
        id: model.id,
        name: model.id,
        kind: model.kind,
        baseUrl: model.baseUrl,
        model: model.model,
        transport: "direct",
        reasoning: false,
      };
      const secret = modelKey(model);
      this.db
        .prepare(
          "INSERT INTO providers(id,user_id,config,secret) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret",
        )
        .run(
          model.id,
          this.userId,
          JSON.stringify(provider),
          this.store.secrets.encrypt(secret),
        );
    }
    return models;
  }
  config(ids?: string[], count = 3): RunConfig {
    const models = this.syncModels();
    const selected = ids?.length ? ids : models.map((m) => m.id);
    if (!selected.length)
      throw new Error(
        "No models configured. Use /connect or council models add.",
      );
    if (selected.some((id) => !models.some((m) => m.id === id)))
      throw new Error(
        "Unknown model connection. Use /models to see configured IDs.",
      );
    if (!Number.isInteger(count) || count < 1 || count > 32)
      throw new Error("Choose 1–32 starting agents.");
    const config: RunConfig = {
      providerIds: selected,
      members: Array.from({ length: count }, (_, i) => ({
        id: `peer-${i + 1}`,
        name: ["Atlas", "Sage", "Echo"][i] || `Peer ${i + 1}`,
        role: "Choose a useful specialization for the user's goal",
        providerId: selected[i % selected.length],
      })),
      maxAgents: Math.max(12, count),
      maxDepth: 3,
      concurrency: 1,
      maxCalls: Math.max(24, count * 3 + 1),
      maxMinutes: 20,
      maxOutputTokens: 8192,
    };
    if (this.teamFile) applyTeamProfile(config, this.teamFile);
    return config;
  }
  async run(
    prompt: string,
    config: RunConfig,
    notify: (e: CouncilEvent) => void,
    previous?: Run,
    resume = false,
  ) {
    if (this.engine.active.size)
      throw new Error("Stop or finish the current council first.");
    for (const [value, min, max, label] of [
      [config.members.length, 1, 32, "agents"],
      [config.maxCalls, config.members.length + 2, 256, "calls"],
      [config.concurrency, 1, 8, "concurrency"],
      [config.maxMinutes, 1, 120, "minutes"],
      [config.maxOutputTokens, 256, 16384, "output tokens"],
    ] as const) {
      if (!Number.isInteger(value) || value < min || value > max)
        throw new Error(`Invalid ${label}: choose ${min}–${max}.`);
    }
    if (
      (config.maxAgents !== null &&
        (!Number.isInteger(config.maxAgents) ||
          config.maxAgents < config.members.length ||
          config.maxAgents > 128)) ||
      (config.maxDepth !== null &&
        (!Number.isInteger(config.maxDepth) ||
          config.maxDepth < 0 ||
          config.maxDepth > 16))
    )
      throw new Error("Invalid delegation limits.");
    if (
      new Set(config.members.map((m) => m.id)).size !== config.members.length ||
      config.members.some((m) => !config.providerIds.includes(m.providerId))
    )
      throw new Error(
        "Every peer needs a distinct identity and a selected model.",
      );
    if (
      config.members.some(
        (m) =>
          m.maxOutputTokens !== undefined &&
          (!Number.isInteger(m.maxOutputTokens) ||
            m.maxOutputTokens < 256 ||
            m.maxOutputTokens > 16384),
      )
    )
      throw new Error("Invalid agent output tokens: choose 256–16384 per agent.");
    config = structuredClone(config);
    if (!prompt.trim() || prompt.length > 20000)
      throw new Error("Enter a goal of 1–20000 characters.");
    const greeting =
      !resume && quickReply({ prompt, attachments: previous?.attachments });
    const models = this.syncModels();
    for (const id of config.providerIds) {
      const m = models.find((m) => m.id === id);
      if (!m) throw new Error(`Connection ${id} is no longer configured.`);
      if (!greeting && m.keyEnv && !modelKey(m))
        throw new Error(
          `Add a key in /connections, set ${m.keyEnv} before launching Council, or use another connection.`,
        );
    }
    const run: Run = {
      id: randomUUID(),
      title: prompt.slice(0, 70),
      userMessage: resume && previous ? previous.userMessage : prompt,
      prompt:
        resume && previous
          ? previous.prompt
          : previous
            ? `Previous goal:\n${previous.prompt.slice(-4000)}\nPrevious answer:\n${previous.final.slice(-8000)}\n\nCurrent user goal:\n${prompt}`
            : prompt,
      config,
      createdAt: new Date().toISOString(),
      status: "queued",
      final: "",
      demo: false,
      parentId: previous?.id,
      ...(resume && previous
        ? { resumeState: structuredClone(previous.sharedState) }
        : {}),
    };
    if (resume && run.resumeState) {
      for (const peer of run.resumeState.peers)
        if (!config.providerIds.includes(peer.member.providerId))
          throw new Error(
            "Restore the prior run's model pool before resuming its team.",
          );
    }
    this.store.saveRun(this.userId, run);
    const unsubscribe = this.store.subscribe(run.id, notify);
    try {
      await this.engine.start(this.userId, run);
      return this.store.getRun(this.userId, run.id)!;
    } finally {
      unsubscribe();
    }
  }
  stop() {
    for (const id of this.engine.active.keys())
      this.engine.cancel(this.userId, id);
  }
  postBoard(content: string) {
    for (const id of this.engine.active.keys())
      if (this.engine.postBoard(this.userId, id, content)) return true;
    return false;
  }
  async close() {
    this.stop();
    for (let i = 0; this.engine.active.size && i < 300; i++)
      await new Promise((r) => setTimeout(r, 20));
    if (this.engine.active.size)
      throw new Error("Council is still stopping; project lock retained.");
    await this.project.lsp.close();
    this.db.close();
    unlinkSync(this.lockFile);
  }
}
