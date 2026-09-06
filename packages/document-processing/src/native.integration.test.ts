import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FakeOcrEngine, PdfInspectorAdapter, PdfiumPageRenderer, runSelectiveOcr } from "./index.js";

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

describe("selective OCR path", () => {
  it("routes an image-only synthetic PDF page and preserves source-coordinate transform", async () => {
    const source = await createSyntheticScannedPdf();
    const inspection = await new PdfInspectorAdapter().inspect(source);
    const render = await new PdfiumPageRenderer().render(source, {
      sourceSha256: createHash("sha256").update(source).digest("hex"), pageNumber: 1, targetDpi: 144,
      colorMode: "color", outputFormat: "png", maximumPixels: 4_000_000,
    });
    const outputs = await runSelectiveOcr(inspection.pages, [{ pageNumber: 1, ...render }], new FakeOcrEngine());

    expect(inspection.pages[0]?.needsOcr).toBe(true);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.result).toMatchObject({
      engine: "deterministic-fake-ocr",
      sourceTransform: { sourceCoordinateSpace: "pdf_points_top_left", scaleX: 0.5, scaleY: 0.5 },
    });
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

async function createSyntheticScannedPdf(): Promise<Buffer> {
  const image = await sharp(Buffer.from(
    '<svg width="612" height="792" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="72" y="120" font-size="28" fill="black">SYNTHETIC DEMO</text><text x="72" y="170" font-size="20" fill="black">Scanned page fixture</text></svg>',
  )).jpeg().toBuffer();
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 612 /Height 792 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`), image, Buffer.from("\nendstream")]),
    Buffer.from("<< /Length 31 >>\nstream\nq 612 0 0 792 0 0 cm /Im1 Do Q\nendstream"),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).byteLength);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  });
  const xrefOffset = Buffer.concat(chunks).byteLength;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  chunks.push(Buffer.from(offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
