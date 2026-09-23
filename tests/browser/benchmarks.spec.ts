import { test, expect } from "@playwright/test";

test("run individual problems, read answers and keep custom proofs unscored", async ({
  page,
}, info) => {
  const config = {
    providerIds: ["model"],
    members: [
      { id: "peer", name: "Atlas", role: "Solve", providerId: "model" },
    ],
    maxAgents: 4,
    maxDepth: 2,
    concurrency: 1,
    maxCalls: 8,
    maxOutputTokens: 4096,
    maxMinutes: 2,
  };
  const tasks = [
    { id: "p1", domain: "math", prompt: "Compute 2 + 2." },
    { id: "p2", domain: "math", prompt: "Solve $x^2=4$." },
  ];
  let reports: any[] = [];
  const posts: any[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/benchmarks" &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      posts.push(body);
      const task =
        body.customTasks[0] || tasks.find((t) => t.id === body.taskIds[0]);
      const manual = !!body.customTasks.length;
      const side = {
        correct: manual ? null : true,
        status: "completed",
        answer:
          "A complete answer: $x^2=4$.\n\n```python\nassert 2 + 2 == 4\n```",
        calls: 2,
        tokens: 30,
        ms: 50,
        reason: manual ? "Requires independent proof review" : "Exact check",
      };
      const report = {
        id: `report-${posts.length}`,
        createdAt: new Date().toISOString(),
        status: "completed",
        baselineMode: body.baselineMode,
        taskIds: [task.id],
        repeats: 1,
        rows: [
          {
            taskId: task.id,
            repeat: 1,
            prompt: task.prompt,
            expected: task.expected || "4",
            council: side,
            baseline: side,
          },
        ],
        summary: {
          scoredTasks: manual ? 0 : 1,
          reviewTasks: manual ? 1 : 0,
          councilCorrect: manual ? 0 : 1,
          baselineCorrect: manual ? 0 : 1,
        },
      };
      reports = [report, ...reports];
      return route.fulfill({ json: report });
    }
    const data: Record<string, unknown> = {
      "/api/me": {
        user: { id: "reader", name: "Reader", email: "reader@example.test" },
      },
      "/api/providers": [
        {
          id: "model",
          name: "Fixture",
          model: "fixture-model",
          kind: "vllm",
          transport: "direct",
        },
      ],
      "/api/team": config,
      "/api/runs": [],
      "/api/benchmarks/suite": tasks,
      "/api/benchmarks": reports,
    };
    return route.fulfill({ json: data[url.pathname] ?? {} });
  });
  const open = async () => {
    await page.goto("/");
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Benchmarks", exact: true }).click();
  };
  await open();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Problem selection", { exact: true }),
  ).toHaveValue("one");
  await dialog.getByRole("button", { name: "Run this problem" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Council answer", exact: true }),
  ).toBeVisible();
  expect(posts[0].taskIds).toEqual(["p1"]);
  await expect(dialog.locator(".katex").first()).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Baseline answer" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Next problem" }).click();
  await expect(dialog.getByLabel("Problem", { exact: true })).toHaveValue("p2");
  await dialog
    .getByLabel("Problem selection", { exact: true })
    .selectOption("custom");
  await dialog
    .getByLabel("Problem statement")
    .fill("Prove this functional equation using BOTH conditions.");
  await dialog
    .getByLabel("Reference solution", { exact: false })
    .fill("Separate reference proof.");
  await dialog.getByRole("button", { name: "Run this problem" }).click();
  await expect(dialog.locator(".benchmark-answer").first()).toContainText(
    "Needs review",
  );
  expect(posts[1].customTasks[0].grading).toBe("manual");
  expect(posts[1].taskIds).toEqual([]);
  await dialog
    .locator(".benchmark-answer")
    .first()
    .getByText("Reference answer / solution", { exact: true })
    .click();
  await expect(
    dialog
      .locator(".benchmark-answer")
      .getByText("Separate reference proof.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("single-problem.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await open();
  await expect(page.locator(".benchmark-report")).toHaveCount(2);
});
