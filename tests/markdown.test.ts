import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMath } from "../src/markdown-math.ts";

test("math delimiters render prose while preserving fenced, inline and indented code", () => {
  const samples = [
    "```python\nprint(r'\\[x\\]')\n```",
    "~~~text\n\\(literal\\) $20 and $30\n~~~",
    "`` ` \\(literal\\) ``",
    "    print(r'\\(x\\)')",
    String.raw`Escaped \\(literal\\) and \$20.`,
  ];
  for (const sample of samples) assert.equal(normalizeMath(sample), sample);
  assert.equal(normalizeMath(String.raw`Use \(x^2\) here.`), "Use $x^2$ here.");
  assert.match(
    normalizeMath(String.raw`\[\frac{1}{2}\]`),
    /\$\$\n\\frac\{1\}\{2\}\n\$\$/,
  );
  assert.equal(
    normalizeMath(String.raw`Unfinished \(x^2`),
    String.raw`Unfinished \(x^2`,
  );
  assert.equal(normalizeMath("Pay $20 and $30."), "Pay \\$20 and \\$30.");
  assert.equal(
    normalizeMath("Compute $1 + 2$ and $x^2$."),
    "Compute $1 + 2$ and $x^2$.",
  );
});
