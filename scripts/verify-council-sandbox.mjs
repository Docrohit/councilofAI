// Deterministic model fixture + real Council HTTP API + real Docker execution.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.ts";
import { startBroker, handle } from "../deploy/sandbox-broker.mjs";
const directory = mkdtempSync(path.join(tmpdir(), "council-project-proof-"));
const socket = path.join(directory, "broker.sock");
process.env.COUNCIL_SANDBOX_SOCKET = socket;
const broker = await startBroker(socket);
let sawActualPass = false,
  owner;
const model = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const { messages } = JSON.parse(raw),
    system = messages[0].content,
    user = messages[1].content;
  const board = JSON.parse(
    user
      .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
      .split("\n\n")[0],
  );
  let actions = {};
  if (board.candidate)
    actions = {
      review: {
        candidateId: board.candidate.id,
        agree: true,
        reason: "The published Node test output reports four verified roots.",
      },
    };
  else if (system.includes("NAME: Builder")) {
    if (system.includes("TURN: 1\n"))
      actions = {
        tools: [
          {
            name: "project_write",
            path: "roots.js",
            sha: null,
            content: "exports.roots = () => [-2,-1,1,2];\n",
          },
          {
            name: "project_write",
            path: "roots.test.js",
            sha: null,
            content:
              "const {test}=require('node:test');const assert=require('node:assert/strict');const {roots}=require('./roots');test('all four quartic roots',()=>{assert.equal(new Set(roots()).size,4);for(const x of roots())assert.equal(x**4-5*x*x+4,0);});\n",
          },
        ],
      };
    else if (system.includes("TURN: 2\n"))
      actions = { tools: [{ name: "project_exec", command: "node --test" }] };
    else {
      sawActualPass = user.includes("pass 1");
      actions = {
        broadcasts: [
          {
            content:
              "Actual node --test passed: four distinct roots satisfy the quartic.",
          },
        ],
        proposal: {
          answer:
            "The project contains roots.js and roots.test.js. node --test passes. Roots: -2,-1,1,2.",
          rationale: "Actual tool output confirms one passing test.",
        },
      };
    }
  }
  const text =
    "Fixture public contribution.\n```council\n" +
    JSON.stringify(actions) +
    "\n```";
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({ choices: [{ delta: { content: text } }] }) +
      "\n\ndata: " +
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const ctx = createApp(path.join(directory, "db"));
const app = ctx.app.listen(0, "127.0.0.1");
await new Promise((r) => app.once("listening", r));
const base = `http://127.0.0.1:${app.address().port}/api`;
let cookie = "";
async function api(route, body) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-council-request": "1",
      cookie,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.getSetCookie().length)
    cookie = response.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}
try {
  owner = (
    await api("/auth/signup", {
      name: "Project proof",
      email: `proof-${Date.now()}@example.test`,
      password: "disposable-test-password",
    })
  ).user.id;
  await api("/sandbox", { action: "create" });
  const provider = await api("/providers", {
    name: "Deterministic fixture",
    kind: "vllm",
    baseUrl: `http://127.0.0.1:${model.address().port}`,
    model: "fixture",
    transport: "direct",
    reasoning: false,
  });
  const run = await api("/runs", {
    prompt:
      "Create a project that returns and tests all real roots of x^4-5x^2+4=0.",
    config: {
      sandbox: true,
      members: [
        {
          id: "builder",
          name: "Builder",
          role: "Write and test",
          providerId: provider.id,
        },
        {
          id: "reviewer",
          name: "Reviewer",
          role: "Review actual evidence",
          providerId: provider.id,
        },
      ],
      providerIds: [provider.id],
      maxAgents: 2,
      maxDepth: 0,
      concurrency: 1,
      maxCalls: 12,
      maxOutputTokens: 2048,
      maxMinutes: 2,
    },
  });
  let result;
  for (let i = 0; i < 300; i++) {
    result = await api("/runs/" + run.id);
    if (!["queued", "running"].includes(result.run.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(result.run.status, "completed", JSON.stringify(result));
  assert(sawActualPass, "The model must receive actual passing test output");
  assert.equal((await api("/sandbox", { action: "export" })).files.length, 2);
  assert(
    result.events.some(
      (e) =>
        e.type === "coding.activity" &&
        e.data.title === "project_exec" &&
        e.data.detail.includes("pass 1"),
    ),
  );
  console.log(
    "Verified Council HTTP signup → sandbox → two-agent fixture → multi-file writes → actual Node tests → result feedback → peer-reviewed final answer. No paid model calls; not a reasoning benchmark.",
  );
} finally {
  for (const run of ctx.engine.active.values()) run.controller.abort();
  for (let i = 0; ctx.engine.active.size && i < 100; i++)
    await new Promise((r) => setTimeout(r, 50));
  if (owner) await handle({ owner, action: "destroy" }).catch(() => {});
  app.closeAllConnections();
  model.closeAllConnections();
  broker.closeAllConnections();
  await Promise.all(
    [app, model, broker].map((s) => new Promise((r) => s.close(r))),
  );
  ctx.db.close();
  rmSync(directory, { recursive: true, force: true });
}
