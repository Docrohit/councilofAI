import yauzl from "yauzl";
import mammoth from "mammoth";
import { ATTACHMENT_TEXT_LIMIT } from "../shared/attachments.ts";

// Inspect ZIP metadata and bound actual inflated bytes before any document parser.
async function archive(buffer: Buffer, apk: boolean) {
  return new Promise<{ names: string[]; manifest?: Buffer }>(
    (resolve, reject) => {
      yauzl.fromBuffer(
        buffer,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
        (error, zip) => {
          if (error || !zip) return reject(new Error("Invalid ZIP container."));
          const names: string[] = [];
          const seen = new Set<string>();
          let declared = 0,
            inflated = 0,
            manifest: Buffer | undefined;
          let failed = false;
          const fail = () => {
            if (!failed) {
              failed = true;
              zip.close();
              reject(
                new Error(
                  "Archive is invalid, encrypted or exceeds safe extraction limits.",
                ),
              );
            }
          };
          zip.on("error", fail);
          zip.on("entry", (entry: yauzl.Entry) => {
            if (failed) return;
            declared += entry.uncompressedSize;
            if (
              seen.has(entry.fileName) ||
              ++names.length > 10_000 ||
              declared > 100 * 1024 * 1024 ||
              entry.uncompressedSize > 25 * 1024 * 1024 ||
              entry.isEncrypted()
            )
              return fail();
            names[names.length - 1] = entry.fileName;
            seen.add(entry.fileName);
            // APK executable contents are never inflated or executed.
            if (
              entry.fileName.endsWith("/") ||
              (apk && entry.fileName !== "AndroidManifest.xml")
            ) {
              zip.readEntry();
              return;
            }
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) return fail();
              const chunks: Buffer[] = [];
              stream.on("error", fail);
              stream.on("data", (chunk: Buffer) => {
                inflated += chunk.length;
                if (
                  inflated > 100 * 1024 * 1024 ||
                  (apk && inflated > 2 * 1024 * 1024)
                ) {
                  stream.destroy();
                  fail();
                  return;
                }
                if (apk) chunks.push(chunk);
              });
              stream.on("end", () => {
                if (!failed) {
                  if (apk) manifest = Buffer.concat(chunks);
                  zip.readEntry();
                }
              });
            });
          });
          zip.on("end", () => {
            if (!failed) resolve({ names, manifest });
          });
          zip.readEntry();
        },
      );
    },
  );
}

// Android binary XML string pool. Report strings as clues, not decoded attributes.
function manifestStrings(bytes: Buffer) {
  if (bytes.subarray(0, 100).toString("utf8").trimStart().startsWith("<"))
    return bytes.toString("utf8").slice(0, 6000);
  const values: string[] = [];
  for (let p = 8; p + 8 <= bytes.length;) {
    const type = bytes.readUInt16LE(p),
      header = bytes.readUInt16LE(p + 2),
      size = bytes.readUInt32LE(p + 4);
    if (size < 8 || header < 8 || header > size || p + size > bytes.length)
      break;
    if (type === 1 && header >= 28) {
      const count = Math.min(bytes.readUInt32LE(p + 8), 500),
        utf8 = !!(bytes.readUInt32LE(p + 16) & 0x100),
        start = bytes.readUInt32LE(p + 20);
      for (let i = 0; i < count && p + header + i * 4 + 4 <= p + size; i++) {
        let at = p + start + bytes.readUInt32LE(p + header + i * 4);
        const length = () => {
          if (at + (utf8 ? 1 : 2) > p + size) throw new Error("length");
          let n = utf8 ? bytes[at++] : bytes.readUInt16LE(at);
          if (!utf8) at += 2;
          if (n & (utf8 ? 0x80 : 0x8000)) {
            if (at + (utf8 ? 1 : 2) > p + size) throw new Error("length");
            n = utf8
              ? ((n & 0x7f) << 8) | bytes[at++]
              : (n & 0x7fff) * 65536 + bytes.readUInt16LE(at);
            if (!utf8) at += 2;
          }
          return n;
        };
        try {
          if (utf8) length();
          const n = length() * (utf8 ? 1 : 2);
          if (n > 2000 || at + n > p + size) continue;
          const value = bytes
            .subarray(at, at + n)
            .toString(utf8 ? "utf8" : "utf16le");
          if (value) values.push(value);
        } catch {
          break;
        }
      }
      break;
    }
    p += size;
  }
  return [...new Set(values)].join("\n").slice(0, 6000);
}

export async function extract(buffer: Buffer, kind: string) {
  let text = "";
  const warnings: string[] = [];
  if (kind === "txt" || kind === "md") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw new Error("Expected UTF-8 text.");
  } else if (kind === "pdf") {
    if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("Invalid PDF.");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    });
    try {
      const result = await parser.getText({ first: 30, pageJoiner: "\n" });
      text = result.text;
      if (result.total > 30)
        warnings.push("Only the first 30 PDF pages were extracted.");
    } finally {
      await parser.destroy();
    }
    warnings.push(
      "Text extraction only: images, scanned pages and some equations may be missing. OCR is not included.",
    );
  } else {
    const report = await archive(buffer, kind === "apk");
    if (kind === "docx") {
      if (!report.names.includes("word/document.xml"))
        throw new Error("Not a DOCX document.");
      text = (await mammoth.extractRawText({ buffer })).value;
      warnings.push(
        "Text only: document images, layout and some equations are not included.",
      );
    } else if (kind === "apk") {
      if (
        !report.manifest ||
        !report.names.some(
          (n) => /^classes\d*\.dex$/.test(n) || n.startsWith("lib/"),
        )
      )
        throw new Error("Not an Android APK.");
      text = `APK static package report\nEntries: ${report.names.length}\n\nManifest strings (not a complete decoded manifest):\n${manifestStrings(report.manifest) || "No readable strings extracted."}\n\nFile inventory (first 200 entries):\n${report.names.slice(0, 200).join("\n")}`;
      warnings.push(
        "Static inventory and manifest strings only. No app execution, decompilation, signature validation or malware verdict.",
      );
      if (report.names.length > 200)
        warnings.push("File inventory limited to 200 entries.");
    } else throw new Error("Unsupported file type.");
  }
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!text)
    throw new Error(
      "No readable text found. For scanned PDFs, export an OCR text version first.",
    );
  if (text.length > ATTACHMENT_TEXT_LIMIT)
    warnings.push(
      `Extracted text limited to ${ATTACHMENT_TEXT_LIMIT.toLocaleString("en-US")} characters. Split the file for more detail.`,
    );
  return { text: text.slice(0, ATTACHMENT_TEXT_LIMIT), warnings };
}
