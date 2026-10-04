import nodemailer from "nodemailer";
import { randomBytes, randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { tokenHash } from "./security.ts";
import type { User } from "../shared/types.ts";

export const PAYMENT_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;

export interface AccountStatus {
  emailVerified: boolean;
  accessApproved: boolean;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  paymentSatoshis: number;
  paymentEmail: string;
  lightningWallet: string;
  needsPayment: boolean;
}

export function businessEmail() {
  return process.env.BUSINESS_EMAIL || process.env.SMTP_FROM || "";
}

export function confirmationRequired() {
  return (
    process.env.EMAIL_CONFIRMATION_REQUIRED === "true" ||
    process.env.DEPLOYMENT_MODE === "hosted"
  );
}

export function freeLimit() {
  const value = Number(process.env.FREE_MESSAGE_LIMIT || 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 10;
}

export function paymentSatoshis() {
  const value = Number(process.env.PAYMENT_SATOSHIS || 100000);
  return Number.isSafeInteger(value) && value > 0 ? value : 100000;
}

export function lightningWallet() {
  return process.env.LIGHTNING_WALLET || "";
}

export function accountStatus(db: DB, userId: string): AccountStatus {
  const row = db
    .prepare(
      "SELECT email_verified,access_approved,free_messages_used FROM users WHERE id=?",
    )
    .get(userId) as
    | {
        email_verified: number;
        access_approved: number;
        free_messages_used: number;
      }
    | undefined;
  const limit = freeLimit();
  const used = Math.max(0, Number(row?.free_messages_used || 0));
  const approved = !!row?.access_approved;
  return {
    emailVerified: !!row?.email_verified,
    accessApproved: approved,
    freeLimit: limit,
    freeUsed: used,
    freeRemaining: approved ? Number.POSITIVE_INFINITY : Math.max(0, limit - used),
    paymentSatoshis: paymentSatoshis(),
    paymentEmail: businessEmail(),
    lightningWallet: lightningWallet(),
    needsPayment: !approved && used >= limit,
  };
}

export function assertCanSend(db: DB, userId: string) {
  const status = accountStatus(db, userId);
  if (status.accessApproved || status.freeUsed < status.freeLimit) return;
  throw new Error(paymentRequiredMessage(status));
}

export function recordUserMessage(db: DB, userId: string) {
  const status = accountStatus(db, userId);
  if (status.accessApproved) return accountStatus(db, userId);
  db.prepare(
    "UPDATE users SET free_messages_used=free_messages_used+1 WHERE id=?",
  ).run(userId);
  return accountStatus(db, userId);
}

export function paymentRequiredMessage(status: AccountStatus) {
  const wallet = status.lightningWallet
    ? ` to ${status.lightningWallet}`
    : " to the configured Lightning wallet";
  return `Free message limit reached (${status.freeLimit}/${status.freeLimit}). Pay ${status.paymentSatoshis.toLocaleString("en-US")} satoshis${wallet}, then upload the payment screenshot from Billing. Your account will be reviewed within 24 hours.`;
}

function smtpConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    (process.env.SMTP_FROM || process.env.BUSINESS_EMAIL)
  );
}

function transport() {
  if (!smtpConfigured())
    throw new Error(
      "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.",
    );
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendConfirmationEmail(
  db: DB,
  user: User,
  appOrigin: string,
) {
  if (!confirmationRequired()) return { required: false };
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose=?").run(
    user.id,
    "signup",
  );
  db.prepare(
    "INSERT INTO email_tokens(user_id,hash,purpose,expires,created_at) VALUES(?,?,?,?,?)",
  ).run(
    user.id,
    tokenHash(token),
    "signup",
    Date.now() + 24 * 60 * 60_000,
    new Date().toISOString(),
  );
  const url = new URL("/api/auth/confirm", appOrigin);
  url.searchParams.set("token", token);
  await transport().sendMail({
    from: process.env.SMTP_FROM || businessEmail(),
    to: user.email,
    subject: "Confirm your Council account",
    text: `Confirm your Council account by opening this link:\n\n${url.toString()}\n\nThis link expires in 24 hours.`,
    html: `<p>Confirm your Council account by opening this link:</p><p><a href="${url.toString()}">${url.toString()}</a></p><p>This link expires in 24 hours.</p>`,
  });
  return { required: true };
}

export function confirmEmailToken(db: DB, token: string) {
  const hash = tokenHash(token);
  const row = db
    .prepare("SELECT user_id,expires FROM email_tokens WHERE hash=? AND purpose=?")
    .get(hash, "signup") as { user_id: string; expires: number } | undefined;
  if (!row || row.expires < Date.now()) return null;
  db.prepare(
    "UPDATE users SET email_verified=1,confirmed_at=? WHERE id=?",
  ).run(new Date().toISOString(), row.user_id);
  db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose=?").run(
    row.user_id,
    "signup",
  );
  return row.user_id;
}

export function paymentMime(mime: string) {
  return ["image/png", "image/jpeg", "image/webp"].includes(mime);
}

export async function sendPaymentScreenshot(
  db: DB,
  user: User,
  fileName: string,
  mime: string,
  data: Buffer,
) {
  if (!paymentMime(mime))
    throw new Error("Upload a PNG, JPG, or WebP payment screenshot.");
  if (data.length > PAYMENT_SCREENSHOT_MAX_BYTES)
    throw new Error("Payment screenshot must be 8 MB or smaller.");
  const id = randomUUID();
  db.prepare(
    "INSERT INTO payment_submissions(id,user_id,file_name,mime,status,created_at,note) VALUES(?,?,?,?,?,?,?)",
  ).run(id, user.id, fileName, mime, "submitted", new Date().toISOString(), "");
  await transport().sendMail({
    from: process.env.SMTP_FROM || businessEmail(),
    to: businessEmail(),
    subject: `Council payment screenshot: ${user.email}`,
    text: [
      `Council payment screenshot submitted.`,
      `User: ${user.name} <${user.email}>`,
      `User ID: ${user.id}`,
      `Amount expected: ${paymentSatoshis()} satoshis`,
      `Submission ID: ${id}`,
      "",
      "Approve after manual verification through the admin endpoint.",
    ].join("\n"),
    attachments: [
      {
        filename: fileName,
        content: data,
        contentType: mime,
      },
    ],
  });
  return { id };
}
