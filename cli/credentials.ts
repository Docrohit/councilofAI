import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
  openSync,
  closeSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { vault } from "../server/security.ts";
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
const schema = z.record(idSchema, z.string().max(40000));
function entries(directory: string): Record<string, string> {
  try {
    return schema.parse(
      JSON.parse(
        readFileSync(path.join(directory, "native-keys.json"), "utf8"),
      ),
    );
  } catch (e: any) {
    if (e.code === "ENOENT") return {};
    throw new Error(
      "Cannot read native encrypted keys. Check your Council configuration backup.",
    );
  }
}
export function hasNativeKey(directory: string, id: string) {
  return !!entries(directory)[idSchema.parse(id)];
}
export function readNativeKey(directory: string, id: string) {
  const encrypted = entries(directory)[idSchema.parse(id)];
  if (!encrypted) return "";
  try {
    if (
      !process.env.COUNCIL_ENCRYPTION_KEY &&
      !existsSync(path.join(directory, "vault.key"))
    )
      throw new Error("Missing vault");
    return vault(directory).decrypt(encrypted);
  } catch {
    throw new Error(
      "Cannot decrypt the saved connection key. Restore its matching vault.key or replace the key in /connections.",
    );
  }
}
export function saveNativeKey(directory: string, id: string, key: string) {
  idSchema.parse(id);
  if (key.length > 16000 || /[\r\n\x00]/.test(key))
    throw new Error("Enter a single API key of at most 16000 characters.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, "native-keys.lock");
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch {
    throw new Error(
      "Another Council process is saving keys. Retry; if a process crashed, inspect native-keys.lock before removing it.",
    );
  }
  const file = path.join(directory, "native-keys.json"),
    temp = file + "." + randomUUID() + ".tmp";
  try {
    const data = entries(directory);
    if (key) data[id] = vault(directory).encrypt(key);
    else delete data[id];
    writeFileSync(temp, JSON.stringify(data) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, file);
    chmodSync(file, 0o600);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
    try {
      unlinkSync(temp);
    } catch {}
  }
}
