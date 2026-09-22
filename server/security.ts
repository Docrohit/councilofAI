import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function vault(directory: string) {
  const file = path.join(directory, "vault.key");
  let hex = process.env.COUNCIL_ENCRYPTION_KEY;
  if (!hex && process.env.DEPLOYMENT_MODE === "hosted")
    throw new Error(
      "Hosted mode requires COUNCIL_ENCRYPTION_KEY (64 hex characters).",
    );
  if (!hex) {
    if (!existsSync(file))
      writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    hex = readFileSync(file, "utf8").trim();
  }
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("Invalid encryption key");
  const key = Buffer.from(hex, "hex");
  return {
    encrypt(text: string) {
      if (!text) return "";
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((b) => b.toString("base64"))
        .join(".");
    },
    decrypt(text: string) {
      if (!text) return "";
      const [iv, tag, content] = text
        .split(".")
        .map((s) => Buffer.from(s, "base64"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(content),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
export function validateEndpoint(
  baseUrl: string,
  hosted = process.env.DEPLOYMENT_MODE === "hosted",
) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Endpoint must not contain credentials, query strings, or fragments.",
    );
  const allowed = (
    process.env.ALLOWED_PROVIDER_ORIGINS ||
    "https://api.openai.com,https://api.anthropic.com,https://api.z.ai"
  )
    .split(",")
    .map((s) => s.trim());
  if (hosted && !allowed.includes(url.origin))
    throw new Error(
      "This server does not allow that provider origin. Use a local bridge for Ollama/vLLM.",
    );
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Endpoint must use HTTP or HTTPS.");
  if (
    url.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Remote endpoints require HTTPS.");
  return url.toString().replace(/\/$/, "");
}
