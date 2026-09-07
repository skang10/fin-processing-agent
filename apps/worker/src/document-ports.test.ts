import { describe, expect, it } from "vitest";
import { createRuntimeDocumentPorts } from "./document-ports.js";

describe("runtime OCR document port", () => {
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
});
