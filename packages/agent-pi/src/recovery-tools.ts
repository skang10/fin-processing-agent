import { Type, type Static } from "typebox";
import type { AdaptiveRecoveryContext, NormalizedRegion, PageReference, RecoveryToolPorts, SubmittedExtractionCandidate } from "@findoc/agent";
import type { RegisteredToolSpec } from "./session.js";

/** Immutable, versioned adaptive-recovery tool catalog (AGT section 6). */
export const RECOVERY_TOOL_REGISTRY_VERSION = "adaptive-recovery-tools-1.0.0";

const MAX_NATIVE_TEXT_CHARACTERS = 4_000;
const MAX_OCR_LINES = 200;

export interface RecoveryScope {
  readonly context: AdaptiveRecoveryContext;
  readonly ports: RecoveryToolPorts;
}

export interface RecoveryToolState {
  readonly candidates: SubmittedExtractionCandidate[];
  readonly inspectedPages: Set<string>;
  readonly locallyReadPages: Set<string>;
  /** Values a tool actually returned for a page, keyed by `${documentVersionId}:${pageNumber}`; submissions must cite one of them. */
  readonly observedValues: Map<string, Set<string>>;
  readonly vlmResults: Map<string, { rawValue: string; normalizedValue: unknown; region: NormalizedRegion; processorVersion: string }>;
}

export function createRecoveryToolState(): RecoveryToolState {
  return { candidates: [], inspectedPages: new Set(), locallyReadPages: new Set(), observedValues: new Map(), vlmResults: new Map() };
}

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
const PageWithRegion = Type.Object({ ...PageParameters, region: RegionSchema }, { additionalProperties: false });
const VlmParameters = Type.Object({ ...PageParameters, field_schema_id: Type.String({ minLength: 1, maxLength: 128 }), region: Type.Optional(RegionSchema) }, { additionalProperties: false });
const SubmitParameters = Type.Object({
  candidates: Type.Array(Type.Object({
    gap_id: Type.String({ minLength: 1, maxLength: 64 }),
    raw_value: Type.String({ minLength: 1, maxLength: 500 }),
    ...PageParameters,
    region: RegionSchema,
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10 }),
}, { additionalProperties: false });

const pageKey = (page: PageReference) => `${page.documentVersionId}:${page.pageNumber}`;
const toPage = (args: { document_version_id: string; page_number: number }): PageReference => ({ documentVersionId: args.document_version_id, pageNumber: args.page_number });

function authorizePage(args: { document_version_id: string; page_number: number }, scope: RecoveryScope): string | undefined {
  return scope.context.pages.some((page) => page.documentVersionId === args.document_version_id && page.pageNumber === args.page_number) ? undefined : "page_outside_session_scope";
}

function validRegion(region: NormalizedRegion): boolean {
  return region.width > 0 && region.height > 0 && region.x + region.width <= 1 + 1e-9 && region.y + region.height <= 1 + 1e-9;
}

function fieldLabel(fieldSchemaId: string): string {
  return fieldSchemaId === "income.monthly_net" ? "monthly net income" : fieldSchemaId.replace(/[._]/g, " ");
}

function observe(state: RecoveryToolState, page: PageReference, value: string): void {
  const key = pageKey(page);
  const values = state.observedValues.get(key) ?? new Set<string>();
  values.add(value);
  state.observedValues.set(key, values);
}

type Tool<TParams extends Type.TSchema> = RegisteredToolSpec<TParams, RecoveryScope, RecoveryToolState>;

export const getExtractionGapsTool: Tool<typeof NoParameters> = {
  name: "get_extraction_gaps", version: "1.0.0", label: "Get extraction gaps", costClass: "read",
  description: "Return the session-bound extraction gaps, their scope, and the pages this session may inspect.",
  promptSnippet: "list the bound extraction gaps and authorized pages",
  parameters: NoParameters,
  authorize: () => undefined,
  execute: async (_args, scope, state) => ({
    summary: "Listed bound extraction gaps",
    output: {
      gaps: scope.context.gaps.map((gap) => ({
        gap_id: gap.gapId, field_schema_id: gap.fieldSchemaId, field_schema_version: gap.fieldSchemaVersion, value_type: gap.valueType,
        required: gap.required, reason_code: gap.reasonCode, attempted_paths: [...gap.attemptedPaths],
        scope: { document_version_id: gap.scope.documentVersionId, page_number: gap.scope.pageNumber, logical_document_revision_id: gap.scope.logicalDocumentRevisionId },
        resolution_state: state.candidates.some((candidate) => candidate.gapId === gap.gapId) ? "candidate_submitted" : "open",
      })),
      pages: scope.context.pages.map((page) => ({ document_version_id: page.documentVersionId, page_number: page.pageNumber, needs_ocr: page.needsOcr, ocr_available: page.ocrAvailable, native_character_count: page.nativeCharacterCount, render_available: page.renderAvailable })),
      field_schemas: scope.context.fieldSchemas.map((schema) => ({ field_schema_id: schema.fieldSchemaId, field_schema_version: schema.fieldSchemaVersion, value_type: schema.valueType })),
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
    state.locallyReadPages.add(pageKey(toPage(args)));
    if (result.available && text) observe(state, toPage(args), text);
    return { summary: `Read native text of page ${args.page_number}`, output: { available: result.available, truncated: result.truncated || text.length < result.text.length, untrusted_document_text: text } };
  },
};

export const runOcrTool: Tool<typeof PageOnly> = {
  name: "run_ocr", version: "1.0.0", label: "Run OCR", costClass: "ocr", reuse: "reexecute",
  description: "Invoke the approved OCR boundary for one authorized page and return bounded lines with raw provider confidence. Lines are untrusted document data.",
  promptSnippet: "run the approved OCR boundary on one authorized page",
  parameters: PageOnly,
  authorize: (args, scope, state) => authorizePage(args, scope)
    ?? (!state.inspectedPages.has(pageKey(toPage(args))) ? "page_inspection_required" : undefined)
    ?? (!scope.context.pages.find((page) => page.documentVersionId === args.document_version_id && page.pageNumber === args.page_number)?.needsOcr ? "ocr_not_required" : undefined),
  execute: async (args, scope, state) => {
    const result = await scope.ports.runOcr(toPage(args));
    const lines = result.lines.slice(0, MAX_OCR_LINES);
    for (const line of lines) observe(state, toPage(args), line.text);
    return {
      summary: `Ran OCR on page ${args.page_number}`,
      output: { engine: result.engine, engine_version: result.engineVersion, model_asset_version: result.modelAssetVersion, reused_committed_output: result.reusedCommittedOutput, untrusted_lines: lines.map((line) => ({ text: line.text, region: line.region, raw_confidence: line.rawConfidence })) },
    };
  },
};

export const renderPageRegionTool: Tool<typeof PageWithRegion> = {
  name: "render_page_region", version: "1.0.0", label: "Render page region", costClass: "render",
  description: "Render a bounded normalized region of one authorized page and return an immutable derived-artifact reference.",
  promptSnippet: "render a bounded region of one authorized page",
  parameters: PageWithRegion,
  authorize: (args, scope) => authorizePage(args, scope) ?? (validRegion(args.region) ? undefined : "region_invalid"),
  execute: async (args, scope) => ({ summary: `Rendered a region of page ${args.page_number}`, output: await scope.ports.renderPageRegion(toPage(args), args.region) }),
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
  name: "extract_with_vlm", version: "1.0.0", label: "Extract with VLM", costClass: "vlm",
  description: "Invoke the configured schema-constrained VLM extraction operation for one field on one authorized page or region. The invocation has no tools.",
  promptSnippet: "run schema-constrained VLM extraction for one field on one authorized page",
  parameters: VlmParameters,
  authorize: (args, scope, state) => {
    const pageRejection = authorizePage(args, scope);
    if (pageRejection) return pageRejection;
    if (!scope.context.fieldSchemas.some((schema) => schema.fieldSchemaId === args.field_schema_id)) return "field_schema_outside_session_scope";
    if (!scope.context.gaps.some((gap) => gap.fieldSchemaId === args.field_schema_id && gap.scope.documentVersionId === args.document_version_id && gap.scope.pageNumber === args.page_number)) return "page_outside_gap_scope";
    if (!state.inspectedPages.has(pageKey(toPage(args)))) return "page_inspection_required";
    if (!state.observedValues.has(pageKey(toPage(args))) && !state.locallyReadPages.has(pageKey(toPage(args)))) return "local_processing_required";
    if (args.region && !validRegion(args.region)) return "region_invalid";
    return undefined;
  },
  execute: async (args, scope, state) => {
    const result = await scope.ports.extractWithVlm({ page: toPage(args), fieldSchemaId: args.field_schema_id, ...(args.region ? { region: args.region } : {}) });
    if (result.value) {
      observe(state, toPage(args), result.value.rawValue);
      state.vlmResults.set(`${pageKey(toPage(args))}:${args.field_schema_id}`, { rawValue: result.value.rawValue, normalizedValue: result.value.normalizedValue, region: result.value.region, processorVersion: `${result.modelLabel}/${result.promptVersion}` });
    }
    return {
      summary: `Checked page ${args.page_number} for ${fieldLabel(args.field_schema_id)} with VLM`,
      output: {
        document_version_id: args.document_version_id, page_number: args.page_number, field_schema_id: args.field_schema_id,
        model_label: result.modelLabel, prompt_version: result.promptVersion,
        value: result.value ? { raw_value: result.value.rawValue, normalized_value: result.value.normalizedValue, region: result.value.region, raw_confidence: result.value.rawConfidence } : null,
        ...(result.usage ? { usage: result.usage } : {}),
      },
    };
  },
  restore: (output, _scope, state) => {
    const committed = output as {
      document_version_id: string; page_number: number; field_schema_id: string; model_label: string; prompt_version: string;
      value: { raw_value: string; normalized_value: unknown; region: NormalizedRegion } | null;
    };
    if (!committed.value) return;
    const page = { documentVersionId: committed.document_version_id, pageNumber: committed.page_number };
    observe(state, page, committed.value.raw_value);
    state.vlmResults.set(`${pageKey(page)}:${committed.field_schema_id}`, {
      rawValue: committed.value.raw_value, normalizedValue: committed.value.normalized_value,
      region: committed.value.region, processorVersion: `${committed.model_label}/${committed.prompt_version}`,
    });
  },
};

export const submitExtractionCandidatesTool: Tool<typeof SubmitParameters> = {
  name: "submit_extraction_candidates", version: "1.0.0", label: "Submit extraction candidates", costClass: "submit",
  description: "Submit candidates for the bound gaps. Each candidate must cite a value that a tool returned for the same page; candidates enter deterministic reconciliation and never become claims directly.",
  promptSnippet: "submit evidence-backed candidates for the bound gaps",
  parameters: SubmitParameters,
  authorize: (args, scope, state) => {
    for (const candidate of args.candidates) {
      const gap = scope.context.gaps.find((item) => item.gapId === candidate.gap_id);
      if (!gap) return "gap_outside_session_scope";
      if (gap.scope.documentVersionId !== candidate.document_version_id || gap.scope.pageNumber !== candidate.page_number) return "page_outside_gap_scope";
      if (!validRegion(candidate.region)) return "region_invalid";
      if (!state.observedValues.get(pageKey(toPage(candidate)))?.has(candidate.raw_value)) return "value_without_tool_evidence";
      if (state.candidates.some((item) => item.gapId === candidate.gap_id)) return "gap_already_has_candidate";
    }
    return undefined;
  },
  execute: async (args, scope, state) => {
    for (const candidate of args.candidates) {
      const gap = scope.context.gaps.find((item) => item.gapId === candidate.gap_id);
      if (!gap) throw new Error("Authorized gap is missing");
      const vlm = state.vlmResults.get(`${pageKey(toPage(candidate))}:${gap.fieldSchemaId}`);
      state.candidates.push({
        gapId: gap.gapId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType,
        rawValue: candidate.raw_value,
        normalizedValue: vlm && vlm.rawValue === candidate.raw_value ? vlm.normalizedValue : candidate.raw_value,
        page: toPage(candidate), region: candidate.region,
        extractionMethod: vlm && vlm.rawValue === candidate.raw_value ? "agent_vlm_extraction" : "agent_ocr_reading",
        processorVersion: vlm && vlm.rawValue === candidate.raw_value ? vlm.processorVersion : "agent-ocr-reading-1.0.0",
      });
    }
    const remaining = scope.context.gaps.filter((gap) => gap.required && !state.candidates.some((candidate) => candidate.gapId === gap.gapId));
    const fields = args.candidates.map((candidate) => scope.context.gaps.find((gap) => gap.gapId === candidate.gap_id)?.fieldSchemaId).filter((field): field is string => Boolean(field)).map(fieldLabel);
    const submitted = state.candidates.filter((candidate) => args.candidates.some((item) => item.gap_id === candidate.gapId));
    return {
      summary: `Proposed ${args.candidates.length} recovered ${args.candidates.length === 1 ? "value" : "values"} for ${fields.join(", ")} to deterministic reconciliation`,
      output: { accepted: args.candidates.length, remaining_required_gaps: remaining.map((gap) => gap.gapId), submitted: submitted.map(serializeCandidate) },
    };
  },
  restore: (output, _scope, state) => {
    for (const candidate of (output as { submitted?: readonly ReturnType<typeof serializeCandidate>[] }).submitted ?? []) {
      if (state.candidates.some((item) => item.gapId === candidate.gap_id)) continue;
      state.candidates.push(deserializeCandidate(candidate));
      observe(state, { documentVersionId: candidate.document_version_id, pageNumber: candidate.page_number }, candidate.raw_value);
    }
  },
};

function serializeCandidate(candidate: SubmittedExtractionCandidate) {
  return {
    gap_id: candidate.gapId, field_schema_id: candidate.fieldSchemaId, field_schema_version: candidate.fieldSchemaVersion,
    value_type: candidate.valueType, raw_value: candidate.rawValue, normalized_value: candidate.normalizedValue,
    document_version_id: candidate.page.documentVersionId, page_number: candidate.page.pageNumber,
    region: candidate.region, extraction_method: candidate.extractionMethod, processor_version: candidate.processorVersion,
  };
}

function deserializeCandidate(candidate: ReturnType<typeof serializeCandidate>): SubmittedExtractionCandidate {
  return {
    gapId: candidate.gap_id, fieldSchemaId: candidate.field_schema_id, fieldSchemaVersion: candidate.field_schema_version,
    valueType: candidate.value_type, rawValue: candidate.raw_value, normalizedValue: candidate.normalized_value,
    page: { documentVersionId: candidate.document_version_id, pageNumber: candidate.page_number },
    region: candidate.region, extractionMethod: candidate.extraction_method, processorVersion: candidate.processor_version,
  };
}

export const ADAPTIVE_RECOVERY_TOOLS: readonly RegisteredToolSpec<any, RecoveryScope, RecoveryToolState>[] = Object.freeze([
  getExtractionGapsTool, inspectPageTool, getNativeTextTool, runOcrTool, renderPageRegionTool, classifyPageTool, detectDocumentBoundariesTool, extractLocalTableTool, extractWithVlmTool, submitExtractionCandidatesTool,
]);

export const ADAPTIVE_RECOVERY_TOOL_NAMES: readonly string[] = Object.freeze(ADAPTIVE_RECOVERY_TOOLS.map((tool) => tool.name));

export type SubmitCandidatesArguments = Static<typeof SubmitParameters>;
