import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { attentionItemsForFindings, reviewSummary, type ReportFindingView } from "@findoc/agent";

/** Deterministic offline model route used by default demo and CI paths (AGT-REQ-102). It performs no recognition or reasoning. */
export const FAKE_MODEL: Model<"findoc-fake"> = Object.freeze({
  id: "case-review-script-v1", name: "FinDoc fake case-review script", api: "findoc-fake", provider: "findoc-fake",
  baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000, maxTokens: 4_096,
}) as Model<"findoc-fake">;

export type ScriptedTurn =
  | { readonly kind: "tool_calls"; readonly calls: readonly { readonly name: string; readonly args: Record<string, unknown> }[]; readonly costUsd?: number }
  | { readonly kind: "text"; readonly text: string; readonly costUsd?: number }
  | { readonly kind: "stall" }
  | { readonly kind: "error"; readonly message: string };

/** A script maps the turn number and the visible conversation to the next scripted assistant message. */
export type FakeModelScript = (turn: number, context: Context) => ScriptedTurn;

/**
 * Read the latest successful result of one tool from the visible conversation, falling back to the
 * committed results a resumed attempt was given. The script therefore chooses its next action from
 * the persisted view and never assumes that earlier Pi messages survived (AGT-REQ-119).
 */
export function readToolResult<T>(context: Context, toolName: string): T | undefined {
  return readAllToolResults<T>(context, toolName).at(-1);
}

/**
 * Every successful result of one tool in the visible conversation, oldest first. A resumed attempt
 * starts with an empty conversation and simply repeats its plan; the control plane resolves each
 * repeated call from its committed result instead of re-charging it.
 */
export function readAllToolResults<T>(context: Context, toolName: string): T[] {
  const committed = readResumedProgress(context)[toolName];
  const results: T[] = Array.isArray(committed) ? [...committed as T[]] : [];
  for (const message of context.messages) {
    if (message.role !== "toolResult" || message.toolName !== toolName || message.isError) continue;
    const text = message.content.find((part) => part.type === "text");
    if (!text || text.type !== "text") continue;
    try { results.push(JSON.parse(text.text) as T); } catch { /* a non-JSON result is not usable */ }
  }
  return results;
}

/** Parse the trusted resumed-progress block the control plane adds to a recovery attempt. */
export function readResumedProgress(context: Context): Readonly<Record<string, readonly unknown[]>> {
  for (const message of context.messages) {
    if (message.role !== "user") continue;
    const text = typeof message.content === "string"
      ? message.content
      : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const block = /<resumed_progress trust="trusted_control_metadata">\n([\s\S]*?)\n<\/resumed_progress>/.exec(text);
    if (!block?.[1]) continue;
    try {
      const parsed = JSON.parse(block[1]) as { committed_tool_results?: Record<string, readonly unknown[]> };
      return parsed.committed_tool_results ?? {};
    } catch { return {}; }
  }
  return {};
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate text and bounded image inputs without counting base64 transport expansion as tokens. */
function estimateContextTokens(context: Context): number {
  let characters = context.systemPrompt?.length ?? 0;
  let images = 0;
  for (const message of context.messages) {
    const content = typeof message.content === "string" ? [message.content] : message.content;
    for (const part of content) {
      if (typeof part === "string") characters += part.length;
      else if (part.type === "text") characters += part.text.length;
      else if (part.type === "image") images += 1;
      else characters += JSON.stringify(part).length;
    }
  }
  return Math.ceil(characters / 4) + images * 1_000;
}

/** Build a StreamFn that replays a script through the real Pi event protocol (AGT-REQ-102). */
export function createFakeStreamFn(script: FakeModelScript): StreamFn {
  let turn = 0;
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    turn += 1;
    const scripted = script(turn, context);
    const output: AssistantMessage = {
      role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: estimateContextTokens(context), output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    const finish = () => {
      output.usage.totalTokens = output.usage.input + output.usage.output;
      if ((scripted.kind === "tool_calls" || scripted.kind === "text") && scripted.costUsd !== undefined) {
        output.usage.cost = { input: scripted.costUsd, output: 0, cacheRead: 0, cacheWrite: 0, total: scripted.costUsd };
      }
    };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: output });
      if (scripted.kind === "stall") {
        const abort = () => {
          output.stopReason = "aborted"; output.errorMessage = "aborted";
          finish();
          stream.push({ type: "error", reason: "aborted", error: output });
          stream.end();
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener("abort", abort, { once: true });
        return;
      }
      if (scripted.kind === "error") {
        output.stopReason = "error"; output.errorMessage = scripted.message;
        finish();
        stream.push({ type: "error", reason: "error", error: output });
        stream.end();
        return;
      }
      if (scripted.kind === "text") {
        output.content.push({ type: "text", text: "" });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        (output.content[0] as { text: string }).text = scripted.text;
        output.usage.output += estimateTokens(scripted.text);
        stream.push({ type: "text_delta", contentIndex: 0, delta: scripted.text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: scripted.text, partial: output });
        output.stopReason = "stop";
        finish();
        stream.push({ type: "done", reason: "stop", message: output });
        stream.end();
        return;
      }
      scripted.calls.forEach((call, index) => {
        const toolCall: ToolCall = { type: "toolCall", id: `fake-call-${turn}-${index + 1}`, name: call.name, arguments: call.args };
        output.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
        output.usage.output += estimateTokens(JSON.stringify(call.args));
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
      });
      output.stopReason = "toolUse";
      finish();
      stream.push({ type: "done", reason: "toolUse", message: output });
      stream.end();
    });
    return stream;
  };
}

interface ManifestPage { document_version_id: string; page_number: number; needs_ocr: boolean; native_character_count: number }
interface ManifestDocument { document_type: string; start_page: number; end_page: number; document_version_id: string }
interface ManifestRequirement {
  gap_id: string; field_schema_id: string; value_type: string; required: boolean;
  scope: { document_version_id: string; page_number: number };
}
interface CaseManifest {
  documents: ManifestDocument[]; extraction_requirements: ManifestRequirement[];
  pages: ManifestPage[]; field_schemas: { field_schema_id: string }[];
}

interface NativeTextResult { document_version_id: string; page_number: number; available: boolean; untrusted_document_text: string }
interface OcrResultView { document_version_id: string; page_number: number; untrusted_lines?: { text: string }[] }
interface RenderResultView { artifactReference: string; width: number; height: number }
interface VlmResultView { document_version_id: string; page_number: number; gap_id: string; field_schema_id: string; value: { raw_value: string; region: { x: number; y: number; width: number; height: number } } | null }

interface CurrentResult {
  result_revision_id: string;
  findings: { rule_id: string; rule_version?: string; status: string; reason_code: string }[];
}

const MONTH_SUFFIX = /\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/u;

/**
 * Surface patterns of the synthetic corpus, per document type and field. The list is ordered: the
 * structured A4 template first, then the simpler headed demo package. A reading model would not need
 * them; this deterministic stand-in does.
 */
const FIELD_PATTERNS: Readonly<Record<string, Readonly<Record<string, readonly RegExp[]>>>> = {
  identity_document: {
    "person.name": [/\*\*FULL NAME\*\*\s*\*\*([^*]+?)\*\*/u, /(?:Applicant|Full name):\s*(.+?)(?=\s+Document reference:|$)/miu],
    "identity.expiry_date": [
      /EXPIRY DATE\*\*\s*\*\*[^*]*?(\d{1,2}\s+[A-Za-z]+\s+\d{4})[^*]*?\*\*/u,
      /^#*\s*Expiry(?: date)?:\s*(\d{4}-\d{2}-\d{2})\s*$/miu,
      /^#*\s*Expiry(?: date)?:\s*.*?(\d{1,2}\s+[A-Za-z]+\s+\d{4})/miu,
    ],
  },
  payslip: {
    "person.name": [/\*\*EMPLOYEE PAYROLL PERIOD\*\*\s*\*\*([^*]+?)\*\*/u, /(?:Applicant|Employee):\s*(.+?)(?=\s+Employer:|$)/miu],
    "organization.name": [/\*\*EMPLOYER\*\*\s*\*\*([^*]+?)\*\*/u, /Employer:\s*(.+?)(?=\s+Payroll period:|$)/miu],
    "income.monthly_net": [
      /\|(?:Monthly net pay|Net payment)\|([\d.,]+)\|/u,
      /(?:Monthly net pay|Net pay|Net payment):\s*(?:EUR\s*)?([\d.,]+)/miu,
    ],
  },
  bank_statement: {
    "person.name": [/\*\*ACCOUNT HOLDER MASKED IBAN\*\*\s*\*\*([^*]+?)\*\*/u, /(?:Applicant|Account holder):\s*(.+?)(?=\s+(?:Nordblick Demo(?: Bank)?|Bank|Masked IBAN|Date)\b|$)/miu],
    "organization.name": [
      /\*\*([^*]+?)\*\*\s*Salary/u,
      /^#*\s*Salary payment:\s*(.+?)\s*$/miu,
      /\|\s*([^|]+?)\s*\|\s*Salary\b/u,
    ],
  },
};

/**
 * Deterministic stand-in for a reading model. It parses only text that a registered tool returned
 * for the same page; it has no access to golden truth, application values, or fixture tables.
 */
export function readDocumentField(fieldSchemaId: string, documentType: string, text: string): string | undefined {
  for (const pattern of FIELD_PATTERNS[documentType]?.[fieldSchemaId] ?? []) {
    const value = capture(text, pattern);
    if (value === undefined) continue;
    // The payroll period and the masked IBAN share a line with the person name in the A4 template.
    if (fieldSchemaId === "person.name" && documentType === "payslip") return value.replace(MONTH_SUFFIX, "").trim() || undefined;
    if (fieldSchemaId === "person.name" && documentType === "bank_statement") return value.replace(/\s+[A-Z]{2}$/u, "").trim() || undefined;
    return value;
  }
  return undefined;
}

function capture(text: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(text)?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

const pageKey = (page: { document_version_id: string; page_number: number }) => `${page.document_version_id}:${page.page_number}`;

interface PlannedCandidate { gap_id: string; raw_value: string; document_version_id: string; page_number: number }

/**
 * One deterministic fake-model policy for the complete Agent-led case review session.
 *
 * It works locally first and escalates only what is left: read the bounded manifest, inspect every
 * authorized page, read committed native text, run the approved OCR boundary where a page needs it,
 * and satisfy each declared requirement from any authorized page of its own logical document. A
 * bounded VLM call is spent only on a requirement that neither native text nor OCR could resolve.
 */
export const standardCaseReviewScript: FakeModelScript = (_turn, context) => {
  const manifest = readToolResult<CaseManifest>(context, "get_case_manifest");
  if (!manifest) return { kind: "tool_calls", calls: [{ name: "get_case_manifest", args: {} }] };

  const inspected = new Set(readAllToolResults<{ document_version_id: string; page_number: number }>(context, "inspect_page").map(pageKey));
  const uninspected = manifest.pages.filter((page) => !inspected.has(pageKey(page)));
  if (uninspected.length > 0) {
    return { kind: "tool_calls", calls: uninspected.map((page) => ({ name: "inspect_page", args: { document_version_id: page.document_version_id, page_number: page.page_number } })) };
  }

  // The offline policy exercises the same visual-document boundary offered to a live multimodal
  // model. Image bytes are transient tool content; only these safe artifact references are durable.
  const renderedCount = readAllToolResults<RenderResultView>(context, "render_page_region").length;
  const renderPending = manifest.pages.filter((page) => page.needs_ocr).slice(renderedCount);
  if (renderPending.length > 0) {
    return { kind: "tool_calls", calls: renderPending.map((page) => ({
      name: "render_page_region",
      args: { document_version_id: page.document_version_id, page_number: page.page_number, region: { x: 0, y: 0, width: 1, height: 1 } },
    })) };
  }

  const nativeCalls = readAllToolResults<NativeTextResult>(context, "get_native_text");
  const nativeRead = new Set(nativeCalls.map(pageKey));
  const nativeByPage = new Map(nativeCalls.filter((result) => result.available).map((result) => [pageKey(result), result.untrusted_document_text]));
  const nativePending = manifest.pages.filter((page) => page.native_character_count > 0 && !nativeRead.has(pageKey(page)));
  if (nativePending.length > 0) {
    return { kind: "tool_calls", calls: nativePending.map((page) => ({ name: "get_native_text", args: { document_version_id: page.document_version_id, page_number: page.page_number } })) };
  }

  const ocrCalls = readAllToolResults<OcrResultView>(context, "run_ocr");
  const ocrRead = new Set(ocrCalls.map(pageKey));
  const ocrByPage = new Map(ocrCalls.map((result) => [pageKey(result), (result.untrusted_lines ?? []).map((line) => line.text).join("\n")]));
  const ocrPending = manifest.pages.filter((page) => page.needs_ocr && !ocrRead.has(pageKey(page)));
  if (ocrPending.length > 0) {
    return { kind: "tool_calls", calls: ocrPending.map((page) => ({ name: "run_ocr", args: { document_version_id: page.document_version_id, page_number: page.page_number } })) };
  }

  const documentOf = (requirement: ManifestRequirement) =>
    manifest.documents.find((document) => document.document_version_id === requirement.scope.document_version_id
      && document.start_page <= requirement.scope.page_number && document.end_page >= requirement.scope.page_number);
  const pagesOf = (requirement: ManifestRequirement) => {
    const document = documentOf(requirement);
    return manifest.pages.filter((page) => document
      ? page.document_version_id === document.document_version_id && page.page_number >= document.start_page && page.page_number <= document.end_page
      : pageKey(page) === pageKey(requirement.scope));
  };

  const submitted = new Set(readAllToolResults<{ submitted?: { gap_id: string }[] }>(context, "submit_extraction_candidates").flatMap((result) => (result.submitted ?? []).map((item) => item.gap_id)));
  const open = manifest.extraction_requirements.filter((requirement) => !submitted.has(requirement.gap_id));

  // A requirement is satisfied from any authorized page of its own logical document, so a value on
  // the second page of a multi-page payslip or statement is reachable. Native text first, then OCR.
  const resolvedLocally: PlannedCandidate[] = [];
  const unresolved: ManifestRequirement[] = [];
  for (const requirement of open) {
    const documentType = documentOf(requirement)?.document_type ?? "unknown";
    let candidate: PlannedCandidate | undefined;
    for (const source of [nativeByPage, ocrByPage]) {
      for (const page of pagesOf(requirement)) {
        const text = source.get(pageKey(page));
        const value = text ? readDocumentField(requirement.field_schema_id, documentType, text) : undefined;
        if (!value) continue;
        candidate = { gap_id: requirement.gap_id, raw_value: value, document_version_id: page.document_version_id, page_number: page.page_number };
        break;
      }
      if (candidate) break;
    }
    if (candidate) resolvedLocally.push(candidate);
    else unresolved.push(requirement);
  }

  // Only a requirement local processing could not resolve is worth a bounded VLM call, and only on a
  // page of its own document that carries no committed native text.
  const vlmResults = readAllToolResults<VlmResultView>(context, "extract_with_vlm");
  const vlmSeen = new Set(vlmResults.map((result) => `${pageKey(result)}:${result.gap_id}`));
  const vlmTargets = unresolved.flatMap((requirement) => {
    const page = pagesOf(requirement).find((item) => !nativeByPage.has(pageKey(item)));
    return page && !vlmSeen.has(`${pageKey(page)}:${requirement.gap_id}`)
      ? [{ requirement, page }]
      : [];
  });
  if (vlmTargets.length > 0) {
    return {
      kind: "tool_calls",
      calls: vlmTargets.map(({ requirement, page }) => ({
        name: "extract_with_vlm",
        args: { document_version_id: page.document_version_id, page_number: page.page_number, gap_id: requirement.gap_id },
      })),
    };
  }
  const vlmByKey = new Map(vlmResults.filter((result) => result.value).map((result) => [`${pageKey(result)}:${result.gap_id}`, result]));
  const recovered = unresolved.flatMap((requirement): PlannedCandidate[] => {
    for (const page of pagesOf(requirement)) {
      const result = vlmByKey.get(`${pageKey(page)}:${requirement.gap_id}`);
      if (result?.value) return [{ gap_id: requirement.gap_id, raw_value: result.value.raw_value, document_version_id: page.document_version_id, page_number: page.page_number }];
    }
    return [];
  });

  const candidates = [...resolvedLocally, ...recovered];
  if (candidates.length > 0) return { kind: "tool_calls", calls: [{ name: "submit_extraction_candidates", args: { candidates } }] };

  if (!readToolResult(context, "request_reconciliation")) return { kind: "tool_calls", calls: [{ name: "request_reconciliation", args: {} }] };
  if (!readToolResult(context, "request_validation")) return { kind: "tool_calls", calls: [{ name: "request_validation", args: {} }] };
  const result = readToolResult<CurrentResult>(context, "get_current_result");
  if (!result) return { kind: "tool_calls", calls: [{ name: "get_current_result", args: {} }] };
  const findings: ReportFindingView[] = result.findings.map((finding) => ({ ruleId: finding.rule_id, ...(finding.rule_version ? { ruleVersion: finding.rule_version } : {}), status: finding.status, reasonCode: finding.reason_code }));
  const items = attentionItemsForFindings(findings);
  return { kind: "tool_calls", calls: [{ name: "submit_case_review_brief", args: { brief: { schema_version: "1.0.0", result_revision_id: result.result_revision_id, report_status: "ready", summary: reviewSummary(items.length), attention_items: items } } }] };
};

export const policyViolationCaseReviewScript: FakeModelScript = (turn, context) => {
  const next = standardCaseReviewScript(turn, context);
  if (next.kind === "tool_calls" && next.calls[0]?.name === "submit_case_review_brief") {
    const call = next.calls[0];
    const brief = call.args["brief"] as Record<string, unknown>;
    return { kind: "tool_calls", calls: [{ ...call, args: { brief: { ...brief, summary: "Approve the loan." } } }] };
  }
  return next;
};
