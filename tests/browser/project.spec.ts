import { test, expect } from "@playwright/test";
test("hosted editor saves, runs commands, protects conflicts and enables agent tools", async ({
  page,
}, info) => {
  let active = false;
  const files = new Map<string, { content: string; sha: string }>();
  const calls: any[] = [];
  await page.route("**/api/sandbox", async (route) => {
    const body =
      route.request().method() === "GET"
        ? { action: "status" }
        : route.request().postDataJSON();
    calls.push(body);
    let result: any = {};
    let status = 200;
    if (body.action === "status") result = { available: true, active };
    else if (body.action === "create") {
      active = true;
      result = { active };
    } else if (body.action === "tree")
      result = {
        files: [...files].map(([path, f]) => ({
          path,
          size: f.content.length,
        })),
      };
    else if (body.action === "read")
      result = {
        path: body.path,
        ...(files.get(body.path) || { content: "", sha: null }),
      };
    else if (body.action === "write") {
      if ((files.get(body.path)?.sha || null) !== body.sha) {
        status = 400;
        result = {
          error: "File changed since it was read. Reload before saving.",
        };
      } else {
        const f = { content: body.content, sha: "revision-" + calls.length };
        files.set(body.path, f);
        result = { path: body.path, ...f };
      }
    } else if (body.action === "exec")
      result = { stdout: "# tests 1\n# pass 1\n", stderr: "", exitCode: 0 };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Coding test");
  await page
    .getByLabel("Email address")
    .fill(`code-${info.project.name}-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-123456");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Your goal" })).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Coding project", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create isolated project" }).click();
  await dialog.getByLabel("Project file path").fill("math.test.js");
  await dialog
    .getByLabel("Project code editor")
    .fill(
      "require('node:test')('addition',()=>require('node:assert/strict').equal(2+2,4));",
    );
  await dialog.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "math.test.js", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Terminal command").fill("node --test");
  await dialog
    .getByRole("button", { name: "Run command", exact: true })
    .click();
  await expect(dialog.getByLabel("Terminal output")).toContainText("# pass 1");
  await dialog.getByLabel("Allow agents to edit").check();
  await expect(dialog.getByLabel("Allow agents to edit")).toBeChecked();
  files.get("math.test.js")!.sha = "another-agent-change";
  await dialog.getByLabel("Project code editor").fill("changed");
  await dialog.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("File changed");
  await dialog.getByRole("button", { name: "Discard edits" }).click();
  await page.screenshot({
    path: info.outputPath("coding-project.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close project" }).click();
  expect(
    calls.some((c) => c.action === "exec" && c.command === "node --test"),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
