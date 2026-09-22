#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { OpenCodeWorker } from "./opencode.ts";
import { complete, streamJson } from "../server/providers.ts";
import type {
  Provider,
  RunConfig,
  CouncilEvent,
  Chunk,
} from "../shared/types.ts";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    providers: { type: "string" },
    provider: { type: "string" },
    url: { type: "string" },
    directory: { type: "string" },
    session: { type: "string" },
    "native-permissions": { type: "boolean" },
    concurrency: { type: "string" },
    agents: { type: "string" },
    "max-agents": { type: "string" },
    "max-depth": { type: "string" },
    "max-calls": { type: "string" },
    version: { type: "boolean" },
    name: { type: "string" },
    kind: { type: "string" },
    model: { type: "string" },
    "key-env": { type: "string" },
    "allow-write": { type: "boolean" },
    "allow-exec": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const configDir =
  process.env.COUNCIL_CONFIG_DIR || path.join(homedir(), ".config", "council");
const configFile = path.join(configDir, "config.json");
let saved: { server?: string; token?: string } = {};
try {
  saved = JSON.parse(readFileSync(configFile, "utf8"));
} catch {}
const base = (
  values.server ||
  process.env.COUNCIL_SERVER ||
  saved.server ||
  "http://localhost:4310"
).replace(/\/$/, "");
let token = process.env.COUNCIL_TOKEN || saved.token || "";
async function api<T = any>(
  endpoint: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
): Promise<T> {
  const result = await fetch(base + "/api" + endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Council-Request": "1",
      ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(70_000),
    redirect: "error",
  });
  const data = (await result.json().catch(() => ({}))) as any;
  if (!result.ok) throw new Error(data.error || `HTTP ${result.status}`);
  return data;
}
function password(): Promise<string> {
  if (process.env.COUNCIL_PASSWORD)
    return Promise.resolve(process.env.COUNCIL_PASSWORD);
  if (!process.stdin.isTTY)
    throw new Error(
      "Interactive login requires a terminal; alternatively set COUNCIL_TOKEN.",
    );
  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let text = "";
    const data = (value: Buffer) => {
      for (const ch of value.toString()) {
        if (ch === "\r" || ch === "\n" || ch === "\u0003") {
          process.stdin.removeListener("data", data);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          if (ch === "\u0003") reject(new Error("Cancelled"));
          else resolve(text);
          return;
        }
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else if (ch >= " ") text += ch;
      }
    };
    process.stdin.on("data", data);
  });
}
async function watch(id: string) {
  let after = 0;
  let done = false;
  const turns = new Map<string, string>();
  let current = "";
  const safe = (value: string) =>
    value.replace(/[\u001b\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  const print = (value: string) => process.stdout.write(safe(value));
  while (!done) {
    try {
      const response = await fetch(
        `${base}/api/runs/${encodeURIComponent(id)}/events?after=${after}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(5 * 60_000),
        },
      );
      if (!response.ok || !response.body)
        throw new Error(`Cannot watch run: HTTP ${response.status}`);
      for await (const event of streamJson(
        response.body,
      ) as AsyncGenerator<CouncilEvent>) {
        if (event.id <= after) continue;
        after = event.id;
        const d = event.data;
        if (event.type === "turn.start") {
          turns.set(d.turnId, d.name);
          print(`\n\n[${d.name} · ${d.model} · ${d.phase}]\n`);
          current = d.turnId;
        }
        if (event.type === "turn.delta") {
          if (current !== d.turnId) {
            print(`\n[${turns.get(d.turnId)}]\n`);
            current = d.turnId;
          }
          print(d.text);
        }
        if (event.type === "agent.message")
          print(`\n↳ ${d.name} → ${d.to}: ${d.content}\n`);
        if (event.type === "agent.spawn")
          print(`\n+ Specialist ${d.name}: ${d.task}\n`);
        if (event.type === "finding.updated")
          print(
            `\n[Finding ${d.finding.key} · ${d.finding.state} · revision ${d.finding.revision}] ${d.finding.claim}\n`,
          );
        if (event.type === "coding.activity")
          print(
            `\n[${d.kind}: ${d.title} · ${d.status || ""}]\n${d.detail}\n${["permission", "question"].includes(d.kind) ? "Respond in the Council web session.\n" : ""}`,
          );
        if (event.type === "turn.error") print(`\nError: ${d.message}\n`);
        if (event.type === "run.final")
          print(`\n\nCOUNCIL CONCLUSION\n\n${d.text}\n`);
        if (
          event.type === "run.status" &&
          !["queued", "running"].includes(d.status)
        ) {
          print(`\nSession ${d.status}${d.message ? ": " + d.message : ""}\n`);
          done = true;
          break;
        }
      }
    } catch (error) {
      if (!after) throw error;
      print("\nStream disconnected. Reconnecting from the last event…\n");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
async function worker(coding = false) {
  if (!values.provider || !values.url)
    throw new Error(
      "worker requires --provider ID --url http://127.0.0.1:11434",
    );
  const providers = await api<Provider[]>("/providers");
  const provider = providers.find(
    (p) => p.id === values.provider && p.transport === "bridge",
  );
  if (!provider)
    throw new Error("Create a bridge connection in the web app first.");
  if (coding !== (provider.kind === "opencode"))
    throw new Error(
      "Use coding-worker for an OpenCode connection, worker for a model-only bridge.",
    );
  if (coding && !values.directory)
    throw new Error(
      "coding-worker requires --directory /absolute/project/path",
    );
  const runtime = coding
    ? new OpenCodeWorker({
        url: values.url,
        directory: values.directory!,
        stateFile: path.join(configDir, `opencode-${provider.id}.json`),
        password: process.env.OPENCODE_SERVER_PASSWORD,
        username: process.env.OPENCODE_SERVER_USERNAME,
        nativePermissions: values["native-permissions"],
      })
    : undefined;
  if (runtime) {
    const health = await runtime.verify();
    console.log(
      `OpenCode ${health.version}: ${runtime.directory}. Real project tools are enabled. Project context and tool output flow through ${base}. Permissions: ${values["native-permissions"] ? "runtime policy" : "ask in Council"}.`,
    );
  }
  const endpoint = new URL(values.url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error(
      "The bridge worker only connects to a loopback model endpoint.",
    );
  const localProvider = {
    ...provider,
    transport: "direct" as const,
    baseUrl: values.url,
    apiKey: process.env.COUNCIL_MODEL_API_KEY,
  };
  // The worker is an explicitly local process, even when its Council server is hosted.
  process.env.DEPLOYMENT_MODE = "local";
  console.log(`Bridge ready: ${provider.name} (${provider.model}) → ${base}`);
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  while (!controller.signal.aborted) {
    let job: any;
    try {
      job = await api(`/bridge/${provider.id}/poll`);
      if (!job) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const callController = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        callController.signal,
        AbortSignal.timeout(240_000),
      ]);
      let acknowledged: string[] = [];
      let controls = Promise.resolve();
      const receive = (data: any) => {
        controls = controls.then(async () => {
          for (const reply of data.replies || []) {
            await runtime?.reply(reply);
            acknowledged.push(reply.id);
          }
        });
        return controls;
      };
      let pending: Chunk[] = [],
        lastFlush = Date.now();
      const flush = async (done = false) => {
        if (!pending.length && !done) return;
        const chunks = pending;
        pending = [];
        try {
          const ack = acknowledged.splice(0);
          await receive(
            await api(`/bridge/jobs/${job.id}`, "POST", {
              chunks,
              done,
              acknowledged: ack,
            }),
          );
        } catch (error) {
          callController.abort();
          throw error;
        }
        lastFlush = Date.now();
      };
      const heartbeat = setInterval(() => {
        api(`/bridge/jobs/${job.id}`, "POST", {
          acknowledged: acknowledged.splice(0),
        })
          .then(receive)
          .catch(() => callController.abort());
      }, 2000);
      try {
        const stream = runtime
          ? runtime.complete(provider, { ...job.request, signal })
          : complete(localProvider, { ...job.request, signal });
        for await (const chunk of stream) {
          pending.push(chunk);
          if (pending.length >= 20 || Date.now() - lastFlush > 200)
            await flush();
        }
        await flush(true);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (controller.signal.aborted) break;
      console.error((error as Error).message);
      if (job)
        await api(`/bridge/jobs/${job.id}`, "POST", {
          error: "Local provider failed",
          done: true,
        }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
async function main() {
  const command = positionals[0];
  if (values.version || command === "version") {
    console.log(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return;
  }
  if (values.help) {
    console.log(
      `Council CLI / native TUI\n\n  council / tui / code               Open Council in the current directory\n      [--directory PATH] [--agents 5] [--providers ID1,ID2]\n  models list                       List standalone model connections\n  models add --name ID --kind KIND --model MODEL [--url URL] [--key-env ENV_NAME]\n  models remove ID                  Remove a standalone connection\n  local-run "goal"                   Run without a TUI or web account\n      [--allow-write] [--allow-exec]  Explicitly allow native tools (otherwise denied)\n  opencode --url URL --directory PATH  Optional legacy OpenCode integration\n\nHosted-account commands:\n  login [--server URL]               Sign in and save a 30-day token\n  connections                       List your model connection IDs\n  run "goal" --providers ID1,ID2     Start and stream a peer discussion\n      [--agents 5] [--concurrency 1] [--max-calls 24]\n      [--max-agents unlimited] [--max-depth unlimited]\n  watch RUN_ID                      Replay and follow a session\n  stop RUN_ID                       Stop a session\n  worker --provider ID --url URL    Connect a local model to a hosted account\n  coding-worker --provider ID --url http://127.0.0.1:4096 --directory /project\n                                    Connect an OpenCode coding runtime\n      [--native-permissions]        Opt into the runtime permission policy\n  logout                            Revoke the current token\n\nEnvironment: COUNCIL_SERVER, COUNCIL_TOKEN, COUNCIL_MODEL_API_KEY\nHosted-account commands require web signup. Standalone commands do not require a web account.`,
    );
    return;
  }
  if (!command || command === "tui" || command === "code") {
    if (values.url)
      throw new Error(
        "Council code is now standalone. Use the optional opencode command to attach an external OpenCode runtime.",
      );
    process.env.DEPLOYMENT_MODE = "local";
    const { startTui } = await import("./tui.ts");
    await startTui({
      directory: values.directory || process.cwd(),
      agents: values.agents ? Number(values.agents) : undefined,
      ids: values.providers?.split(","),
      maxCalls: values["max-calls"] ? Number(values["max-calls"]) : undefined,
      concurrency: values.concurrency ? Number(values.concurrency) : undefined,
      maxAgents:
        values["max-agents"] === "unlimited"
          ? null
          : values["max-agents"]
            ? Number(values["max-agents"])
            : undefined,
      maxDepth:
        values["max-depth"] === "unlimited"
          ? null
          : values["max-depth"]
            ? Number(values["max-depth"])
            : undefined,
      prompt: positionals.slice(1).join(" ") || undefined,
    });
    return;
  }
  if (command === "models") {
    const { loadModels, saveModel, removeModel, nativeDefaults } =
      await import("./native.ts");
    if (positionals[1] === "add") {
      const kind = values.kind || "openai",
        defaults = nativeDefaults[kind];
      if (!defaults || !values.name || !values.model)
        throw new Error(
          "Use models add --name ID --kind KIND --model MODEL [--url URL] [--key-env ENV_NAME].",
        );
      const m = saveModel({
        id: values.name,
        kind,
        model: values.model,
        baseUrl: values.url || defaults.url,
        keyEnv: values["key-env"] || defaults.keyEnv,
      });
      console.log(
        `Saved ${m.id}: ${m.model}${m.keyEnv ? `. Export ${m.keyEnv} before launching Council.` : ""}`,
      );
    } else if (positionals[1] === "remove") {
      if (!positionals[2]) throw new Error("Provide a model connection ID.");
      removeModel(positionals[2]);
    } else
      for (const m of loadModels())
        console.log(
          `${m.id}  ${m.kind}  ${m.model}  ${m.baseUrl}  key: ${m.keyEnv || "none"}`,
        );
    return;
  }
  if (command === "local-run") {
    process.env.DEPLOYMENT_MODE = "local";
    const { NativeCouncil } = await import("./native.ts");
    const { cleanTerminal } = await import("./tui.ts");
    const council = new NativeCouncil(
      values.directory || process.cwd(),
      async (request) =>
        request.kind === "write"
          ? !!values["allow-write"]
          : !!values["allow-exec"],
    );
    const cancel = () => council.stop();
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
      const config = council.config(
        values.providers?.split(","),
        Number(values.agents || 3),
      );
      if (values["max-calls"]) config.maxCalls = Number(values["max-calls"]);
      if (values.concurrency) config.concurrency = Number(values.concurrency);
      if (values["max-agents"])
        config.maxAgents =
          values["max-agents"] === "unlimited"
            ? null
            : Number(values["max-agents"]);
      if (values["max-depth"])
        config.maxDepth =
          values["max-depth"] === "unlimited"
            ? null
            : Number(values["max-depth"]);
      const run = await council.run(
        positionals.slice(1).join(" "),
        config,
        (event) => {
          const d = event.data;
          if (event.type === "turn.start")
            console.log(`\n[${cleanTerminal(d.name)}]`);
          if (event.type === "turn.delta")
            process.stdout.write(cleanTerminal(d.text));
          if (event.type === "coding.activity")
            console.log(
              `\n[${cleanTerminal(d.title)} · ${d.status}] ${cleanTerminal(d.detail)}`,
            );
          if (event.type === "run.final")
            console.log("\nCOUNCIL CONCLUSION\n" + cleanTerminal(d.text));
        },
      );
      console.log(`\nSession ${run.id}: ${run.status}`);
      if (run.status !== "completed") process.exitCode = 1;
    } finally {
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      await council.close();
    }
    return;
  }
  const parsed = new URL(base);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  )
    throw new Error("Use HTTPS for a remote Council server.");

  if (command === "login") {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const email = process.env.COUNCIL_EMAIL || (await rl.question("Email: "));
    rl.close();
    const secret = await password();
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Council-Request": "1" },
      body: JSON.stringify({ email, password: secret }),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error("Sign in failed. Check your email and password.");
    const cookie = response.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    const result = await api("/auth/token", "POST", {}, cookie);
    await api("/auth/logout", "POST", {}, cookie);
    token = result.token;
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(configFile, JSON.stringify({ server: base, token }), {
      mode: 0o600,
    });
    chmodSync(configFile, 0o600);
    console.log(`Signed in to ${base}. Token saved to ${configFile}`);
    return;
  }
  if (command === "opencode") {
    if (!values.url || !values.directory)
      throw new Error("opencode requires --url and --directory");
    const runtime = new OpenCodeWorker({
      url: values.url,
      directory: values.directory,
      password: process.env.OPENCODE_SERVER_PASSWORD,
      username: process.env.OPENCODE_SERVER_USERNAME,
    });
    await runtime.verify();
    const args = [
      "attach",
      runtime.endpoint,
      "--dir",
      runtime.directory,
      ...(values.session ? ["--session", values.session] : []),
    ];
    const child = spawn(process.env.COUNCIL_OPENCODE_BIN || "opencode", args, {
      stdio: "inherit",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        process.exitCode = code || 0;
        resolve();
      });
    });
    return;
  }
  if (!token) throw new Error("Run login first, or set COUNCIL_TOKEN.");
  if (command === "connections") {
    const providers = await api<Provider[]>("/providers");
    for (const p of providers)
      console.log(`${p.id}  ${p.name}  ${p.model}  ${p.transport}`);
    return;
  }
  if (command === "run") {
    const prompt = positionals.slice(1).join(" ");
    if (!prompt || !values.providers)
      throw new Error("run requires a goal and --providers ID1[,ID2,ID3]");
    const ids = values.providers.split(",");
    if (ids.length < 1 || ids.length > 20)
      throw new Error("Choose 1–20 model connections.");
    const count = Number(values.agents || ids.length);
    if (!Number.isInteger(count) || count < 1 || count > 32)
      throw new Error("Choose 1–32 starting agents.");
    const config: RunConfig = {
      providerIds: ids,
      members: Array.from({ length: count }, (_, i) => ids[i % ids.length]).map(
        (providerId, i) => ({
          id: `peer-${i + 1}`,
          name: ["Atlas", "Sage", "Echo"][i] || `Peer ${i + 1}`,
          role: "Choose a useful specialization for this goal",
          providerId,
        }),
      ),
      maxAgents:
        values["max-agents"] === "unlimited"
          ? null
          : Number(values["max-agents"] || Math.max(12, count)),
      maxDepth:
        values["max-depth"] === "unlimited"
          ? null
          : Number(values["max-depth"] || 3),
      maxCalls: Number(values["max-calls"] || Math.max(24, count * 3 + 1)),
      maxOutputTokens: 4096,
      concurrency: Number(values.concurrency || 1),
      maxMinutes: 20,
    };
    const run = await api("/runs", "POST", { prompt, config });
    console.log(`Session: ${run.id}\nWeb: ${base}`);
    await watch(run.id);
    return;
  }
  if (command === "watch") {
    if (!positionals[1]) throw new Error("watch requires RUN_ID");
    await watch(positionals[1]);
    return;
  }
  if (command === "stop") {
    if (!positionals[1]) throw new Error("stop requires RUN_ID");
    await api(`/runs/${encodeURIComponent(positionals[1])}/cancel`, "POST");
    console.log("Stop requested.");
    return;
  }
  if (command === "worker" || command === "coding-worker") {
    await worker(command === "coding-worker");
    return;
  }
  if (command === "logout") {
    await api("/auth/logout", "POST");
    if (saved.token === token)
      writeFileSync(configFile, JSON.stringify({ server: base }), {
        mode: 0o600,
      });
    console.log("Signed out.");
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
