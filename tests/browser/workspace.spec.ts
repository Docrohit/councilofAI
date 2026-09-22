import { test, expect } from "@playwright/test";
test("signup, responsive workspace, one model with five peers, resolved finding and conclusion", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Preview workspace");
  await page
    .getByLabel("Email address")
    .fill(`preview-${info.project.name}-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("preview-only-password-1234");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Your goal" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Configure team", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Starting agent count").fill("5");
  await dialog.getByLabel(/Free delegation/).check();
  await expect(
    dialog.getByText("1 model connections · 5 independent agents"),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("team-settings.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save team" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Your goal" })
    .fill("Establish shared evidence and resolve a disagreement as a team.");
  await page.getByRole("button", { name: "Start council" }).click();
  await expect(page.locator(".run-status")).toHaveText("completed", {
    timeout: 40_000,
  });
  await page.getByRole("button", { name: /Findings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Build on what is already known." }),
  ).toBeVisible();
  await expect(page.locator(".finding-card")).toContainText("revision 2");
  await expect(page.locator(".finding-card")).toContainText(
    "AGENT-ESTABLISHED",
  );
  await page.getByText("Disagreement & recheck", { exact: true }).click();
  await expect(page.locator(".finding-acceptances")).toContainText("✓ Atlas");
  await expect(page.locator(".finding-acceptances")).toContainText("✓ Sage");
  await page.screenshot({
    path: info.outputPath("findings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  await expect(page.locator(".final-answer")).toContainText(
    "scripted demonstration",
  );
  await page.screenshot({
    path: info.outputPath("answer.png"),
    fullPage: true,
  });
  await page.reload();
  // Session history survives reload; opening it replays the saved transcript.
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".session-link").first().click();
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  await expect(page.locator(".final-answer")).toContainText(
    "scripted demonstration",
  );
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noOverflow).toBe(true);
  expect(errors).toEqual([]);
});
