import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Run, RunConfig } from "../shared/types.ts";
import { Store } from "./store.ts";
import { Orchestrator } from "./orchestrator.ts";
import { complete } from "./providers.ts";
const smokeSuite = [
  {
    id: "arithmetic-01",
    domain: "math",
    prompt: "Compute 37 * 48 - 129.",
    expected: "1647",
    numeric: true,
  },
  {
    id: "probability-01",
    domain: "math",
    prompt:
      "Two fair six-sided dice are rolled. What is the probability that their sum is 8? Give a fraction.",
    expected: "5/36",
    numeric: true,
  },
  {
    id: "algebra-01",
    domain: "math",
    prompt: "Solve for x: 7x - 19 = 3x + 45.",
    expected: "16",
    numeric: true,
  },
  {
    id: "percent-01",
    domain: "math",
    prompt:
      "A price of 250 increases by 20%, then decreases by 20%. What is the final price?",
    expected: "240",
    numeric: true,
  },
  {
    id: "logic-01",
    domain: "logic",
    prompt:
      "All zargs are blue. Some blue things are round. Does it logically follow that some zargs are round? Answer yes or no.",
    expected: "no",
  },
  {
    id: "order-01",
    domain: "logic",
    prompt:
      "A is before C. B is after C. D is before A. Give the unique order, using comma-separated letters.",
    expected: "D,A,C,B",
  },
  {
    id: "context-01",
    domain: "context",
    prompt:
      "Project Cedar originally used port 8011. This was corrected to 8123. Project Birch uses 8222. The Cedar port was later explicitly changed to 8456; Birch stayed unchanged. Return the current Cedar port only.",
    expected: "8456",
    numeric: true,
  },
  {
    id: "context-02",
    domain: "context",
    prompt:
      "The blue box contains a red key. The green box contains a blue key. The red box contains a green key. Move the red key from its original box into the red box, leaving everything else in place. Which box now has two keys? Return the box color.",
    expected: "red",
  },
  {
    id: "transform-01",
    domain: "structured-data",
    prompt:
      "Sort these integers numerically, preserving duplicates: 11, -2, 3, 11, 0. Return a comma-separated list with no brackets.",
    expected: "-2,0,3,11,11",
  },
  {
    id: "count-01",
    domain: "structured-data",
    prompt:
      'Count case-sensitive occurrences of the exact word "red" in this list: red, Red, blue, red, reddish, red. Return the integer count.',
    expected: "3",
    numeric: true,
  },
  {
    id: "roots-01",
    domain: "math",
    prompt:
      "Find all real roots of x^4 - 5*x^2 + 4 = 0. Return the roots in ascending order separated by commas, without spaces.",
    expected: "-2,-1,1,2",
  },
  {
    id: "extraneous-01",
    domain: "math",
    prompt: "Solve sqrt(x+6)=x over the real numbers. Return the valid x only.",
    expected: "3",
    numeric: true,
  },
  {
    id: "implication-01",
    domain: "logic",
    prompt: "If P implies Q, and Q is true, must P be true? Answer yes or no.",
    expected: "no",
  },
];
export const benchmarkTaskSchema = z
  .object({
    id: z.string().min(1).max(120),
    domain: z.string().min(1).max(100),
    prompt: z.string().trim().min(1).max(18000),
    expected: z.string().max(18000).default(""),
    numeric: z.boolean().optional(),
    grading: z.enum(["automatic", "manual"]).default("automatic"),
    source: z.string().max(1000).optional(),
  })
  .refine((task) => task.grading === "manual" || !!task.expected.trim(), {
    message: "Automatic grading requires an expected answer.",
    path: ["expected"],
  });
export type BenchmarkTask = z.infer<typeof benchmarkTaskSchema>;
const importedSchema = z.object({
  name: z.string().max(200),
  source: z.string().max(500),
  revision: z.string().optional(),
  seed: z.string().optional(),
  sourceSha256: z.string().optional(),
  tasks: z.array(benchmarkTaskSchema).min(1).max(5000),
});
const importedRaw = process.env.BENCHMARK_SUITE_PATH
  ? readFileSync(process.env.BENCHMARK_SUITE_PATH, "utf8")
  : undefined;
const imported = importedRaw
  ? importedSchema.parse(JSON.parse(importedRaw))
  : undefined;
export const benchmarkSuite: BenchmarkTask[] =
  imported?.tasks || smokeSuite.map((t) => benchmarkTaskSchema.parse(t));
if (new Set(benchmarkSuite.map((t) => t.id)).size !== benchmarkSuite.length)
  throw new Error("Benchmark task IDs must be unique.");
export const benchmarkMetadata = {
  name: imported?.name || "Council original smoke suite",
  source:
    imported?.source || "Original deterministic tasks included in Council",
  revision: imported?.revision,
  seed: imported?.seed,
  sha256: createHash("sha256")
    .update(importedRaw || JSON.stringify(smokeSuite))
    .digest("hex"),
};
export function gradeAnswer(
  text: string,
  task: (typeof benchmarkSuite)[number],
) {
  const matches = [...text.matchAll(/FINAL_ANSWER:\s*([^\n]+)/g)];
  const raw = matches.at(-1)?.[1]?.replace(/[*`]/g, "").trim();
  if (task.grading === "manual")
    return {
      correct: null,
      extracted: raw || null,
      reason:
        "Proof or open-ended answer requires independent review; not automatically scored.",
    };
  if (!raw)
    return {
      correct: false,
      extracted: null,
      reason: "Missing FINAL_ANSWER marker",
    };
  if (task.numeric) {
    const number = (value: string) => {
      const v = value.replace(/,/g, "").trim();
      if (/^[-+]?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(v)) {
        const [a, b] = v.split("/").map(Number);
        return a / b;
      }
      return /^[-+]?\d+(?:\.\d+)?$/.test(v) ? Number(v) : NaN;
    };
    const actual = number(raw),
      expected = number(task.expected);
    return {
      correct: Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
      extracted: raw,
      reason: "Deterministic numeric check",
    };
  }
  return {
    correct:
      raw.toLowerCase().replace(/\s+/g, "") ===
      task.expected.toLowerCase().replace(/\s+/g, ""),
    extracted: raw,
    reason: "Deterministic exact check",
  };
}
export interface BenchmarkResult {
  id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  createdAt: string;
  baselineMode: "single" | "matched";
  repeats: number;
  taskIds: string[];
  config: RunConfig;
  baselineProviderId: string;
  rows: any[];
  summary?: any;
  error?: string;
  suite?: typeof benchmarkMetadata;
  taskSha256?: string;
  tasks?: BenchmarkTask[];
  models?: {
    baseline: { id: string; model: string; kind: string; name: string };
    council: { id: string; model: string; kind: string; name: string }[];
  };
  progress?: {
    taskId: string;
    repeat: number;
    phase: "council" | "baseline";
    runId: string;
  };
}
export class Benchmarks {
  active = new Map<
    string,
    { userId: string; controller: AbortController; runId?: string }
  >();
  constructor(
    public store: Store,
    public engine: Orchestrator,
  ) {}
  busy(userId: string) {
    return [...this.active.values()].some((a) => a.userId === userId);
  }
  save(userId: string, result: BenchmarkResult) {
    this.store.db
      .prepare(
        "INSERT INTO benchmarks(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(result.id, userId, JSON.stringify(result));
  }
  list(userId: string) {
    return (
      this.store.db
        .prepare(
          "SELECT data FROM benchmarks WHERE user_id=? ORDER BY rowid DESC LIMIT 30",
        )
        .all(userId) as any[]
    ).map((r) => JSON.parse(r.data));
  }
  get(userId: string, id: string): BenchmarkResult | undefined {
    const row = this.store.db
      .prepare("SELECT data FROM benchmarks WHERE id=? AND user_id=?")
      .get(id, userId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  cancel(userId: string, id: string) {
    const entry = this.active.get(id);
    if (entry?.userId !== userId) return false;
    entry.controller.abort();
    if (entry.runId) this.engine.cancel(userId, entry.runId);
    return true;
  }
  async run(userId: string, result: BenchmarkResult) {
    result.suite = benchmarkMetadata;
    result.tasks ??= result.taskIds.map((id) =>
      benchmarkSuite.find((t) => t.id === id)!,
    );
    result.taskSha256 = createHash("sha256")
      .update(JSON.stringify(result.tasks))
      .digest("hex");
    if (
      result.tasks.some(
        (task) =>
          JSON.stringify(task) !==
          JSON.stringify(benchmarkSuite.find((t) => t.id === task.id)),
      )
    ) {
      result.suite = {
        name: "Custom comparison",
        source:
          "User-supplied problems; sources and references are not independently verified.",
        sha256: result.taskSha256,
        revision: undefined,
        seed: undefined,
      };
    }
    const controller = new AbortController();
    const entry: {
      userId: string;
      controller: AbortController;
      runId?: string;
    } = { userId, controller };
    this.active.set(result.id, entry);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(120 * 60_000),
    ]);
    const providers = this.store.providers(userId, true);
    const baseline = providers.find((p) => p.id === result.baselineProviderId)!;
    const describe = ({
      id,
      name,
      model,
      kind,
    }: (typeof providers)[number]) => ({ id, name, model, kind });
    result.models = {
      baseline: describe(baseline),
      council: providers
        .filter((p) => result.config.providerIds.includes(p.id))
        .map(describe),
    };
    const cancelCouncil = () => {
      if (entry.runId) this.engine.cancel(userId, entry.runId);
    };
    signal.addEventListener("abort", cancelCouncil, { once: true });
    this.save(userId, result);
    try {
      for (let repeat = 1; repeat <= result.repeats; repeat++)
        for (const id of result.taskIds) {
          signal.throwIfAborted();
          const task = result.tasks.find((t) => t.id === id)!;
          const prompt =
            task.prompt +
            (task.grading === "manual"
              ? "\nGive a complete, justified solution. Check every condition and state your final conclusion clearly."
              : "\nGive your final answer on a line formatted exactly FINAL_ANSWER: value. Do not include units, commentary, punctuation, or Markdown on that line.");
          const run: Run = {
            id: randomUUID(),
            verificationTools: false,
            title: `Benchmark ${task.id} · trial ${repeat}`,
            prompt,
            status: "queued",
            config: result.config,
            createdAt: new Date().toISOString(),
            final: "",
            demo: false,
          };
          entry.runId = run.id;
          result.progress = {
            taskId: task.id,
            repeat,
            phase: "council",
            runId: run.id,
          };
          this.save(userId, result);
          this.store.saveRun(userId, run);
          let started = Date.now();
          await this.engine.start(userId, run);
          const councilMs = Date.now() - started;
          const events = this.store.events(run.id);
          const turns = events.filter((e) => e.type === "turn.start").length;
          const usage = events.filter((e) => e.type === "turn.done");
          const councilTokens = usage.some(
            (e) =>
              e.data.inputTokens !== undefined ||
              e.data.outputTokens !== undefined,
          )
            ? usage.reduce(
                (n, e) =>
                  n + (e.data.inputTokens || 0) + (e.data.outputTokens || 0),
                0,
              )
            : null;
          const baselineCalls = result.baselineMode === "matched" ? turns : 1;
          const row: any = {
            taskId: task.id,
            domain: task.domain,
            repeat,
            prompt: task.prompt,
            expected: task.expected,
            grading: task.grading,
            source: task.source,
            council: {
              ...gradeAnswer(run.final, task),
              status: run.status,
              answer: run.final,
              runId: run.id,
              calls: turns,
              tokens: councilTokens,
              ms: councilMs,
            },
            baseline: {
              correct: null,
              answer: "",
              calls: 0,
              tokens: null,
              ms: 0,
              status: "pending",
              reason: "Baseline has not finished.",
            },
          };
          result.rows.push(row);
          result.progress.phase = "baseline";
          this.save(userId, result);
          signal.throwIfAborted();
          let answer = "";
          let baselineTokens: number | null = null;
          let baselineActualCalls = 0;
          let baselineError: string | undefined;
          started = Date.now();
          for (let call = 0; call < baselineCalls; call++) {
            signal.throwIfAborted();
            baselineActualCalls++;
            let output = "";
            let input: number | undefined, generated: number | undefined;
            const request = {
              messages: [
                {
                  role: "system" as const,
                  content:
                    "Solve the user task accurately. Follow the requested final-answer format. If reviewing an earlier attempt, independently verify it and correct any mistakes.",
                },
                {
                  role: "user" as const,
                  content:
                    prompt +
                    (call
                      ? "\n\nYour previous attempt (review and improve it):\n" +
                        answer
                      : ""),
                },
              ],
              maxTokens: result.config.maxOutputTokens,
              signal: AbortSignal.any([signal, AbortSignal.timeout(240_000)]),
            };
            try {
              const stream =
                baseline.transport === "bridge"
                  ? this.engine.bridge.complete(userId, baseline, request)
                  : complete(baseline, request);
              for await (const chunk of stream) {
                if (chunk.type === "text") output += chunk.text || "";
                if (chunk.type === "usage") {
                  input = chunk.input ?? input;
                  generated = chunk.output ?? generated;
                }
              }
              answer = output;
              if (input !== undefined || generated !== undefined)
                baselineTokens =
                  (baselineTokens || 0) + (input || 0) + (generated || 0);
              Object.assign(row.baseline, {
                answer,
                calls: baselineActualCalls,
                tokens: baselineTokens,
                ms: Date.now() - started,
                status: "running",
              });
              this.save(userId, result);
            } catch (error) {
              baselineError = (error as Error).message;
              break;
            }
          }
          const baselineMs = Date.now() - started;
          row.baseline = {
            ...gradeAnswer(baselineError ? "" : answer, task),
            answer,
            error: baselineError,
            calls: baselineActualCalls,
            tokens: baselineTokens,
            ms: baselineMs,
            status: baselineError ? "failed" : "completed",
          };
          this.save(userId, result);
          signal.throwIfAborted();
        }
      const count = result.rows.length;
      const correct = (side: "council" | "baseline") =>
        result.rows.filter((r) => r[side].correct).length;
      const scored = result.rows.filter((r) => r.grading !== "manual").length;
      result.summary = {
        tasks: count,
        councilCorrect: correct("council"),
        baselineCorrect: correct("baseline"),
        scoredTasks: scored,
        reviewTasks: count - scored,
        councilAccuracy: scored ? correct("council") / scored : null,
        baselineAccuracy: scored ? correct("baseline") / scored : null,
        councilMs: result.rows.reduce((n, r) => n + r.council.ms, 0),
        baselineMs: result.rows.reduce((n, r) => n + r.baseline.ms, 0),
        note: "Inspect the suite identity and sample size in this report; a small sample does not establish general capability. Compare correctness together with calls, tokens, latency, and unresolved status. No general superiority claim is justified.",
      };
      result.status = "completed";
    } catch (error) {
      result.status = controller.signal.aborted ? "cancelled" : "failed";
      result.error = (error as Error).message;
    } finally {
      signal.removeEventListener("abort", cancelCouncil);
      delete result.progress;
      for (const row of result.rows) {
        if (["pending", "running"].includes(row.baseline.status)) {
          row.baseline.status =
            result.status === "cancelled" ? "cancelled" : "failed";
          row.baseline.reason =
            "Comparison stopped before baseline evaluation finished.";
          row.baseline.error = result.error;
        }
      }
      this.save(userId, result);
      this.active.delete(result.id);
    }
  }
}
