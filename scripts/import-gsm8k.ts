import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const revision = "3101c7d5072418e28b9008a6636bde82a006892c";
const base = `https://raw.githubusercontent.com/openai/grade-school-math/${revision}`;
const count = Number(process.argv[2] || 50);
const seed = process.argv[3] || "council-pilot-v1";
if (!Number.isInteger(count) || count < 1 || count > 1319)
  throw new Error("Choose 1–1319 test questions.");
const [dataResponse, licenseResponse] = await Promise.all([
  fetch(base + "/grade_school_math/data/test.jsonl"),
  fetch(base + "/LICENSE"),
]);
if (!dataResponse.ok || !licenseResponse.ok)
  throw new Error("Could not download the pinned official GSM8K files.");
const raw = await dataResponse.text();
const license = await licenseResponse.text();
const records = raw
  .trim()
  .split("\n")
  .map((line, index) => ({ ...JSON.parse(line), index }));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const tasks = records
  .sort((a, b) =>
    hash(seed + ":" + a.index).localeCompare(hash(seed + ":" + b.index)),
  )
  .slice(0, count)
  .map((row) => {
    const expected = row.answer.split("####").at(-1).trim().replace(/,/g, "");
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(expected))
      throw new Error(`Unsupported expected answer at index ${row.index}`);
    return {
      id: `gsm8k-test-${row.index}`,
      domain: "math",
      prompt: row.question,
      expected,
      numeric: true,
    };
  });
const output = path.resolve(".council/benchmarks");
mkdirSync(output, { recursive: true, mode: 0o700 });
const file = path.join(output, `gsm8k-${count}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      name: `GSM8K test sample (${count})`,
      source: "https://github.com/openai/grade-school-math",
      revision,
      seed,
      sourceSha256: hash(raw),
      tasks,
    },
    null,
    2,
  ),
);
writeFileSync(path.join(output, "GSM8K-LICENSE"), license);
console.log(
  `Prepared ${tasks.length} deterministic test questions at ${file}. No model calls were made.\nSet BENCHMARK_SUITE_PATH=${file} and restart Council to use this suite.`,
);
