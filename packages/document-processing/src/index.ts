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

export interface OcrRequest {
  readonly pageNumber: number;
  readonly languages: readonly ("de" | "en")[];
  readonly image: { readonly bytes: Buffer; readonly width: number; readonly height: number; readonly targetDpi: number };
}

export interface OcrSpan {
  readonly text: string;
  readonly bbox: readonly [number, number, number, number];
  readonly confidence: { readonly value: number; readonly scale: "zero_to_one"; readonly producer: string };
}

export interface OcrResult {
  readonly rawText: string;
  readonly spans: readonly OcrSpan[];
  readonly languages: readonly ("de" | "en")[];
  readonly engine: string;
  readonly engineVersion: string;
  readonly modelAssetVersion: string;
  readonly coordinateSpace: "render_pixels_top_left";
  readonly sourceTransform: {
    readonly sourceCoordinateSpace: "pdf_points_top_left";
    readonly scaleX: number;
    readonly scaleY: number;
    readonly translateX: 0;
    readonly translateY: 0;
  };
}

export interface OcrEngine {
  recognize(request: OcrRequest): Promise<OcrResult>;
}

export class FakeOcrEngine implements OcrEngine {
  async recognize(request: OcrRequest): Promise<OcrResult> {
    if (!Number.isInteger(request.pageNumber) || request.pageNumber < 1 || request.image.bytes.byteLength === 0 ||
        request.image.width < 1 || request.image.height < 1 || request.image.targetDpi < 72 || request.languages.length === 0) {
      throw new Error("Fake OCR request is invalid");
    }
    const rawText = `Synthetic OCR candidate for page ${request.pageNumber}`;
    return {
      rawText,
      spans: [{
        text: rawText, bbox: [0, 0, request.image.width, request.image.height],
        confidence: { value: 1, scale: "zero_to_one", producer: "deterministic-fake-ocr" },
      }],
      languages: [...request.languages], engine: "deterministic-fake-ocr", engineVersion: "1.0.0",
      modelAssetVersion: "synthetic-fixture-v1", coordinateSpace: "render_pixels_top_left",
      sourceTransform: {
        sourceCoordinateSpace: "pdf_points_top_left",
        scaleX: 72 / request.image.targetDpi,
        scaleY: 72 / request.image.targetDpi,
        translateX: 0,
        translateY: 0,
      },
    };
  }
}

export async function runSelectiveOcr(
  pages: readonly Pick<InspectedPage, "pageNumber" | "needsOcr">[],
  renders: readonly { readonly pageNumber: number; readonly bytes: Buffer; readonly width: number; readonly height: number; readonly targetDpi: number }[],
  engine: OcrEngine,
  languages: readonly ("de" | "en")[] = ["de", "en"],
): Promise<readonly { pageNumber: number; result: OcrResult }[]> {
  const outputs = [];
  for (const page of pages) {
    if (!page.needsOcr) continue;
    const render = renders.find((candidate) => candidate.pageNumber === page.pageNumber);
    if (!render) throw new Error("OCR-routed page has no render");
    outputs.push({ pageNumber: page.pageNumber, result: await engine.recognize({
      pageNumber: page.pageNumber, languages,
      image: { bytes: render.bytes, width: render.width, height: render.height, targetDpi: render.targetDpi },
    }) });
  }
  return outputs;
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
