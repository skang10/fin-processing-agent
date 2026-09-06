import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_BUDGET, type AgentLedCaseReviewContext, type CaseReviewProcessingPorts } from "@findoc/agent";
import { PiAgentLedCaseReviewHarness } from "./harness.js";
import { policyViolationCaseReviewScript, standardCaseReviewScript, type FakeModelScript } from "./fake-model.js";
import { CASE_REVIEW_PROMPT_HASH } from "./prompt.js";

const page = { documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1, needsOcr: true, ocrAvailable: true, nativeCharacterCount: 0, renderAvailable: true };
const context = (withGap: boolean): AgentLedCaseReviewContext => ({
  runId: "run-1", pages: [page], fieldSchemas: [{ fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" }],
  gaps: withGap ? [{ gapId: "gap-1", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money", required: true, originatingStage: "extract", reasonCode: "missing", attemptedPaths: ["native_text"], scope: { documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1 } }] : [],
});

function ports(): CaseReviewProcessingPorts {
  return {
    inspectPage: vi.fn(async () => ({ needsOcr: true, ocrReason: "image_only", hasTable: false, hasColumns: false, nativeCharacterCount: 0, renderAvailable: true, ocrAvailable: true })),
    getNativeText: vi.fn(async () => ({ available: false, text: "", truncated: false })),
    runOcr: vi.fn(async () => ({ engine: "fake", engineVersion: "1", modelAssetVersion: "fixture", lines: [{ text: "2980.00", region: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, rawConfidence: 0.9 }], reusedCommittedOutput: false })),
    renderPageRegion: vi.fn(async () => ({ artifactReference: "render-1", width: 100, height: 50 })),
    classifyPage: vi.fn(async () => ({ candidates: [{ type: "payslip", rawConfidence: 0.9 }], method: "fake", version: "1" })),
    detectDocumentBoundaries: vi.fn(async () => ({ startsNewDocument: true, method: "fake", version: "1" })),
    extractLocalTable: vi.fn(async () => ({ available: false, rowCount: 0 })),
    extractWithVlm: vi.fn(async () => ({ modelLabel: "fake-vlm", promptVersion: "1", value: { rawValue: "2980.00", normalizedValue: { amount: "2980.00", currency: "EUR" }, region: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, rawConfidence: 0.9 } })),
    requestReconciliation: vi.fn(async () => ({ reference: "reconciliation-1" })),
    requestValidation: vi.fn(async () => ({ resultRevisionId: "result-1", findings: [], recommendedDisposition: "ready_for_downstream_processing", allowedReferences: new Set<string>() })),
  };
}

describe("PiAgentLedCaseReviewHarness", () => {
  it("uses one Pi session from document review through report submission", async () => {
    const service = ports();
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript, scriptLabel: "standard" } }).review(context(true), service);
    expect(outcome.trace).toMatchObject({ mode: "case_review", terminalReason: "report_submitted" });
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.trace.steps.map((step) => step.toolName)).toEqual([
      "get_extraction_gaps", "inspect_page", "run_ocr", "extract_with_vlm", "submit_extraction_candidates",
      "request_reconciliation", "request_validation", "get_current_result", "submit_case_review_brief",
    ]);
    expect(service.requestReconciliation).toHaveBeenCalledOnce();
    expect(service.requestValidation).toHaveBeenCalledOnce();
    expect(outcome.trace.promptHash).toBe(CASE_REVIEW_PROMPT_HASH);
    expect(outcome.trace.offeredTools).not.toContain("bash");
    expect(outcome.trace.offeredTools).not.toContain("read");
  });

  it("keeps prohibited report language as an unverified submission for the external verifier", async () => {
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: policyViolationCaseReviewScript, scriptLabel: "policy_violation" } }).review(context(false), ports());
    expect(outcome.trace.terminalReason).toBe("report_submitted");
    expect(outcome.submission).toMatchObject({ summary: "Approve the loan." });
  });

  it("rejects unknown coding tools without granting extra authority", async () => {
    const script: FakeModelScript = (turn, visible) => turn === 1
      ? { kind: "tool_calls", calls: [{ name: "bash", args: { command: "cat /etc/passwd" } }, { name: "read", args: { path: "/etc/hosts" } }] }
      : standardCaseReviewScript(turn - 1, visible);
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script }, budget: { ...DEFAULT_AGENT_BUDGET, maxConsecutiveNoProgressSteps: 5 } }).review(context(true), ports());
    expect(outcome.trace.steps.slice(0, 2).map((step) => `${step.toolName}:${step.outcome}`)).toEqual(["bash:unknown_tool_rejected", "read:unknown_tool_rejected"]);
    expect(outcome.trace.terminalReason).toBe("report_submitted");
  });

  it("enforces OCR and VLM budgets in the unified session", async () => {
    const ocrLimited = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, budget: { ...DEFAULT_AGENT_BUDGET, maxOcrPages: 0 } }).review(context(true), ports());
    expect(ocrLimited.trace.steps.at(-1)).toMatchObject({ toolName: "run_ocr", outcome: "budget_rejected" });
    expect(ocrLimited.trace.terminalReason).toBe("tool_budget_exhausted");

    const vlmLimited = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, budget: { ...DEFAULT_AGENT_BUDGET, maxVlmCalls: 0 } }).review(context(true), ports());
    expect(vlmLimited.trace.steps.at(-1)).toMatchObject({ toolName: "extract_with_vlm", outcome: "budget_rejected" });
    expect(vlmLimited.trace.terminalReason).toBe("tool_budget_exhausted");
  });

  it("stops repeated identical calls as no progress", async () => {
    const script: FakeModelScript = () => ({ kind: "tool_calls", calls: [{ name: "get_extraction_gaps", args: {} }] });
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script } }).review(context(true), ports());
    expect(outcome.trace.terminalReason).toBe("no_progress");
    expect(outcome.trace.steps.map((step) => step.outcome)).toEqual(["succeeded", "duplicate_resolved", "duplicate_resolved"]);
  });

  it("enforces iteration, token, cost, and wall-clock budgets", async () => {
    const iteration = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, budget: { ...DEFAULT_AGENT_BUDGET, maxIterations: 1 } }).review(context(false), ports());
    expect(iteration.trace).toMatchObject({ terminalReason: "iteration_budget_exhausted", iterations: 1 });

    const token = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, budget: { ...DEFAULT_AGENT_BUDGET, maxInputTokens: 1 } }).review(context(false), ports());
    expect(token.trace.terminalReason).toBe("token_budget_exhausted");

    const costly: FakeModelScript = (turn, visible) => {
      const next = standardCaseReviewScript(turn, visible);
      return next.kind === "tool_calls" || next.kind === "text" ? { ...next, costUsd: 1 } : next;
    };
    const cost = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: costly }, budget: { ...DEFAULT_AGENT_BUDGET, maxEstimatedCostUsd: 0.5 } }).review(context(false), ports());
    expect(cost.trace.terminalReason).toBe("cost_budget_exhausted");

    const stall: FakeModelScript = () => ({ kind: "stall" });
    const timed = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: stall }, budget: { ...DEFAULT_AGENT_BUDGET, maxWallClockMs: 100 } }).review(context(false), ports());
    expect(timed.trace).toMatchObject({ terminalReason: "timeout", steps: [] });
  });

  it("records provider failure and missing report terminal states", async () => {
    const unavailable = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: () => ({ kind: "error", message: "provider unavailable" }) } }).review(context(false), ports());
    expect(unavailable.trace.terminalReason).toBe("model_unavailable");

    const silent = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: () => ({ kind: "text", text: "No report." }) } }).review(context(false), ports());
    expect(silent.trace).toMatchObject({ terminalReason: "report_not_submitted", toolCalls: 0 });
  });

  it("rejects schema-invalid report submissions at the tool boundary", async () => {
    const script: FakeModelScript = (turn, visible) => {
      const current = standardCaseReviewScript(turn, visible);
      if (current.kind === "tool_calls" && current.calls[0]?.name === "submit_case_review_brief") {
        return { kind: "tool_calls", calls: [{ name: "submit_case_review_brief", args: { brief: { schema_version: "9.9.9" } } }] };
      }
      return current;
    };
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script } }).review(context(false), ports());
    expect(outcome.trace.steps.at(-1)).toMatchObject({ toolName: "submit_case_review_brief", outcome: "schema_rejected" });
    expect(outcome.submission).toBeUndefined();
  });

  it("rejects pages outside the case and fabricated candidate values", async () => {
    const script: FakeModelScript = (turn, visible) => {
      if (turn === 1) return { kind: "tool_calls", calls: [{ name: "get_extraction_gaps", args: {} }] };
      if (turn === 2) return { kind: "tool_calls", calls: [{ name: "get_native_text", args: { document_version_id: "other-document", page_number: 1 } }] };
      if (turn === 3) return { kind: "tool_calls", calls: [{ name: "submit_extraction_candidates", args: { candidates: [{ gap_id: "gap-1", raw_value: "9999.00", document_version_id: "document-1", page_number: 1, region: { x: 0, y: 0, width: 1, height: 1 } }] } }] };
      return standardCaseReviewScript(turn - 3, visible);
    };
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script }, budget: { ...DEFAULT_AGENT_BUDGET, maxConsecutiveNoProgressSteps: 5 } }).review(context(true), ports());
    expect(outcome.trace.steps.slice(1, 3).map((step) => step.outcome)).toEqual(["authorization_rejected", "authorization_rejected"]);
    expect(outcome.candidates).toEqual([]);
    expect(outcome.trace.terminalReason).toBe("report_submitted");
  });

  it("does not start an unregistered live model route", async () => {
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "live", provider: "anthropic", modelId: "no-such-model-000", apiKey: "not-a-real-key" } }).review(context(false), ports());
    expect(outcome.trace).toMatchObject({ terminalReason: "model_unavailable", modelRoute: "live", iterations: 0, offeredTools: [] });
    expect(outcome.submission).toBeUndefined();
  });
});
