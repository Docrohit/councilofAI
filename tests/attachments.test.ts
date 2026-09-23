import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { prepareAttachment } from "../server/attachments.ts";
import { extract } from "../server/attachment-extract.ts";
import { attachmentContext } from "../shared/attachments.ts";
import { binaryManifest, docx, pdf, zip } from "./attachment-fixtures.ts";

test("actual worker preserves Unicode when pipe chunks split UTF-8 characters", async () => {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = ((...args: any[]) => {
    const child = (originalSpawn as any)(...args);
    const pipe = child.stdio[3];
    if (pipe) {
      const originalEmit = pipe.emit;
      pipe.emit = function (name: string, ...values: any[]) {
        if (name === "data" && Buffer.isBuffer(values[0])) {
          // Pipe writes need not be delivered at UTF-8 character boundaries.
          for (const byte of values[0])
            originalEmit.call(this, "data", Buffer.from([byte]));
          return true;
        }
        return originalEmit.call(this, name, ...values);
      };
    }
    return child;
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  try {
    const text = "संस्कृत 😀 — Ελληνικά 中文";
    const item = await prepareAttachment(Buffer.from(text), "unicode.md");
    assert.equal(item.text, text);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test("worker extracts Markdown, DOCX, PDF and APK reports for any text model", async () => {
  const md = await prepareAttachment(
    Buffer.from("# Evidence\nAnswer = 42"),
    "notes.md",
  );
  assert.equal(md.text, "# Evidence\nAnswer = 42");
  assert.equal(md.sha256.length, 64);
  assert.match(attachmentContext([md]), /untrusted source material/);
  const word = await prepareAttachment(docx(), "report.docx");
  assert.match(word.text, /Council document evidence 42/);
  const document = await prepareAttachment(pdf(), "report.pdf");
  assert.match(document.text, /Council PDF evidence 42/);
  assert.match(document.warnings.join(" "), /OCR is not included/);
  const apk = await prepareAttachment(
    zip({
      "AndroidManifest.xml":
        '<manifest package="example.test"><uses-permission android:name="android.permission.INTERNET"/></manifest>',
      "classes.dex": "fixture, never executed",
      "assets/notes.txt": "notes",
    }),
    "example.apk",
  );
  assert.match(apk.text, /android.permission.INTERNET/);
  assert.match(apk.text, /classes.dex/);
  assert.match(apk.warnings.join(" "), /No app execution/);
});
test("bounded parsing rejects wrong types, invalid archives and misleading text; truncation is explicit", async () => {
  await assert.rejects(
    prepareAttachment(Buffer.from("x"), "script.exe"),
    /Choose/,
  );
  await assert.rejects(
    prepareAttachment(Buffer.alloc(0), "empty.md"),
    /between/,
  );
  await assert.rejects(
    prepareAttachment(Buffer.from("not pdf"), "wrong.pdf"),
    /Could not read/,
  );
  await assert.rejects(extract(Buffer.from([0xff, 0xfe]), "md"));
  await assert.rejects(
    extract(zip({ "../escape": "no", "word/document.xml": "x" }), "docx"),
  );
  await assert.rejects(extract(zip({ "notes.txt": "no" }), "apk"));
  const bomb = zip({ "word/document.xml": "x" });
  const central = bomb.indexOf(Buffer.from("504b0102", "hex"));
  bomb.writeUInt32LE(200 * 1024 * 1024, central + 24);
  await assert.rejects(extract(bomb, "docx"), /limits/);
  const long = await extract(Buffer.from("x".repeat(13000)), "txt");
  assert.equal(long.text.length, 12000);
  assert.match(long.warnings.join(), /limited/);
});
test("aborted file readers terminate without returning content", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(prepareAttachment(docx(), "test.docx", ctrl.signal));
});

test("APK binary manifest strings are decoded as evidence without claiming attributes", async () => {
  const report = await prepareAttachment(
    zip({
      "AndroidManifest.xml": binaryManifest([
        "example.test",
        "android.permission.INTERNET",
        "नमस्ते",
      ]),
      "classes.dex": "fixture",
    }),
    "binary.apk",
  );
  assert.match(report.text, /android.permission.INTERNET/);
  assert.match(report.text, /नमस्ते/);
  assert.match(report.text, /not a complete decoded manifest/);
});
