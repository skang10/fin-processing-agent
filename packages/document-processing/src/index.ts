import {
  classifyPdfAsync,
  extractPagesMarkdownAsync,
  type PdfClassification,
  type PagesExtractionResult,
} from "@firecrawl/pdf-inspector";

export const PDF_INSPECTOR_VERSION = "1.17.0";

export interface InspectedPage {
  readonly pageNumber: number;
  readonly nativeMarkdown: string;
  readonly needsOcr: boolean;
  readonly ocrReason?: string;
  readonly hasTable: boolean;
  readonly hasColumns: boolean;
}

export interface PdfInspection {
  readonly processor: "firecrawl/pdf-inspector";
  readonly processorVersion: string;
  readonly pageCount: number;
  readonly pdfType: "text_based" | "scanned" | "image_based" | "mixed";
  readonly routingSignal: number;
  readonly isComplex: boolean;
  readonly pages: readonly InspectedPage[];
}

export interface PdfInspectorEngine {
  classify(buffer: Buffer): Promise<PdfClassification>;
  extract(buffer: Buffer): Promise<PagesExtractionResult>;
}

const nativeEngine: PdfInspectorEngine = {
  classify: classifyPdfAsync,
  extract: (buffer) => extractPagesMarkdownAsync(buffer),
};

export class PdfInspectorAdapter {
  constructor(private readonly engine: PdfInspectorEngine = nativeEngine) {}

  async inspect(buffer: Buffer): Promise<PdfInspection> {
    const [classification, extraction] = await Promise.all([
      this.engine.classify(buffer),
      this.engine.extract(buffer),
    ]);
    if (!Number.isInteger(classification.pageCount) || classification.pageCount < 1) {
      throw new Error("PDF Inspector returned an invalid page count");
    }
    if (!Number.isFinite(classification.confidence) || classification.confidence < 0 || classification.confidence > 1) {
      throw new Error("PDF Inspector returned an invalid routing signal");
    }
    if (classification.pageCount !== extraction.pages.length) {
      throw new Error("PDF Inspector returned inconsistent page counts");
    }
    const pages = [...extraction.pages].sort((left, right) => left.page - right.page);
    if (pages.some((page, index) => page.page !== index)) {
      throw new Error("PDF Inspector returned invalid page identities");
    }

    return {
      processor: "firecrawl/pdf-inspector",
      processorVersion: PDF_INSPECTOR_VERSION,
      pageCount: classification.pageCount,
      pdfType: normalizePdfType(classification.pdfType),
      routingSignal: classification.confidence,
      isComplex: extraction.isComplex,
      pages: pages.map((page) => ({
        pageNumber: page.page + 1,
        nativeMarkdown: page.markdown,
        needsOcr: page.needsOcr,
        ...(page.ocrReason ? { ocrReason: page.ocrReason } : {}),
        hasTable: extraction.pagesWithTables.includes(page.page + 1),
        hasColumns: extraction.pagesWithColumns.includes(page.page + 1),
      })),
    };
  }
}

function normalizePdfType(value: PdfClassification["pdfType"]): PdfInspection["pdfType"] {
  switch (value) {
    case "TextBased": return "text_based";
    case "Scanned": return "scanned";
    case "ImageBased": return "image_based";
    case "Mixed": return "mixed";
    default: throw new Error(`Unsupported PDF Inspector type: ${String(value)}`);
  }
}
