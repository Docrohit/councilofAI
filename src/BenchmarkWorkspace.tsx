import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "./api";
import { Markdown } from "./Markdown";
import type { Provider, RunConfig } from "../shared/types";

const score = (side: any) =>
  side.status === "pending" || side.status === "running"
    ? "Pending"
    : side.error
      ? "Failed"
      : side.correct === null || side.correct === undefined
        ? "Needs review"
        : side.correct
          ? "Correct"
          : "Incorrect";

export function BenchmarkWorkspace({
  providers,
  config,
}: {
  providers: Provider[];
  config: RunConfig;
}) {
  const real = providers.filter(
    (p) => p.kind !== "demo" && p.kind !== "opencode",
  );
  const [suite, setSuite] = useState<any[]>([]),
    [results, setResults] = useState<any[]>([]);
  const [baseline, setBaseline] = useState(real[0]?.id || ""),
    [mode, setMode] = useState("single");
  const [selection, setSelection] = useState("one"),
    [problem, setProblem] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [repeats, setRepeats] = useState(1);
  const [prompt, setPrompt] = useState(""),
    [reference, setReference] = useState("");
  const [grading, setGrading] = useState("manual"),
    [source, setSource] = useState("");
  const [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  useEffect(() => {
    let disposed = false;
    api("/benchmarks/suite")
      .then((s) => {
        if (disposed) return;
        setSuite(s);
        setProblem(s[0]?.id || "");
        setSelected(s.slice(0, 3).map((t: any) => t.id));
      })
      .catch((e) => !disposed && setError(e.message));
    // Schedule the next poll only when the preceding request finishes.
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const reports = await api("/benchmarks");
        if (!disposed) setResults(reports);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  const active = sending || results.some((r) => r.status === "running");
  const teamReady =
    config.providerIds.length > 0 &&
    config.providerIds.every((id) => real.some((p) => p.id === id));
  const taskIds =
    selection === "one"
      ? [problem].filter(Boolean)
      : selection === "batch"
        ? selected
        : [];
  const taskCount = selection === "custom" ? 1 : taskIds.length;
  const valid =
    selection === "custom"
      ? !!prompt.trim() && (grading === "manual" || !!reference.trim())
      : taskCount > 0 && taskCount <= 10;
  async function start() {
    setSending(true);
    setError("");
    try {
      const report = await api("/benchmarks", "POST", {
        config,
        baselineProviderId: baseline,
        baselineMode: mode,
        repeats,
        taskIds,
        customTasks:
          selection === "custom"
            ? [
                {
                  id: `custom-${crypto.randomUUID()}`,
                  domain: "custom",
                  prompt,
                  expected: reference,
                  grading: grading === "manual" ? "manual" : "automatic",
                  numeric: grading === "numeric",
                  source,
                },
              ]
            : [],
      });
      setResults((old) => [report, ...old.filter((r) => r.id !== report.id)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function download(report: any) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `council-benchmark-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="benchmark-workspace">
      <p className="modal-intro">
        Run one problem, inspect both answers, then choose the next. Each trial
        starts fresh. Built-in problems are smoke tests; custom proofs require
        independent review. Research and project tools are disabled for both
        sides.
      </p>
      <div className="form-grid">
        <label>
          Problem selection
          <select
            aria-label="Problem selection"
            value={selection}
            disabled={active}
            onChange={(e) => setSelection(e.target.value)}
          >
            <option value="one">One problem at a time</option>
            <option value="custom">Paste a custom problem</option>
            <option value="batch">Batch comparison</option>
          </select>
        </label>
        <label>
          Baseline model
          <select
            value={baseline}
            disabled={active}
            onChange={(e) => setBaseline(e.target.value)}
          >
            <option value="" disabled>
              Select a real connection
            </option>
            {real.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Comparison mode
          <select
            value={mode}
            disabled={active}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="single">One call vs. Council</option>
            <option value="matched">
              Same call count, single-model refinement
            </option>
          </select>
        </label>
        <label>
          Trials per problem
          <input
            type="number"
            min={1}
            max={3}
            value={repeats}
            disabled={active}
            onChange={(e) => setRepeats(Number(e.target.value))}
          />
        </label>
      </div>
      {selection === "one" && (
        <div className="benchmark-problem">
          <label>
            Problem
            <select
              aria-label="Problem"
              value={problem}
              disabled={active}
              onChange={(e) => setProblem(e.target.value)}
            >
              {suite.map((t, i) => (
                <option key={t.id} value={t.id}>
                  {i + 1}. {t.id} · {t.domain}
                </option>
              ))}
            </select>
          </label>
          <Markdown>
            {suite.find((t) => t.id === problem)?.prompt || "Loading problems…"}
          </Markdown>
          <button
            className="quiet-button"
            disabled={
              active ||
              suite.findIndex((t) => t.id === problem) >= suite.length - 1
            }
            onClick={() =>
              setProblem(
                suite[suite.findIndex((t) => t.id === problem) + 1]?.id ||
                  problem,
              )
            }
          >
            Next problem
          </button>
        </div>
      )}
      {selection === "batch" && (
        <div className="benchmark-tasks">
          {suite.map((t) => (
            <label className="checkbox-label" key={t.id}>
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                disabled={active}
                onChange={() =>
                  setSelected((old) =>
                    old.includes(t.id)
                      ? old.filter((id) => id !== t.id)
                      : [...old, t.id],
                  )
                }
              />
              {t.id}
              <span className="tiny-tag">{t.domain}</span>
            </label>
          ))}
        </div>
      )}
      {selection === "custom" && (
        <div className="benchmark-custom">
          <label>
            Problem statement
            <textarea
              rows={7}
              maxLength={18000}
              value={prompt}
              disabled={active}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Paste the complete problem, including every condition."
            />
          </label>
          <label>
            Grading
            <select
              value={grading}
              disabled={active}
              onChange={(e) => setGrading(e.target.value)}
            >
              <option value="manual">Proof / independent review</option>
              <option value="exact">Exact final-answer match</option>
              <option value="numeric">Numeric final-answer check</option>
            </select>
          </label>
          <label>
            {grading === "manual"
              ? "Reference solution (optional, never sent to solvers)"
              : "Expected final answer (never sent to solvers)"}
            <textarea
              rows={4}
              maxLength={18000}
              value={reference}
              disabled={active}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            Source / citation (optional)
            <input
              maxLength={1000}
              value={source}
              disabled={active}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <p className="field-help">
            An exact or numeric answer match checks the final value only. It
            does not validate a proof.
          </p>
        </div>
      )}
      <p className="field-help">
        Council: {config.members.length} starting agents,{" "}
        {config.providerIds.length} connections. Up to{" "}
        {taskCount *
          repeats *
          (config.maxCalls * (mode === "matched" ? 2 : 1) +
            (mode === "single" ? 1 : 0))}{" "}
        model calls. Uses real provider capacity and may incur charges. Equal
        call counts do not mean equal tokens or cost.
      </p>
      {!teamReady && (
        <div className="notice">
          Configure your team with real model connections first. Scripted demos
          and OpenCode workers are excluded.
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={
            !teamReady ||
            !baseline ||
            !valid ||
            active ||
            !Number.isInteger(repeats) ||
            repeats < 1 ||
            repeats > 3
          }
          onClick={start}
        >
          {sending
            ? "Starting…"
            : selection === "batch"
              ? "Run comparison"
              : "Run this problem"}
        </button>
      </div>
      <h3>Saved results</h3>
      {!results.length && (
        <p className="field-help">
          Your answers and comparison details will appear here and remain
          available after reloading.
        </p>
      )}
      {results.map((r) => (
        <section className="benchmark-report" key={r.id}>
          <header>
            <b>{new Date(r.createdAt).toLocaleString()}</b>
            <span className="tiny-tag">{r.status}</span>
            <button
              className="icon-button"
              aria-label="Download benchmark report"
              onClick={() => download(r)}
            >
              <Download size={15} />
            </button>
            {r.status === "running" && (
              <button
                className="quiet-button"
                onClick={() =>
                  api(`/benchmarks/${r.id}/cancel`, "POST").catch((e) =>
                    setError(e.message),
                  )
                }
              >
                Stop
              </button>
            )}
          </header>
          <p>
            {
              r.rows.filter(
                (row: any) =>
                  row.baseline.status !== "pending" &&
                  row.baseline.status !== "running",
              ).length
            }{" "}
            / {r.taskIds.length * r.repeats} trials finished ·{" "}
            {r.baselineMode === "matched"
              ? "Matched call count"
              : "Single-call baseline"}
          </p>
          {r.progress && (
            <p role="status">
              {r.progress.taskId} · trial {r.progress.repeat}:{" "}
              {r.progress.phase === "council"
                ? "Council working"
                : "Baseline working"}
            </p>
          )}
          {r.models && (
            <p>
              Baseline: {r.models.baseline.model} · Council:{" "}
              {r.models.council.map((p: any) => p.model).join(", ")}
            </p>
          )}
          {r.summary && (
            <p>
              Automatically scored: {r.summary.scoredTasks ?? r.summary.tasks} ·
              Council correct: {r.summary.councilCorrect} · Baseline correct:{" "}
              {r.summary.baselineCorrect}
              {r.summary.reviewTasks
                ? ` · ${r.summary.reviewTasks} require proof review`
                : ""}
            </p>
          )}
          {r.rows.map((row: any, i: number) => (
            <details
              className="benchmark-answer"
              key={`${row.taskId}-${row.repeat}`}
              open={r.taskIds.length === 1}
            >
              <summary>
                {row.taskId} · trial {row.repeat} — Council:{" "}
                {score(row.council)}; baseline: {score(row.baseline)}
              </summary>
              {row.prompt && (
                <>
                  <h4>Problem</h4>
                  <Markdown>{row.prompt}</Markdown>
                </>
              )}
              <div className="benchmark-answers">
                {["council", "baseline"].map((side) => (
                  <article key={side}>
                    <h4>
                      {side === "council"
                        ? "Council answer"
                        : "Baseline answer"}
                    </h4>
                    <p className="field-help">
                      {score(row[side])} · {row[side].status || "finished"} ·{" "}
                      {row[side].calls} calls ·{" "}
                      {(row[side].ms / 1000).toFixed(1)}s ·{" "}
                      {row[side].tokens ?? "unknown"} tokens
                    </p>
                    <Markdown>
                      {row[side].answer || "No answer recorded yet."}
                    </Markdown>
                    <p className="field-help">{row[side].reason}</p>
                    {row[side].error && (
                      <div className="error">{row[side].error}</div>
                    )}
                  </article>
                ))}
              </div>
              {row.expected && (
                <details>
                  <summary>Reference answer / solution</summary>
                  <Markdown>{row.expected}</Markdown>
                </details>
              )}
              {row.source && <p className="field-help">Source: {row.source}</p>}
            </details>
          ))}
          {r.error && <div className="error">{r.error}</div>}
        </section>
      ))}
    </div>
  );
}
