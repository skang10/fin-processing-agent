import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { PageContentSource, PdfType } from "@firecrawl/pdf-inspector";
import { DocumentSandboxClient, FakeOcrEngine, PdfInspectorAdapter, PdfInspectorOcrAdapter, PdfiumPageRenderer, classifySyntheticDemoPages, groupLogicalDocuments, runSelectiveOcr, type BoundaryPrediction, type OcrEngine, type PageClassification, type PdfInspectorEngine } from "./index.js";

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
        timeoutMs: 5_000, maximumPages: 2, maximumPixelsPerPage: 1_000, targetDpi: 110, ocrMode: "fake",
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

describe("PdfInspectorOcrAdapter", () => {
  it("maps the pinned offline OCR result without exposing SDK types downstream", async () => {
    let receivedOptions: unknown;
    const adapter = new PdfInspectorOcrAdapter(async (_source, options) => {
      receivedOptions = options;
      return {
        markdown: "Recognized text", pageCount: 1, pagesRecommendedForOcr: [1], pagesRoutedToOcr: [1],
        pagesRecommendingHosted: [], ocrReasonsByPage: [], pagesWithTables: [], pagesWithColumns: [], isComplex: false,
        processingTimeMs: 12, renderTimeMs: 3, ocrTimeMs: 8,
        pages: [{ pageNumber: 1, markdown: "Recognized text", provenance: {
          pageNumber: 1, source: PageContentSource.Ocr, ocrModel: { name: "PP-OCRv6-small", revision: "fixture-revision" },
          renderDpi: 144, ocrConfidence: 0.91, timings: { renderMs: 3, ocrMs: 8, assemblyMs: 1 },
          warnings: [], hostedRecommended: false,
        } }],
      };
    });
    const output = await adapter.recognize(Buffer.from("pdf"), [1], { targetDpi: 144, modelDirectory: "/models/ocr" });

    expect(receivedOptions).toMatchObject({ mode: "Auto", pageNumbers: [1], offline: true, modelDirectory: "/models/ocr" });
    expect(output[0]?.result).toMatchObject({
      rawText: "Recognized text", engine: "firecrawl/pdf-inspector-oar",
      modelAssetVersion: "PP-OCRv6-small@fixture-revision",
      pageConfidence: { value: 0.91, scale: "zero_to_one", producer: "firecrawl/pdf-inspector-oar" },
      sourceTransform: { scaleX: 0.5, scaleY: 0.5 },
    });
  });
});

describe("groupLogicalDocuments", () => {
  it("classifies only visibly synthetic demo headings", () => {
    const result = classifySyntheticDemoPages([
      { pageNumber: 1, nativeMarkdown: "SYNTHETIC DEMO - Identity document" },
      { pageNumber: 2, nativeMarkdown: "SYNTHETIC DEMO - Payslip" },
      { pageNumber: 3, nativeMarkdown: "SYNTHETIC DEMO - Document boundary" },
      { pageNumber: 4, nativeMarkdown: "SYNTHETIC DEMO - Bank statement" },
    ]);
    expect(result.classifications.map((item) => item.selectedType)).toEqual([
      "identity_document", "payslip", "payslip", "bank_statement",
    ]);
    expect(result.boundaries.map((item) => item.startsNewDocument)).toEqual([true, false, true]);
    expect(classifySyntheticDemoPages([{ pageNumber: 1, nativeMarkdown: "Identity document" }]).classifications[0])
      .toMatchObject({ selectedType: "unknown", qualityStatus: "uncertain" });
  });

  it("creates deterministic contiguous groups and preserves uncertainty", () => {
    const classification = (pageNumber: number, selectedType: PageClassification["selectedType"], qualityStatus: PageClassification["qualityStatus"] = "accepted"): PageClassification => ({
      pageNumber, selectedType, method: "deterministic-fixture", version: "1.0.0",
      qualityStatus, rawConfidence: { value: 0.8, scale: "zero_to_one", producer: "deterministic-fixture" }, alternatives: [],
    });
    const boundary = (pageNumber: number, startsNewDocument: boolean): BoundaryPrediction => ({
      pageNumber, startsNewDocument, method: "deterministic-fixture", version: "1.0.0",
      rawConfidence: { value: 1, scale: "zero_to_one", producer: "deterministic-fixture" },
    });
    const result = groupLogicalDocuments([
      classification(1, "identity_document"), classification(2, "payslip"),
      classification(3, "payslip", "uncertain"), classification(4, "bank_statement"),
    ], [boundary(2, true), boundary(3, false), boundary(4, true)]);

    expect(result).toEqual([
      { startPage: 1, endPage: 1, documentType: "identity_document", uncertain: false, pageNumbers: [1] },
      { startPage: 2, endPage: 3, documentType: "payslip", uncertain: true, pageNumbers: [2, 3] },
      { startPage: 4, endPage: 4, documentType: "bank_statement", uncertain: false, pageNumbers: [4] },
    ]);
  });

  it("fails when a boundary prediction is missing", () => {
    const classifications: PageClassification[] = [1, 2].map((pageNumber) => ({
      pageNumber, selectedType: "payslip", method: "fixture", version: "1", qualityStatus: "accepted",
      rawConfidence: { value: 1, scale: "zero_to_one", producer: "fixture" }, alternatives: [],
    }));
    expect(() => groupLogicalDocuments(classifications, [])).toThrow("every page after the first");
  });
});
