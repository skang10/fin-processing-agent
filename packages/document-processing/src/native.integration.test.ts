import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PdfInspectorAdapter, PdfiumPageRenderer } from "./index.js";

describe("PDF Inspector native module", () => {
  it("classifies and extracts a one-page synthetic text PDF", async () => {
    const result = await new PdfInspectorAdapter().inspect(createSyntheticPdf());
    expect(result).toMatchObject({
      processor: "firecrawl/pdf-inspector",
      processorVersion: "1.17.0",
      pageCount: 1,
      pdfType: "text_based",
    });
    expect(result.pages[0]?.nativeMarkdown).toContain("Synthetic demo");
  });
});

describe("PDFium renderer", () => {
  it("renders one bounded synthetic page as PNG", async () => {
    const source = createSyntheticPdf();
    const result = await new PdfiumPageRenderer().render(source, {
      sourceSha256: createHash("sha256").update(source).digest("hex"), pageNumber: 1, targetDpi: 96,
      colorMode: "color", outputFormat: "png", maximumPixels: 2_000_000,
    });
    expect(result).toMatchObject({ width: 816, height: 1056, targetDpi: 96, outputFormat: "png" });
    expect(result.bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});

function createSyntheticPdf(): Buffer {
  const lines = Array.from({ length: 20 }, (_, index) =>
    `BT /F1 12 Tf 72 ${740 - index * 24} Td (Synthetic demo document line ${index + 1}) Tj ET`,
  ).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(lines)} >>\nstream\n${lines}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}
