import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenCodeWorker } from "../cli/opencode.ts";
import { Bridge } from "../server/bridge.ts";
import type { Provider, Chunk } from "../shared/types.ts";
const provider: Provider = {
  id: "code",
  name: "Coder",
  kind: "opencode",
  model: "local/fixture",
  transport: "bridge",
  baseUrl: "",
  reasoning: false,
};
const request = (signal = AbortSignal.timeout(10000)) => ({
  messages: [{ role: "user" as const, content: "Fix the project" }],
  maxTokens: 1000,
  context: { runId: "run", agentId: "peer" },
  signal,
});

test("OpenCode project pinning, persistent peer sessions, permission and question isolation, tools and usage", async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "council-code-")));
  let created = 0,
    turn = 0,
    accepted = 0,
    asked = false,
    question = false;
  const messages: any[] = [];
  const permissions: any[] = [];
  let finish: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    assert.equal(url.searchParams.get("directory"), dir);
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    const reply = (x: any) => res.end(JSON.stringify(x));
    if (url.pathname === "/global/health")
      return reply({ healthy: true, version: "fixture" });
    if (url.pathname === "/path") return reply({ directory: dir });
    if (url.pathname === "/session" && req.method === "POST") {
      created++;
      assert.equal(body.permission[0].action, "ask");
      return reply({ id: "s1" });
    }
    if (url.pathname === "/session")
      return reply([{ id: "s1" }, { id: "foreign" }]);
    if (url.pathname === "/session/s1")
      return reply({ id: "s1", directory: dir });
    if (url.pathname === "/session/s1/message" && req.method === "GET")
      return reply(messages);
    if (url.pathname === "/session/s1/message") {
      turn++;
      assert.deepEqual(body.model, { providerID: "local", modelID: "fixture" });
      const message = {
        info: {
          id: `m${turn}`,
          parentID: `u${turn}`,
          role: "assistant",
          tokens: { input: 10, output: 4 },
        },
        parts: [
          { id: `t${turn}`, type: "text", text: "Checked the actual project." },
          {
            id: `tool${turn}`,
            sessionID: "s1",
            type: "tool",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "npm test" },
              output: "2 passed",
            },
          },
        ],
      };
      if (turn === 1) {
        asked = true;
        permissions.push({
          id: "permission1",
          sessionID: "s1",
          permission: "bash",
          patterns: ["npm test"],
        });
        await new Promise<void>((r) => {
          finish = r;
        });
      }
      messages.push(message);
      return reply(message);
    }
    if (url.pathname === "/permission")
      return reply([
        ...permissions,
        {
          id: "foreign-permission",
          sessionID: "foreign",
          permission: "bash",
          patterns: ["private"],
        },
      ]);
    if (url.pathname === "/question")
      return reply(
        question
          ? [
              {
                id: "question1",
                sessionID: "s1",
                questions: [
                  {
                    question: "Which check?",
                    options: [{ label: "Unit tests" }],
                  },
                ],
              },
            ]
          : [],
      );
    if (url.pathname === "/permission/permission1/reply") {
      assert.equal(body.reply, "once");
      accepted++;
      permissions.length = 0;
      question = true;
      return reply(true);
    }
    if (url.pathname === "/question/question1/reply") {
      assert.deepEqual(body.answers, [["Unit tests"]]);
      question = false;
      finish?.();
      return reply(true);
    }
    if (url.pathname === "/session/s1/diff") {
      assert.equal(url.searchParams.get("messageID"), `u${turn}`);
      return reply([
        {
          file: "math.ts",
          before: "old",
          after: "fixed",
          additions: 1,
          deletions: 1,
        },
      ]);
    }
    if (url.pathname.endsWith("/abort")) {
      finish?.();
      return reply(true);
    }
    res.statusCode = 404;
    reply({});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const options = {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    directory: dir,
    stateFile: path.join(dir, "state.json"),
  };
  try {
    const runtime = new OpenCodeWorker(options);
    await runtime.verify();
    const chunks: Chunk[] = [];
    for await (const chunk of runtime.complete(provider, request())) {
      chunks.push(chunk);
      const a = chunk.activity;
      if (a?.kind === "permission") {
        assert.equal(a.id, "permission1");
        await runtime.reply({ id: a.id, kind: "permission", reply: "once" });
        await runtime.reply({ id: a.id, kind: "permission", reply: "once" });
      }
      if (a?.kind === "question")
        await runtime.reply({
          id: a.id,
          kind: "question",
          reply: "once",
          answers: [["Unit tests"]],
        });
    }
    assert.ok(asked);
    assert.equal(accepted, 1);
    assert.ok(chunks.some((c) => c.activity?.title === "bash"));
    assert.ok(chunks.some((c) => c.activity?.kind === "diff"));
    assert.ok(
      chunks.some(
        (c) => c.type === "usage" && c.input === 10 && c.output === 4,
      ),
    );
    const restored = new OpenCodeWorker(options);
    const next: Chunk[] = [];
    for await (const c of restored.complete(provider, request())) next.push(c);
    assert.equal(created, 1);
    assert.equal(turn, 2);
    assert.equal(
      next
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
      "Checked the actual project.",
    );
    await assert.rejects(
      restored.reply({
        id: "foreign-permission",
        kind: "permission",
        reply: "once",
      }),
      /no longer pending/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coding approval bridge requires owner and current request; replies survive polling until acknowledgement", async () => {
  const bridge = new Bridge();
  bridge.poll("alice", provider.id);
  const abort = new AbortController();
  const iterator = bridge.complete("alice", provider, request(abort.signal));
  const next = iterator.next();
  const job = bridge.poll("alice", provider.id)!;
  assert.ok(job);
  const activity = {
    kind: "permission" as const,
    sessionId: "s1",
    id: "p1",
    title: "bash",
    detail: "npm test",
    status: "pending",
  };
  assert.equal(
    bridge.push("bob", job.id, { chunks: [{ type: "coding", activity }] }),
    false,
  );
  assert.equal(
    bridge.push("alice", job.id, { chunks: [{ type: "coding", activity }] }),
    true,
  );
  assert.equal((await next).value?.jobId, job.id);
  assert.equal(
    bridge.reply("bob", job.id, {
      kind: "permission",
      id: "p1",
      reply: "once",
    }),
    undefined,
  );
  assert.equal(
    bridge.reply("alice", job.id, {
      kind: "permission",
      id: "unknown",
      reply: "once",
    }),
    undefined,
  );
  assert.ok(
    bridge.reply("alice", job.id, {
      kind: "permission",
      id: "p1",
      reply: "once",
    }),
  );
  assert.equal(bridge.controls("alice", job.id).length, 1);
  assert.equal(bridge.controls("alice", job.id).length, 1);
  assert.equal(
    bridge.reply("alice", job.id, {
      kind: "permission",
      id: "p1",
      reply: "once",
    }),
    undefined,
  );
  bridge.push("alice", job.id, { acknowledged: ["p1"] });
  assert.equal(bridge.controls("alice", job.id).length, 0);
  abort.abort();
  await assert.rejects(iterator.next());
  assert.equal(
    bridge.reply("alice", job.id, {
      kind: "permission",
      id: "p1",
      reply: "once",
    }),
    undefined,
  );
});

test("OpenCode worker rejects nonlocal runtime addresses and embedded credentials", () => {
  for (const url of [
    "https://example.com",
    "http://localhost@evil.test",
    "http://user:secret@localhost:4096",
    "http://127.0.0.1:4096?directory=/other",
  ])
    assert.throws(
      () => new OpenCodeWorker({ url, directory: tmpdir() }),
      /loopback/,
    );
});

test("cancelling a coding turn aborts its native session and leaves unrelated sessions alone", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-cancel-"));
  const aborted: string[] = [];
  let pending: any;
  let prompted = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let raw = "";
    for await (const c of req) raw += c;
    res.setHeader("Content-Type", "application/json");
    const reply = (v: any) => res.end(JSON.stringify(v));
    if (url.pathname === "/session" && req.method === "POST")
      return reply({ id: "owned" });
    if (url.pathname === "/session")
      return reply([{ id: "owned" }, { id: "unrelated" }]);
    if (url.pathname === "/session/owned/message" && req.method === "POST") {
      prompted = true;
      pending = res;
      return;
    }
    if (
      url.pathname === "/session/owned/message" ||
      url.pathname === "/permission" ||
      url.pathname === "/question"
    )
      return reply([]);
    if (url.pathname.endsWith("/abort")) {
      aborted.push(url.pathname);
      pending?.end("{}");
      return reply(true);
    }
    res.statusCode = 404;
    reply({});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const runtime = new OpenCodeWorker({
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      directory: dir,
    });
    const controller = new AbortController();
    const run = (async () => {
      for await (const c of runtime.complete(
        provider,
        request(controller.signal),
      )) {
        if (c.type === "text") assert.fail("No successful answer expected");
      }
    })();
    while (!prompted) await new Promise((r) => setTimeout(r, 5));
    controller.abort(new Error("Stopped by user"));
    await assert.rejects(run, /Stopped by user/);
    assert.deepEqual(aborted, ["/session/owned/abort"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
