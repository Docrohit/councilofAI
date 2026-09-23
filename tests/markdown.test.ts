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

test("overescaped model math renders without rewriting code or TeX row breaks", () => {
  assert.equal(
    normalizeMath(
      String.raw`The zeros of \\( \zeta(s) \\) have real part \\( \frac{1}{2} \\).`,
    ),
    String.raw`The zeros of $ \zeta(s) $ have real part $ \frac{1}{2} $.`,
  );
  assert.equal(
    normalizeMath(String.raw`\\( \\zeta(s) = \\frac{1}{2} \\)`),
    String.raw`$ \zeta(s) = \frac{1}{2} $`,
  );
  assert.equal(normalizeMath(String.raw`\\(x^2\\)`), "$x^2$");
  assert.equal(
    normalizeMath(String.raw`Unfinished \\(\zeta(s)`),
    String.raw`Unfinished \\(\zeta(s)`,
  );
  const aligned = String.raw`\\[\begin{aligned}x &= 1 \\ y &= 2\end{aligned}\\]`;
  assert.match(normalizeMath(aligned), /x &= 1 \\\\ y &= 2/);
  const code = "```tex\n" + String.raw`\\(\\frac{1}{2}\\)` + "\n```";
  assert.equal(normalizeMath(code), code);
  const inline = "`" + String.raw`\\(x^2\\)` + "`";
  assert.equal(normalizeMath(inline), inline);
});

test("doubled delimiters preserve TeX row breaks before multi-letter variables", () => {
  const body = String.raw`\begin{aligned}ab &= 1\\cd &= 2\end{aligned}`;
  assert.equal(
    normalizeMath(String.raw`\\[` + body + String.raw`\\]`),
    "\n\n$$\n" + body + "\n$$\n\n",
  );
});

test("model escape repair preserves bare row breaks and decodes complete escape layers", () => {
  const bare = String.raw`ab = 1\\cd = 2`;
  assert.equal(
    normalizeMath(String.raw`\\[` + bare + String.raw`\\]`),
    "\n\n$$\n" + bare + "\n$$\n\n",
  );
  const escaped = String.raw`\\begin{aligned}ab &= 1\\\\cd &= 2\\end{aligned}`;
  const decoded = String.raw`\begin{aligned}ab &= 1\\cd &= 2\end{aligned}`;
  assert.equal(
    normalizeMath(String.raw`\\[` + escaped + String.raw`\\]`),
    "\n\n$$\n" + decoded + "\n$$\n\n",
  );
});
