// Small generated documents: no private user files or external fixtures.
export function zip(entries: Record<string, Buffer | string>) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const data = Buffer.from(value),
      filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(filename.length, 26);
    local.push(h, filename, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, filename);
    offset += h.length + filename.length + data.length;
  }
  const index = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
export const docx = () =>
  zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Council document evidence 42</w:t></w:r></w:p></w:body></w:document>',
  });
export function pdf() {
  const stream = "BT /F1 12 Tf 50 750 Td (Council PDF evidence 42) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const at = Buffer.byteLength(out);
  out +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`;
  return Buffer.from(out);
}

export function binaryManifest(values: string[]) {
  const strings = values.map((value) => {
    const b = Buffer.from(value);
    return Buffer.concat([
      Buffer.from([value.length, b.length]),
      b,
      Buffer.from([0]),
    ]);
  });
  const header = Buffer.alloc(28),
    index = Buffer.alloc(values.length * 4);
  let at = 0;
  strings.forEach((b, i) => {
    index.writeUInt32LE(at, i * 4);
    at += b.length;
  });
  const size = 28 + index.length + at;
  header.writeUInt16LE(1, 0);
  header.writeUInt16LE(28, 2);
  header.writeUInt32LE(size, 4);
  header.writeUInt32LE(values.length, 8);
  header.writeUInt32LE(0x100, 16);
  header.writeUInt32LE(28 + index.length, 20);
  const xml = Buffer.alloc(8);
  xml.writeUInt16LE(3, 0);
  xml.writeUInt16LE(8, 2);
  xml.writeUInt32LE(size + 8, 4);
  return Buffer.concat([xml, header, index, ...strings]);
}
