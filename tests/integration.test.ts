import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.ts";
import { Bridge } from "../server/bridge.ts";
import type { RunConfig } from "../shared/types.ts";
import { extractPage } from "../server/research.ts";
process.env.DEMO_DELAY_MS = "0";
const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function harness(work: (ctx: any) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "council-test-"));
  const ctx = createApp(dir);
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const api = async (
    url: string,
    body?: any,
    cookie = "",
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(base + "/api" + url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-council-request": "1",
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };
  try {
    await work({ ...ctx, base, api });
  } finally {
    for (const a of ctx.engine.active.values())
      a.controller.abort(new Error("Stopped by user"));
    while (ctx.engine.active.size) await pause();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const cfg = (
  ids: string[],
  count = 3,
  extra: Partial<RunConfig> = {},
): RunConfig => ({
  providerIds: ids,
  members: Array.from({ length: count }, (_, i) => ({
    id: `peer-${i + 1}`,
    name: ["Atlas", "Sage", "Echo"][i] || `Peer ${i + 1}`,
    role: "Choose a specialization",
    providerId: ids[i % ids.length],
  })),
  concurrency: 3,
  maxAgents: 12,
  maxDepth: 3,
  maxCalls: 32,
  maxOutputTokens: 4096,
  maxMinutes: 2,
  ...extra,
});
async function done(api: any, cookie: string, id: string) {
  for (let i = 0; i < 1000; i++) {
    const r = await api("/runs/" + id, undefined, cookie);
    if (!["queued", "running"].includes(r.data.run.status)) return r.data;
    await pause(20);
  }
  throw new Error("Run did not finish");
}
test("signup, isolation, encrypted secrets, five agents on one model, disagreement resolution, replay", async () =>
  harness(async ({ api, base, db }: any) => {
    const alice = await api("/auth/signup", {
      name: "Alice",
      email: "alice@example.test",
      password: "long-password-123",
    });
    const bob = await api("/auth/signup", {
      name: "Bob",
      email: "bob@example.test",
      password: "long-password-456",
    });
    assert.equal(alice.status, 201);
    const providers = await api("/providers", undefined, alice.cookie);
    const id = providers.data[0].id;
    const key = "test-secret-not-for-browser";
    const saved = await api(
      "/providers",
      {
        name: "Cloud",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "example",
        transport: "direct",
        reasoning: false,
        apiKey: key,
      },
      alice.cookie,
    );
    assert.equal(saved.status, 201);
    assert(
      !JSON.stringify(
        (await api("/providers", undefined, alice.cookie)).data,
      ).includes(key),
    );
    assert(
      !(
        db
          .prepare("SELECT secret FROM providers WHERE id=?")
          .get(saved.data.id) as any
      ).secret.includes(key),
    );
    assert.equal(
      (await api("/providers/" + saved.data.id, {}, bob.cookie, "PUT")).status,
      404,
    );
    const csrf = await fetch(base + "/api/auth/logout", {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    assert.equal(csrf.status, 403);
    const hostile = await fetch(base + "/api/runs", {
      headers: { origin: "https://evil.example", cookie: alice.cookie },
    });
    assert.equal(hostile.status, 403);
    const run = await api(
      "/runs",
      {
        prompt:
          "Demonstrate five peers using one model, with shared findings and peer correction.",
        config: cfg([id], 5, {
          concurrency: 1,
          maxAgents: null,
          maxDepth: null,
          maxCalls: 48,
        }),
      },
      alice.cookie,
    );
    assert.equal(run.status, 201, JSON.stringify(run.data));
    assert.equal(
      (await api("/runs/" + run.data.id, undefined, bob.cookie)).status,
      404,
    );
    const result = await done(api, alice.cookie, run.data.id);
    assert.equal(
      result.run.status,
      "completed",
      JSON.stringify(
        result.events.filter((e: any) =>
          ["run.status", "turn.error"].includes(e.type),
        ),
      ),
    );
    assert.match(result.run.final, /scripted demonstration/);
    assert(result.events.some((e: any) => e.type === "agent.spawn"));
    const updates = result.events.filter(
      (e: any) => e.type === "finding.updated",
    );
    assert(updates.some((e: any) => e.data.finding.state === "disputed"));
    const f = updates.at(-1).data.finding;
    assert.equal(f.state, "established");
    assert.equal(f.revision, 2);
    assert.equal(Object.keys(f.acceptances).length, 2);
    assert(result.events.some((e: any) => e.type === "agent.message"));
    assert(
      result.events.filter((e: any) => e.type === "turn.start").length <= 48,
    );
    const max = result.events.at(-1).id;
    const replay = await fetch(
      base + `/api/runs/${run.data.id}/events?after=${max - 1}`,
      { headers: { cookie: alice.cookie } },
    );
    const reader = replay.body!.getReader();
    const chunk = await reader.read();
    assert(new TextDecoder().decode(chunk.value).includes(`id: ${max}`));
    await reader.cancel();
    const token = await api("/auth/token", {}, alice.cookie);
    assert.equal(token.data.token.length > 30, true);
  }));
test("streaming delegation starts a specialist before parent response finishes", async () => {
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (text: string) =>
      res.write(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: text } }] }) +
          "\n\n",
      );
    if (system.includes("TURN: 1") && system.includes("DEPTH: 0")) {
      write(
        '```council\n{"delegates":[{"name":"Specialist","role":"Checker","task":"Check this claim"}]}\n```',
      );
      await pause(150);
      write("I have asked a specialist to investigate.");
    } else if (board.candidate) {
      write(
        "Checked.\n```council\n" +
          JSON.stringify({
            review: {
              candidateId: board.candidate.id,
              agree: true,
              reason: "The fixture evidence supports this precise answer.",
            },
          }) +
          "\n```",
      );
    } else {
      write(
        "```council\n" +
          JSON.stringify({
            proposal: {
              answer: "Fixture conclusion",
              rationale: "Test fixture evidence",
            },
          }) +
          "\n```",
      );
    }
    res.end(
      "data: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Team",
        email: "team@example.test",
        password: "long-password-123",
      });
      const p = await api(
        "/providers",
        {
          name: "Fixture model",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const r = await api(
        "/runs",
        {
          prompt: "Check collaboration",
          config: cfg([p.data.id], 1, { concurrency: 2 }),
        },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, r.data.id);
      assert.equal(result.run.status, "completed");
      const start = result.events.find(
        (e: any) => e.type === "turn.start" && e.data.name === "Atlas",
      );
      const end = result.events.find(
        (e: any) =>
          e.type === "turn.done" && e.data.turnId === start.data.turnId,
      );
      const specialist = result.events.find(
        (e: any) => e.type === "turn.start" && e.data.name === "Specialist",
      );
      assert(
        specialist.id < end.id,
        "Specialist must start while parent is still generating",
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});
test("bridge isolates tenants, streams results, and discards cancelled work", async () => {
  const b = new Bridge();
  const p = {
    id: "p",
    name: "Local",
    kind: "ollama" as const,
    baseUrl: "",
    model: "m",
    transport: "bridge" as const,
    reasoning: false,
  };
  b.poll("alice", "p");
  const controller = new AbortController();
  const iterator = b.complete("alice", p, {
    messages: [],
    maxTokens: 100,
    signal: controller.signal,
  });
  const next = iterator.next();
  const job = b.poll("alice", "p")!;
  assert(job);
  assert.equal(b.poll("bob", "p"), null);
  assert.equal(b.push("bob", job.id, { done: true }), false);
  b.push("alice", job.id, { chunks: [{ type: "text", text: "hello" }] });
  assert.equal((await next).value?.text, "hello");
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending);
  assert.equal(b.jobs.size, 0);
  assert.equal(b.push("alice", job.id, { done: true }), false);
});
test("stop cancels an active run and no final answer is emitted", async () =>
  harness(async ({ api }: any) => {
    const a = await api("/auth/signup", {
      name: "Stop",
      email: "stop@example.test",
      password: "long-password-123",
    });
    const p = (await api("/providers", undefined, a.cookie)).data[0];
    const r = await api(
      "/runs",
      { prompt: "Test cancellation", config: cfg([p.id]) },
      a.cookie,
    );
    await api(`/runs/${r.data.id}/cancel`, {}, a.cookie);
    const result = await done(api, a.cookie, r.data.id);
    assert.equal(result.run.status, "cancelled");
    assert.equal(
      result.events.some((e: any) => e.type === "run.final"),
      false,
    );
  }));
test("user can post a live board message that is queued for peers", async () => {
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    await pause(120);
    const output = board.candidate
      ? {
          review: {
            candidateId: board.candidate.id,
            agree: true,
            reason: "The user board instruction was considered.",
          },
        }
      : {
          proposal: {
            answer: "Adjusted after checking the live board.",
            rationale: "The board context is part of the shared state.",
          },
        };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [
            { delta: { content: "```council\n" + JSON.stringify(output) + "\n```" } },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Board User",
        email: "board-user@example.test",
        password: "long-password-123",
      });
      const provider = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const config = cfg([provider.data.id], 2, { concurrency: 1, maxCalls: 8 });
      config.members[0].name = "Peer 4";
      config.members[1].name = "検証";
      const started = await api(
        "/runs",
        {
          prompt: "Solve while accepting live board corrections",
          config,
        },
        auth.cookie,
      );
      let posted;
      for (let i = 0; i < 20; i++) {
        posted = await api(
          `/runs/${started.data.id}/board`,
          {
            content:
              "Please @Peer4 and @検証 verify the direction before finalizing.",
          },
          auth.cookie,
        );
        if (posted.status === 200) break;
        await pause(20);
      }
      assert.equal(posted.status, 200);
      const result = await done(api, auth.cookie, started.data.id);
      assert(
        result.events.some(
          (e: any) =>
            e.type === "board.post" &&
            e.data.post.kind === "user-instruction" &&
            e.data.post.author === "user" &&
            e.data.post.content.includes("verify the direction") &&
            e.data.post.evidenceSummary === "Tagged: Peer 4, 検証",
        ),
      );
      assert(
        result.events.some(
          (e: any) =>
            e.type === "agent.message" &&
            e.data.from === "user" &&
            e.data.tagged.includes("peer-1") &&
            e.data.tagged.includes("peer-2") &&
            e.data.delivery.includes("next model turn"),
        ),
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});
test("live board message invalidates stale in-flight candidate reviews", async () => {
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    const inbox = JSON.parse(user.split("YOUR INBOX:\n")[1].split("\n\n")[0]);
    const fresh = inbox.some((m: any) =>
      String(m.content).includes("Candidate proposal/review was ignored"),
    );
    let output;
    if (!board.candidate)
      output = {
        proposal: {
          answer: "Initial answer before user board update.",
          rationale: "Initial fixture candidate.",
        },
      };
    else {
      await pause(fresh ? 0 : 180);
      output = {
        review: {
          candidateId: board.candidate.id,
          agree: true,
          reason: fresh
            ? "Fresh review after reading the user board message."
            : "Stale review from the old board snapshot.",
        },
      };
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [
            { delta: { content: "```council\n" + JSON.stringify(output) + "\n```" } },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Stale Board",
        email: "stale-board@example.test",
        password: "long-password-123",
      });
      const provider = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const started = await api(
        "/runs",
        {
          prompt: "Reject stale candidate reviews after board updates",
          config: cfg([provider.data.id], 2, { concurrency: 1, maxCalls: 10 }),
        },
        auth.cookie,
      );
      for (let i = 0; i < 50; i++) {
        const snapshot = await api("/runs/" + started.data.id, undefined, auth.cookie);
        if (
          snapshot.data.events.some((e: any) => e.type === "candidate.proposed")
        )
          break;
        await pause(20);
      }
      const posted = await api(
        `/runs/${started.data.id}/board`,
        { content: "User changed the verification direction." },
        auth.cookie,
      );
      assert.equal(posted.status, 200);
      const result = await done(api, auth.cookie, started.data.id);
      assert.equal(result.run.status, "completed");
      assert(
        result.events.some(
          (e: any) =>
            e.type === "warning" &&
            String(e.data.message).includes("Candidate proposal/review was ignored"),
        ),
      );
      assert(
        result.events.some(
          (e: any) =>
            e.type === "candidate.review" &&
            e.data.reason === "Fresh review after reading the user board message.",
        ),
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});
test("budget exhaustion preserves state and continuation reuses the existing finding", async () =>
  harness(async ({ api }: any) => {
    const a = await api("/auth/signup", {
      name: "Resume",
      email: "resume@example.test",
      password: "long-password-123",
    });
    const p = (await api("/providers", undefined, a.cookie)).data[0];
    const r = await api(
      "/runs",
      {
        prompt: "Investigate and preserve evidence across budget boundaries",
        config: cfg([p.id], 2, { maxCalls: 4, concurrency: 1 }),
      },
      a.cookie,
    );
    const first = await done(api, a.cookie, r.data.id);
    assert.equal(first.run.status, "needs_review");
    assert.equal(first.run.sharedState.findings.length, 1);
    const oldId = first.run.sharedState.findings[0].id;
    const continued = await api(`/runs/${r.data.id}/continue`, {}, a.cookie);
    assert.equal(continued.status, 201);
    const next = await done(api, a.cookie, continued.data.id);
    assert.equal(next.run.sharedState.findings[0].id, oldId);
    assert.equal(next.run.parentId, r.data.id);
    assert.equal(next.run.sharedState.findings.length, 1);
  }));
test("independent model pool supports five connections and ten initial agents", async () =>
  harness(async ({ api }: any) => {
    const a = await api("/auth/signup", {
      name: "Pool",
      email: "pool@example.test",
      password: "long-password-123",
    });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const p = await api(
        "/providers",
        {
          name: `Demo ${i}`,
          kind: "demo",
          baseUrl: "",
          model: `fixture-${i}`,
          transport: "direct",
          reasoning: false,
        },
        a.cookie,
      );
      ids.push(p.data.id);
    }
    const r = await api(
      "/runs",
      {
        prompt: "Exercise a larger model pool",
        config: cfg(ids, 10, {
          maxAgents: null,
          maxDepth: null,
          maxCalls: 64,
          concurrency: 3,
        }),
      },
      a.cookie,
    );
    assert.equal(r.status, 201);
    const result = await done(api, a.cookie, r.data.id);
    assert.equal(result.run.config.members.length, 10);
    assert.equal(
      new Set(result.run.config.members.map((m: any) => m.providerId)).size,
      5,
    );
    assert.equal(result.run.status, "completed");
  }));
test("a failed provider hands the same agent and partial context to another selected model", async () => {
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const text = (value: string) =>
      res.write(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: value } }] }) +
          "\n\n",
      );
    if (req.url?.startsWith("/bad/")) {
      text("Critical discovered clue: preserve this partial finding.");
      res.end();
      return;
    }
    assert(body.messages[1].content.includes("Critical discovered clue"));
    text(
      "```council\n" +
        JSON.stringify({
          proposal: {
            answer: "Recovered using the preserved clue.",
            rationale:
              "Continued with the same peer context on an available model.",
          },
        }) +
        "\n```",
    );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Recovery",
        email: "recovery@example.test",
        password: "long-password-123",
      });
      const base = `http://127.0.0.1:${(model.address() as any).port}`;
      const ids = [];
      for (const suffix of ["bad", "good"]) {
        const p = await api(
          "/providers",
          {
            name: suffix,
            kind: "vllm",
            baseUrl: base + "/" + suffix,
            model: suffix,
            transport: "direct",
            reasoning: false,
          },
          auth.cookie,
        );
        ids.push(p.data.id);
      }
      const r = await api(
        "/runs",
        {
          prompt: "Preserve useful work through a failure",
          config: cfg(ids, 1),
        },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, r.data.id);
      assert.equal(result.run.status, "completed");
      assert(result.events.some((e: any) => e.type === "agent.reassigned"));
      const turns = result.events.filter((e: any) => e.type === "turn.start");
      assert.equal(new Set(turns.map((e: any) => e.data.agentId)).size, 1);
      assert.equal(turns[1].data.model, "good");
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});
test("benchmark compares council and single-model refinement with deterministic grading and isolation", async () => {
  const requests: string[] = [];
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(raw);
    const body = JSON.parse(raw);
    const user = body.messages[1].content;
    let text = "FINAL_ANSWER: 1647";
    if (user.includes("LIVE SHARED BOARD")) {
      const board = JSON.parse(
        user
          .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
          .split("\n\n")[0],
      );
      text =
        "```council\n" +
        JSON.stringify(
          board.candidate
            ? {
                review: {
                  candidateId: board.candidate.id,
                  agree: true,
                  reason: "Fixture arithmetic checked",
                },
              }
            : {
                proposal: {
                  answer: text,
                  rationale: "Fixture deterministic output",
                },
              },
        ) +
        "\n```";
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: text } }] }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api, benchmarks }: any) => {
      const a = await api("/auth/signup", {
        name: "Bench",
        email: "bench@example.test",
        password: "long-password-123",
      });
      const p = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        a.cookie,
      );
      const b = await api(
        "/benchmarks",
        {
          config: cfg([p.data.id], 2, { concurrency: 1 }),
          baselineProviderId: p.data.id,
          baselineMode: "matched",
          repeats: 1,
          taskIds: ["arithmetic-01"],
        },
        a.cookie,
      );
      assert.equal(b.status, 201);
      while (benchmarks.active.size) await pause();
      const report = (await api("/benchmarks", undefined, a.cookie)).data[0];
      assert.equal(report.status, "completed");
      assert.equal(report.summary.councilCorrect, 1);
      assert.equal(report.summary.baselineCorrect, 1);
      assert.equal(report.rows[0].council.calls, report.rows[0].baseline.calls);
      assert.equal(report.rows[0].baseline.tokens, 30);
      const other = await api("/auth/signup", {
        name: "Other",
        email: "other@example.test",
        password: "long-password-123",
      });
      assert.deepEqual(
        (await api("/benchmarks", undefined, other.cookie)).data,
        [],
      );
      assert.equal(
        (await api(`/benchmarks/${report.id}`, undefined, other.cookie)).status,
        404,
      );
      assert.equal(
        (await api(`/benchmarks/${report.id}`, undefined, a.cookie)).data.id,
        report.id,
      );
      assert.equal(report.tasks[0].prompt, "Compute 37 * 48 - 129.");
      assert.equal(report.models.baseline.model, "fixture");
      assert.equal(report.taskSha256.length, 64);
      const custom = {
        id: "proof-1",
        domain: "math",
        prompt: "Prove the stated two-condition functional equation.",
        expected: "PRIVATE_REFERENCE_MUST_NOT_REACH_SOLVERS",
        grading: "manual",
        source: "user reference",
      };
      const startCustom = await api(
        "/benchmarks",
        {
          config: cfg([p.data.id], 2, {
            concurrency: 1,
            webResearch: true,
            sandbox: true,
          }),
          baselineProviderId: p.data.id,
          customTasks: [custom],
        },
        a.cookie,
      );
      assert.equal(startCustom.status, 201);
      while (benchmarks.active.size) await pause();
      const proof = (
        await api(`/benchmarks/${startCustom.data.id}`, undefined, a.cookie)
      ).data;
      assert.equal(proof.rows[0].council.correct, null);
      assert.equal(proof.rows[0].baseline.correct, null);
      assert.equal(proof.summary.scoredTasks, 0);
      assert.equal(proof.summary.councilAccuracy, null);
      assert.equal(proof.summary.reviewTasks, 1);
      assert.equal(proof.tasks[0].expected, custom.expected);
      assert.equal(proof.suite.name, "Custom comparison");
      assert.equal(proof.config.webResearch, false);
      assert.equal(proof.config.sandbox, false);
      assert.equal(
        requests.some((raw) => raw.includes(custom.expected)),
        false,
      );
      const invalid = await api(
        "/benchmarks",
        {
          config: cfg([p.data.id], 2),
          baselineProviderId: p.data.id,
          customTasks: [custom, custom],
        },
        a.cookie,
      );
      assert.equal(invalid.status, 400);
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});

test("two peers agree on a revision and broadcast it while a third sees only published contents", async () => {
  let outsiderSawPrivate = false;
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      system = body.messages[0].content,
      user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    const id = system.includes("NAME: Atlas")
      ? "peer-1"
      : system.includes("NAME: Sage")
        ? "peer-2"
        : "peer-3";
    if (id === "peer-3" && user.includes("private-draft-unique"))
      outsiderSawPrivate = true;
    const thread = board.communication.conversations[0];
    let actions: any = {};
    if (id === "peer-1" && !thread)
      actions = {
        broadcasts: [{ content: "Checking all roots" }],
        conversations: [
          {
            to: "peer-2",
            topic: "Roots",
            message: "private-draft-unique",
            proposal: {
              summary: "Roots are -2,-1,1,2",
              evidence: ["Substitution into quartic"],
            },
          },
        ],
      };
    else if (
      thread?.proposal &&
      !thread.proposal.reviews[id] &&
      id !== "peer-3"
    )
      actions = {
        conversations: [
          {
            threadId: thread.id,
            review: {
              revision: 1,
              agree: true,
              reason: "All four substitutions and degree checked",
            },
          },
        ],
      };
    else if (
      thread?.proposal &&
      Object.keys(thread.proposal.reviews).length === 2 &&
      !thread.proposal.publishedPostId
    )
      actions = {
        conversations: [{ threadId: thread.id, publish: true }],
        proposal: {
          answer: "Roots are -2,-1,1,2",
          rationale: "Both checks complete",
        },
      };
    else if (board.candidate)
      actions = {
        review: {
          candidateId: board.candidate.id,
          agree: true,
          reason: "Published evidence checked",
        },
      };
    const text =
      "Public progress.\n```council\n" + JSON.stringify(actions) + "\n```";
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: text }, finish_reason: null }],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Communication",
        email: "communication@example.test",
        password: "long-password-123",
      });
      const p = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const r = await api(
        "/runs",
        {
          prompt: "Verify quartic roots",
          config: cfg([p.data.id], 3, { maxCalls: 24 }),
        },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, r.data.id);
      assert.equal(
        result.run.status,
        "completed",
        JSON.stringify(result.events.filter((e: any) => e.type === "warning")),
      );
      assert.equal(outsiderSawPrivate, false);
      assert(
        result.events.some(
          (e: any) =>
            e.type === "board.post" && e.data.post.coauthors?.length === 2,
        ),
      );
      assert.equal(
        result.run.sharedState.communication.conversations[0].proposal.revision,
        1,
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});

test("sandbox API derives ownership from authentication and blocks manual writes during a run", async () => {
  const socket = path.join(tmpdir(), `council-sandbox-${Date.now()}.sock`);
  const requests: any[] = [];
  const broker = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ available: true, active: true, files: [] }));
  });
  await new Promise<void>((r) => broker.listen(socket, r));
  const previous = process.env.COUNCIL_SANDBOX_SOCKET;
  process.env.COUNCIL_SANDBOX_SOCKET = socket;
  try {
    await harness(async ({ api, engine }: any) => {
      const auth = await api("/auth/signup", {
        name: "Sandbox",
        email: "sandbox@example.test",
        password: "long-password-123",
      });
      assert.equal(
        (await api("/sandbox", { action: "exec", command: "node --test" }))
          .status,
        401,
      );
      const result = await api(
        "/sandbox",
        { action: "tree", owner: "someone-else" },
        auth.cookie,
      );
      assert.equal(result.status, 200);
      assert.equal(requests.at(-1).owner, auth.data.user.id);
      engine.active.set("fixture", {
        userId: auth.data.user.id,
        controller: new AbortController(),
      });
      assert.equal(
        (
          await api(
            "/sandbox",
            { action: "exec", command: "echo nope" },
            auth.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (await api("/sandbox", { action: "tree" }, auth.cookie)).status,
        200,
      );
      engine.active.delete("fixture");
    });
  } finally {
    if (previous) process.env.COUNCIL_SANDBOX_SOCKET = previous;
    else delete process.env.COUNCIL_SANDBOX_SOCKET;
    broker.closeAllConnections();
    await new Promise<void>((r) => broker.close(() => r()));
  }
});

test("rejected actions feed back to the agent, recover and publish exact math evidence without a sandbox", async () => {
  let repaired = false;
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    const inbox = JSON.parse(user.split("YOUR INBOX:\n")[1].split("\n\n")[0]);
    const owner = board.peers.find((p: any) => p.id === "peer-1");
    const isOwner = body.messages[0].content.includes("NAME: Atlas");
    let output = "";
    if (board.candidate)
      output = JSON.stringify({
        proposal: {
          answer: board.candidate.answer,
          rationale:
            "Repeated identical answer must retain prior reviews; exact tool output has 32 divisors.",
        },
      });
    else if (!isOwner)
      output = JSON.stringify({
        messages: [
          { to: "peer-1", content: "Please obtain the exact tool result." },
        ],
      });
    else if (inbox.some((m: any) => m.kind === "protocol_error")) {
      repaired = true;
      output = JSON.stringify({
        work: [
          {
            key: "factor",
            status: "claim",
            description: "Check exact factors",
          },
        ],
        tools: [
          { name: "factor_integer", integer: "2045901" },
          { name: "calculate", expression: "3*11*13*19*251" },
          {
            name: "solve_linear",
            coefficients: [
              ["2", "1"],
              ["1", "-1"],
            ],
            constants: ["5", "1"],
          },
        ],
      });
    } else if (
      board.communication.board.some((p: any) =>
        p.content.includes('"divisorCount":32'),
      )
    ) {
      output = JSON.stringify({
        work: [
          {
            key: "factor",
            status: "complete",
            result: "Actual factor_integer result: 32 divisors.",
          },
        ],
        proposal: {
          answer: "2045901 = 3 × 11 × 13 × 19 × 251; 32 positive factors.",
          rationale: "Exact integer verification, not repeated claims.",
        },
      });
    } else
      output = String.raw`{"proposal":{"answer":"\(2045901\)","rationale":"bad JSON escape fixture"}}`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "```council\n" + output + "\n```" } }],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Math fixture",
        email: "math@example.test",
        password: "long-password-123",
      });
      const provider = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const started = await api(
        "/runs",
        {
          prompt: "Find the factors of 2045901",
          config: cfg([provider.data.id], 2, { concurrency: 1, maxCalls: 12 }),
        },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, started.data.id);
      assert.equal(repaired, true);
      assert.equal(result.run.status, "completed");
      assert.match(result.run.final, /32 positive factors/);
      assert.equal(
        result.events.filter((e: any) => e.type === "candidate.proposed")
          .length,
        1,
      );
      const first = result.events.find((e: any) => e.type === "turn.done");
      assert.match(first.data.text, /No valid team actions/);
      assert.doesNotMatch(first.data.text, /Published team actions/);
      assert(
        result.events.some(
          (e: any) =>
            e.type === "tool.result" && e.data.tool === "factor_integer",
        ),
      );
      assert(
        result.events.some(
          (e: any) =>
            e.type === "board.post" &&
            e.data.post.content.includes('"divisorCount":32'),
        ),
      );
      assert.equal(result.run.sharedState.work[0].state, "complete");
      const results = result.events.filter(
        (e: any) => e.type === "tool.result",
      );
      assert.equal(
        JSON.parse(
          results.find((e: any) => e.data.tool === "calculate").data.result,
        ).exact,
        "2045901",
      );
      assert.equal(
        JSON.parse(
          results.find((e: any) => e.data.tool === "solve_linear").data.result,
        ).verified,
        true,
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});

test("a team repeating status without evidence stops before exhausting its budget", async () => {
  const model = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* consume fixture request */
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content: "I will verify this later; waiting for another peer.",
              },
            },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api }: any) => {
      const auth = await api("/auth/signup", {
        name: "Stall fixture",
        email: "stall@example.test",
        password: "long-password-123",
      });
      const p = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          model: "fixture",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const r = await api(
        "/runs",
        {
          prompt: "Verify a concrete fact",
          config: cfg([p.data.id], 2, { concurrency: 1, maxCalls: 24 }),
        },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, r.data.id);
      assert.equal(result.run.status, "needs_review");
      assert(
        result.events.filter((e: any) => e.type === "turn.start").length < 24,
      );
      assert.match(result.run.final, /Stopped repeated discussion/);
      assert(
        result.events.some(
          (e: any) =>
            e.type === "warning" && e.data.message.includes("concrete check"),
        ),
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});

test("web research shares cached sources across peers, counts search calls and respects opt-in", async () => {
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      system = body.messages[0].content,
      user = body.messages[1].content;
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    const turn = Number(system.match(/\nTURN: (\d+)/)[1]);
    const output =
      turn === 1
        ? {
            tools: [
              { name: "web_search", query: "primary source test" },
              { name: "web_fetch", url: "https://example.org/docs" },
            ],
          }
        : board.candidate
          ? {
              review: {
                candidateId: board.candidate.id,
                agree: true,
                reason: "The retrieved page supports the conclusion.",
              },
            }
          : {
              proposal: {
                answer:
                  "Source result: [Primary source](https://example.org/docs).",
                rationale: "Inspected retrieved page evidence.",
              },
            };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content: "```council\n" + JSON.stringify(output) + "\n```",
              },
            },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  try {
    await harness(async ({ api, engine }: any) => {
      let searches = 0,
        pages = 0;
      engine.research = {
        searchWeb: async () => {
          searches++;
          return {
            query: "primary source test",
            text: "Retrieved source digest.",
            sources: [
              { url: "https://example.org/docs", title: "Primary source" },
            ],
            fetchedAt: new Date().toISOString(),
            inputTokens: 3,
            outputTokens: 4,
          };
        },
        fetchPage: async () => {
          pages++;
          return extractPage(
            "https://example.org/docs",
            "text/plain",
            "Primary source result.",
          );
        },
      };
      const auth = await api("/auth/signup", {
        name: "Research fixture",
        email: "research@example.test",
        password: "long-password-123",
      });
      const local = await api(
        "/providers",
        {
          name: "Fixture",
          kind: "vllm",
          baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
          model: "fixture",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const search = await api(
        "/providers",
        {
          name: "Search",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKey: "fixture-only",
          transport: "direct",
          reasoning: false,
        },
        auth.cookie,
      );
      const config = cfg([local.data.id], 2, {
        concurrency: 1,
        maxCalls: 8,
        webResearch: true,
      });
      config.providerIds.push(search.data.id);
      const start = await api(
        "/runs",
        { prompt: "Research a public source", config },
        auth.cookie,
      );
      const result = await done(api, auth.cookie, start.data.id);
      assert.equal(result.run.status, "completed");
      assert.equal(searches, 1);
      assert.equal(pages, 1);
      assert.equal(
        result.events.filter((e: any) => e.type === "research.start").length,
        1,
      );
      assert.equal(
        result.events.filter(
          (e: any) => e.type === "tool.result" && e.data.cached,
        ).length,
        2,
      );
      assert.equal(
        result.events.filter((e: any) => e.type === "board.post").length,
        2,
      );
      assert.match(result.run.final, /https:\/\/example.org\/docs/);
      const disabled = await api(
        "/runs",
        {
          prompt: "Research disabled",
          config: { ...config, webResearch: false },
        },
        auth.cookie,
      );
      const without = await done(api, auth.cookie, disabled.data.id);
      assert.equal(searches, 1);
      assert.equal(pages, 1);
      assert.equal(
        without.events.filter((e: any) => e.type === "research.start").length,
        0,
      );
      assert.ok(
        without.events.some(
          (e: any) =>
            e.type === "tool.error" && e.data.message.includes("disabled"),
        ),
      );
    });
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
  }
});

test("chat attachments enforce ownership, limits, persistence and follow-up inheritance", async () =>
  harness(async ({ api, base, db, store, engine }: any) => {
    const alice = await api("/auth/signup", {
      email: "files-a@example.test",
      password: "long-password-123",
    });
    const bob = await api("/auth/signup", {
      email: "files-b@example.test",
      password: "long-password-123",
    });
    const upload = async (cookie: string, name: string, content: string) => {
      const r = await fetch(base + "/api/attachments", {
        method: "POST",
        headers: {
          cookie,
          "x-council-request": "1",
          "x-file-name": encodeURIComponent(name),
          "content-type": "application/octet-stream",
        },
        body: content,
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal(
      (await upload("", "notes.md", "private evidence")).status,
      401,
    );
    assert.equal((await upload(alice.cookie, "payload.exe", "x")).status, 400);
    const item = await upload(
      alice.cookie,
      "evidence.md",
      "# Private attachment marker",
    );
    assert.equal(item.status, 201);
    const provider = (await api("/providers", undefined, alice.cookie)).data[0]
      .id;
    const config = cfg([provider], 1);
    const bobProvider = (await api("/providers", undefined, bob.cookie)).data[0]
      .id;
    assert.equal(
      (
        await api(
          "/runs",
          {
            prompt: "Read",
            config: cfg([bobProvider], 1),
            attachmentIds: [item.data.id],
          },
          bob.cookie,
        )
      ).status,
      400,
    );
    await api("/attachments/" + item.data.id, undefined, bob.cookie, "DELETE");
    const created = await api(
      "/runs",
      {
        prompt: "Read attached evidence",
        config,
        attachmentIds: [item.data.id],
      },
      alice.cookie,
    );
    assert.equal(created.status, 201);
    assert.match(created.data.attachments[0].text, /Private attachment marker/);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM attachments WHERE id=?")
        .get(item.data.id).n,
      0,
    );
    await done(api, alice.cookie, created.data.id);
    const follow = await api(
      "/runs",
      {
        prompt: "Explain the same document",
        config,
        parentId: created.data.id,
      },
      alice.cookie,
    );
    assert.equal(follow.status, 201);
    assert.equal(follow.data.attachments[0].id, item.data.id);
    await done(api, alice.cookie, follow.data.id);
    assert.equal(
      (await api("/runs/" + created.data.id, undefined, bob.cookie)).status,
      404,
    );
    assert.equal(
      (await api("/runs/" + created.data.id, undefined, alice.cookie)).data.run
        .attachments[0].text,
      item.data.text,
    );
    const expired = await upload(
      alice.cookie,
      "expired.md",
      "Expired evidence",
    );
    db.prepare("UPDATE attachments SET expires=0 WHERE id=?").run(
      expired.data.id,
    );
    assert.equal(
      (
        await api(
          "/runs",
          { prompt: "Read", config, attachmentIds: [expired.data.id] },
          alice.cookie,
        )
      ).status,
      400,
    );
    const removed = await upload(alice.cookie, "remove.md", "Delete this");
    await api(
      "/attachments/" + removed.data.id,
      undefined,
      alice.cookie,
      "DELETE",
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM attachments WHERE id=?")
        .get(removed.data.id).n,
      0,
    );
  }));

test("every peer receives attachment text through the shared provider request", async () =>
  harness(async ({ api, base, engine }: any) => {
    const auth = await api("/auth/signup", {
      email: "files-model@example.test",
      password: "long-password-123",
    });
    const p = await api(
      "/providers",
      {
        name: "Fixture bridge",
        kind: "vllm",
        baseUrl: "http://127.0.0.1:8000/v1",
        model: "fixture",
        transport: "bridge",
      },
      auth.cookie,
    );
    const requests: any[] = [];
    engine.bridge.complete = async function* (
      _uid: any,
      _provider: any,
      request: any,
    ) {
      requests.push(request);
      yield {
        text: 'Fixture answer.\n```council\n{"proposal":{"answer":"The attachment says 42.","rationale":"Attachment fixture"}}\n```',
      };
    };
    const response = await fetch(base + "/api/attachments", {
      method: "POST",
      headers: {
        cookie: auth.cookie,
        "x-council-request": "1",
        "x-file-name": "evidence.md",
        "content-type": "application/octet-stream",
      },
      body: "Attachment marker: 42",
    });
    const file = await response.json();
    assert.equal(response.status, 201);
    const run = await api(
      "/runs",
      {
        prompt: "Read the evidence",
        config: cfg([p.data.id], 3, { maxCalls: 6 }),
        attachmentIds: [file.id],
      },
      auth.cookie,
    );
    assert.equal(run.status, 201);
    await done(api, auth.cookie, run.data.id);
    assert.ok(requests.length >= 3);
    for (const request of requests) {
      assert.match(request.messages[1].content, /Attachment marker: 42/);
      assert.match(request.messages[1].content, /untrusted source material/);
    }
  }));

test("greetings finish with zero peer turns or tool calls and remain visible on reload", async () =>
  harness(async ({ api, engine }: any) => {
    const auth = await api("/auth/signup", {
      email: "greeting@example.test",
      password: "long-password-123",
    });
    const provider = (await api("/providers", undefined, auth.cookie)).data[0]
      .id;
    const config = cfg([provider], 3);
    const run = await api(
      "/runs",
      { prompt: "hello", config: { ...config, sandbox: true } },
      auth.cookie,
    );
    assert.equal(run.status, 201);
    assert.equal(run.data.status, "completed");
    const saved = await api("/runs/" + run.data.id, undefined, auth.cookie);
    assert.match(saved.data.run.final, /Hello!/);
    assert.equal(engine.active.size, 0);
    assert.equal(
      saved.data.events.some((e: any) =>
        ["agent.join", "turn.start", "tool.result", "coding.activity"].includes(
          e.type,
        ),
      ),
      false,
    );
    const final = saved.data.events.find((e: any) => e.type === "run.final");
    assert.equal(final.data.calls, 0);
    assert.equal(final.data.agents, 0);
    const follow = await api(
      "/runs",
      { prompt: "thanks", config, parentId: run.data.id },
      auth.cookie,
    );
    assert.equal(follow.data.status, "completed");
    assert.match(follow.data.final, /welcome/);
  }));
