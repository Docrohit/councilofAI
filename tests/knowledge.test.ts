import test from "node:test";
import assert from "node:assert/strict";
import { Knowledge } from "../server/knowledge.ts";
import { parseResponse } from "../server/orchestrator.ts";
test("established evidence is reused and investigation has a single owner", () => {
  const events: any[] = [];
  const k = new Knowledge((type, data) => events.push({ type, data }));
  const a = k.publish("a", {
    key: "stream completion",
    claim: "Completion is explicit",
    evidence: ["Observed done=true"],
  });
  const b = k.publish("b", {
    key: "STREAM COMPLETION",
    claim: "Duplicate investigation",
    evidence: ["Duplicate"],
  });
  assert.equal(a.id, b.id);
  assert.equal(b.claim, "Completion is explicit");
  assert.equal(k.findings.size, 1);
  assert.equal(
    k.claimWork("a", "check-timeout", "Check timeout").acquired,
    true,
  );
  assert.equal(
    k.claimWork("b", "check-timeout", "Repeat check").acquired,
    false,
  );
  assert.throws(() => k.finishWork("b", "check-timeout", "done"), /owner/);
  k.finishWork("a", "check-timeout", "A timeout aborts the provider.");
  assert.equal(
    k.claimWork("b", "check-timeout", "Repeat").work.result,
    "A timeout aborts the provider.",
  );
  assert(events.some((e) => e.type === "finding.reused"));
});
test("both disputants must accept the same revision, not a majority or stale evidence", () => {
  const k = new Knowledge(() => {});
  const f = k.publish("a", {
    key: "delivery",
    claim: "Instant mid-stream input",
    evidence: ["Initial assumption"],
  });
  k.challenge("b", f.id, "Prompts are fixed", "Inspect the request boundary");
  k.accept("b", f.id, 1, "Old assessment");
  assert.equal(f.state, "disputed");
  k.revise("a", f.id, "Incoming input is delivered next turn", [
    "Request body snapshots the inbox",
  ]);
  assert.throws(() => k.accept("b", f.id, 1, "Stale"), /revision changed/);
  k.accept("a", f.id, 2, "Corrected after checking boundary");
  k.accept("third-peer", f.id, 2, "A majority agrees");
  assert.equal(f.state, "disputed");
  k.accept("b", f.id, 2, "Boundary evidence resolves objection");
  assert.equal(f.state, "established");
  assert.equal(k.disputed().length, 0);
});
test("stream protocol supports several complete command blocks and ignores incomplete actions", () => {
  const result = parseResponse(
    'Finding\n```council\n{"messages":[{"to":"all","content":"Hi"}]}\n```\nMore\n```council\n{"organization":{"role":"Verifier"}}\n```',
  );
  assert.equal(result.commands.length, 2);
  assert.equal(result.text, "Finding\n\nMore");
  assert.equal(parseResponse('```council\n{"delegates":[').commands.length, 0);
  assert.match(
    parseResponse('```council\n{"delegates":"wrong"}\n```').error!,
    /Invalid/,
  );
});
import { Adaptation } from "../server/adaptation.ts";
import { gradeAnswer, benchmarkSuite } from "../server/benchmarks.ts";
test("delegation assessments require specific evidence and expire after revision", () => {
  const k = new Knowledge(() => {}),
    a = new Adaptation(() => {});
  const f = k.publish("math-peer", {
    key: "math-result",
    claim: "x is 16",
    evidence: ["Substitution yields equality."],
  });
  assert.throws(
    () =>
      a.record(
        "critic",
        {
          agentId: "math-peer",
          domain: "math",
          outcome: "success",
          findingIds: ["missing"],
          reason: "Unsupported",
        },
        (id) => k.get(id),
      ),
    /cite established/,
  );
  a.record(
    "math-peer",
    {
      agentId: "math-peer",
      domain: "math",
      outcome: "success",
      findingIds: [f.id],
      reason: "Self-praise",
    },
    (id) => k.get(id),
  );
  assert.equal(a.scores((id) => k.get(id)).length, 0);
  a.record(
    "critic",
    {
      agentId: "math-peer",
      domain: "math",
      outcome: "success",
      findingIds: [f.id],
      reason: "Checked by substitution",
    },
    (id) => k.get(id),
  );
  assert.equal(a.scores((id) => k.get(id))[0].score, 1);
  k.challenge("critic", f.id, "Recheck", "Substitute");
  assert.equal(a.scores((id) => k.get(id)).length, 0);
  k.revise("math-peer", f.id, "Different answer", ["New calculation"]);
  k.accept("math-peer", f.id, 2, "Checked");
  k.accept("critic", f.id, 2, "Checked");
  assert.equal(a.scores((id) => k.get(id)).length, 0);
});
test("benchmark grading requires the requested format and deterministic ground truth", () => {
  assert.equal(
    gradeAnswer("FINAL_ANSWER: 1647", benchmarkSuite[0]).correct,
    true,
  );
  assert.equal(
    gradeAnswer("The answer may be 1647", benchmarkSuite[0]).correct,
    false,
  );
  assert.equal(
    gradeAnswer("FINAL_ANSWER: 1648", benchmarkSuite[0]).correct,
    false,
  );
  assert.equal(
    gradeAnswer("FINAL_ANSWER: 0.1388888888888889", benchmarkSuite[1]).correct,
    true,
  );
  assert.equal(
    gradeAnswer("FINAL_ANSWER: yes", benchmarkSuite[4]).correct,
    false,
  );
});
