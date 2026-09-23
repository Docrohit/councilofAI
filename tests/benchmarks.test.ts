import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";
import {
  Benchmarks,
  benchmarkTaskSchema,
  gradeAnswer,
  type BenchmarkResult,
} from "../server/benchmarks.ts";
import type { Run, RunConfig } from "../shared/types.ts";
import type { Orchestrator } from "../server/orchestrator.ts";

test("proof grading stays unscored even when final text matches the reference", () => {
  const task = benchmarkTaskSchema.parse({
    id: "proof",
    domain: "math",
    prompt: "Prove it",
    expected: "42",
    grading: "manual",
  });
  assert.equal(gradeAnswer("FINAL_ANSWER: 42", task).correct, null);
  assert.equal(
    gradeAnswer("No marker but a complete proof", task).correct,
    null,
  );
  assert.equal(
    benchmarkTaskSchema.safeParse({
      ...task,
      grading: "automatic",
      expected: "",
    }).success,
    false,
  );
});

test("cancelled baseline preserves the council answer and owner-private report", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-benchmark-"));
  const db = openDb(dir),
    store = new Store(db, dir);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "owner",
    "bench@example.test",
    "Owner",
    "unused",
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO providers VALUES(?,?,?,?)").run(
    "provider",
    "owner",
    JSON.stringify({
      id: "provider",
      name: "Fixture",
      kind: "vllm",
      model: "fixture",
      transport: "bridge",
      baseUrl: "",
    }),
    "",
  );
  let entered!: () => void;
  const baselineStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const engine = {
    start: async (_owner: string, run: Run) => {
      run.final = "FINAL_ANSWER: 1647";
      run.status = "completed";
      store.event(run.id, "turn.start", {});
      store.event(run.id, "turn.done", { inputTokens: 10, outputTokens: 5 });
      store.saveRun("owner", run);
    },
    cancel: () => true,
    bridge: {
      complete: async function* (
        _owner: string,
        _provider: unknown,
        request: any,
      ) {
        entered();
        await new Promise<void>((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true },
          );
        });
      },
    },
  } as unknown as Orchestrator;
  const benchmarks = new Benchmarks(store, engine);
  const config: RunConfig = {
    providerIds: ["provider"],
    members: [
      { id: "peer", name: "Peer", role: "Solve", providerId: "provider" },
    ],
    concurrency: 1,
    maxAgents: 1,
    maxDepth: 0,
    maxCalls: 4,
    maxOutputTokens: 256,
    maxMinutes: 1,
  };
  const result: BenchmarkResult = {
    id: "report",
    createdAt: new Date().toISOString(),
    status: "running",
    baselineMode: "single",
    baselineProviderId: "provider",
    repeats: 1,
    taskIds: ["arithmetic-01"],
    config,
    rows: [],
  };
  try {
    const running = benchmarks.run("owner", result);
    await baselineStarted;
    const partial = benchmarks.get("owner", "report")!;
    assert.equal(partial.rows[0].council.answer, "FINAL_ANSWER: 1647");
    assert.equal(partial.progress?.phase, "baseline");
    assert.equal(benchmarks.get("another-owner", "report"), undefined);
    assert.equal(benchmarks.cancel("another-owner", "report"), false);
    assert.equal(benchmarks.cancel("owner", "report"), true);
    await running;
    const finished = benchmarks.get("owner", "report")!;
    assert.equal(finished.status, "cancelled");
    assert.equal(finished.rows[0].council.correct, true);
    assert.equal(finished.rows[0].baseline.status, "failed");
    assert.equal(finished.progress, undefined);
    assert.equal(benchmarks.active.size, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart recovery clears progress and preserves completed Council answers", async () => {
  const { createApp } = await import("../server/app.ts");
  for (const phase of ["council", "baseline"]) {
    const directory = mkdtempSync(
      path.join(tmpdir(), "council-benchmark-restart-"),
    );
    const db = openDb(directory);
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "owner",
      "restart@example.test",
      "Owner",
      "unused",
      new Date().toISOString(),
    );
    const report = {
      id: "interrupted",
      status: "running",
      progress: { taskId: "p1", repeat: 1, phase },
      rows:
        phase === "baseline"
          ? [
              {
                council: { answer: "Keep this answer" },
                baseline: {
                  answer: "Partial answer",
                  status: "running",
                  calls: 1,
                  tokens: 12,
                },
              },
            ]
          : [],
    };
    db.prepare("INSERT INTO benchmarks(id,user_id,data) VALUES(?,?,?)").run(
      report.id,
      "owner",
      JSON.stringify(report),
    );
    db.close();
    const app = createApp(directory);
    try {
      const stored = JSON.parse(
        (
          app.db
            .prepare("SELECT data FROM benchmarks WHERE id=?")
            .get(report.id) as any
        ).data,
      );
      assert.equal(stored.status, "failed");
      assert.equal(stored.progress, undefined);
      if (phase === "baseline") {
        assert.equal(stored.rows[0].baseline.status, "failed");
        assert.equal(stored.rows[0].baseline.answer, "Partial answer");
        assert.equal(stored.rows[0].council.answer, "Keep this answer");
        assert.equal(stored.rows[0].baseline.tokens, 12);
      }
    } finally {
      app.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
