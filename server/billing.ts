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
  freeRemaining: number | null;
  paymentSatoshis: number;
  paymentBtc: number;
  paymentUsdEstimate: number | null;
  paymentUsdSource: string;
  paymentUsdUpdatedAt: string | null;
  billingPeriodMonths: number;
  tokenBudgetMarginPercent: number;
  paymentEmail: string;
  lightningWallet: string;
  needsPayment: boolean;
}
export interface PaymentSubmission {
  id: string;
  userId: string;
  fileName: string;
  mime: string;
  status: "submitted" | "approved" | "rejected";
  createdAt: string;
  note: string;
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

export function paymentBtc() {
  return paymentSatoshis() / 100_000_000;
}

export function billingPeriodMonths() {
  const value = Number(process.env.BILLING_PERIOD_MONTHS || 3);
  return Number.isSafeInteger(value) && value > 0 ? value : 3;
}

export function tokenBudgetMarginPercent() {
  const value = Number(process.env.TOKEN_BUDGET_MARGIN_PERCENT || 25);
  return Number.isFinite(value) && value >= 0 ? value : 25;
}

export function lightningWallet() {
  return process.env.LIGHTNING_WALLET || "";
}

let btcUsdCache:
  | { usd: number; updatedAt: string; expires: number; source: string }
  | null = null;

export async function btcUsdPrice() {
  const override = Number(process.env.BTC_USD_PRICE);
  if (Number.isFinite(override) && override > 0)
    return {
      usd: override,
      updatedAt: new Date().toISOString(),
      source: "BTC_USD_PRICE",
    };
  if (btcUsdCache && btcUsdCache.expires > Date.now()) return btcUsdCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(
      "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error(`BTC price lookup failed ${response.status}`);
    const body = (await response.json()) as {
      data?: { amount?: string; currency?: string };
    };
    const usd = Number(body.data?.amount);
    if (!Number.isFinite(usd) || usd <= 0)
      throw new Error("BTC price lookup returned no USD amount");
    btcUsdCache = {
      usd,
      updatedAt: new Date().toISOString(),
      expires: Date.now() + 10 * 60_000,
      source: "Coinbase BTC-USD spot",
    };
    return btcUsdCache;
  } catch {
    return btcUsdCache;
  } finally {
    clearTimeout(timeout);
  }
}

export function billingAdminEmails() {
  return new Set(
    (
      process.env.BILLING_ADMIN_EMAILS ||
      "cosmicwisdomyt@gmail.com,rohitsharma9000@gmail.com"
    )
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBillingAdmin(email: string) {
  return billingAdminEmails().has(email.toLowerCase());
}

export function accountStatus(db: DB, userId: string): AccountStatus {
  const row = db
    .prepare(
      "SELECT email,email_verified,access_approved,free_messages_used FROM users WHERE id=?",
    )
    .get(userId) as
    | {
        email: string;
        email_verified: number;
        access_approved: number;
        free_messages_used: number;
      }
    | undefined;
  const limit = freeLimit();
  const used = Math.max(0, Number(row?.free_messages_used || 0));
  const approved = !!row?.access_approved || !!(row && isBillingAdmin(row.email));
  return {
    emailVerified: !!row?.email_verified,
    accessApproved: approved,
    freeLimit: limit,
    freeUsed: used,
    freeRemaining: approved ? null : Math.max(0, limit - used),
    paymentSatoshis: paymentSatoshis(),
    paymentBtc: paymentBtc(),
    paymentUsdEstimate: null,
    paymentUsdSource: "unavailable",
    paymentUsdUpdatedAt: null,
    billingPeriodMonths: billingPeriodMonths(),
    tokenBudgetMarginPercent: tokenBudgetMarginPercent(),
    paymentEmail: businessEmail(),
    lightningWallet: lightningWallet(),
    needsPayment: !approved && used >= limit,
  };
}

export async function accountStatusWithPricing(db: DB, userId: string) {
  const status = accountStatus(db, userId);
  const price = await btcUsdPrice();
  if (!price) return status;
  return {
    ...status,
    paymentUsdEstimate: Math.round(status.paymentBtc * price.usd * 100) / 100,
    paymentUsdSource: price.source,
    paymentUsdUpdatedAt: price.updatedAt,
  };
}

export function paymentSubmissions(db: DB, userId: string): PaymentSubmission[] {
  return (
    db
      .prepare(
        "SELECT id,user_id,file_name,mime,status,created_at,note FROM payment_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(userId) as any[]
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    mime: row.mime,
    status: row.status,
    createdAt: row.created_at,
    note: row.note,
  }));
}

export function listPaymentSubmissions(db: DB) {
  return db
    .prepare(
      `SELECT p.id,p.user_id AS userId,p.file_name AS fileName,p.mime,p.status,p.created_at AS createdAt,p.note,
              u.email,u.name,u.access_approved AS accessApproved,u.free_messages_used AS freeUsed
       FROM payment_submissions p
       JOIN users u ON u.id=p.user_id
       ORDER BY p.created_at DESC
       LIMIT 500`,
    )
    .all();
}

export function paymentImage(db: DB, id: string) {
  return db
    .prepare("SELECT mime,image FROM payment_submissions WHERE id=?")
    .get(id) as { mime: string; image: Buffer | Uint8Array | null } | undefined;
}

export function reviewPaymentSubmission(
  db: DB,
  id: string,
  status: "approved" | "rejected",
  note = "",
) {
  const row = db
    .prepare("SELECT user_id FROM payment_submissions WHERE id=?")
    .get(id) as { user_id: string } | undefined;
  if (!row) return false;
  db.prepare("UPDATE payment_submissions SET status=?,note=? WHERE id=?").run(
    status,
    note,
    id,
  );
  if (status === "approved")
    db.prepare("UPDATE users SET access_approved=1 WHERE id=?").run(row.user_id);
  return true;
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
  return `Free message limit reached (${status.freeLimit}/${status.freeLimit}). Pay ${status.paymentSatoshis.toLocaleString("en-US")} satoshis for quarterly access${wallet}, then upload the payment screenshot from Billing. Your account will be reviewed within 24 hours.`;
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

export async function sendPasswordResetEmail(
  db: DB,
  email: string,
  appOrigin: string,
) {
  const user = db
    .prepare("SELECT id,email FROM users WHERE email=?")
    .get(email.toLowerCase()) as { id: string; email: string } | undefined;
  if (!user) return { sent: false };
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose=?").run(
    user.id,
    "password-reset",
  );
  db.prepare(
    "INSERT INTO email_tokens(user_id,hash,purpose,expires,created_at) VALUES(?,?,?,?,?)",
  ).run(
    user.id,
    tokenHash(token),
    "password-reset",
    Date.now() + 60 * 60_000,
    new Date().toISOString(),
  );
  const url = new URL("/", appOrigin);
  url.searchParams.set("reset", token);
  await transport().sendMail({
    from: process.env.SMTP_FROM || businessEmail(),
    to: user.email,
    subject: "Reset your Council password",
    text: `Reset your Council password by opening this link:\n\n${url.toString()}\n\nThis link expires in 1 hour. Ignore this email if you did not request it.`,
    html: `<p>Reset your Council password by opening this link:</p><p><a href="${url.toString()}">${url.toString()}</a></p><p>This link expires in 1 hour. Ignore this email if you did not request it.</p>`,
  });
  return { sent: true };
}

export function resetPasswordToken(db: DB, token: string) {
  const hash = tokenHash(token);
  const row = db
    .prepare("SELECT user_id,expires FROM email_tokens WHERE hash=? AND purpose=?")
    .get(hash, "password-reset") as
    | { user_id: string; expires: number }
    | undefined;
  if (!row || row.expires < Date.now()) return null;
  db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose=?").run(
    row.user_id,
    "password-reset",
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
    "INSERT INTO payment_submissions(id,user_id,file_name,mime,status,created_at,note,image) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    id,
    user.id,
    fileName,
    mime,
    "submitted",
    new Date().toISOString(),
    "",
    data,
  );
  await transport().sendMail({
    from: process.env.SMTP_FROM || businessEmail(),
    to: businessEmail(),
    subject: `Council payment screenshot: ${user.email}`,
    text: [
      `Council payment screenshot submitted.`,
      `User: ${user.name} <${user.email}>`,
      `User ID: ${user.id}`,
      `Amount expected: ${paymentSatoshis()} satoshis for quarterly access`,
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
