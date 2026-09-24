import { test, expect } from "@playwright/test";
import { docx, pdf, zip } from "../attachment-fixtures";
test("main composer uploads, previews, removes and persists attachments", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Attachment reader");
  await page
    .getByLabel("Email address")
    .fill(`files-${info.project.name}-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-password-1234");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "remove.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Remove before sending"),
  });
  await expect(
    page.getByRole("button", { name: "Remove remove.md" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove remove.md" }).click();
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await page.getByLabel("Choose attachments").setInputFiles([
    {
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# User evidence\nShared value = 42"),
    },
    {
      name: "report.docx",
      mimeType: "application/octet-stream",
      buffer: docx(),
    },
    { name: "report.pdf", mimeType: "application/pdf", buffer: pdf() },
    {
      name: "app.apk",
      mimeType: "application/octet-stream",
      buffer: zip({
        "AndroidManifest.xml": '<manifest package="example.test"/>',
        "classes.dex": "fixture",
      }),
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Remove app.apk" }),
  ).toBeEnabled({ timeout: 30000 });
  const preview = page
    .locator(".attachment-item")
    .filter({ hasText: "report.pdf" });
  await preview.locator("summary").click();
  await expect(preview.locator("pre")).toContainText("Council PDF evidence 42");
  await expect(preview).toContainText("OCR is not included");
  await page
    .getByLabel("Your goal")
    .fill("Compare these documents using their extracted evidence.");
  await page.screenshot({
    path: info.outputPath("composer-attachments.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Start council", exact: true })
    .click();
  await expect(page.locator(".run-status")).toHaveText("completed", {
    timeout: 40000,
  });
  await expect(
    page.locator(".run-attachments .attachment-preview"),
  ).toHaveCount(4);
  await page.reload();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".session-link").first().click();
  await expect(
    page.locator(".run-attachments .attachment-preview"),
  ).toHaveCount(4);
  await page
    .locator(".run-attachments")
    .getByText("notes.md", { exact: false })
    .click();
  await expect(page.locator(".run-attachments")).toContainText(
    "Shared value = 42",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Choose attachments").setInputFiles({
    name: "extra.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Too many"),
  });
  await expect(page.getByRole("alert")).toContainText("Up to four files");
  // A fresh greeting must complete without starting the configured peers.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("Your goal").fill("hello");
  await page
    .getByRole("button", { name: "Start council", exact: true })
    .click();
  await expect(page.locator(".final-answer")).toContainText(
    "Hello! What would you like to work on?",
  );
  await expect(page.locator(".run-status")).toHaveText("completed");
});
