import { Type, type Static } from "typebox";
import type { ExtractionGap } from "@findoc/core";
import type { AdaptiveRecoveryContext, AgentExtractionMethod, NormalizedRegion, PageReference, RecoveryToolPorts, SubmittedExtractionCandidate } from "@findoc/agent";
import type { RegisteredToolSpec } from "./session.js";

/** Immutable, versioned adaptive-recovery tool catalog (AGT section 6). */
export const RECOVERY_TOOL_REGISTRY_VERSION = "adaptive-recovery-tools-2.3.0";

const MAX_NATIVE_TEXT_CHARACTERS = 4_000;
const MAX_OCR_LINES = 200;

export interface RecoveryScope {
  readonly context: AdaptiveRecoveryContext;
  readonly ports: RecoveryToolPorts;
}

/**
 * In-session record of what registered tools actually returned, keyed by `${documentVersionId}:${pageNumber}`.
 * A submitted candidate must cite one of these observations, so the model cannot introduce a value
 * that no authorized tool produced for that page (AGT-REQ-047).
 */
export interface RecoveryToolState {
  readonly candidates: SubmittedExtractionCandidate[];
  readonly inspectedPages: Set<string>;
  /** Pages whose authorized render was delivered to the model during this session. */
  readonly renderedPages: Set<string>;
  /** Bounded committed native text returned for a page, exactly as the model saw it. */
  readonly nativeTextByPage: Map<string, string>;
  /** Bounded OCR lines returned for a page, with the region each line came from. */
  readonly ocrLinesByPage: Map<string, { text: string; region: NormalizedRegion }[]>;
  /** VLM values keyed by `${documentVersionId}:${pageNumber}:${gapId}`. */
  readonly vlmResults: Map<string, { rawValue: string; region: NormalizedRegion; processorVersion: string }>;
}

export function createRecoveryToolState(): RecoveryToolState {
  return { candidates: [], inspectedPages: new Set(), renderedPages: new Set(), nativeTextByPage: new Map(), ocrLinesByPage: new Map(), vlmResults: new Map() };
}

/** True when at least one approved local boundary already returned text for the page. */
function locallyProcessed(state: RecoveryToolState, page: PageReference): boolean {
  return state.nativeTextByPage.has(pageKey(page)) || state.ocrLinesByPage.has(pageKey(page));
}

export interface ResolvedEvidenceSource {
  readonly extractionMethod: AgentExtractionMethod;
  readonly processorVersion: string;
  readonly region?: NormalizedRegion;
}

/**
 * Resolve the tool boundary a submitted value came from. The rule is the same for every source: the
 * value must appear verbatim in what an authorized tool returned for that page. A VLM value must
 * match its returned value exactly; an OCR value must appear in a returned line, and inherits that
 * line's region; a native-text value must appear in the bounded text the page tool returned. Anything
 * else has no tool evidence.
 */
export function resolveEvidenceSource(
  state: RecoveryToolState, page: PageReference, gapId: string, rawValue: string,
): ResolvedEvidenceSource | undefined {
  if (rawValue.length === 0) return undefined;
  const key = pageKey(page);
  const vlm = state.vlmResults.get(`${key}:${gapId}`);
  if (vlm && vlm.rawValue === rawValue) return { extractionMethod: "agent_vlm_extraction", processorVersion: vlm.processorVersion, region: vlm.region };
  const lines = state.ocrLinesByPage.get(key) ?? [];
  const line = lines.find((item) => item.text === rawValue) ?? lines.find((item) => item.text.includes(rawValue));
  if (line) return { extractionMethod: "agent_ocr_reading", processorVersion: AGENT_OCR_READING_VERSION, region: line.region };
  const native = state.nativeTextByPage.get(key);
  if (native && native.includes(rawValue)) {
    return { extractionMethod: "agent_native_text_reading", processorVersion: AGENT_NATIVE_TEXT_READING_VERSION };
  }
  return undefined;
}

export const AGENT_OCR_READING_VERSION = "agent-ocr-reading-1.0.0";
export const AGENT_NATIVE_TEXT_READING_VERSION = "agent-native-text-reading-1.0.0";

const PageParameters = {
  document_version_id: Type.String({ minLength: 1, maxLength: 64 }),
  page_number: Type.Integer({ minimum: 1, maximum: 10_000 }),
};

const RegionSchema = Type.Object({
  x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
  width: Type.Number({ minimum: 0, maximum: 1 }), height: Type.Number({ minimum: 0, maximum: 1 }),
}, { additionalProperties: false });

const NoParameters = Type.Object({}, { additionalProperties: false });
const PageOnly = Type.Object(PageParameters, { additionalProperties: false });
const PageWithOptionalRegion = Type.Object({ ...PageParameters, region: Type.Optional(RegionSchema) }, { additionalProperties: false });
const PageWithRegion = Type.Object({ ...PageParameters, region: RegionSchema }, { additionalProperties: false });
const VlmParameters = Type.Object({ ...PageParameters, gap_id: Type.String({ minLength: 1, maxLength: 64 }), region: Type.Optional(RegionSchema) }, { additionalProperties: false });
const SubmitParameters = Type.Object({
  candidates: Type.Array(Type.Object({
    gap_id: Type.String({ minLength: 1, maxLength: 64 }),
    raw_value: Type.String({ minLength: 1, maxLength: 500 }),
    ...PageParameters,
    region: Type.Optional(RegionSchema),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });

const pageKey = (page: PageReference) => `${page.documentVersionId}:${page.pageNumber}`;
const toPage = (args: { document_version_id: string; page_number: number }): PageReference => ({ documentVersionId: args.document_version_id, pageNumber: args.page_number });

function authorizePage(args: { document_version_id: string; page_number: number }, scope: RecoveryScope): string | undefined {
  return scope.context.pages.some((page) => page.documentVersionId === args.document_version_id && page.pageNumber === args.page_number) ? undefined : "page_outside_session_scope";
}

/**
 * Pages one gap may be worked from. A gap anchors on the first page of its logical document, but the
 * value it needs can sit on any authorized page of that same document, so a multi-page payslip or
 * statement is not restricted to its first page. When the session carries no document inventory the
 * check falls back to the anchor page and stays closed.
 */
function pageWithinGapScope(gap: ExtractionGap, scope: RecoveryScope, page: PageReference): boolean {
  if (page.documentVersionId !== gap.scope.documentVersionId) return false;
  if (!scope.context.pages.some((item) => item.documentVersionId === page.documentVersionId && item.pageNumber === page.pageNumber)) return false;
  const document = scope.context.documents?.find((item) => item.logicalDocumentRevisionId === gap.scope.logicalDocumentRevisionId);
  return document
    ? page.pageNumber >= document.startPage && page.pageNumber <= document.endPage
    : page.pageNumber === gap.scope.pageNumber;
}

function validRegion(region: NormalizedRegion): boolean {
  return region.width > 0 && region.height > 0 && region.x + region.width <= 1 + 1e-9 && region.y + region.height <= 1 + 1e-9;
}

function sameRegion(left: NormalizedRegion | undefined, right: NormalizedRegion | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined
    && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function fieldLabel(fieldSchemaId: string): string {
  return fieldSchemaId === "income.monthly_net" ? "monthly net income" : fieldSchemaId.replace(/[._]/g, " ");
}

type Tool<TParams extends Type.TSchema> = RegisteredToolSpec<TParams, RecoveryScope, RecoveryToolState>;

/**
 * The bounded case manifest: grouped logical documents, authorized pages, the declared field
 * requirements this session must satisfy from documents, and the structured application data of the
 * run. It carries no document content; every document value must come from a page tool.
 */
export const getCaseManifestTool: Tool<typeof NoParameters> = {
  name: "get_case_manifest", version: "2.0.0", label: "Get case manifest", costClass: "read",
  description: "Return the bounded case manifest: logical documents, authorized pages, declared extraction requirements, and structured application data. It contains no document content.",
  promptSnippet: "read the bounded case manifest before inspecting any page",
  parameters: NoParameters,
  authorize: () => undefined,
  execute: async (_args, scope, state) => ({
    summary: `Read the case manifest: ${scope.context.documents?.length ?? 0} documents, ${scope.context.pages.length} pages, ${scope.context.gaps.length} extraction requirements`,
    output: {
      documents: (scope.context.documents ?? []).map((document) => ({
        logical_document_revision_id: document.logicalDocumentRevisionId, document_version_id: document.documentVersionId,
        document_type: document.documentType, start_page: document.startPage, end_page: document.endPage, uncertain: document.uncertain,
      })),
      extraction_requirements: scope.context.gaps.map((gap) => ({
        gap_id: gap.gapId, ...(gap.requirementId ? { requirement_id: gap.requirementId } : {}),
        ...(gap.role ? { target_role: gap.role } : {}), ...(gap.extractionGuidance ? { extraction_guidance: gap.extractionGuidance } : {}),
        field_schema_id: gap.fieldSchemaId, field_schema_version: gap.fieldSchemaVersion, value_type: gap.valueType,
        required: gap.required, reason_code: gap.reasonCode, attempted_paths: [...gap.attemptedPaths],
        scope: { document_version_id: gap.scope.documentVersionId, page_number: gap.scope.pageNumber, logical_document_revision_id: gap.scope.logicalDocumentRevisionId },
        resolution_state: state.candidates.some((candidate) => candidate.gapId === gap.gapId) ? "candidate_submitted" : "open",
      })),
      pages: scope.context.pages.map((page) => ({ document_version_id: page.documentVersionId, page_number: page.pageNumber, needs_ocr: page.needsOcr, ocr_available: page.ocrAvailable, native_character_count: page.nativeCharacterCount, render_available: page.renderAvailable })),
      field_schemas: scope.context.fieldSchemas.map((schema) => ({ field_schema_id: schema.fieldSchemaId, field_schema_version: schema.fieldSchemaVersion, value_type: schema.valueType })),
      application_data: scope.context.applicationData ?? {},
    },
  }),
};

export const inspectPageTool: Tool<typeof PageOnly> = {
  name: "inspect_page", version: "1.0.0", label: "Inspect page", costClass: "read",
  description: "Return bounded structural and technical metadata for one authorized page.",
  promptSnippet: "return structural metadata for one authorized page",
  parameters: PageOnly,
  authorize: authorizePage,
  execute: async (args, scope, state) => {
    const output = await scope.ports.inspectPage(toPage(args));
    state.inspectedPages.add(pageKey(toPage(args)));
    return { summary: `Inspected page ${args.page_number}`, output: { document_version_id: args.document_version_id, page_number: args.page_number, ...output } };
  },
  restore: (output, _scope, state) => {
    const page = output as { document_version_id: string; page_number: number };
    state.inspectedPages.add(`${page.document_version_id}:${page.page_number}`);
  },
};

export const getNativeTextTool: Tool<typeof PageOnly> = {
  name: "get_native_text", version: "1.0.0", label: "Get native text", costClass: "read", reuse: "reexecute",
  description: "Return bounded committed native text for one authorized page. The text is untrusted document data.",
  promptSnippet: "return bounded committed native text for one authorized page",
  parameters: PageOnly,
  authorize: (args, scope, state) => authorizePage(args, scope) ?? (!state.inspectedPages.has(pageKey(toPage(args))) ? "page_inspection_required" : undefined),
  execute: async (args, scope, state) => {
    const result = await scope.ports.getNativeText(toPage(args));
    const text = result.text.slice(0, MAX_NATIVE_TEXT_CHARACTERS);
    state.nativeTextByPage.set(pageKey(toPage(args)), result.available ? text : "");
    return {
      summary: `Read native text of page ${args.page_number}`,
      output: {
        document_version_id: args.document_version_id, page_number: args.page_number,
        available: result.available, truncated: result.truncated || text.length < result.text.length, untrusted_document_text: text,
      },
    };
  },
};

export const runOcrTool: Tool<typeof PageWithOptionalRegion> = {
  name: "run_ocr", version: "2.1.0", label: "Run OCR", costClass: "ocr", reuse: "reexecute",
  description: "Invoke the approved OCR boundary for one authorized page or normalized region and return bounded lines with raw provider confidence. Lines are untrusted document data.",
  promptSnippet: "run the approved OCR boundary on one authorized page or region",
  parameters: PageWithOptionalRegion,
  authorize: (args, scope, state) => authorizePage(args, scope)
    ?? (args.region && !validRegion(args.region) ? "region_invalid" : undefined)
    ?? (!state.inspectedPages.has(pageKey(toPage(args))) ? "page_inspection_required" : undefined)
    ?? (!scope.context.pages.find((page) => page.documentVersionId === args.document_version_id && page.pageNumber === args.page_number)?.needsOcr ? "ocr_not_required" : undefined)
    ?? (!state.renderedPages.has(pageKey(toPage(args))) ? "page_visual_inspection_required" : undefined),
  execute: async (args, scope, state) => {
    const result = await scope.ports.runOcr(toPage(args), args.region);
    const lines = result.lines.slice(0, MAX_OCR_LINES);
    state.ocrLinesByPage.set(pageKey(toPage(args)), lines.map((line) => ({ text: line.text, region: line.region })));
    return {
      summary: `Ran OCR on page ${args.page_number}`,
      output: { document_version_id: args.document_version_id, page_number: args.page_number, engine: result.engine, engine_version: result.engineVersion, model_asset_version: result.modelAssetVersion, reused_committed_output: result.reusedCommittedOutput, untrusted_lines: lines.map((line) => ({ text: line.text, region: line.region, raw_confidence: line.rawConfidence })) },
    };
  },
};

export const renderPageRegionTool: Tool<typeof PageWithRegion> = {
  name: "render_page_region", version: "3.0.0", label: "View page region", costClass: "render", reuse: "reexecute",
  description: "Render and visually inspect a bounded normalized region of one authorized uploaded-document page. Returns the image to the model and a safe immutable artifact reference for audit.",
  promptSnippet: "visually inspect an authorized uploaded-document page or region",
  parameters: PageWithRegion,
  authorize: (args, scope) => authorizePage(args, scope) ?? (validRegion(args.region) ? undefined : "region_invalid"),
  execute: async (args, scope, state) => {
    const { image, ...safe } = await scope.ports.renderPageRegion(toPage(args), args.region);
    state.renderedPages.add(pageKey(toPage(args)));
    return {
      summary: `Viewed the uploaded document on page ${args.page_number}`,
      output: { document_version_id: args.document_version_id, page_number: args.page_number, ...safe },
      ...(image ? { modelContent: [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] } : {}),
    };
  },
  restore: (output, _scope, state) => {
    const page = output as { document_version_id?: string; page_number?: number };
    if (page.document_version_id && page.page_number) state.renderedPages.add(`${page.document_version_id}:${page.page_number}`);
  },
  producedReferences: (output) => [{ kind: "artifact", id: (output as { artifactReference: string }).artifactReference }],
};

export const classifyPageTool: Tool<typeof PageOnly> = {
  name: "classify_page", version: "1.0.0", label: "Classify page", costClass: "read",
  description: "Invoke the configured page classifier for one authorized page and return constrained classification candidates.",
  promptSnippet: "return constrained classification candidates for one authorized page",
  parameters: PageOnly,
  authorize: authorizePage,
  execute: async (args, scope) => ({ summary: `Classified page ${args.page_number}`, output: await scope.ports.classifyPage(toPage(args)) }),
};

export const detectDocumentBoundariesTool: Tool<typeof PageOnly> = {
  name: "detect_document_boundaries", version: "1.0.0", label: "Detect document boundaries", costClass: "read",
  description: "Return a bounded boundary candidate for one authorized page.", promptSnippet: "inspect the committed boundary candidate for one page",
  parameters: PageOnly, authorize: authorizePage,
  execute: async (args, scope) => ({ summary: `Checked document boundary on page ${args.page_number}`, output: await scope.ports.detectDocumentBoundaries(toPage(args)) }),
};

export const extractLocalTableTool: Tool<typeof PageOnly> = {
  name: "extract_local_table", version: "1.0.0", label: "Extract local table", costClass: "read",
  description: "Return committed local table structure for one authorized page.", promptSnippet: "inspect local table output before model recovery",
  parameters: PageOnly, authorize: authorizePage,
  execute: async (args, scope) => ({ summary: `Checked local tables on page ${args.page_number}`, output: await scope.ports.extractLocalTable(toPage(args)) }),
};

export const extractWithVlmTool: Tool<typeof VlmParameters> = {
  name: "extract_with_vlm", version: "3.2.0", label: "Extract with VLM", costClass: "vlm",
  description: "Invoke the configured schema-constrained VLM extraction operation for one field on one authorized page or region. The invocation has no tools.",
  promptSnippet: "run schema-constrained VLM extraction for one field on one authorized page",
  parameters: VlmParameters,
  authorize: (args, scope, state) => {
    const pageRejection = authorizePage(args, scope);
    if (pageRejection) return pageRejection;
    const gap = scope.context.gaps.find((item) => item.gapId === args.gap_id);
    if (!gap) return "gap_outside_session_scope";
    if (!pageWithinGapScope(gap, scope, toPage(args))) return "page_outside_gap_scope";
    if (!state.inspectedPages.has(pageKey(toPage(args)))) return "page_inspection_required";
    const page = scope.context.pages.find((item) => item.documentVersionId === args.document_version_id && item.pageNumber === args.page_number);
    if (page?.needsOcr && !state.renderedPages.has(pageKey(toPage(args)))) return "page_visual_inspection_required";
    if (!locallyProcessed(state, toPage(args))) return "local_processing_required";
    if (args.region && !validRegion(args.region)) return "region_invalid";
    return undefined;
  },
  execute: async (args, scope, state) => {
    const gap = scope.context.gaps.find((item) => item.gapId === args.gap_id);
    if (!gap?.role || !gap.extractionGuidance) throw new Error("VLM extraction requirement lacks trusted role or guidance");
    const result = await scope.ports.extractWithVlm({
      page: toPage(args), fieldSchemaId: gap.fieldSchemaId, targetRole: gap.role,
      extractionGuidance: gap.extractionGuidance, ...(args.region ? { region: args.region } : {}),
    });
    if (result.value) {
      state.vlmResults.set(`${pageKey(toPage(args))}:${gap.gapId}`, { rawValue: result.value.rawValue, region: result.value.region, processorVersion: `${result.modelLabel}/${result.promptVersion}` });
    }
    return {
      // The model label is part of the reviewer-visible summary so a fixture gateway is never
      // mistaken for a real Vision Language Model result.
      summary: `Checked page ${args.page_number} for ${fieldLabel(gap.fieldSchemaId)} (${gap.role}) with ${result.modelLabel}`,
      output: {
        document_version_id: args.document_version_id, page_number: args.page_number, gap_id: gap.gapId,
        field_schema_id: gap.fieldSchemaId, target_role: gap.role,
        model_label: result.modelLabel, prompt_version: result.promptVersion,
        value: result.value ? { raw_value: result.value.rawValue, normalized_value: result.value.normalizedValue, region: result.value.region, raw_confidence: result.value.rawConfidence } : null,
        ...(result.usage ? { usage: result.usage } : {}),
      },
      ...(result.usage ? { modelUsage: result.usage } : {}),
    };
  },
  restore: (output, _scope, state) => {
    const committed = output as {
      document_version_id: string; page_number: number; gap_id: string; field_schema_id: string; model_label: string; prompt_version: string;
      value: { raw_value: string; normalized_value: unknown; region: NormalizedRegion } | null;
    };
    if (!committed.value) return;
    const page = { documentVersionId: committed.document_version_id, pageNumber: committed.page_number };
    state.vlmResults.set(`${pageKey(page)}:${committed.gap_id}`, {
      rawValue: committed.value.raw_value,
      region: committed.value.region, processorVersion: `${committed.model_label}/${committed.prompt_version}`,
    });
  },
};

export const submitExtractionCandidatesTool: Tool<typeof SubmitParameters> = {
  name: "submit_extraction_candidates", version: "3.0.0", label: "Submit extraction candidates", costClass: "submit",
  description: "Submit candidates for the declared extraction requirements. Each candidate must cite a value an authorized tool returned for the same page; candidates enter deterministic reconciliation and never become claims directly.",
  promptSnippet: "submit evidence-backed candidates for the declared extraction requirements",
  parameters: SubmitParameters,
  authorize: (args, scope, state) => {
    const proposed = new Set<string>();
    for (const candidate of args.candidates) {
      const gap = scope.context.gaps.find((item) => item.gapId === candidate.gap_id);
      if (!gap) return "gap_outside_session_scope";
      if (!pageWithinGapScope(gap, scope, toPage(candidate))) return "page_outside_gap_scope";
      if (candidate.region && !validRegion(candidate.region)) return "region_invalid";
      const source = resolveEvidenceSource(state, toPage(candidate), gap.gapId, candidate.raw_value);
      if (!source) return "value_without_tool_evidence";
      if (candidate.region !== undefined && !sameRegion(candidate.region, source.region)) return "region_without_tool_evidence";
      if (state.candidates.some((item) => item.gapId === candidate.gap_id) || proposed.has(candidate.gap_id)) return "gap_already_has_candidate";
      proposed.add(candidate.gap_id);
    }
    return undefined;
  },
  execute: async (args, scope, state) => {
    for (const candidate of args.candidates) {
      const gap = scope.context.gaps.find((item) => item.gapId === candidate.gap_id);
      if (!gap) throw new Error("Authorized gap is missing");
      const source = resolveEvidenceSource(state, toPage(candidate), gap.gapId, candidate.raw_value);
      if (!source) throw new Error("Authorized candidate has no tool evidence");
      const region = source.region;
      state.candidates.push({
        gapId: gap.gapId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType,
        rawValue: candidate.raw_value, page: toPage(candidate),
        ...(region ? { region } : {}),
        extractionMethod: source.extractionMethod, processorVersion: source.processorVersion,
      });
    }
    const remaining = scope.context.gaps.filter((gap) => gap.required && !state.candidates.some((candidate) => candidate.gapId === gap.gapId));
    const fields = args.candidates.map((candidate) => scope.context.gaps.find((gap) => gap.gapId === candidate.gap_id)?.fieldSchemaId).filter((field): field is string => Boolean(field)).map(fieldLabel);
    const submitted = state.candidates.filter((candidate) => args.candidates.some((item) => item.gap_id === candidate.gapId));
    return {
      summary: `Proposed ${args.candidates.length} extracted ${args.candidates.length === 1 ? "value" : "values"} for ${[...new Set(fields)].join(", ")} to deterministic reconciliation`,
      output: { accepted: args.candidates.length, remaining_required_gaps: remaining.map((gap) => gap.gapId), submitted: submitted.map(serializeCandidate) },
    };
  },
  restore: (output, _scope, state) => {
    for (const candidate of (output as { submitted?: readonly ReturnType<typeof serializeCandidate>[] }).submitted ?? []) {
      if (state.candidates.some((item) => item.gapId === candidate.gap_id)) continue;
      state.candidates.push(deserializeCandidate(candidate));
    }
  },
};

function serializeCandidate(candidate: SubmittedExtractionCandidate) {
  return {
    gap_id: candidate.gapId, field_schema_id: candidate.fieldSchemaId, field_schema_version: candidate.fieldSchemaVersion,
    value_type: candidate.valueType, raw_value: candidate.rawValue,
    document_version_id: candidate.page.documentVersionId, page_number: candidate.page.pageNumber,
    ...(candidate.region ? { region: candidate.region } : {}),
    extraction_method: candidate.extractionMethod, processor_version: candidate.processorVersion,
  };
}

function deserializeCandidate(candidate: ReturnType<typeof serializeCandidate>): SubmittedExtractionCandidate {
  return {
    gapId: candidate.gap_id, fieldSchemaId: candidate.field_schema_id, fieldSchemaVersion: candidate.field_schema_version,
    valueType: candidate.value_type, rawValue: candidate.raw_value,
    page: { documentVersionId: candidate.document_version_id, pageNumber: candidate.page_number },
    ...(candidate.region ? { region: candidate.region } : {}),
    extractionMethod: candidate.extraction_method, processorVersion: candidate.processor_version,
  };
}

export const ADAPTIVE_RECOVERY_TOOLS: readonly RegisteredToolSpec<any, RecoveryScope, RecoveryToolState>[] = Object.freeze([
  getCaseManifestTool, inspectPageTool, getNativeTextTool, runOcrTool, renderPageRegionTool, classifyPageTool, detectDocumentBoundariesTool, extractLocalTableTool, extractWithVlmTool, submitExtractionCandidatesTool,
]);

export const ADAPTIVE_RECOVERY_TOOL_NAMES: readonly string[] = Object.freeze(ADAPTIVE_RECOVERY_TOOLS.map((tool) => tool.name));

export type SubmitCandidatesArguments = Static<typeof SubmitParameters>;
