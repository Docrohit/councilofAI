import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  ATTACHMENT_MAX_BYTES,
  type Attachment,
} from "../shared/attachments.ts";

export function attachmentName(value: string) {
  const name = value
    .normalize("NFC")
    .replace(/[/\\\u0000-\u001f\u007f]/g, "_")
    .slice(0, 180);
  const kind = name.split(".").pop()?.toLowerCase();
  if (!name || !["md", "txt", "pdf", "docx", "apk"].includes(kind || ""))
    throw new Error("Choose a .md, .txt, .pdf, .docx or .apk file.");
  return { name, kind: kind as Attachment["kind"] };
}
export async function prepareAttachment(
  buffer: Buffer,
  filename: string,
  signal?: AbortSignal,
): Promise<Attachment> {
  const { name, kind } = attachmentName(filename);
  if (!buffer.length || buffer.length > ATTACHMENT_MAX_BYTES)
    throw new Error("Files must be between 1 byte and 20 MB.");
  const result = await new Promise<{ text: string; warnings: string[] }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=384",
          "--import",
          "tsx",
          fileURLToPath(new URL("./attachment-worker.ts", import.meta.url)),
          kind,
        ],
        {
          stdio: ["pipe", "ignore", "ignore", "pipe"],
          // Do not pass provider credentials or production environment to parsers.
          env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
          cwd: fileURLToPath(new URL("..", import.meta.url)),
        },
      );
      const decoder = new StringDecoder("utf8");
      let output = "",
        oversized = false;
      const abort = () => child.kill("SIGKILL");
      const timer = setTimeout(abort, 20_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdio[3]!.on("data", (chunk) => {
        output += decoder.write(chunk);
        if (output.length > 100_000) {
          oversized = true;
          abort();
        }
      });
      child.stdin!.on("error", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new Error("File reader could not start."));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (code !== 0 || oversized)
          return reject(
            new Error(
              "Could not read this file. It may be damaged, encrypted, scanned without readable text, or exceed extraction limits.",
            ),
          );
        try {
          resolve(JSON.parse(output + decoder.end()));
        } catch {
          reject(new Error("File reader returned an invalid result."));
        }
      });
      child.stdin!.end(buffer);
    },
  );
  return {
    id: randomUUID(),
    name,
    kind,
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    ...result,
  };
}
