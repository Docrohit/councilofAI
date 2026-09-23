import test from "node:test";
import { lines } from "../server/providers.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dialog } from "../cli/tui-dialog.ts";
import { sessionView, cells, fit, livePeers } from "../cli/tui-workspace.ts";
import { cleanTerminal, wrapTerminal, terminalRow } from "../cli/tui.ts";
import {
  saveNativeKey,
  readNativeKey,
  hasNativeKey,
} from "../cli/credentials.ts";
import { saveModel, removeModel, modelKey } from "../cli/native.ts";
import type { CouncilEvent } from "../shared/types.ts";
const event = (type: string, data: Record<string, any>): CouncilEvent => ({
  id: 1,
  runId: "fixture",
  type,
  data,
  at: "2026-01-01",
});
test("interleaved peer streams remain attributed to their own turns", () => {
  const events = [
    event("turn.start", {
      turnId: "a",
      name: "Atlas",
      model: "fixture",
      phase: "discussion",
    }),
    event("turn.delta", { turnId: "a", text: "A first." }),
    event("turn.start", {
      turnId: "b",
      name: "Sage",
      model: "fixture",
      phase: "discussion",
    }),
    event("turn.delta", { turnId: "b", text: "B only." }),
    event("turn.delta", { turnId: "a", text: " A second." }),
  ];
  const text = sessionView("Discussion", events, undefined, (x) => x);
  assert.match(text, /Atlas[^]*A first\. A second\.[^]*Sage[^]*B only\./);
});
test("collaboration views preserve authors, challenges, evidence and final answer", () => {
  const events = [
    event("board.post", {
      post: {
        id: "p",
        author: "a",
        coauthors: ["a", "b"],
        content: "Broadcast proof",
        threadId: "t",
      },
    }),
    event("conversation.updated", {
      conversation: {
        id: "t",
        topic: "Review",
        participants: ["a", "b"],
        messages: [{ author: "b", content: "Counterexample" }],
        proposal: {
          revision: 2,
          summary: "Candidate",
          evidence: ["Calculation"],
          reviews: {
            a: { agree: true, reason: "Verified" },
            b: { agree: false, reason: "Missing case" },
          },
        },
      },
    }),
    event("finding.updated", {
      finding: {
        id: "f",
        key: "factor",
        state: "disputed",
        revision: 2,
        author: "a",
        claim: "Claim",
        evidence: ["Proof step"],
        challenges: [
          { agent: "b", reason: "Counterexample", recheck: "Check integer" },
        ],
      },
    }),
    event("agent.message", {
      name: "Atlas",
      to: "b",
      kind: "delegate",
      content: "Check this",
    }),
    event("run.final", { text: "Final result" }),
  ];
  const name = (id: string) => (id === "a" ? "Atlas" : "Sage");
  assert.match(
    sessionView("Board", events, undefined, name),
    /Atlas \+ Sage[^]*Broadcast proof/,
  );
  assert.match(
    sessionView("Conversations", events, undefined, name),
    /Sage: disagrees — Missing case/,
  );
  assert.match(
    sessionView("Findings", events, undefined, name),
    /DISPUTED[^]*Proof step[^]*Challenge by Sage: Counterexample/,
  );
  assert.match(
    sessionView("Engagement", events, undefined, name),
    /Atlas → Sage[^]*Check this/,
  );
  assert.equal(sessionView("Answer", events, undefined, name), "Final result");
  assert.match(sessionView("Answer", [], undefined, name), /not produced/);
});
test("terminal cell layout handles wide characters and strips escape payloads", () => {
  assert.equal(cells("数学🙂e\u0301"), 7);
  assert.equal(cells(fit("数学🙂e\u0301", 5)), 5);
  const rows = wrapTerminal("\x1b[31m数学🙂e\u0301\x1b[0m", 4);
  assert.deepEqual(rows, ["数学", "🙂e\u0301"]);
  assert.equal(cleanTerminal("\x1b]52;c;bad\x07hello"), "hello");
});
test("dialogs filter choices, preserve multiselection and never render secrets", async () => {
  let result: string[] = [];
  const d = new Dialog(
    "Models",
    [
      { id: "a", title: "Ollama" },
      { id: "b", title: "OpenAI" },
    ],
    (ids) => {
      result = ids;
    },
    undefined,
    true,
  );
  await d.key(" ", {});
  await d.key("Open", {});
  await d.key(" ", {});
  await d.key("", { name: "return" });
  assert.deepEqual(result, ["a", "b"]);
  const secret = new Dialog("Key", [], () => {}, [
    { label: "API key", value: "", secret: true },
  ]);
  await secret.key("fixture-secret", {}, true);
  assert.doesNotMatch(secret.lines(12), /fixture-secret/);
  assert.match(secret.lines(12), /•••/);
});
test("saved native credentials are encrypted, private, reusable and cleared on endpoint change", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-keys-"));
  const prev = process.env.COUNCIL_CONFIG_DIR;
  process.env.COUNCIL_CONFIG_DIR = dir;
  try {
    const model = saveModel({
      id: "fixture",
      kind: "compatible",
      model: "fixture",
      baseUrl: "http://localhost:8000/v1",
    });
    saveNativeKey(dir, "fixture", "fixture-private-key");
    assert.equal(readNativeKey(dir, "fixture"), "fixture-private-key");
    assert.equal(modelKey(model), "fixture-private-key");
    assert.equal(
      statSync(path.join(dir, "native-keys.json")).mode & 0o777,
      0o600,
    );
    assert.doesNotMatch(
      readFileSync(path.join(dir, "native-keys.json"), "utf8"),
      /fixture-private-key/,
    );
    assert.doesNotMatch(
      readFileSync(path.join(dir, "native-models.json"), "utf8"),
      /fixture-private-key/,
    );
    saveModel({ ...model, model: "another-model" });
    assert(hasNativeKey(dir, "fixture"));
    assert.throws(
      () =>
        saveModel({ ...model, baseUrl: "https://user:pass@example.com/v1" }),
      /credentials/,
    );
    assert(hasNativeKey(dir, "fixture"));
    const changed = saveModel({
      ...model,
      baseUrl: "http://localhost:9000/v1",
      keyEnv: "OPENAI_API_KEY",
    });
    assert.equal(changed.keyEnv, undefined);
    assert.equal(readNativeKey(dir, "fixture"), "");
    saveNativeKey(dir, "fixture", "replacement");
    removeModel("fixture");
    assert.equal(readNativeKey(dir, "fixture"), "");
  } finally {
    if (prev === undefined) delete process.env.COUNCIL_CONFIG_DIR;
    else process.env.COUNCIL_CONFIG_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical contributions replace protocol blocks and live peers reflect failover", () => {
  const peer = {
    id: "a",
    name: "Atlas",
    providerId: "local",
    role: "research",
  };
  const events = [
    event("turn.start", { turnId: "t", name: "Atlas", model: "local" }),
    event("turn.delta", { turnId: "t", text: "```council {raw}" }),
    event("turn.done", { turnId: "t", text: "Published evidence." }),
    event("agent.spawn", {
      id: "b",
      name: "New peer",
      providerId: "local",
      role: "math",
    }),
    event("agent.reassigned", { ...peer, providerId: "cloud" }),
    event("agent.unavailable", { agentId: "b" }),
  ];
  const text = sessionView("Discussion", events, undefined, (x) => x);
  assert.match(text, /Published evidence/);
  assert.doesNotMatch(text, /```council/);
  const peers = livePeers([peer], events);
  assert.equal(peers[0].providerId, "cloud");
  assert.equal(peers[1].unavailable, true);
});

test("returning a provider stream cannot hang on transport cancellation", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("fixture\n"));
    },
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  const iterator = lines(stream);
  assert.equal((await iterator.next()).value, "fixture");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      iterator.return(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stream return hung")), 1000);
      }),
    ]);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  } finally {
    clearTimeout(timer);
  }
});

test("aborting a provider stream resumes a pending read and stops buffered yields", async () => {
  for (const waiting of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        if (!waiting) c.enqueue(new TextEncoder().encode("first\nsecond\n"));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const iterator = lines(stream, controller.signal);
    if (!waiting) assert.equal((await iterator.next()).value, "first");
    const pending = waiting ? iterator.next() : undefined;
    controller.abort(new Error("Fixture stopped"));
    await assert.rejects(pending || iterator.next(), /Fixture stopped/);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test("status rows cannot insert extra terminal lines and dialog errors are readable", async () => {
  const row = terminalRow("Failure:\nline two\r\nline three\tmore", 32);
  assert.doesNotMatch(row, /[\r\n\t]/);
  assert.equal(cells(row), 32);
  const d = new Dialog("Connection", [], () => {
    throw { issues: [{ path: ["keyEnv"] }], message: "raw\nJSON" };
  });
  await d.key("", { name: "return" });
  assert.match(d.error, /Check the connection fields/);
  assert.doesNotMatch(d.error, /\n|JSON/);
});
