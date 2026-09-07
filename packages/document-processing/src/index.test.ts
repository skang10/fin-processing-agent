import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { PageContentSource, PdfType } from "@firecrawl/pdf-inspector";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { DocumentSandboxClient, FakeOcrEngine, PdfInspectorAdapter, PdfInspectorOcrAdapter, PdfiumPageRenderer, classifySyntheticDemoPages, cropPageRender, groupLogicalDocuments, prepareImageDocument, runSelectiveOcr, type BoundaryPrediction, type OcrEngine, type PageClassification, type PdfInspectorEngine } from "./index.js";

describe("cropPageRender", () => {
  it("resolves normalized coordinates to a real bounded PNG crop", async () => {
    const source = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const crop = await cropPageRender(source, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 });
    expect(crop).toMatchObject({
      width: 100, height: 40,
      sourcePixelBounds: { left: 50, top: 20, width: 100, height: 40 },
      processorVersion: "sharp-0.35.4",
    });
    await expect(sharp(crop.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 100, height: 40 });
  });

  it("rejects empty and out-of-bounds regions", async () => {
    const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    await expect(cropPageRender(source, { x: 0.9, y: 0, width: 0.2, height: 1 })).rejects.toThrow("invalid");
    await expect(cropPageRender(source, { x: 0, y: 0, width: 0, height: 1 })).rejects.toThrow("invalid");
  });
});

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

describe("prepareImageDocument", () => {
  for (const mediaType of ["image/jpeg", "image/png"] as const) {
    it(`decodes a bounded ${mediaType} and produces a one-page OCR wrapper`, async () => {
      const pipeline = sharp({ create: { width: 120, height: 80, channels: 3, background: "white" } });
      const source = mediaType === "image/jpeg" ? await pipeline.jpeg().toBuffer() : await pipeline.png().toBuffer();
      const result = await prepareImageDocument(source, createHash("sha256").update(source).digest("hex"), mediaType, 110, 20_000);
      expect(result.inspection).toMatchObject({ processor: "image-intake-router", pageCount: 1, pdfType: "image_based" });
      expect(result.render).toMatchObject({ width: 120, height: 80, outputFormat: "png" });
      await expect(new PdfInspectorAdapter().inspect(result.ocrPdf)).resolves.toMatchObject({ pageCount: 1 });
    });
  }

  it("rejects a declared media type that does not match decoded content", async () => {
    const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareImageDocument(source, createHash("sha256").update(source).digest("hex"), "image/jpeg", 110, 1_000))
      .rejects.toThrow("does not match");
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

  it("requires every pinned native-runtime path for real OCR", async () => {
    await expect(new DocumentSandboxClient().inspectAndRender(Buffer.from("fixture"), "a".repeat(64), {
      timeoutMs: 5_000, maximumPages: 2, maximumPixelsPerPage: 1_000, targetDpi: 110,
      ocrMode: "pdf_inspector", ocrModelDirectory: "/models/ocr",
    })).rejects.toThrow("PDFIUM_LIB_PATH");
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

  it("uses committed OCR text for a scanned synthetic page without fixture classification", () => {
    const result = classifySyntheticDemoPages([{
      pageNumber: 1,
      nativeMarkdown: "",
      ocrMarkdown: "SYNTHETIC DEMO - Payslip\nEmployee Greta Demofall",
    }]);
    expect(result.classifications[0]).toMatchObject({
      selectedType: "payslip",
      method: "synthetic-demo-ocr-content-classifier",
      qualityStatus: "accepted",
    });
  });

  it("classifies a visibly synthetic OCR page from its bounded content signals when its heading is imperfect", () => {
    const result = classifySyntheticDemoPages([{
      pageNumber: 1,
      nativeMarkdown: "",
      ocrMarkdown: "SYNTHETIC DEMO SCAN\nAccount holder: Greta Demofall\nDate Description Reference Amount EUR\nSalary payment: Demowerk GmbH",
    }]);
    expect(result.classifications[0]).toMatchObject({
      selectedType: "bank_statement",
      method: "synthetic-demo-ocr-content-classifier",
    });
  });

  it("tolerates a missed account-holder label when bank transaction headings remain readable", () => {
    const result = classifySyntheticDemoPages([{
      pageNumber: 1,
      nativeMarkdown: "",
      ocrMarkdown: "SYNTHETIC DEMO SCAN\nDate Description Reference Amount EUR\nSalary payment Demowerk GmbH",
    }]);
    expect(result.classifications[0]?.selectedType).toBe("bank_statement");
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
