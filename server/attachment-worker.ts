import { extract } from "./attachment-extract.ts";
import { ATTACHMENT_MAX_BYTES } from "../shared/attachments.ts";
const chunks: Buffer[] = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > ATTACHMENT_MAX_BYTES) throw new Error("File too large.");
    chunks.push(chunk);
  }
  const result = await extract(Buffer.concat(chunks), process.argv[2]);
  // A dedicated fd keeps parser diagnostics out of the structured result.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(3, JSON.stringify(result));
} catch {
  process.exitCode = 1;
}
