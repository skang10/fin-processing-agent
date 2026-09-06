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

interface ListedFinding { rule_id: string; status: string; reason_code: string; rule_version?: string }

/** Read the latest successful tool result of one tool from the conversation, exactly as the model would see it. */
export function readToolResult<T>(context: Context, toolName: string): T | undefined {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role !== "toolResult" || message.toolName !== toolName || message.isError) continue;
    const text = message.content.find((part) => part.type === "text");
    if (!text || text.type !== "text") return undefined;
    try { return JSON.parse(text.text) as T; } catch { return undefined; }
  }
  return undefined;
}

function listedFindings(context: Context): readonly ReportFindingView[] {
  const listed = readToolResult<{ findings: ListedFinding[] }>(context, "list_findings");
  return (listed?.findings ?? []).map((finding) => ({ ruleId: finding.rule_id, status: finding.status, reasonCode: finding.reason_code, ...(finding.rule_version ? { ruleVersion: finding.rule_version } : {}) }));
}

function resultRevisionId(context: Context): string {
  return readToolResult<{ result_revision_id: string }>(context, "list_findings")?.result_revision_id ?? "unknown";
}

function briefCall(context: Context, summaryOverride?: string): ScriptedTurn {
  const findings = listedFindings(context);
  const items = attentionItemsForFindings(findings);
  return { kind: "tool_calls", calls: [{ name: "submit_case_review_brief", args: { brief: {
    schema_version: "1.0.0", result_revision_id: resultRevisionId(context), report_status: "ready",
    summary: summaryOverride ?? `Document processing completed with ${items.length} items requiring human review.`,
    attention_items: items,
  } } }] };
}

/** Lists findings, inspects the first failed finding's references, then submits a schema-valid brief. */
export const standardReportScript: FakeModelScript = (turn, context) => {
  if (turn === 1) return { kind: "tool_calls", calls: [{ name: "list_findings", args: {} }] };
  const failed = listedFindings(context).find((finding) => finding.status !== "passed" && finding.status !== "not_applicable");
  if (turn === 2 && failed) return { kind: "tool_calls", calls: [{ name: "get_finding_references", args: { rule_id: failed.ruleId } }] };
  if (turn <= 3) return briefCall(context);
  return { kind: "text", text: "The brief has been submitted." };
};

/** Submits a brief containing prohibited decision language so the deterministic verifier rejects it. */
export const policyViolationScript: FakeModelScript = (turn, context) => {
  if (turn === 1) return { kind: "tool_calls", calls: [{ name: "list_findings", args: {} }] };
  if (turn === 2) return briefCall(context, "Approve the loan.");
  return { kind: "text", text: "Done." };
};

/** Attempts shell, file, and out-of-scope access before completing the bounded task. */
export const injectionAttemptScript: FakeModelScript = (turn, context) => {
  if (turn === 1) return { kind: "tool_calls", calls: [{ name: "bash", args: { command: "cat /etc/passwd" } }, { name: "read", args: { path: "/etc/hosts" } }] };
  if (turn === 2) return { kind: "tool_calls", calls: [{ name: "get_finding_references", args: { rule_id: "VAL_NOT_IN_SCOPE_999" } }] };
  if (turn === 3) return { kind: "tool_calls", calls: [{ name: "list_findings", args: {} }] };
  if (turn === 4) return briefCall(context);
  return { kind: "text", text: "Done." };
};

/** Repeats the same tool call forever; the no-progress policy must stop it. */
export const runawayScript: FakeModelScript = () => ({ kind: "tool_calls", calls: [{ name: "list_findings", args: {} }] });

/** Never answers; the wall-clock budget must stop it. */
export const stallScript: FakeModelScript = () => ({ kind: "stall" });

/** Ends immediately without submitting anything. */
export const silentScript: FakeModelScript = () => ({ kind: "text", text: "No brief." });

/** Fails like an unavailable provider. */
export const providerErrorScript: FakeModelScript = () => ({ kind: "error", message: "provider unavailable" });

/** Reports a large estimated cost on every turn so the cost budget stops the session. */
export const expensiveScript: FakeModelScript = (turn, context) => {
  const next = standardReportScript(turn, context);
  return next.kind === "tool_calls" || next.kind === "text" ? { ...next, costUsd: 1 } : next;
};

export const FAKE_MODEL_SCRIPTS: Readonly<Record<string, FakeModelScript>> = Object.freeze({
  standard: standardReportScript, policy_violation: policyViolationScript, injection_attempt: injectionAttemptScript,
  runaway: runawayScript, stall: stallScript, silent: silentScript, provider_error: providerErrorScript, expensive: expensiveScript,
});

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
