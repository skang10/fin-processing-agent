import type { NormalizedRegion, PageReference, RecoveryToolPorts } from "@findoc/agent";
import type { CaseDocumentInventory, CaseInventoryPage } from "@findoc/persistence";
import type { FixtureScannedPageAdapter } from "@findoc/offline";
import { cropPageRender, IMAGE_PROCESSOR_VERSION } from "@findoc/document-processing";

const MAXIMUM_ARTIFACT_BYTES = 2_000_000;
const MAXIMUM_OCR_LINES = 200;

export interface RuntimeDocumentPortOptions {
  readonly inventory: CaseDocumentInventory;
  /** Reads one committed derived artifact by object key. */
  readonly readArtifact: (objectKey: string, maximumBytes: number) => Promise<Buffer>;
  /** Explicit live, provider-neutral page-image extraction route. */
  readonly vlmExtractor?: (request: {
    readonly image: { readonly data: string; readonly mimeType: string };
    readonly fieldSchemaId: string;
    readonly targetRole: string;
    readonly extractionGuidance: string;
    readonly region?: NormalizedRegion;
  }) => ReturnType<RecoveryToolPorts["extractWithVlm"]>;
  /**
   * Explicit synthetic-fixture stand-in for pages the delivered runtime cannot read. It is used
   * only when no live VLM route is configured and is absent for any non-fixture case.
   */
  readonly fixtureScannedPages?: FixtureScannedPageAdapter;
}

interface CommittedOcrArtifact {
  readonly rawText?: string;
  readonly spans?: readonly { readonly text: string; readonly bbox: readonly number[]; readonly confidence?: { readonly value?: number } }[];
}

/**
 * Registered document tools backed by committed run state: PDF Inspector page metadata, the stored
 * native-text artifact, the stored selective-OCR output, the stored page render, and the persisted
 * classification and boundary. No golden truth and no precomputed field values reach the Agent
 * through these ports (ARC-REQ-044, AGT-REQ-027).
 */
export function createRuntimeDocumentPorts(options: RuntimeDocumentPortOptions): RecoveryToolPorts {
  const find = (reference: PageReference): CaseInventoryPage => {
    const page = options.inventory.pages.find((item) => item.documentVersionId === reference.documentVersionId && item.pageNumber === reference.pageNumber);
    if (!page) throw new Error("Page is outside the current run");
    return page;
  };
  const fullPage: NormalizedRegion = { x: 0, y: 0, width: 1, height: 1 };

  return {
    inspectPage: async (reference) => {
      const page = find(reference);
      return {
        needsOcr: page.needsOcr, ...(page.ocrReason ? { ocrReason: page.ocrReason } : {}),
        hasTable: page.hasTable, hasColumns: page.hasColumns, nativeCharacterCount: page.nativeCharacterCount,
        renderAvailable: Boolean(page.render), ocrAvailable: Boolean(page.ocr),
      };
    },

    getNativeText: async (reference) => {
      const page = find(reference);
      if (!page.nativeTextObjectKey || page.nativeCharacterCount === 0) return { available: false, text: "", truncated: false };
      const bytes = await options.readArtifact(page.nativeTextObjectKey, MAXIMUM_ARTIFACT_BYTES);
      return { available: true, text: bytes.toString("utf8"), truncated: false };
    },

    runOcr: async (reference) => {
      const page = find(reference);
      if (!page.ocr) throw new Error("Page has no committed OCR output");
      const bytes = await options.readArtifact(page.ocr.objectKey, MAXIMUM_ARTIFACT_BYTES);
      const committed = JSON.parse(bytes.toString("utf8")) as CommittedOcrArtifact;
      const width = page.render?.width ?? 0;
      const height = page.render?.height ?? 0;
      const preciseLines = (committed.spans ?? []).slice(0, MAXIMUM_OCR_LINES).map((span) => ({
        text: span.text,
        region: normalizeBoundingBox(span.bbox, width, height) ?? fullPage,
        rawConfidence: span.confidence?.value ?? 0,
      }));
      const lines = preciseLines.length > 0 ? preciseLines : (committed.rawText ?? "").split(/\r?\n/u)
        .map((text) => text.trim()).filter(Boolean).slice(0, MAXIMUM_OCR_LINES)
        .map((text) => ({ text, region: fullPage, rawConfidence: 0 }));
      return {
        engine: page.ocr.engine, engineVersion: page.ocr.engineVersion, modelAssetVersion: page.ocr.modelAssetVersion,
        reusedCommittedOutput: true,
        lines,
      };
    },

    renderPageRegion: async (reference, region) => {
      const page = find(reference);
      if (!page.render) throw new Error("Page has no committed render");
      const bytes = await options.readArtifact(page.render.objectKey, MAXIMUM_ARTIFACT_BYTES);
      if (!sameRegion(region, fullPage)) {
        const crop = await cropPageRender(bytes, region);
        return {
          artifactReference: page.render.objectKey, width: crop.width, height: crop.height,
          region, processorVersion: crop.processorVersion,
          image: { data: crop.bytes.toString("base64"), mimeType: "image/png" },
        };
      }
      return {
        artifactReference: page.render.objectKey, width: page.render.width, height: page.render.height,
        region, processorVersion: IMAGE_PROCESSOR_VERSION,
        image: { data: bytes.toString("base64"), mimeType: "image/png" },
      };
    },

    classifyPage: async (reference) => {
      const page = find(reference);
      if (!page.classification) return { candidates: [], method: "unclassified", version: "1.0.0" };
      return {
        candidates: [{ type: page.classification.selectedType, rawConfidence: page.classification.rawConfidence }],
        method: page.classification.method, version: page.classification.version,
      };
    },

    detectDocumentBoundaries: async (reference) => {
      const page = find(reference);
      if (!page.boundary) return { startsNewDocument: page.pageNumber === 1, method: "unpredicted", version: "1.0.0" };
      return {
        startsNewDocument: page.boundary.startsNewDocument, method: page.boundary.method,
        version: page.boundary.version, rawConfidence: page.boundary.rawConfidence,
      };
    },

    extractLocalTable: async (reference) => ({ available: find(reference).hasTable, rowCount: 0 }),

    extractWithVlm: async (request) => {
      const page = find(request.page);
      if (options.vlmExtractor) {
        if (!page.render) throw new Error("Page has no committed render for VLM extraction");
        const source = await options.readArtifact(page.render.objectKey, MAXIMUM_ARTIFACT_BYTES);
        const bytes = request.region && !sameRegion(request.region, fullPage)
          ? (await cropPageRender(source, request.region)).bytes
          : source;
        return options.vlmExtractor({
          image: { data: bytes.toString("base64"), mimeType: "image/png" },
          fieldSchemaId: request.fieldSchemaId,
          targetRole: request.targetRole,
          extractionGuidance: request.extractionGuidance,
          ...(request.region ? { region: request.region } : {}),
        });
      }
      const fixture = options.fixtureScannedPages;
      const declared = fixture && page.nativeCharacterCount === 0 ? fixture.value(request.page.pageNumber, request.fieldSchemaId) : undefined;
      return {
        modelLabel: fixture ? "fixture-vlm-gateway" : "unconfigured-vlm-gateway",
        promptVersion: fixture?.adapterVersion ?? "none",
        ...(declared ? { value: { rawValue: declared, normalizedValue: declared, region: request.region ?? fullPage, rawConfidence: 0 } } : {}),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function sameRegion(left: NormalizedRegion, right: NormalizedRegion): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

/** OCR spans are stored in render pixels with a top-left origin; evidence regions are normalized. */
function normalizeBoundingBox(bbox: readonly number[], width: number, height: number): NormalizedRegion | undefined {
  if (bbox.length < 4 || width <= 0 || height <= 0) return undefined;
  const [left, top, right, bottom] = bbox as [number, number, number, number];
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(left / width);
  const y = clamp(top / height);
  return { x, y, width: clamp(right / width) - x, height: clamp(bottom / height) - y };
}
