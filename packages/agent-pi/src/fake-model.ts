import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { attentionItemsForFindings, type ReportFindingView } from "@findoc/agent";

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
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role !== "toolResult" || message.toolName !== toolName || message.isError) continue;
    const text = message.content.find((part) => part.type === "text");
    if (!text || text.type !== "text") return undefined;
    try { return JSON.parse(text.text) as T; } catch { return undefined; }
  }
  return readResumedProgress(context)[toolName] as T | undefined;
}

/** Parse the trusted resumed-progress block the control plane adds to a recovery attempt. */
export function readResumedProgress(context: Context): Readonly<Record<string, unknown>> {
  for (const message of context.messages) {
    if (message.role !== "user") continue;
    const text = typeof message.content === "string"
      ? message.content
      : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const block = /<resumed_progress trust="trusted_control_metadata">\n([\s\S]*?)\n<\/resumed_progress>/.exec(text);
    if (!block?.[1]) continue;
    try {
      const parsed = JSON.parse(block[1]) as { committed_tool_results?: Record<string, unknown> };
      return parsed.committed_tool_results ?? {};
    } catch { return {}; }
  }
  return {};
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
      usage: { input: estimateTokens(JSON.stringify(context.messages) + (context.systemPrompt ?? "")), output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
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

interface ListedGap { gap_id: string; field_schema_id: string; scope: { document_version_id: string; page_number: number } }

interface CurrentResult {
  result_revision_id: string;
  findings: { rule_id: string; rule_version?: string; status: string; reason_code: string }[];
}

/** One deterministic fake-model policy for the complete Agent-led case review session. */
export const standardCaseReviewScript: FakeModelScript = (_turn, context) => {
  const gapsResult = readToolResult<{ gaps: ListedGap[]; pages: { document_version_id: string; page_number: number; needs_ocr: boolean }[] }>(context, "get_extraction_gaps");
  if (!gapsResult) return { kind: "tool_calls", calls: [{ name: "get_extraction_gaps", args: {} }] };
  const gap = gapsResult.gaps[0];
  const reviewPage = gap?.scope ?? gapsResult.pages[0];
  if (reviewPage && !readToolResult(context, "inspect_page")) {
    return { kind: "tool_calls", calls: [{ name: "inspect_page", args: { document_version_id: reviewPage.document_version_id, page_number: reviewPage.page_number } }] };
  }
  if (!gap && reviewPage && !readToolResult(context, "get_native_text")) {
    return { kind: "tool_calls", calls: [{ name: "get_native_text", args: { document_version_id: reviewPage.document_version_id, page_number: reviewPage.page_number } }] };
  }
  if (gap && !readToolResult(context, "run_ocr")) {
    return { kind: "tool_calls", calls: [{ name: "run_ocr", args: { document_version_id: gap.scope.document_version_id, page_number: gap.scope.page_number } }] };
  }
  if (gap && !readToolResult(context, "extract_with_vlm")) {
    return { kind: "tool_calls", calls: [{ name: "extract_with_vlm", args: { document_version_id: gap.scope.document_version_id, page_number: gap.scope.page_number, field_schema_id: gap.field_schema_id } }] };
  }
  if (gap && !readToolResult(context, "submit_extraction_candidates")) {
    const vlm = readToolResult<{ value: { raw_value: string; region: { x: number; y: number; width: number; height: number } } | null }>(context, "extract_with_vlm");
    if (vlm?.value) return { kind: "tool_calls", calls: [{ name: "submit_extraction_candidates", args: { candidates: [{ gap_id: gap.gap_id, raw_value: vlm.value.raw_value, document_version_id: gap.scope.document_version_id, page_number: gap.scope.page_number, region: vlm.value.region }] } }] };
  }
  if (!readToolResult(context, "request_reconciliation")) return { kind: "tool_calls", calls: [{ name: "request_reconciliation", args: {} }] };
  if (!readToolResult(context, "request_validation")) return { kind: "tool_calls", calls: [{ name: "request_validation", args: {} }] };
  const result = readToolResult<CurrentResult>(context, "get_current_result");
  if (!result) return { kind: "tool_calls", calls: [{ name: "get_current_result", args: {} }] };
  const findings: ReportFindingView[] = result.findings.map((finding) => ({ ruleId: finding.rule_id, ...(finding.rule_version ? { ruleVersion: finding.rule_version } : {}), status: finding.status, reasonCode: finding.reason_code }));
  const items = attentionItemsForFindings(findings);
  return { kind: "tool_calls", calls: [{ name: "submit_case_review_brief", args: { brief: { schema_version: "1.0.0", result_revision_id: result.result_revision_id, report_status: "ready", summary: `Document processing completed with ${items.length} items requiring human review.`, attention_items: items } } }] };
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
