import {
  classifyPdfAsync,
  extractPagesMarkdownAsync,
  type PdfClassification,
  type PagesExtractionResult,
} from "@firecrawl/pdf-inspector";
import { createHash } from "node:crypto";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import sharp from "sharp";

export const PDF_INSPECTOR_VERSION = "1.17.0";
export const PDFIUM_RENDERER_VERSION = "@hyzyla/pdfium-2.1.13";

export interface PageRenderRequest {
  readonly sourceSha256: string;
  readonly pageNumber: number;
  readonly targetDpi: number;
  readonly colorMode: "color" | "grayscale";
  readonly outputFormat: "png";
  readonly maximumPixels: number;
}

export interface PageRenderResult {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly targetDpi: number;
  readonly colorMode: "color" | "grayscale";
  readonly outputFormat: "png";
  readonly rendererVersion: string;
}

export interface PageRenderer {
  render(source: Buffer, request: PageRenderRequest): Promise<PageRenderResult>;
}

export class PdfiumPageRenderer implements PageRenderer {
  async render(source: Buffer, request: PageRenderRequest): Promise<PageRenderResult> {
    validateRenderRequest(request);
    if (createHash("sha256").update(source).digest("hex") !== request.sourceSha256) {
      throw new Error("Render source checksum does not match the supplied bytes");
    }
    const library = await PDFiumLibrary.init();
    const document = await library.loadDocument(source);
    try {
      if (request.pageNumber > document.getPageCount()) throw new Error("Render page is outside the document");
      const page = document.getPage(request.pageNumber - 1);
      const { originalWidth, originalHeight } = page.getOriginalSize();
      const scale = request.targetDpi / 72;
      const width = Math.floor(originalWidth * scale);
      const height = Math.floor(originalHeight * scale);
      if (width < 1 || height < 1 || width * height > request.maximumPixels) {
        throw new Error("Render exceeds the configured pixel limit");
      }
      const rendered = await page.render({
        scale,
        colorSpace: request.colorMode === "grayscale" ? "Gray" : "BGRA",
        render: async ({ data, width: rawWidth, height: rawHeight }) => sharp(data, {
          raw: { width: rawWidth, height: rawHeight, channels: request.colorMode === "grayscale" ? 1 : 4 },
        }).png().toBuffer(),
      });
      return {
        bytes: Buffer.from(rendered.data), width: rendered.width, height: rendered.height,
        targetDpi: request.targetDpi, colorMode: request.colorMode, outputFormat: "png",
        rendererVersion: PDFIUM_RENDERER_VERSION,
      };
    } finally {
      document.destroy();
      library.destroy();
    }
  }
}

function validateRenderRequest(request: PageRenderRequest): void {
  if (!/^[a-f0-9]{64}$/.test(request.sourceSha256)) throw new Error("Render source checksum is invalid");
  if (!Number.isInteger(request.pageNumber) || request.pageNumber < 1) throw new Error("Render page number is invalid");
  if (!Number.isFinite(request.targetDpi) || request.targetDpi < 72 || request.targetDpi > 300) throw new Error("Render DPI is invalid");
  if (!Number.isSafeInteger(request.maximumPixels) || request.maximumPixels < 1) throw new Error("Render pixel limit is invalid");
}

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

export { DocumentSandboxClient, DocumentSandboxError, type DocumentSandboxLimits, type DocumentSandboxResult } from "./sandbox.js";
