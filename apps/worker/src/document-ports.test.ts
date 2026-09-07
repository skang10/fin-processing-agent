import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createRuntimeDocumentPorts } from "./document-ports.js";

describe("runtime OCR document port", () => {
  it("returns positioned native spans while retaining legacy markdown compatibility", async () => {
    const ports = createRuntimeDocumentPorts({
      inventory: {
        inputRevisionId: "input-1", applicationSnapshotId: "application-1", documentProcessorVersion: "processor-1",
        pages: [{ documentVersionId: "document-1", submittedFilename: "synthetic.pdf", pageNumber: 1,
          needsOcr: false, hasTable: false, hasColumns: false, nativeCharacterCount: 20, nativeTextObjectKey: "native-1",
          render: { objectKey: "render-1", width: 100, height: 200, rendererVersion: "pdfium" } }], logicalDocuments: [],
      },
      readArtifact: async () => Buffer.from(JSON.stringify({ rawText: "Employee: Greta", spans: [{ text: "Greta", bbox: [20, 40, 60, 60] }] })),
    });
    const result = await ports.getNativeText({ documentVersionId: "document-1", pageNumber: 1 });
    expect(result).toMatchObject({ available: true, text: "Employee: Greta", truncated: false });
    expect(result.lines?.[0]).toMatchObject({ text: "Greta", region: { x: 0.2, y: 0.2 } });
    expect(result.lines?.[0]?.region.width).toBeCloseTo(0.4);
    expect(result.lines?.[0]?.region.height).toBeCloseTo(0.1);
  });

  it("returns bounded raw OCR lines with full-page evidence when the provider exposes no spans", async () => {
    const ports = createRuntimeDocumentPorts({
      inventory: {
        inputRevisionId: "input-1",
        applicationSnapshotId: "application-1",
        documentProcessorVersion: "firecrawl/pdf-inspector@1.17.0",
        pages: [{
          documentVersionId: "document-1", submittedFilename: "synthetic.pdf", pageNumber: 1,
          needsOcr: true, hasTable: false, hasColumns: false, nativeCharacterCount: 0,
          render: { objectKey: "render-1", width: 100, height: 200, rendererVersion: "pdfium" },
          ocr: { objectKey: "ocr-1", engine: "firecrawl/pdf-inspector-oar", engineVersion: "1.17.0", modelAssetVersion: "pp-ocrv6-small@oar-ocr-v0.7.0" },
        }],
        logicalDocuments: [],
      },
      readArtifact: async (objectKey) => {
        if (objectKey !== "ocr-1") throw new Error("unexpected artifact");
        return Buffer.from(JSON.stringify({ rawText: "Employee: Greta Demofall\nMonthly net pay: EUR 2980.00", spans: [] }));
      },
    });

    const result = await ports.runOcr({ documentVersionId: "document-1", pageNumber: 1 });
    expect(result.lines).toEqual([
      { text: "Employee: Greta Demofall", region: { x: 0, y: 0, width: 1, height: 1 }, rawConfidence: 0 },
      { text: "Monthly net pay: EUR 2980.00", region: { x: 0, y: 0, width: 1, height: 1 }, rawConfidence: 0 },
    ]);
  });

  it("crops visual input while OCR retains its original source-page evidence spans", async () => {
    const render = await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } }).png().toBuffer();
    const ports = createRuntimeDocumentPorts({
      inventory: {
        inputRevisionId: "input-1", applicationSnapshotId: "application-1",
        documentProcessorVersion: "firecrawl/pdf-inspector@1.17.0",
        pages: [{
          documentVersionId: "document-1", submittedFilename: "synthetic.pdf", pageNumber: 1,
          needsOcr: true, hasTable: false, hasColumns: false, nativeCharacterCount: 0,
          render: { objectKey: "render-1", width: 100, height: 200, rendererVersion: "pdfium" },
          ocr: { objectKey: "ocr-1", engine: "fake", engineVersion: "1", modelAssetVersion: "fixture" },
        }], logicalDocuments: [],
      },
      readArtifact: async (objectKey) => objectKey === "render-1" ? render : Buffer.from(JSON.stringify({ spans: [
        { text: "inside", bbox: [20, 40, 40, 60], confidence: { value: 0.9 } },
        { text: "outside", bbox: [70, 140, 90, 180], confidence: { value: 0.8 } },
      ] })),
    });
    const region = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
    const visual = await ports.renderPageRegion({ documentVersionId: "document-1", pageNumber: 1 }, region);
    expect(visual).toMatchObject({ width: 40, height: 60, region, processorVersion: "sharp-0.35.4" });
    await expect(sharp(Buffer.from(visual.image!.data, "base64")).metadata()).resolves.toMatchObject({ width: 40, height: 60 });
    const ocr = await ports.runOcr({ documentVersionId: "document-1", pageNumber: 1 });
    expect(ocr.lines.map((line) => line.text)).toEqual(["inside", "outside"]);
    expect(ocr.lines[0]?.region).toMatchObject({ x: 0.2, y: 0.2, width: 0.2 });
    expect(ocr.lines[0]?.region.height).toBeCloseTo(0.1);
  });

  it("sends only cropped pixels to the VLM when a bounded region is requested", async () => {
    const render = await sharp({ create: { width: 120, height: 80, channels: 3, background: "white" } }).png().toBuffer();
    let receivedImage: { data: string; mimeType: string } | undefined;
    const ports = createRuntimeDocumentPorts({
      inventory: {
        inputRevisionId: "input-1", applicationSnapshotId: "application-1", documentProcessorVersion: "processor-1",
        pages: [{ documentVersionId: "document-1", submittedFilename: "synthetic.pdf", pageNumber: 1,
          needsOcr: true, hasTable: false, hasColumns: false, nativeCharacterCount: 0,
          render: { objectKey: "render-1", width: 120, height: 80, rendererVersion: "pdfium" } }],
        logicalDocuments: [],
      },
      readArtifact: async () => render,
      vlmExtractor: async (request) => {
        receivedImage = request.image;
        return { modelLabel: "test/model", promptVersion: "prompt-1", usage: { inputTokens: 0, outputTokens: 0 } };
      },
    });
    const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    await ports.extractWithVlm({ page: { documentVersionId: "document-1", pageNumber: 1 },
      fieldSchemaId: "income.net_monthly", targetRole: "net_monthly_income", extractionGuidance: "Read net pay", region });
    expect(receivedImage?.mimeType).toBe("image/png");
    await expect(sharp(Buffer.from(receivedImage!.data, "base64")).metadata()).resolves.toMatchObject({ width: 60, height: 40 });
  });
});
