import test from "node:test";
import assert from "node:assert/strict";
import { factorInteger } from "../server/math.ts";
import { parseCommandBlock, parseResponse } from "../server/orchestrator.ts";

test("factor verification disproves the live session's primality claim with exact arithmetic", () => {
  const result = factorInteger("2045901");
  assert.deepEqual(
    result.factors.map((f) => f.prime),
    ["3", "11", "13", "19", "251"],
  );
  assert.equal(result.divisorCount, 32);
  assert.equal(result.productVerified, true);
  assert.equal(result.divisors.length, 32);
  assert(result.divisors.every((d) => 2045901n % BigInt(d) === 0n));
  assert.equal(factorInteger("681967").prime, false);
  assert.deepEqual(factorInteger("1").divisors, ["1"]);
  assert.equal(factorInteger("251").prime, true);
  assert.deepEqual(factorInteger("64").factors, [{ prime: "2", exponent: 6 }]);
  assert.equal(factorInteger("1000000000000").product, "1000000000000");
  for (const input of [
    "0",
    "-5",
    "1.1",
    "1e6",
    "1000000000001",
    "process.exit()",
  ])
    assert.throws(() => factorInteger(input));
});

test("work completion follows the documented protocol and malformed blocks have actionable errors", () => {
  const completed = parseCommandBlock(
    '{"work":[{"key":"factor","status":"complete","result":"32 divisors, checked"}]}',
  );
  assert.equal(completed.work?.[0].status, "complete");
  assert.throws(
    () => parseCommandBlock('{"work":[{"key":"factor","status":"claim"}]}'),
    /work.0.description/,
  );
  assert.throws(
    () => parseCommandBlock('{"work":[{"key":"factor","status":"complete"}]}'),
    /work.0.result/,
  );
  assert.throws(
    () => parseCommandBlock('{"communications":{"board":[]}}'),
    /communications/,
  );
  const latex = String.raw`{"proposal":{"answer":"\(2045901\)","rationale":"check"}}`;
  assert.throws(() => parseCommandBlock(latex), /escape literal backslashes/);
  const safe = JSON.stringify({
    proposal: { answer: String.raw`\(2045901\)`, rationale: "check" },
  });
  assert.equal(
    parseCommandBlock(safe).proposal?.answer,
    String.raw`\(2045901\)`,
  );
  const result = parseResponse(
    "```council\n" +
      latex +
      "\n```\n```council\n" +
      JSON.stringify({
        tools: [{ name: "factor_integer", integer: "2045901" }],
      }) +
      "\n```",
  );
  assert.equal(result.commands.length, 1);
  assert.match(result.error!, /Invalid JSON/);
});

test("calculator uses exact rational arithmetic and rejects executable or unbounded input", async () => {
  const { calculate } = await import("../server/math.ts");
  assert.equal(calculate("0.1 + 0.2").exact, "3/10");
  assert.equal(calculate("(37*48)-129").exact, "1647");
  assert.equal(calculate("-2^2").exact, "-4");
  assert.equal(calculate("2^3^2").exact, "512");
  assert.equal(calculate("2^-3").exact, "1/8");
  assert.equal(calculate("681967 % 11").exact, "0");
  assert.equal(calculate("1/3 + 2/3").exact, "1");
  for (const expr of [
    "process.exit()",
    "fetch('x')",
    "1/0",
    "0^0",
    "2^65",
    "2(3)",
    "NaN",
    "1e99999",
    "(".repeat(100) + "1" + ")".repeat(100),
  ])
    assert.throws(() => calculate(expr));
});

test("linear solver distinguishes unique, inconsistent and underdetermined systems and substitutes exact solutions", async () => {
  const { solveLinear } = await import("../server/math.ts");
  const unique = solveLinear(
    [
      ["2", "1"],
      ["1", "-1"],
    ],
    ["5", "1"],
  );
  assert.equal(unique.status, "unique");
  assert.deepEqual(unique.particularSolution, ["2", "1"]);
  assert(unique.verified);
  assert.deepEqual(solveLinear([["3"]], ["1"]).particularSolution, ["1/3"]);
  assert.equal(
    solveLinear(
      [
        ["1", "1"],
        ["2", "2"],
      ],
      ["1", "3"],
    ).status,
    "inconsistent",
  );
  const infinite = solveLinear(
    [
      ["1", "1"],
      ["2", "2"],
    ],
    ["1", "2"],
  );
  assert.equal(infinite.status, "infinitely_many");
  assert.deepEqual(infinite.freeVariables, [2]);
  assert(infinite.verified);
  assert.throws(() => solveLinear([["1"], ["1", "2"]], ["1", "2"]));
});
