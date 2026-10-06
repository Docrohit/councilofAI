import { quickReply } from "./quick-reply.ts";
import { prepareAttachment, attachmentName } from "./attachments.ts";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  type Attachment,
} from "../shared/attachments.ts";
import { sandboxRequest } from "./sandbox.ts";
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
  benchmarkTaskSchema,
  type BenchmarkResult,
} from "./benchmarks.ts";
import { complete } from "./providers.ts";
import { TelegramBridge } from "./telegram.ts";
import {
  clearKite,
  completeKiteConnect,
  kiteStatus,
  refreshKiteAccessToken,
  saveKite,
  startKiteConnect,
  testKiteConnection,
} from "./kite.ts";
import {
  deleteUserSkill,
  listSkills,
  MAX_USER_SKILLS,
  readSkillForOwner,
  saveUserSkill,
  setUserSkillEnabled,
} from "./skills.ts";
import type { Provider, Run, User } from "../shared/types.ts";
import {
  PAYMENT_SCREENSHOT_MAX_BYTES,
  accountStatus,
  accountStatusWithPricing,
  assertCanSend,
  confirmEmailToken,
  confirmationRequired,
  listPaymentSubmissions,
  paymentSubmissions,
  paymentImage,
  recordUserMessage,
  resetPasswordToken,
  reviewPaymentSubmission,
  sendConfirmationEmail,
  sendPasswordResetEmail,
  sendPaymentScreenshot,
  isBillingAdmin,
} from "./billing.ts";
import QRCode from "qrcode";
import { modelCatalog, resolveModelId } from "./catalog.ts";
import {
  adminOrders,
  approveOrder,
  createOrder,
  PaymentError,
  paymentsConfig,
  rejectOrder,
  submitProof,
  userOrder,
  userOrders,
} from "./payments.ts";

const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(60).optional(),
  inviteCode: z.string().optional(),
});
const emailOnly = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
});
const resetPassword = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(200),
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
  reasoningEffort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .optional(),
  apiKey: z.string().max(1000).optional(),
  clearKey: z.boolean().optional(),
});
const member = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  role: z.string().trim().min(1).max(200),
  providerId: z.string().min(1).max(80),
  systemPrompt: z.string().trim().min(1).max(4000).optional(),
  maxOutputTokens: z.number().int().min(256).max(16384).optional(),
});
const configSchema = z.object({
  sandbox: z.boolean().default(false),
  webResearch: z.boolean().default(false),
  skillsAgent: z.boolean().default(true),
  goalMode: z.boolean().default(false),
  minGoalMinutes: z.number().int().min(1).max(180).optional(),
  members: z.array(member).min(1).max(32),
  providerIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  maxAgents: z.number().int().min(1).max(128).nullable().default(12),
  maxDepth: z.number().int().min(0).max(16).nullable().default(3),
  concurrency: z.number().int().min(1).max(8).default(1),
  maxCalls: z.number().int().min(4).max(256).default(24),
  maxOutputTokens: z.number().int().min(256).max(16384).default(8192),
  maxMinutes: z.number().int().min(1).max(180).default(20),
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
      delete b.progress;
      for (const item of b.rows || []) {
        if (["pending", "running"].includes(item.baseline?.status)) {
          item.baseline.status = "failed";
          item.baseline.correct = null;
          item.baseline.error =
            "Server restarted before the baseline finished.";
          item.baseline.reason = item.baseline.error;
        }
      }
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
  const unreadableKeys = (providers: Provider[], ids: string[]) => {
    const names = providers
      .filter((p) => ids.includes(p.id) && p.keyUnreadable)
      .map((p) => p.name);
    return names.length
      ? `The saved API key for ${names.join(", ")} can no longer be read. Edit ${names.length > 1 ? "those connections" : "that connection"} in Connections and paste the key again.`
      : "";
  };
  const appOrigin = process.env.APP_ORIGIN || "http://localhost:4310";
  const chargeMessage = (userId: string) => {
    assertCanSend(db, userId);
    recordUserMessage(db, userId);
  };
  const startRunForUser = async (
    userId: string,
    input: {
      prompt: string;
      config: unknown;
      goalMode?: boolean;
      minGoalMinutes?: number;
      maxGoalMinutes?: number;
      attachmentIds?: string[];
      parentId?: string;
    },
  ) => {
    let prompt = z.string().trim().min(1).max(20_000).parse(input.prompt);
    let config = configSchema.parse(input.config);
    if (
      benchmarks.busy(userId) ||
      [...engine.active.values()].some((a) => a.userId === userId)
    )
      throw new Error("Stop or finish your active session first.");
    if (engine.active.size >= 10)
      throw new Error("Server is at capacity. Please retry shortly.");
    const providers = store.providers(userId);
    if (
      new Set(config.members.map((m) => m.id)).size !== config.members.length ||
      (config.maxAgents !== null && config.maxAgents < config.members.length) ||
      config.maxCalls < config.members.length + 2 ||
      config.members.some((m) => !config.providerIds.includes(m.providerId)) ||
      config.providerIds.some((id) => !providers.find((p) => p.id === id))
    )
      throw new Error(
        "Invalid saved team or budget. Update your Council team.",
      );
    const keyProblem = unreadableKeys(providers, config.providerIds);
    if (keyProblem) throw new Error(keyProblem);
    const selected = providers.filter((p) => config.providerIds.includes(p.id));
    if (
      selected.some((p) => p.kind === "demo") &&
      selected.some((p) => p.kind !== "demo")
    )
      throw new Error(
        "Use an entirely demo team or entirely real connections.",
      );
    const goalMin = Math.min(
      Math.max(input.minGoalMinutes ?? config.minGoalMinutes ?? 10, 1),
      180,
    );
    const goalMax = Math.min(
      Math.max(input.maxGoalMinutes ?? config.maxMinutes, goalMin),
      180,
    );
    if (input.goalMode || config.goalMode)
      config = {
        ...config,
        goalMode: true,
        minGoalMinutes: goalMin,
        maxMinutes: goalMax,
      };
    let attachments: Attachment[] = [];
    const parent = input.parentId
      ? store.getRun(userId, input.parentId)
      : undefined;
    if (input.parentId && !parent)
      throw new Error("Previous Telegram session is unavailable. Send /new to start fresh.");
    for (const id of new Set(input.attachmentIds || [])) {
      const row = db
        .prepare(
          "SELECT data FROM attachments WHERE id=? AND user_id=? AND expires>?",
        )
        .get(id, userId, Date.now()) as { data: string } | undefined;
      if (!row)
        throw new Error(
          "A Telegram attachment expired or is unavailable. Please send it again.",
        );
      attachments.push(JSON.parse(row.data));
    }
    if (parent) {
      attachments = [...(parent.attachments || []), ...attachments];
      prompt = `Previous goal:\n${parent.prompt.slice(0, 6000)}\nPrevious answer:\n${parent.final.slice(0, 6000)}\n\nCurrent follow-up:\n${input.prompt}`;
    }
    if (attachments.length > ATTACHMENT_MAX_FILES)
      throw new Error("A conversation can include up to four files.");
    assertCanSend(db, userId);
    const run: Run = {
      attachments,
      id: randomUUID(),
      title: input.prompt.slice(0, 70),
      userMessage: input.prompt,
      prompt,
      config,
      createdAt: new Date().toISOString(),
      status: "queued",
      final: "",
      demo: selected.every((p) => p.kind === "demo"),
      parentId: input.parentId,
      ...(input.goalMode || config.goalMode
        ? {
            goal: {
              mode: "goal" as const,
              text: input.prompt,
              minMinutes: goalMin,
              maxMinutes: goalMax,
              updatedAt: new Date().toISOString(),
            },
          }
        : {}),
    };
    store.saveRun(userId, run);
    recordUserMessage(db, userId);
    for (const id of input.attachmentIds || [])
      db.prepare("DELETE FROM attachments WHERE id=? AND user_id=?").run(
        id,
        userId,
      );
    void engine.start(userId, run).catch((error) => {
      console.error(
        "Run failure:",
        error instanceof Error ? error.message : String(error),
      );
      engine.failStart(userId, run.id, error);
    });
    return run;
  };
  const telegram = new TelegramBridge(
    db,
    store,
    engine,
    startRunForUser,
    chargeMessage,
  );
  telegram.startAll();
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
      emailConfirmationRequired: confirmationRequired(),
    }),
  );
  app.get("/api/auth/confirm", (req, res) => {
    const token = z.string().min(20).max(200).parse(req.query.token);
    const userId = confirmEmailToken(db, token);
    if (!userId) {
      res.status(400).send("Confirmation link is invalid or expired.");
      return;
    }
    cookie(res, issueSession(userId, "cookie"));
    res.redirect("/?confirmed=1");
  });
  // Kite redirects here from kite.zerodha.com. The SameSite=strict session
  // cookie is not sent on that cross-site navigation, so the account is found
  // through the single-use state created by /api/integrations/kite/connect.
  app.get("/api/integrations/kite/callback", authLimit, async (req, res) => {
    const page = (status: number, title: string, message: string) =>
      res
        .status(status)
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Council</a></p></body></html>`,
        );
    const query = z
      .object({
        state: z.string().trim().min(16).max(200),
        request_token: z.string().trim().min(10).max(500),
        status: z.string().max(40).optional(),
      })
      .safeParse(req.query);
    if (!query.success || (query.data.status && query.data.status !== "success")) {
      page(
        400,
        "Kite login was not completed",
        "Kite did not return a usable login. Open Connections in Council and click Connect Kite again. If this keeps happening, check that your Kite app's Redirect URL matches the one shown in Council.",
      );
      return;
    }
    try {
      const { status } = await completeKiteConnect(
        db,
        store,
        query.data.state,
        query.data.request_token,
      );
      page(
        200,
        "Kite connected",
        `Kite is connected for today${status.kiteUserId ? ` as ${status.kiteUserId}` : ""}. Kite ends every session at the next 6 AM IST, so connect again each trading day.`,
      );
    } catch (e) {
      page(400, "Kite connection failed", (e as Error).message);
    }
  });
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
    const verified = confirmationRequired() ? 0 : 1;
    try {
      db.prepare(
        "INSERT INTO users(id,email,name,password,created_at,email_verified,access_approved,free_messages_used,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        user.id,
        user.email,
        user.name,
        hashed,
        new Date().toISOString(),
        verified,
        0,
        0,
        verified ? new Date().toISOString() : null,
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
    const confirmation = await sendConfirmationEmail(db, user, appOrigin);
    if (confirmation.required) {
      res.status(201).json({
        needsConfirmation: true,
        message:
          "Check your email and click the confirmation link to finish signup.",
      });
      return;
    }
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
    if (!row.email_verified) {
      res.status(403).json({
        error:
          "Confirm your email address before signing in. Check your inbox for the Council confirmation link.",
      });
      return;
    }
    const user = { id: row.id, email: row.email, name: row.name };
    cookie(res, issueSession(user.id, "cookie"));
    res.json({ user });
  });
  app.post("/api/auth/password/forgot", authLimit, async (req, res) => {
    const data = emailOnly.parse(req.body);
    try {
      await sendPasswordResetEmail(db, data.email, appOrigin);
    } catch (e) {
      if (process.env.NODE_ENV === "production")
        console.warn("Password reset email failed", e);
    }
    res.json({
      ok: true,
      message:
        "If that email is registered, a password reset link will arrive shortly.",
    });
  });
  app.post("/api/auth/password/reset", authLimit, async (req, res) => {
    const data = resetPassword.parse(req.body);
    const userId = resetPasswordToken(db, data.token);
    if (!userId) {
      res.status(400).json({ error: "Password reset link is invalid or expired." });
      return;
    }
    const hashed = await hashPassword(data.password);
    db.prepare(
      "UPDATE users SET password=?,email_verified=1,confirmed_at=COALESCE(confirmed_at,?) WHERE id=?",
    ).run(hashed, new Date().toISOString(), userId);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    cookie(res, issueSession(userId, "cookie"));
    const row = db
      .prepare("SELECT id,email,name FROM users WHERE id=?")
      .get(userId) as Pick<User, "id" | "email" | "name"> | undefined;
    if (!row) {
      res.sendStatus(404);
      return;
    }
    res.json({ user: row });
  });
  const admin = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    next();
  };
  app.get("/api/admin/users", admin, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,email,name,created_at,email_verified,access_approved,free_messages_used FROM users ORDER BY created_at DESC LIMIT 500",
        )
        .all(),
    ),
  );
  app.post("/api/admin/users/:id/approval", admin, (req, res) => {
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
    // Revoking also ends any paid period.
    const result = db
      .prepare("UPDATE users SET access_approved=?, access_until=CASE WHEN ? THEN access_until ELSE NULL END WHERE id=?")
      .run(approved ? 1 : 0, approved ? 1 : 0, req.params.id as string);
    if (!result.changes) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
  });
  app.get("/api/admin/payments", admin, (_req, res) =>
    res.json(listPaymentSubmissions(db)),
  );
  app.post("/api/admin/payments/:id/review", admin, (req, res) => {
    const { status, note } = z
      .object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(req.body);
    if (!reviewPaymentSubmission(db, req.params.id as string, status, note)) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
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
  const uploads = new Set<string>();
  db.prepare("DELETE FROM attachments WHERE expires<?").run(Date.now());
  app.post(
    "/api/attachments",
    (req, res, next) => {
      const uid = userOf(res).id;
      if (uploads.has(uid) || uploads.size >= 2) {
        res
          .status(429)
          .json({ error: "File reader is busy. Try again shortly." });
        return;
      }
      db.prepare("DELETE FROM attachments WHERE expires<?").run(Date.now());
      const count = db
        .prepare("SELECT count(*) AS n FROM attachments WHERE user_id=?")
        .get(uid) as { n: number };
      if (count.n >= 20) {
        res.status(429).json({
          error:
            "Too many pending files. Remove attachments or try again after they expire in 24 hours.",
        });
        return;
      }
      try {
        attachmentName(decodeURIComponent(req.get("X-File-Name") || ""));
      } catch {
        res.status(400).json({
          error:
            "Choose a .md, .txt, .pdf, .docx, .apk, .png, .jpg, .jpeg or .webp file.",
        });
        return;
      }
      if (!req.is("application/octet-stream")) {
        res.status(415).json({ error: "Send a binary file upload." });
        return;
      }
      uploads.add(uid);
      res.locals.uploadAbort = new AbortController();
      let reading = false;
      res.locals.uploadStarted = () => {
        reading = true;
      };
      res.once("close", () => {
        res.locals.uploadAbort.abort();
        if (!reading) uploads.delete(uid);
      });
      next();
    },
    express.raw({
      type: "application/octet-stream",
      limit: ATTACHMENT_MAX_BYTES,
    }),
    async (req, res) => {
      const uid = userOf(res).id;
      res.locals.uploadStarted();
      try {
        const item = await prepareAttachment(
          req.body,
          decodeURIComponent(req.get("X-File-Name")!),
          res.locals.uploadAbort.signal,
        );
        if (res.destroyed) return;
        db.prepare(
          "INSERT INTO attachments(id,user_id,expires,data) VALUES(?,?,?,?)",
        ).run(item.id, uid, Date.now() + 86400_000, JSON.stringify(item));
        res.status(201).json(item);
      } catch (e) {
        if (!res.destroyed)
          res.status(400).json({ error: (e as Error).message });
      } finally {
        uploads.delete(uid);
      }
    },
  );
  app.delete("/api/attachments/:id", (req, res) => {
    db.prepare("DELETE FROM attachments WHERE id=? AND user_id=?").run(
      req.params.id as string,
      userOf(res).id,
    );
    res.json({ ok: true });
  });
  app.get("/api/me", async (_req, res) =>
    res.json({
      user: userOf(res),
      billing: await accountStatusWithPricing(db, userOf(res).id),
      billingAdmin: isBillingAdmin(userOf(res).email),
    }),
  );
  const requireBillingAdmin = (res: Response) => {
    if (isBillingAdmin(userOf(res).email)) return true;
    res.status(404).json({ error: "Not found." });
    return false;
  };
  app.get("/api/billing/admin/payments", (_req, res) => {
    if (!requireBillingAdmin(res)) return;
    res.json(listPaymentSubmissions(db));
  });
  app.get("/api/billing/admin/payments/:id/image", (req, res) => {
    if (!requireBillingAdmin(res)) return;
    const image = paymentImage(db, req.params.id as string);
    if (!image?.image) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Content-Type", image.mime);
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(image.image));
  });
  app.post("/api/billing/admin/payments/:id/review", (req, res) => {
    if (!requireBillingAdmin(res)) return;
    const { status, note } = z
      .object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(req.body);
    if (!reviewPaymentSubmission(db, req.params.id as string, status, note)) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
  });
  app.get("/api/billing", async (_req, res) =>
    res.json({
      ...(await accountStatusWithPricing(db, userOf(res).id)),
      payments: {
        lightning: !!paymentsConfig().lightningAddress,
        onchain: !!paymentsConfig().onchainAddress,
      },
    }),
  );
  // Automatic payments: Lightning (zap receipts or preimage) and on-chain (unique amount or txid).
  const paymentError = (res: Response, e: unknown) =>
    res
      .status(e instanceof PaymentError ? e.status : 400)
      .json({ error: e instanceof z.ZodError ? "Invalid request." : (e as Error).message });
  const proofLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.get("/api/billing/orders", (_req, res) =>
    res.json(userOrders(db, userOf(res).id)),
  );
  app.post("/api/billing/orders", proofLimit, async (req, res) => {
    try {
      const { chain } = z
        .object({ chain: z.enum(["lightning", "onchain"]) })
        .parse(req.body);
      res.status(201).json(await createOrder(db, userOf(res).id, chain));
    } catch (e) {
      paymentError(res, e);
    }
  });
  app.get("/api/billing/orders/:id", (req, res) => {
    try {
      res.json(userOrder(db, userOf(res).id, req.params.id as string));
    } catch (e) {
      paymentError(res, e);
    }
  });
  app.get("/api/billing/orders/:id/qr.svg", async (req, res) => {
    try {
      const order = userOrder(db, userOf(res).id, req.params.id as string);
      const content =
        order.chain === "lightning" && order.invoice
          ? `LIGHTNING:${order.invoice.toUpperCase()}`
          : order.bip21;
      if (!content) throw new PaymentError("No payment request.", 404);
      res
        .type("image/svg+xml")
        .send(await QRCode.toString(content, { type: "svg", margin: 1 }));
    } catch (e) {
      paymentError(res, e);
    }
  });
  app.post("/api/billing/orders/:id/proof", proofLimit, async (req, res) => {
    try {
      const data = z
        .object({
          reference: z.string().trim().max(200).optional(),
          note: z.string().trim().max(1000).optional(),
        })
        .parse(req.body);
      res.json(
        await submitProof(db, userOf(res).id, req.params.id as string, data),
      );
    } catch (e) {
      paymentError(res, e);
    }
  });
  app.get("/api/billing/admin/orders", (_req, res) => {
    if (!requireBillingAdmin(res)) return;
    res.json(adminOrders(db));
  });
  app.post("/api/billing/admin/orders/:id", async (req, res) => {
    if (!requireBillingAdmin(res)) return;
    try {
      const data = z
        .object({
          action: z.enum(["approve", "reject"]),
          note: z.string().trim().max(500).optional(),
          force: z.boolean().optional(),
        })
        .parse(req.body);
      if (data.action === "approve")
        await approveOrder(db, req.params.id as string, data, userOf(res).email);
      else rejectOrder(db, req.params.id as string, data.note);
      res.json({ ok: true });
    } catch (e) {
      paymentError(res, e);
    }
  });
  app.get("/api/billing/payments", (_req, res) =>
    res.json(paymentSubmissions(db, userOf(res).id)),
  );
  app.post(
    "/api/billing/payment",
    express.raw({
      type: ["image/png", "image/jpeg", "image/webp"],
      limit: PAYMENT_SCREENSHOT_MAX_BYTES,
    }),
    async (req, res) => {
      try {
        const name = decodeURIComponent(
          req.get("X-File-Name") || "payment-screenshot.png",
        )
          .replace(/[^\w .-]/g, "_")
          .slice(0, 120);
        const result = await sendPaymentScreenshot(
          db,
          userOf(res),
          name || "payment-screenshot.png",
          req.get("content-type") || "",
          Buffer.isBuffer(req.body) ? req.body : Buffer.from([]),
        );
        res.status(201).json({
          ...result,
          message:
            "Payment screenshot submitted. Your account will be reviewed within 24 hours.",
        });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );
  app.get("/api/sandbox", async (_req, res) => {
    if (!process.env.COUNCIL_SANDBOX_SOCKET) {
      res.json({ available: false, active: false });
      return;
    }
    res.json(await sandboxRequest(userOf(res).id, { action: "status" }));
  });
  app.post("/api/sandbox", async (req, res) => {
    const action = z
      .discriminatedUnion("action", [
        z.object({ action: z.enum(["create", "destroy", "tree", "export"]) }),
        z.object({
          action: z.literal("read"),
          path: z.string().min(1).max(200),
        }),
        z.object({
          action: z.literal("write"),
          path: z.string().min(1).max(200),
          content: z.string().max(128000),
          sha: z.string().nullable(),
        }),
        z.object({
          action: z.literal("exec"),
          command: z.string().min(1).max(8000),
        }),
      ])
      .parse(req.body);
    if (
      ["write", "exec", "destroy"].includes(action.action) &&
      [...engine.active.values()].some((r) => r.userId === userOf(res).id)
    ) {
      res.status(409).json({
        error: "Stop the active council before manually changing its project.",
      });
      return;
    }
    res.json(await sandboxRequest(userOf(res).id, action));
  });
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
  app.get("/api/integrations/telegram", (_req, res) =>
    res.json(telegram.status(userOf(res).id)),
  );
  app.put("/api/integrations/telegram", async (req, res) => {
    const data = z
      .object({
        token: z.string().trim().max(200).optional(),
        enabled: z.boolean(),
      })
      .parse(req.body);
    try {
      res.json(await telegram.configure(userOf(res).id, data));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete("/api/integrations/telegram", (_req, res) => {
    telegram.clear(userOf(res).id);
    res.json({ ok: true });
  });
  app.get("/api/integrations/kite", (_req, res) =>
    res.json(kiteStatus(db, store, userOf(res).id, appOrigin)),
  );
  app.post("/api/integrations/kite/connect", (_req, res) => {
    try {
      res.json(startKiteConnect(db, store, userOf(res).id));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/integrations/kite/test", async (_req, res) => {
    const userId = userOf(res).id;
    try {
      await testKiteConnection(db, store, userId, AbortSignal.timeout(20_000));
      res.json(kiteStatus(db, store, userId, appOrigin));
    } catch (e) {
      res.status(400).json({
        error: (e as Error).message,
        status: kiteStatus(db, store, userId, appOrigin),
      });
    }
  });
  app.put("/api/integrations/kite", (req, res) => {
    const data = z
      .object({
        enabled: z.boolean(),
        apiKey: z.string().trim().max(200).optional(),
        apiSecret: z.string().trim().max(1000).optional(),
        accessToken: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    try {
      saveKite(db, store, userOf(res).id, data);
      res.json(kiteStatus(db, store, userOf(res).id, appOrigin));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/integrations/kite/request-token", async (req, res) => {
    const data = z
      .object({
        requestToken: z.string().trim().min(10).max(500),
      })
      .parse(req.body);
    try {
      await refreshKiteAccessToken(
        db,
        store,
        userOf(res).id,
        data.requestToken,
      );
      res.json(kiteStatus(db, store, userOf(res).id, appOrigin));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete("/api/integrations/kite", (_req, res) => {
    clearKite(db, userOf(res).id);
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
  app.get("/api/model-catalog", async (_req, res) => {
    res.set("Cache-Control", "private, max-age=3600");
    res.json(await modelCatalog());
  });
  app.post("/api/providers", async (req, res) => {
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
    // Check the model ID against the provider's own list and use the closest real ID.
    const requested = config.model;
    if (data.transport === "direct" && apiKey)
      config.model = await resolveModelId(config.kind, config.baseUrl, apiKey, config.model);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO providers(id,user_id,config,secret) VALUES(?,?,?,?)",
    ).run(
      id,
      userId,
      JSON.stringify({ ...config, id }),
      store.secrets.encrypt(apiKey || ""),
    );
    res.status(201).json({ id, ...(config.model !== requested ? { correctedModel: config.model } : {}) });
  });
  app.put("/api/providers/:id", async (req, res) => {
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
    const requested = config.model;
    if (data.transport === "direct" && apiKey)
      config.model = await resolveModelId(config.kind, config.baseUrl, apiKey, config.model);
    db.prepare(
      "UPDATE providers SET config=?,secret=? WHERE id=? AND user_id=?",
    ).run(
      JSON.stringify({ ...config, id: req.params.id }),
      clearKey ? "" : apiKey ? store.secrets.encrypt(apiKey) : existing.secret,
      req.params.id as string,
      userId,
    );
    res.json({ ok: true, ...(config.model !== requested ? { correctedModel: config.model } : {}) });
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
    if (provider.keyUnreadable) {
      res
        .status(400)
        .json({ error: unreadableKeys([provider], [provider.id]) });
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
  app.get("/api/benchmarks/:id", (req, res) => {
    const report = benchmarks.get(userOf(res).id, req.params.id as string);
    if (!report) {
      res.sendStatus(404);
      return;
    }
    res.json(report);
  });
  app.post("/api/benchmarks", (req, res) => {
    const userId = userOf(res).id;
    const data = z
      .object({
        config: configSchema,
        baselineProviderId: z.string(),
        baselineMode: z.enum(["single", "matched"]).default("single"),
        repeats: z.number().int().min(1).max(3).default(1),
        taskIds: z.array(z.string()).max(10).default([]),
        customTasks: z.array(benchmarkTaskSchema).max(10).default([]),
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
    const benchmarkKeyProblem = unreadableKeys(providers, selected);
    if (benchmarkKeyProblem) {
      res.status(400).json({ error: benchmarkKeyProblem });
      return;
    }
    const tasks = [
      ...data.taskIds.map((id) => benchmarkSuite.find((t) => t.id === id)),
      ...data.customTasks,
    ];
    if (
      tasks.length < 1 ||
      tasks.length > 10 ||
      tasks.some((t) => !t) ||
      new Set(tasks.map((t) => t?.id)).size !== tasks.length ||
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
    // Model-only comparisons must not grant tools exclusively to the council.
    data.config.sandbox = false;
    data.config.webResearch = false;
    data.config.skillsAgent = false;
    const { customTasks, ...settings } = data;
    const result: BenchmarkResult = {
      id: randomUUID(),
      status: "running",
      createdAt: new Date().toISOString(),
      ...settings,
      taskIds: tasks.map((t) => t!.id),
      tasks: tasks.map((t) => t!),
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
        .map(({ sharedState, resumeState, attachments, ...run }) => run),
    ),
  );
  app.post("/api/runs", async (req, res) => {
    const userId = userOf(res).id;
    const data = z
      .object({
        prompt: z.string().trim().min(1).max(20_000),
        config: configSchema,
        goalMode: z.boolean().optional(),
        minGoalMinutes: z.number().int().min(1).max(180).optional(),
        maxGoalMinutes: z.number().int().min(1).max(180).optional(),
        parentId: z.string().optional(),
        attachmentIds: z
          .array(z.string().uuid())
          .max(ATTACHMENT_MAX_FILES)
          .default([]),
      })
      .parse(req.body);
    const config = data.config;
    const parent = data.parentId
      ? store.getRun(userId, data.parentId)
      : undefined;
    if (data.parentId && !parent) {
      res.sendStatus(404);
      return;
    }
    const greeting =
      !data.attachmentIds.length &&
      quickReply({ prompt: data.prompt, attachments: parent?.attachments });
    if (config.sandbox && !greeting) {
      const sandbox = await sandboxRequest(userId, { action: "status" });
      if (!sandbox.active) {
        res.status(400).json({
          error: "Create a hosted project before enabling coding tools.",
        });
        return;
      }
    }
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
    const keyProblem = unreadableKeys(providers, config.providerIds);
    if (keyProblem) {
      res.status(400).json({ error: keyProblem });
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
    let attachments: Attachment[] = [];
    for (const id of new Set(data.attachmentIds)) {
      const row = db
        .prepare(
          "SELECT data FROM attachments WHERE id=? AND user_id=? AND expires>?",
        )
        .get(id, userId, Date.now()) as { data: string } | undefined;
      if (!row) {
        res.status(400).json({
          error:
            "An attachment expired or is unavailable. Please upload it again.",
        });
        return;
      }
      attachments.push(JSON.parse(row.data));
    }
    if (parent) {
      attachments = [...(parent.attachments || []), ...attachments];
      prompt = `Previous goal:\n${parent.prompt.slice(0, 6000)}\nPrevious answer:\n${parent.final.slice(0, 6000)}\n\nCurrent follow-up:\n${data.prompt}`;
    }
    if (attachments.length > ATTACHMENT_MAX_FILES) {
      res.status(400).json({
        error:
          "A conversation can include up to four files. Start a new session for additional attachments.",
      });
      return;
    }
    assertCanSend(db, userId);
    const run: Run = {
      attachments,
      id: randomUUID(),
      title: data.prompt.slice(0, 70),
      userMessage: data.prompt,
      prompt,
      config,
      createdAt: new Date().toISOString(),
      status: "queued",
      final: "",
      demo: selected.every((p) => p.kind === "demo"),
      parentId: data.parentId,
      ...(data.goalMode || config.goalMode
        ? {
            goal: {
              mode: "goal" as const,
              text: data.prompt,
              minMinutes: Math.min(
                Math.max(data.minGoalMinutes ?? config.minGoalMinutes ?? 10, 1),
                180,
              ),
              maxMinutes: Math.min(
                Math.max(
                  data.maxGoalMinutes ?? config.maxMinutes,
                  data.minGoalMinutes ?? config.minGoalMinutes ?? 10,
                ),
                180,
              ),
              updatedAt: new Date().toISOString(),
            },
            config: {
              ...config,
              goalMode: true,
              minGoalMinutes: Math.min(
                Math.max(data.minGoalMinutes ?? config.minGoalMinutes ?? 10, 1),
                180,
              ),
              maxMinutes: Math.min(
                Math.max(
                  data.maxGoalMinutes ?? config.maxMinutes,
                  data.minGoalMinutes ?? config.minGoalMinutes ?? 10,
                ),
                180,
              ),
            },
          }
        : {}),
    };
    store.saveRun(userId, run);
    recordUserMessage(db, userId);
    for (const id of data.attachmentIds)
      db.prepare("DELETE FROM attachments WHERE id=? AND user_id=?").run(
        id,
        userId,
      );
    void engine.start(userId, run).catch((error) => {
      console.error(
        "Run failure:",
        error instanceof Error ? error.message : String(error),
      );
      engine.failStart(userId, run.id, error);
    });
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
    const continueKeyProblem = unreadableKeys(
      available,
      previous.config.providerIds,
    );
    if (continueKeyProblem) {
      res.status(400).json({ error: continueKeyProblem });
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
    void engine.start(userId, run).catch((error) => {
      console.error(
        "Run failure:",
        error instanceof Error ? error.message : String(error),
      );
      engine.failStart(userId, run.id, error);
    });
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
    if (
      !engine.cancel(userOf(res).id, run.id) &&
      ["queued", "running"].includes(run.status)
    ) {
      // Nothing is executing this run any more; release it so new work can start.
      run.status = "cancelled";
      store.saveRun(userOf(res).id, run);
      store.event(run.id, "run.status", {
        status: "cancelled",
        message: "Stopped. This session was no longer running on the server.",
      });
    }
    res.json({ ok: true });
  });
  app.post("/api/runs/:id/board", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    const { content } = z
      .object({ content: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    assertCanSend(db, userOf(res).id);
    if (!engine.postBoard(userOf(res).id, run.id, content)) {
      res.status(409).json({ error: "This session is not currently running." });
      return;
    }
    recordUserMessage(db, userOf(res).id);
    res.json({ ok: true });
  });
  app.post("/api/runs/:id/message", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    const { to, content } = z
      .object({
        to: z.string().trim().min(1).max(80),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(req.body);
    assertCanSend(db, userOf(res).id);
    const result = engine.sendUserMessage(userOf(res).id, run.id, to, content);
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    recordUserMessage(db, userOf(res).id);
    res.json({ ok: true });
  });
  app.post("/api/runs/:id/goal", (req, res) => {
    const run = store.getRun(userOf(res).id, req.params.id as string);
    if (!run) {
      res.sendStatus(404);
      return;
    }
    const { goal, minMinutes, maxMinutes } = z
      .object({
        goal: z.string().trim().min(1).max(20_000),
        minMinutes: z.number().int().min(1).max(180).optional(),
        maxMinutes: z.number().int().min(1).max(180).optional(),
      })
      .parse(req.body);
    assertCanSend(db, userOf(res).id);
    const result = engine.updateGoal(userOf(res).id, run.id, goal, {
      minMinutes,
      maxMinutes,
    });
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    recordUserMessage(db, userOf(res).id);
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
  app.get("/api/skills", (_req, res) =>
    res.json({
      skills: listSkills(db, userOf(res).id),
      maxUserSkills: MAX_USER_SKILLS,
    }),
  );
  app.get("/api/skills/view/:name", (req, res) => {
    const skill = readSkillForOwner(
      db,
      userOf(res).id,
      String(req.params.name).slice(0, 64),
    );
    if (!skill) {
      res.sendStatus(404);
      return;
    }
    res.json(skill);
  });
  app.post("/api/skills", (req, res) => {
    const data = z
      .object({
        files: z
          .array(
            z.object({
              path: z.string().trim().min(1).max(300),
              content: z.string().max(32_000),
            }),
          )
          .min(1)
          .max(21),
      })
      .parse(req.body);
    try {
      res.json(saveUserSkill(db, userOf(res).id, data.files));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.patch("/api/skills/:id", (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (
      !setUserSkillEnabled(db, userOf(res).id, String(req.params.id), enabled)
    ) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
  });
  app.delete("/api/skills/:id", (req, res) => {
    if (!deleteUserSkill(db, userOf(res).id, String(req.params.id))) {
      res.sendStatus(404);
      return;
    }
    res.json({ ok: true });
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
      res.status(409).json({
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

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
