import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { PdfType } from "@firecrawl/pdf-inspector";
import { DocumentSandboxClient, FakeOcrEngine, PdfInspectorAdapter, PdfiumPageRenderer, runSelectiveOcr, type OcrEngine, type PdfInspectorEngine } from "./index.js";

describe("PdfInspectorAdapter", () => {
  it("translates zero-based native pages into project-owned one-based pages", async () => {
    const engine: PdfInspectorEngine = {
      classify: async () => ({ pdfType: PdfType.Mixed, pageCount: 2, pagesNeedingOcr: [1], confidence: 0.7 }),
      extract: async () => ({
        pages: [
          { page: 0, markdown: "native", needsOcr: false },
          { page: 1, markdown: "", needsOcr: true, ocrReason: "no_text" },
        ],
        pagesWithTables: [1], pagesWithColumns: [], pagesNeedingOcr: [2],
        ocrReasonsByPage: [{ page: 2, reasons: ["no_text"] }], isComplex: true,
      }),
    };
    const result = await new PdfInspectorAdapter(engine).inspect(Buffer.from("fixture"));

    expect(result).toMatchObject({ pdfType: "mixed", pageCount: 2, routingSignal: 0.7 });
    expect(result.pages).toEqual([
      { pageNumber: 1, nativeMarkdown: "native", needsOcr: false, hasTable: true, hasColumns: false },
      { pageNumber: 2, nativeMarkdown: "", needsOcr: true, ocrReason: "no_text", hasTable: false, hasColumns: false },
    ]);
  });

  it("fails closed when classification and extraction disagree", async () => {
    const engine: PdfInspectorEngine = {
      classify: async () => ({ pdfType: PdfType.TextBased, pageCount: 2, pagesNeedingOcr: [], confidence: 1 }),
      extract: async () => ({ pages: [], pagesWithTables: [], pagesWithColumns: [], pagesNeedingOcr: [], ocrReasonsByPage: [], isComplex: false }),
    };
    await expect(new PdfInspectorAdapter(engine).inspect(Buffer.from("fixture")))
      .rejects.toThrow("inconsistent page counts");
  });
});

describe("PdfiumPageRenderer", () => {
  it("rejects an invalid request before loading PDFium", async () => {
    await expect(new PdfiumPageRenderer().render(Buffer.from("not a pdf"), {
      sourceSha256: "invalid", pageNumber: 0, targetDpi: 600,
      colorMode: "color", outputFormat: "png", maximumPixels: 0,
    })).rejects.toThrow("checksum");
  });
});

describe("DocumentSandboxClient", () => {
  it("runs with a credential-free environment and returns bounded artifacts", async () => {
    process.env.FINDOC_SANDBOX_SECRET_TEST = "must-not-cross-boundary";
    try {
      const entrypoint = fileURLToPath(new URL("../test-fixtures/sandbox-success.mjs", import.meta.url));
      const result = await new DocumentSandboxClient(entrypoint).inspectAndRender(Buffer.from("fixture"), "a".repeat(64), {
        timeoutMs: 5_000, maximumPages: 2, maximumPixelsPerPage: 1_000, targetDpi: 110,
      });
      expect(result.inspection.pageCount).toBe(1);
      expect(result.renders[0]).toMatchObject({ pageNumber: 1, width: 10, height: 20 });
    } finally {
      delete process.env.FINDOC_SANDBOX_SECRET_TEST;
    }
  });
});

describe("FakeOcrEngine", () => {
  it("returns explicit synthetic provenance and render-pixel geometry", async () => {
    const result = await new FakeOcrEngine().recognize({
      pageNumber: 2, languages: ["de", "en"], image: { bytes: Buffer.from("png"), width: 100, height: 200, targetDpi: 144 },
    });
    expect(result).toMatchObject({ engine: "deterministic-fake-ocr", modelAssetVersion: "synthetic-fixture-v1" });
    expect(result.spans[0]?.bbox).toEqual([0, 0, 100, 200]);
    expect(result.sourceTransform).toEqual({
      sourceCoordinateSpace: "pdf_points_top_left", scaleX: 0.5, scaleY: 0.5, translateX: 0, translateY: 0,
    });
  });

  it("runs only for pages explicitly routed to OCR", async () => {
    const calls: number[] = [];
    const engine: OcrEngine = { recognize: async (request) => {
      calls.push(request.pageNumber);
      return new FakeOcrEngine().recognize(request);
    } };
    const outputs = await runSelectiveOcr([
      { pageNumber: 1, needsOcr: false }, { pageNumber: 2, needsOcr: true },
    ], [
      { pageNumber: 1, bytes: Buffer.from("png"), width: 10, height: 10, targetDpi: 110 },
      { pageNumber: 2, bytes: Buffer.from("png"), width: 10, height: 10, targetDpi: 110 },
    ], engine);
    expect(calls).toEqual([2]);
    expect(outputs.map((output) => output.pageNumber)).toEqual([2]);
  });
});
