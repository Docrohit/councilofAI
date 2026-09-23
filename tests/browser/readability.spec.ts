import { test, expect } from "@playwright/test";

const code =
  "const roots = [-2, -1, 1, 2];\nconsole.log(roots.map(x => x ** 4 - 5 * x ** 2 + 4));\n// Preserve literal delimiters: \\(x\\) and \\[y\\]\n" +
  "// A deliberately long line to check horizontal scrolling: " +
  "0123456789".repeat(16) +
  "\n";
const answer =
  String.raw`## Solving the equation

The equation \(x^4 - 5x^2 + 4 = 0\) has **four real roots**. We can find them by factoring and then verify each result.

\[
x^4 - 5x^2 + 4 = (x^2 - 1)(x^2 - 4) = 0
\]

### Step by step

1. Substitute $y = x^2$ to get a quadratic.
2. Factor $y^2 - 5y + 4 = (y-1)(y-4)$.
3. Take both signs of each square root:
   - **From 1:** the roots are $-1$ and $1$.
   - **From 4:** the roots are $-2$ and $2$.

> Check each root in the original equation before concluding.

### Verify with code

Use the **roots** array below. The snippet preserves spaces and literal LaTeX delimiters.

` +
  "```javascript\n" +
  code +
  "```\n\n" +
  String.raw`### Comparison

| Method | Result | Verification |
| --- | --- | --- |
| Factoring | Four roots | Exact algebra |
| Substitution | Zero residual | Check every root |

Budget examples: $20 and $30. These are currency amounts.

Long equation:

$$
\underbrace{x_1+x_2+x_3+x_4+x_5+x_6+x_7+x_8+x_9+x_{10}+x_{11}+x_{12}}_{\text{scroll to inspect every term}} = \sum_{i=1}^{12} x_i
$$

Unsupported notation remains visible: $\unknownCouncilCommand{x}$.

<img src="x" onerror="alert('unsafe')">

` +
  "```unregistered-language\nplain fallback\n```";

test("readable answers render equations and code without mobile overflow", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const config = {
    providerIds: ["demo"],
    members: [
      { id: "peer", name: "Atlas", role: "Verifier", providerId: "demo" },
    ],
    maxAgents: 4,
    maxDepth: 2,
    concurrency: 1,
    maxCalls: 24,
    maxOutputTokens: 4096,
    maxMinutes: 20,
  };
  const run = {
    id: "readability-fixture",
    title: "Solve and verify a polynomial",
    prompt: "Solve x^4 - 5x^2 + 4 = 0",
    config,
    createdAt: new Date().toISOString(),
    status: "completed",
    final: answer,
    demo: true,
  };
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: `id: 1\ndata: ${JSON.stringify({ id: 1, runId: run.id, type: "run.status", data: { status: "completed" } })}\n\n`,
      });
    const data: Record<string, unknown> = {
      "/api/me": {
        user: { id: "reader", name: "Reader", email: "reader@example.test" },
      },
      "/api/providers": [
        {
          id: "demo",
          name: "Demo",
          kind: "demo",
          model: "scripted-demo",
          transport: "direct",
        },
      ],
      "/api/team": config,
      "/api/runs": [run],
      [`/api/runs/${run.id}`]: { run, events: [] },
    };
    return route.fulfill({ json: data[p] ?? {} });
  });
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".session-link").first().click();
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  const panel = page.locator(".final-answer");
  await expect(
    panel.getByRole("heading", { name: "Solving the equation" }),
  ).toBeVisible();
  await expect(panel.locator(".katex-display")).toHaveCount(2);
  await expect(panel.locator(".katex-mathml math").first()).toBeAttached();
  await expect(panel.locator(".hljs-keyword").first()).toHaveText("const");
  await expect(panel.locator("ol > li")).toHaveCount(3);
  await expect(
    panel.getByText(
      "Budget examples: $20 and $30. These are currency amounts.",
    ),
  ).toBeVisible();
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(
    panel.locator("p").filter({ hasText: "Unsupported notation" }),
  ).toContainText("\\unknownCouncilCommand");
  await expect(panel.locator(".code-block").last()).toContainText(
    "plain fallback",
  );
  expect(
    await panel
      .locator(".markdown")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".transcript").evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("answer-reading.png"),
    fullPage: true,
  });
  const block = panel.locator(".code-block").first();
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator("pre")).toHaveText(code);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await block.getByRole("button", { name: "Copy code" }).click();
  await expect(block.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.screenshot({
    path: info.outputPath("answer-code.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".transcript")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  if (info.project.name === "mobile") {
    expect(
      await block
        .locator("pre")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    expect(
      await panel
        .locator(".katex-display")
        .last()
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
