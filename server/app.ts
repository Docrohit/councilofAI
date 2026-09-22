import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { openDb } from "./db.ts";
import {
  hashPassword,
  verifyPassword,
  tokenHash,
  validateEndpoint,
} from "./security.ts";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import {
  Benchmarks,
  benchmarkSuite,
  benchmarkMetadata,
  type BenchmarkResult,
} from "./benchmarks.ts";
import { complete } from "./providers.ts";
import type { Provider, Run, User } from "../shared/types.ts";

const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(60).optional(),
  inviteCode: z.string().optional(),
});
const providerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum([
    "ollama",
    "vllm",
    "openai",
    "anthropic",
    "glm",
    "compatible",
    "opencode",
    "demo",
  ]),
  baseUrl: z.string().max(500),
  model: z.string().trim().min(1).max(200),
  transport: z.enum(["direct", "bridge"]).default("direct"),
  reasoning: z.boolean().default(false),
  apiKey: z.string().max(1000).optional(),
  clearKey: z.boolean().optional(),
});
const member = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  role: z.string().trim().min(1).max(200),
  providerId: z.string().min(1).max(80),
});
const configSchema = z.object({
  members: z.array(member).min(1).max(32),
  providerIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  maxAgents: z.number().int().min(1).max(128).nullable().default(12),
  maxDepth: z.number().int().min(0).max(16).nullable().default(3),
  concurrency: z.number().int().min(1).max(8).default(1),
  maxCalls: z.number().int().min(4).max(256).default(24),
  maxOutputTokens: z.number().int().min(256).max(16384).default(4096),
  maxMinutes: z.number().int().min(1).max(120).default(20),
});
const fileSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/ -]{0,199}$/)
    .refine((s) => !s.split("/").some((p) => p === ".." || p === ".")),
  content: z.string().max(40_000),
});

export function createApp(directory: string, production = false) {
  const db = openDb(directory);
  const store = new Store(db, directory);
  store.recover();
  const engine = new Orchestrator(store);
  const benchmarks = new Benchmarks(store, engine);
  for (const row of db
    .prepare("SELECT id,user_id,data FROM benchmarks")
    .all() as any[]) {
    const b = JSON.parse(row.data);
    if (b.status === "running") {
      b.status = "failed";
      b.error = "Server restarted; partial rows are preserved.";
      benchmarks.save(row.user_id, b);
    }
  }
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY)
    app.set("trust proxy", Number(process.env.TRUST_PROXY));
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    process.env.DEPLOYMENT_MODE === "hosted";
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              upgradeInsecureRequests: secure ? [] : null,
            },
          }
        : false,
      hsts: secure ? undefined : false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    const expected = process.env.APP_ORIGIN || "http://localhost:4310";
    const local = process.env.DEPLOYMENT_MODE !== "hosted";
    const origins = new Set([
      expected,
      ...(local ? [expected.replace("localhost", "127.0.0.1")] : []),
    ]);
    if (origin && !origins.has(origin)) {
      res.status(403).json({ error: "Origin not allowed." });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-council-request"] !== "1"
    ) {
      res.status(403).json({ error: "Missing request protection header." });
      return;
    }
    if (
      local &&
      !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname) &&
      req.hostname !== new URL(expected).hostname
    ) {
      res.status(403).json({ error: "Host not allowed." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "512kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const userOf = (res: Response) => res.locals.user as User;
  const issueSession = (userId: string, kind: string) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare(
      "INSERT INTO sessions(hash,user_id,expires,kind) VALUES(?,?,?,?)",
    ).run(
      tokenHash(token),
      userId,
      Date.now() + (kind === "cli" ? 30 : 7) * 86400_000,
      kind,
    );
    return token;
  };
  const cookie = (res: Response, token: string) =>
    res.cookie("council_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 7 * 86400_000,
    });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/info", (_req, res) =>
    res.json({
      signup: process.env.ALLOW_SIGNUP !== "false",
      inviteRequired: !!process.env.INVITE_CODE,
      mode: process.env.DEPLOYMENT_MODE || "local",
    }),
  );
  app.post("/api/auth/signup", authLimit, async (req, res) => {
    if (process.env.ALLOW_SIGNUP === "false") {
      res.status(403).json({ error: "Signup is closed." });
      return;
    }
    const data = credentials.parse(req.body);
    if (
      process.env.INVITE_CODE &&
      data.inviteCode !== process.env.INVITE_CODE
    ) {
      res.status(403).json({ error: "A valid invitation code is required." });
      return;
    }
    const user = {
      id: randomUUID(),
      email: data.email,
      name: data.name || data.email.split("@")[0],
    };
    const hashed = await hashPassword(data.password);
    try {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        user.id,
        user.email,
        user.name,
        hashed,
        new Date().toISOString(),
      );
    } catch {
      res
        .status(409)
        .json({ error: "Unable to create an account with these details." });
      return;
    }
    const demo: Provider = {
      id: randomUUID(),
      name: "Demo connection",
      kind: "demo",
      baseUrl: "",
      model: "scripted-demo",
      transport: "direct",
      reasoning: false,
    };
    db.prepare("INSERT INTO providers(id,user_id,config) VALUES(?,?,?)").run(
      demo.id,
      user.id,
      JSON.stringify(demo),
    );
    cookie(res, issueSession(user.id, "cookie"));
    res.status(201).json({ user });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const data = credentials.parse(req.body);
    const row = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(data.email) as any;
    if (!row) {
      await hashPassword(data.password);
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    if (!(await verifyPassword(data.password, row.password))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const user = { id: row.id, email: row.email, name: row.name };
    cookie(res, issueSession(user.id, "cookie"));
    res.json({ user });
  });
  app.use("/api", (req, res, next) => {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    const rawCookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("council_session="))
      ?.slice("council_session=".length);
    const token = bearer || rawCookie;
    const row = token
      ? (db
          .prepare(
            "SELECT u.id,u.email,u.name,s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?",
          )
          .get(tokenHash(token), Date.now()) as any)
      : null;
    if (!row) {
      res.status(401).json({ error: "Please sign in." });
      return;
    }
    res.locals.user = { id: row.id, email: row.email, name: row.name };
    res.locals.session = row.hash;
    next();
  });
  app.get("/api/me", (_req, res) => res.json({ user: userOf(res) }));
  app.post("/api/auth/logout", (_req, res) => {
    db.prepare("DELETE FROM sessions WHERE hash=?").run(res.locals.session);
    res.clearCookie("council_session", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
    });
    res.json({ ok: true });
  });
  app.post("/api/auth/token", (_req, res) =>
    res.json({ token: issueSession(userOf(res).id, "cli"), expiresInDays: 30 }),
  );
  app.delete("/api/auth/tokens", (_req, res) => {
    db.prepare("DELETE FROM sessions WHERE user_id=? AND kind='cli'").run(
      userOf(res).id,
    );
    res.json({ ok: true });
  });
  app.get("/api/providers", (_req, res) =>
    res.json(
      store.providers(userOf(res).id).map((p) => ({
        ...p,
        online:
          Date.now() -
            (engine.bridge.online.get(`${userOf(res).id}:${p.id}`) || 0) <
          20_000,
      })),
    ),
  );
  app.post("/api/providers", (req, res) => {
    const userId = userOf(res).id;
    if (store.providers(userId).length >= 20) {
      res.status(400).json({ error: "Connection limit reached." });
      return;
    }
    const data = providerSchema.parse(req.body);
    if (data.kind === "opencode") data.transport = "bridge";
    if (data.kind !== "demo" && data.transport === "direct")
      data.baseUrl = validateEndpoint(data.baseUrl);
    if (
      data.transport === "bridge" &&
      !["ollama", "vllm", "compatible", "opencode"].includes(data.kind)
    ) {
      res.status(400).json({
        error: "Local bridge supports Ollama, vLLM, and compatible endpoints.",
      });
      return;
    }
    const { apiKey, clearKey, ...config } = data;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO providers(id,user_id,config,secret) VALUES(?,?,?,?)",
    ).run(
      id,
      userId,
      JSON.stringify({ ...config, id }),
      store.secrets.encrypt(apiKey || ""),
    );
    res.status(201).json({ id });
  });
  app.put("/api/providers/:id", (req, res) => {
    const userId = userOf(res).id;
    const existing = db
      .prepare("SELECT secret FROM providers WHERE id=? AND user_id=?")
      .get(req.params.id as string, userId) as any;
    if (!existing) {
      res.sendStatus(404);
      return;
    }
    const data = providerSchema.parse(req.body);
    if (data.kind === "opencode") data.transport = "bridge";
    if (data.kind !== "demo" && data.transport === "direct")
      data.baseUrl = validateEndpoint(data.baseUrl);
    if (
      data.transport === "bridge" &&
      !["ollama", "vllm", "compatible", "opencode"].includes(data.kind)
    ) {
      res.status(400).json({ error: "Unsupported bridge provider." });
      return;
    }
    const { apiKey, clearKey, ...config } = data;
    db.prepare(
      "UPDATE providers SET config=?,secret=? WHERE id=? AND user_id=?",
    ).run(
      JSON.stringify({ ...config, id: req.params.id }),
      clearKey ? "" : apiKey ? store.secrets.encrypt(apiKey) : existing.secret,
      req.params.id as string,
      userId,
    );
    res.json({ ok: true });
  });
  app.delete("/api/providers/:id", (req, res) => {
    db.prepare("DELETE FROM providers WHERE id=? AND user_id=?").run(
      req.params.id as string,
      userOf(res).id,
    );
    res.json({ ok: true });
  });
  app.post("/api/providers/:id/test", async (req, res) => {
    const provider = store
      .providers(userOf(res).id, true)
      .find((p) => p.id === req.params.id);
    if (!provider) {
      res.sendStatus(404);
      return;
    }
    const request = {
      messages: [
        { role: "user" as const, content: "Reply with just: Connected" },
      ],
      maxTokens: 512,
      signal: AbortSignal.timeout(60_000),
    };
    const stream =
      provider.transport === "bridge"
        ? engine.bridge.complete(userOf(res).id, provider, request)
        : complete(provider, request);
    let text = "";
    for await (const chunk of stream)
      if (chunk.type === "text") text += chunk.text;
    res.json({ ok: true, text: text.slice(0, 1000) });
  });
  app.get("/api/benchmarks/metadata", (_req, res) =>
    res.json(benchmarkMetadata),
  );
  app.get("/api/benchmarks/suite", (_req, res) =>
    res.json(benchmarkSuite.map(({ expected, ...task }) => task)),
  );
  app.get("/api/benchmarks", (_req, res) =>
    res.json(benchmarks.list(userOf(res).id)),
  );
  app.post("/api/benchmarks", (req, res) => {
    const userId = userOf(res).id;
    const data = z
      .object({
        config: configSchema,
        baselineProviderId: z.string(),
        baselineMode: z.enum(["single", "matched"]).default("single"),
        repeats: z.number().int().min(1).max(3).default(1),
        taskIds: z.array(z.string()).min(1).max(10),
      })
      .parse(req.body);
    if (
      benchmarks.busy(userId) ||
      [...engine.active.values()].some((a) => a.userId === userId) ||
      benchmarks.active.size >= 2
    ) {
      res.status(409).json({
        error:
          "Finish current work or retry when benchmark capacity is available.",
      });
      return;
    }
    const providers = store.providers(userId);
    const selected = [...data.config.providerIds, data.baselineProviderId];
    if (
      selected.some(
        (id) =>
          !providers.some(
            (p) => p.id === id && p.kind !== "demo" && p.kind !== "opencode",
          ),
      ) ||
      data.taskIds.some((id) => !benchmarkSuite.some((t) => t.id === id)) ||
      data.config.members.some(
        (m) => !data.config.providerIds.includes(m.providerId),
      ) ||
      new Set(data.config.members.map((m) => m.id)).size !==
        data.config.members.length ||
      (data.config.maxAgents !== null &&
        data.config.maxAgents < data.config.members.length) ||
      data.config.maxCalls < data.config.members.length + 2
    ) {
      res.status(400).json({
        error:
          "Choose valid real model connections, agents, tasks, and budgets. Scripted demos and coding runtimes are excluded from model-only benchmarks.",
      });
      return;
    }
    const result: BenchmarkResult = {
      id: randomUUID(),
      status: "running",
      createdAt: new Date().toISOString(),
      ...data,
      rows: [],
    };
    benchmarks.save(userId, result);
    void benchmarks.run(userId, result);
    res.status(201).json(result);
  });
  app.post("/api/benchmarks/:id/cancel", (req, res) => {
    if (!benchmarks.cancel(userOf(res).id, req.params.id as string)) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
  });
  app.get("/api/team", (_req, res) => {
    const row = db
      .prepare("SELECT config FROM preferences WHERE user_id=?")
      .get(userOf(res).id) as any;
    res.json(row ? JSON.parse(row.config) : null);
  });
  app.put("/api/team", (req, res) => {
    const config = configSchema.parse(req.body);
    db.prepare(
      "INSERT INTO preferences(user_id,config) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET config=excluded.config",
    ).run(userOf(res).id, JSON.stringify(config));
    res.json({ ok: true });
  });
  app.get("/api/runs", (_req, res) =>
    res.json(
      store
        .runs(userOf(res).id)
        .map(({ sharedState, resumeState, ...run }) => run),
    ),
  );
  app.post("/api/runs", (req, res) => {
    const userId = userOf(res).id;
    const data = z
      .object({
        prompt: z.string().trim().min(1).max(20_000),
        config: configSchema,
        parentId: z.string().optional(),
      })
      .parse(req.body);
    const config = data.config;
    if (
      benchmarks.busy(userId) ||
      [...engine.active.values()].some((a) => a.userId === userId)
    ) {
      res
        .status(409)
        .json({ error: "Stop or finish your active session first." });
      return;
    }
    if (engine.active.size >= 10) {
      res
        .status(429)
        .json({ error: "Server is at capacity. Please retry shortly." });
      return;
    }
    const providers = store.providers(userId);
    if (
      new Set(config.members.map((m) => m.id)).size !== config.members.length ||
      (config.maxAgents !== null && config.maxAgents < config.members.length) ||
      config.maxCalls < config.members.length + 2 ||
      config.members.some((m) => !config.providerIds.includes(m.providerId)) ||
      config.providerIds.some((id) => !providers.find((p) => p.id === id))
    ) {
      res.status(400).json({
        error:
          "Invalid team or budget. Every member needs a connection and enough calls to contribute.",
      });
      return;
    }
    const selected = providers.filter((p) => config.providerIds.includes(p.id));
    if (
      selected.some((p) => p.kind === "demo") &&
      selected.some((p) => p.kind !== "demo")
    ) {
      res.status(400).json({
        error: "Use an entirely demo team or entirely real connections.",
      });
      return;
    }
    let prompt = data.prompt;
    if (data.parentId) {
      const parent = store.getRun(userId, data.parentId);
      if (!parent) {
        res.sendStatus(404);
        return;
      }
      prompt = `Previous goal:\n${parent.prompt.slice(0, 6000)}\nPrevious answer:\n${parent.final.slice(0, 6000)}\n\nCurrent follow-up:\n${data.prompt}`;
    }
    const run: Run = {
      id: randomUUID(),
      title: data.prompt.slice(0, 70),
      prompt,
      config,
      createdAt: new Date().toISOString(),
      status: "queued",
      final: "",
      demo: selected.every((p) => p.kind === "demo"),
      parentId: data.parentId,
    };
    store.saveRun(userId, run);
    void engine
      .start(userId, run)
      .catch((error) => console.error("Run failure:", error.message));
    res.status(201).json(run);
  });
  app.post("/api/runs/:id/continue", (req, res) => {
    const userId = userOf(res).id;
    const previous = store.getRun(userId, req.params.id as string);
    if (!previous) {
      res.sendStatus(404);
      return;
    }
    if (!previous.sharedState) {
      res.status(400).json({ error: "This session has no saved team state." });
      return;
    }
    if (
      benchmarks.busy(userId) ||
      [...engine.active.values()].some((a) => a.userId === userId) ||
      engine.active.size >= 10
    ) {
      res.status(409).json({
        error:
          "Finish your active session first or retry when capacity is available.",
      });
      return;
    }
    const available = store.providers(userId);
    if (
      previous.config.providerIds.some(
        (id) => !available.some((p) => p.id === id),
      )
    ) {
      res.status(400).json({
        error:
          "A connection has been removed. Start a new session with available connections.",
      });
      return;
    }
    const run: Run = {
      ...previous,
      id: randomUUID(),
      title: previous.title,
      createdAt: new Date().toISOString(),
      status: "queued",
      final: "",
      parentId: previous.id,
      resumeState: previous.sharedState,
      sharedState: undefined,
    };
    store.saveRun(userId, run);
    void engine
      .start(userId, run)
      .catch((error) => console.error("Run failure:", error.message));
    res.status(201).json(run);
  });
  app.get("/api/runs/:id", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    res.json({ run, events: store.events(run.id) });
  });
  app.post("/api/runs/:id/cancel", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    engine.cancel(userOf(res).id, run.id);
    res.json({ ok: true });
  });
  app.get("/api/runs/:id/events", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    const after = Number(req.headers["last-event-id"] || req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      res.sendStatus(400);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: any) => {
      if (res.writableLength > 1_000_000) {
        res.end();
        return;
      }
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = store.subscribe(run.id, send);
    for (const event of store.events(run.id, after)) send(event);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.get("/api/files", (_req, res) =>
    res.json(
      db
        .prepare("SELECT name,content FROM files WHERE user_id=?")
        .all(userOf(res).id),
    ),
  );
  app.post("/api/files", (req, res) => {
    const file = fileSchema.parse(req.body);
    const userId = userOf(res).id;
    const count = (
      db
        .prepare("SELECT count(*) AS n FROM files WHERE user_id=?")
        .get(userId) as any
    ).n;
    if (
      count >= 100 &&
      !db
        .prepare("SELECT name FROM files WHERE user_id=? AND name=?")
        .get(userId, file.name)
    ) {
      res.status(400).json({ error: "Workspace file limit reached." });
      return;
    }
    db.prepare(
      "INSERT INTO files(user_id,name,content) VALUES(?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET content=excluded.content",
    ).run(userId, file.name, file.content);
    res.json({ ok: true });
  });
  app.get("/api/proposals", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM proposals WHERE user_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(userOf(res).id),
    ),
  );
  app.post("/api/proposals/:id", (req, res) => {
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    const proposal = db
      .prepare("SELECT * FROM proposals WHERE id=? AND user_id=?")
      .get(req.params.id as string, userOf(res).id) as any;
    if (!proposal || proposal.status !== "pending") {
      res
        .status(404)
        .json({ error: "Proposal not found or already resolved." });
      return;
    }
    if (accept) {
      const current = db
        .prepare("SELECT content FROM files WHERE user_id=? AND name=?")
        .get(userOf(res).id, proposal.name) as any;
      if ((current?.content ?? null) !== proposal.original) {
        res.status(409).json({
          error:
            "File changed since this proposal. Reject it and request a new proposal.",
        });
        return;
      }
      db.prepare(
        "INSERT INTO files(user_id,name,content) VALUES(?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET content=excluded.content",
      ).run(userOf(res).id, proposal.name, proposal.content);
    }
    db.prepare("UPDATE proposals SET status=? WHERE id=?").run(
      accept ? "accepted" : "rejected",
      proposal.id,
    );
    store.event(proposal.run_id, "file.resolved", {
      id: proposal.id,
      status: accept ? "accepted" : "rejected",
      path: proposal.name,
    });
    res.json({ ok: true });
  });
  app.get("/api/bridge/:providerId/poll", (req, res) => {
    const provider = store
      .providers(userOf(res).id)
      .find((p) => p.id === req.params.providerId && p.transport === "bridge");
    if (!provider) {
      res.sendStatus(404);
      return;
    }
    res.json(engine.bridge.poll(userOf(res).id, provider.id));
  });
  app.post("/api/bridge/jobs/:id", (req, res) => {
    const data = z
      .object({
        chunks: z
          .array(
            z.object({
              type: z.enum(["text", "reasoning", "usage", "coding"]),
              text: z.string().max(8000).optional(),
              input: z.number().nonnegative().optional(),
              output: z.number().nonnegative().optional(),
              activity: z
                .object({
                  kind: z.enum([
                    "session",
                    "tool",
                    "diff",
                    "permission",
                    "question",
                  ]),
                  sessionId: z.string().min(1).max(200),
                  id: z.string().min(1).max(200),
                  title: z.string().max(500),
                  detail: z.string().max(12000),
                  status: z.string().max(80).optional(),
                  questions: z
                    .array(
                      z.object({
                        question: z.string().max(2000),
                        options: z.array(z.string().max(500)).max(20),
                        multiple: z.boolean().optional(),
                      }),
                    )
                    .max(10)
                    .optional(),
                })
                .optional(),
            }),
          )
          .max(50)
          .optional(),
        done: z.boolean().optional(),
        error: z.string().max(500).optional(),
        acknowledged: z.array(z.string().max(200)).max(50).optional(),
      })
      .parse(req.body);
    if (!engine.bridge.push(userOf(res).id, req.params.id as string, data)) {
      res.status(410).json({ error: "Job ended or is unavailable." });
      return;
    }
    res.json({
      ok: true,
      replies: engine.bridge.controls(userOf(res).id, req.params.id as string),
    });
  });
  app.post("/api/coding/jobs/:id/reply", (req, res) => {
    const reply = z
      .object({
        id: z.string().min(1).max(200),
        kind: z.enum(["permission", "question"]),
        reply: z.enum(["once", "reject"]),
        answers: z
          .array(z.array(z.string().max(2000)).max(20))
          .max(10)
          .optional(),
      })
      .parse(req.body);
    const result = engine.bridge.reply(
      userOf(res).id,
      req.params.id as string,
      reply,
    );
    if (!result) {
      res
        .status(409)
        .json({
          error:
            "This request has ended, was answered, or belongs to another account.",
        });
      return;
    }
    if (result.context)
      store.event(result.context.runId, "coding.reply", {
        jobId: req.params.id,
        requestId: reply.id,
        reply: reply.reply,
      });
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request too large." });
      return;
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : "Request failed.",
    });
  });
  return { app, db, store, engine, benchmarks };
}
