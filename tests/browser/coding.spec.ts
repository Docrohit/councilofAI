import { test, expect } from "@playwright/test";
test("coding connection, real-work permission UI and tool transcript", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Coding acceptance");
  await page
    .getByLabel("Email address")
    .fill(`coding-${info.project.name}-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-password-only-1234");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Your goal" })).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: /Connections/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("opencode");
  await dialog.getByLabel("Connection name").fill("Project coder");
  await dialog.getByLabel("Model ID").fill("fixture/test");
  await expect(
    dialog.getByRole("combobox", { name: "Connection type", exact: true }),
  ).toHaveValue("bridge");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(
    dialog.getByText("Project coder", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const providers = await (await page.request.get("/api/providers")).json();
  const p = providers.find((p: any) => p.kind === "opencode");
  expect(p).toBeTruthy();
  const headers = { "X-Council-Request": "1" };
  const config = {
    providerIds: [p.id],
    members: [
      { id: "coder", name: "Coder", role: "Choose role", providerId: p.id },
    ],
    maxAgents: 4,
    maxDepth: 2,
    concurrency: 1,
    maxCalls: 4,
    maxOutputTokens: 1000,
    maxMinutes: 2,
  };
  await page.request.put("/api/team", { headers, data: config });
  await page.request.get(`/api/bridge/${p.id}/poll`);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "1 peers", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Your goal" })
    .fill("Implement square and run the tests.");
  await page
    .getByRole("button", { name: "Start council", exact: true })
    .click();
  let job: any;
  await expect
    .poll(async () => {
      job = await (await page.request.get(`/api/bridge/${p.id}/poll`)).json();
      return !!job;
    })
    .toBe(true);
  expect(job.request.context.agentId).toBe("coder");
  const send = (data: any) =>
    page.request.post(`/api/bridge/jobs/${job.id}`, { headers, data });
  await send({
    chunks: [
      {
        type: "coding",
        activity: {
          kind: "permission",
          sessionId: "s1",
          id: "permission1",
          title: "bash",
          detail: "node --test calc.test.js",
          status: "pending",
        },
      },
    ],
  });
  await expect(
    page.getByRole("button", { name: "Allow once", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(page.getByText("Response sent.", { exact: true })).toBeVisible();
  const response = await (await send({})).json();
  expect(response.replies).toEqual([
    { id: "permission1", kind: "permission", reply: "once" },
  ]);
  await send({
    acknowledged: ["permission1"],
    chunks: [
      {
        type: "coding",
        activity: {
          kind: "tool",
          sessionId: "s1",
          id: "t1",
          title: "bash",
          detail: "node --test calc.test.js\n1 passed",
          status: "completed",
        },
      },
      {
        type: "text",
        text:
          "Implemented and tested.\n```council\n" +
          JSON.stringify({
            proposal: {
              answer: "square(n) implemented; one test passed.",
              rationale: "Observed test output.",
            },
          }) +
          "\n```",
      },
    ],
    done: true,
  });
  await expect(page.locator(".run-status")).toHaveText("completed", {
    timeout: 15000,
  });
  await page
    .locator(".coding-card")
    .filter({ hasText: "1 passed" })
    .locator("summary")
    .click();
  await expect(
    page.locator(".coding-card").filter({ hasText: "1 passed" }),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("coding-tools.png"),
    fullPage: true,
  });
  // A stale approval cannot execute again, even after replay.
  const stale = await page.request.post(`/api/coding/jobs/${job.id}/reply`, {
    headers,
    data: { id: "permission1", kind: "permission", reply: "once" },
  });
  expect(stale.status()).toBe(409);
});
