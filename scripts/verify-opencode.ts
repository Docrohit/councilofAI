// Optional real-runtime acceptance check. Uses a deterministic local model
// fixture, no API credentials, and a disposable Git project. Not a benchmark.
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCodeWorker } from "../cli/opencode.ts";
const root = realpathSync(
  mkdtempSync(path.join(tmpdir(), "council-native-check-")),
);
const project = path.join(root, "project");
mkdirSync(project);
writeFileSync(
  path.join(project, "package.json"),
  JSON.stringify({ type: "module" }),
);
writeFileSync(
  path.join(project, "calc.test.js"),
  `import test from 'node:test'; import assert from 'node:assert/strict'; import {square} from './calc.js'; test('square',()=>{assert.equal(square(4),16);assert.equal(square(-3),9);});`,
);
execFileSync("git", ["init", "-q", project]);
execFileSync("git", ["-C", project, "add", "."]);
execFileSync("git", [
  "-C",
  project,
  "-c",
  "user.name=Council Test",
  "-c",
  "user.email=fixture@example.test",
  "commit",
  "-qm",
  "Acceptance fixture",
]);
let calls = 0;
const model = createServer(async (req, res) => {
  let text = "";
  for await (const c of req) text += c;
  const input = JSON.parse(text);
  calls++;
  const toolMessages =
    input.messages?.filter((m: any) => m.role === "tool") || [];
  const tools = (input.tools || []).map((t: any) => t.function.name);
  let tool: any;
  if (tools.includes("write") && !toolMessages.length)
    tool = {
      id: "call_write",
      type: "function",
      function: {
        name: "write",
        arguments: JSON.stringify({
          filePath: path.join(project, "calc.js"),
          content: "export function square(n) { return n * n; }\n",
        }),
      },
    };
  else if (tools.includes("bash") && toolMessages.length === 1)
    tool = {
      id: "call_test",
      type: "function",
      function: {
        name: "bash",
        arguments: JSON.stringify({
          command: "node --test calc.test.js",
          description: "Verify square with real node tests",
          timeout: 10000,
        }),
      },
    };
  const content = tools.length
    ? "Implemented square and verified the Node test.\n```council\n" +
      JSON.stringify({
        findings: [
          {
            key: "square-tested",
            claim: "square handles positive and negative values",
            evidence: ["node --test calc.test.js passed"],
          },
        ],
        proposal: {
          answer: "Implemented square(n) with passing tests.",
          rationale: "Real file write and Node test results.",
        },
      }) +
      "\n```"
    : "Square implementation";
  const delta = tool
    ? { role: "assistant", tool_calls: [{ index: 0, ...tool }] }
    : { role: "assistant", content };
  const chunk = {
    id: "completion-" + calls,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
  res.setHeader("Content-Type", "text/event-stream");
  res.end(
    "data: " +
      JSON.stringify(chunk) +
      "\n\ndata: " +
      JSON.stringify({
        ...chunk,
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${(model.address() as any).port}/v1`;
const reserve = createServer();
await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
const port = (reserve.address() as any).port;
await new Promise<void>((r) => reserve.close(() => r()));
const config = {
  enabled_providers: ["fixture"],
  model: "fixture/test",
  small_model: "fixture/test",
  permission: "allow",
  share: "disabled",
  provider: {
    fixture: {
      npm: "@ai-sdk/openai-compatible",
      name: "Local test fixture",
      options: { baseURL: modelUrl, apiKey: "fixture-not-a-secret" },
      models: {
        test: { name: "Test fixture", limit: { context: 32768, output: 4096 } },
      },
    },
  },
};
const executable =
  process.env.COUNCIL_OPENCODE_BIN ||
  execFileSync("which", ["opencode"], { encoding: "utf8" }).trim();
const native = spawn(
  executable,
  ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: project,
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmpdir(),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
native.stdout.on("data", (b) => {
  log += b;
});
native.stderr.on("data", (b) => {
  log += b;
});
try {
  const worker = new OpenCodeWorker({
    url: `http://127.0.0.1:${port}`,
    directory: project,
    nativePermissions: false,
  });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      await worker.verify();
      healthy = true;
      break;
    } catch {}
    if (native.exitCode !== null) break;
    await delay(300);
  }
  assert.ok(healthy, "Runtime failed to start: " + log.slice(-2000));
  const activities: any[] = [];
  let answer = "";
  for await (const c of worker.complete(
    {
      id: "test",
      name: "Test",
      kind: "opencode",
      model: "fixture/test",
      baseUrl: "",
      transport: "bridge",
      reasoning: false,
    },
    {
      messages: [
        {
          role: "system",
          content:
            "Use native write and bash tools to implement and test square(n). Publish results.",
        },
        {
          role: "user",
          content:
            "Create calc.js exporting square(n); run node --test calc.test.js and report the result.",
        },
      ],
      maxTokens: 4096,
      context: { runId: "acceptance", agentId: "coder" },
      signal: AbortSignal.timeout(90000),
    },
  )) {
    if (c.activity) {
      activities.push(c.activity);
      if (c.activity.kind === "permission")
        await worker.reply({
          id: c.activity.id,
          kind: "permission",
          reply: "once",
        });
      console.log(c.activity.kind, c.activity.title, c.activity.status || "");
    }
    if (c.type === "text") answer += c.text;
  }
  assert.match(readFileSync(path.join(project, "calc.js"), "utf8"), /n \* n/);
  const result = execFileSync(process.execPath, ["--test", "calc.test.js"], {
    cwd: project,
    encoding: "utf8",
  });
  assert.match(result, /pass 1/);
  assert.ok(
    activities.some((a) => a.title === "write" && a.status === "completed"),
    "Missing real write event",
  );
  assert.ok(
    activities.some(
      (a) =>
        a.title === "bash" &&
        a.status === "completed" &&
        a.detail.includes("pass 1"),
    ),
    "Missing actual test output",
  );
  assert.match(answer, /Implemented square/);
  assert.ok(
    activities.filter((a) => a.kind === "permission").length >= 2,
    "Native write and bash permissions were not exercised",
  );
  assert.ok(
    activities.some((a) => a.kind === "diff" && a.detail.includes("calc.js")),
    "Missing native session diff",
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      runtime: execFileSync(executable, ["--version"], {
        encoding: "utf8",
      }).trim(),
      nativeModelCalls: calls,
      verified: [
        "native permission replies",
        "native session diff",
        "real file edit",
        "real shell test",
        "tool transcript",
        "public answer",
      ],
      note: "Deterministic local model fixture; not evidence of reasoning quality.",
    }),
  );
} catch (error) {
  console.error(log.slice(-4000));
  throw error;
} finally {
  native.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (native.exitCode !== null) return r();
    native.once("exit", () => r());
    setTimeout(() => {
      native.kill("SIGKILL");
      r();
    }, 3000).unref();
  });
  model.closeAllConnections();
  await new Promise<void>((r) => model.close(() => r()));
  rmSync(root, { recursive: true, force: true });
}
