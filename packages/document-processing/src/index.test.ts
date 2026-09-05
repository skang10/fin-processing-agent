import { describe, expect, it } from "vitest";
import { PdfType } from "@firecrawl/pdf-inspector";
import { PdfInspectorAdapter, type PdfInspectorEngine } from "./index.js";

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
