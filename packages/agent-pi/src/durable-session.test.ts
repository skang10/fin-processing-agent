import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_BUDGET, InMemoryAgentSessionLifecycle, type AgentLedCaseReviewContext, type CaseReviewProcessingPorts } from "@findoc/agent";
import type { AgentRecoverySnapshot } from "@findoc/core";
import { PiAgentLedCaseReviewHarness } from "./harness.js";
import { policyViolationCaseReviewScript, standardCaseReviewScript, type FakeModelScript } from "./fake-model.js";

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const CASE_ID = "99999999-8888-4777-8666-555555555555";

export const reviewPage = {
  documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1,
  needsOcr: true, ocrAvailable: true, nativeCharacterCount: 0, renderAvailable: true,
};

export function reviewContext(withGap: boolean): AgentLedCaseReviewContext {
  return {
    runId: RUN_ID, caseId: CASE_ID, pages: [reviewPage],
    fieldSchemas: [{ fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" }],
    gaps: withGap
      ? [{
        gapId: "gap-1", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money",
        required: true, originatingStage: "extract", reasonCode: "missing", attemptedPaths: ["native_text"],
        scope: { documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1 },
      }]
      : [],
  };
}

export function reviewPorts(overrides: Partial<CaseReviewProcessingPorts> = {}): CaseReviewProcessingPorts {
  return {
    inspectPage: vi.fn(async () => ({ needsOcr: true, ocrReason: "image_only", hasTable: false, hasColumns: false, nativeCharacterCount: 0, renderAvailable: true, ocrAvailable: true })),
    getNativeText: vi.fn(async () => ({ available: false, text: "", truncated: false })),
    runOcr: vi.fn(async () => ({ engine: "fake", engineVersion: "1", modelAssetVersion: "fixture", lines: [{ text: "2980.00", region: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, rawConfidence: 0.9 }], reusedCommittedOutput: false })),
    renderPageRegion: vi.fn(async () => ({ artifactReference: "render-artifact-1", width: 100, height: 50 })),
    classifyPage: vi.fn(async () => ({ candidates: [{ type: "payslip", rawConfidence: 0.9 }], method: "fake", version: "1" })),
    detectDocumentBoundaries: vi.fn(async () => ({ startsNewDocument: true, method: "fake", version: "1" })),
    extractLocalTable: vi.fn(async () => ({ available: false, rowCount: 0 })),
    extractWithVlm: vi.fn(async () => ({ modelLabel: "fake-vlm", promptVersion: "1", value: { rawValue: "2980.00", normalizedValue: { amount: "2980.00", currency: "EUR" }, region: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, rawConfidence: 0.9 } })),
    requestReconciliation: vi.fn(async () => ({ reference: "reconciliation-1" })),
    requestValidation: vi.fn(async () => ({
      resultRevisionId: "result-1",
      findings: [{ ruleId: "VAL_EMPLOYER_CONSISTENCY_001", ruleVersion: "1.0.0", status: "failed", reasonCode: "employer_conflict", references: ["claim-1"] }],
      recommendedDisposition: "human_review_required",
      allowedReferences: new Set(["finding:VAL_EMPLOYER_CONSISTENCY_001"]),
    })),
    ...overrides,
  };
}

describe("durable case-review checkpoints", () => {
  it("persists each completed step before the session terminates", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const observed: { atReconciliation?: AgentRecoverySnapshot; atValidation?: AgentRecoverySnapshot } = {};
    const ports = reviewPorts({
      requestReconciliation: vi.fn(async () => {
        observed.atReconciliation = await lifecycle.loadSnapshot(RUN_ID);
        return { reference: "reconciliation-1" };
      }),
    });
    const validation = ports.requestValidation;
    ports.requestValidation = vi.fn(async () => {
      observed.atValidation = await lifecycle.loadSnapshot(RUN_ID);
      return validation();
    });

    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, lifecycle }).review(reviewContext(true), ports);

    expect(observed.atReconciliation?.status).toBe("running");
    expect(observed.atReconciliation?.steps.map((step) => step.toolName)).toEqual([
      "get_case_manifest", "inspect_page", "run_ocr", "extract_with_vlm", "submit_extraction_candidates",
    ]);
    expect(observed.atValidation?.steps.at(-1)?.toolName).toBe("request_reconciliation");
    expect(observed.atValidation?.consumed.toolCalls).toBe(6);
    expect(outcome.trace.terminalReason).toBe("report_submitted");
  });

  it("builds the reviewer trace from durable records and records one terminal reason", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, lifecycle }).review(reviewContext(true), reviewPorts());
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    expect(snapshot).toMatchObject({ status: "terminal", terminalReason: "report_submitted", attempts: 1 });
    expect(outcome.trace.steps).toEqual(snapshot?.steps);
    expect(outcome.trace.iterations).toBe(snapshot?.consumed.iterations);
    expect(outcome.trace.toolCalls).toBe(snapshot?.consumed.toolCalls);
    expect(outcome.attemptNumber).toBe(1);
    expect(outcome.resumed).toBe(false);
  });

  it("links the immutable records each committed step produced", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const script: FakeModelScript = (turn, visible) => turn === 1
      ? { kind: "tool_calls", calls: [{ name: "inspect_page", args: { document_version_id: "document-1", page_number: 1 } }] }
      : turn === 2
        ? { kind: "tool_calls", calls: [{ name: "render_page_region", args: { document_version_id: "document-1", page_number: 1, region: { x: 0, y: 0, width: 0.5, height: 0.5 } } }] }
        : standardCaseReviewScript(turn - 2, visible);
    await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script }, lifecycle, budget: { ...DEFAULT_AGENT_BUDGET, maxConsecutiveNoProgressSteps: 6 } }).review(reviewContext(true), reviewPorts());
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    const references = Object.fromEntries((snapshot?.committedToolResults ?? []).map((result) => [result.toolName, result.producedReferences]));
    expect(references["render_page_region"]).toEqual([{ kind: "artifact", id: "render-artifact-1" }]);
    expect(references["request_reconciliation"]).toEqual([{ kind: "reconciliation", id: "reconciliation-1" }]);
    expect(references["request_validation"]).toEqual([{ kind: "result_revision", id: "result-1" }]);
    expect(references["submit_case_review_brief"]).toEqual([{ kind: "report_submission", id: "result-1" }]);
  });

  it("retains only a bounded payload for tools whose output carries document text", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, lifecycle }).review(reviewContext(true), reviewPorts());
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    const byTool = new Map((snapshot?.committedToolResults ?? []).map((result) => [result.toolName, result]));
    expect(byTool.get("run_ocr")?.safeOutput).toBeUndefined();
    expect(byTool.get("run_ocr")?.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(byTool.get("extract_with_vlm")?.safeOutput).toMatchObject({ value: { raw_value: "2980.00" } });
    expect(JSON.stringify(snapshot?.committedToolResults)).not.toContain("untrusted_document_text");
  });

  it("durably records rejected requests without granting authority", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const script: FakeModelScript = (turn, visible) => {
      if (turn === 1) return { kind: "tool_calls", calls: [{ name: "bash", args: { command: "id" } }] };
      if (turn === 2) return { kind: "tool_calls", calls: [{ name: "inspect_page", args: { document_version_id: "other-document", page_number: 1 } }] };
      if (turn === 3) return { kind: "tool_calls", calls: [{ name: "inspect_page", args: { page_number: "one" } }] };
      return standardCaseReviewScript(turn - 3, visible);
    };
    await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script }, lifecycle, budget: { ...DEFAULT_AGENT_BUDGET, maxConsecutiveNoProgressSteps: 6 } }).review(reviewContext(true), reviewPorts());
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    expect(snapshot?.steps.slice(0, 3).map((step) => `${step.toolName}:${step.outcome}`)).toEqual([
      "bash:unknown_tool_rejected", "inspect_page:authorization_rejected", "inspect_page:schema_rejected",
    ]);
    expect(snapshot?.committedToolResults.some((result) => result.toolName === "bash")).toBe(false);
    expect(snapshot?.terminalReason).toBe("report_submitted");
  });

  it("keeps a policy-rejected report distinct from the Agent session terminal reason", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: policyViolationCaseReviewScript }, lifecycle }).review(reviewContext(false), reviewPorts());
    expect(outcome.submission).toMatchObject({ summary: "Approve the loan." });
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    expect(snapshot?.terminalReason).toBe("report_submitted");
    expect(snapshot?.steps.at(-1)).toMatchObject({ toolName: "submit_case_review_brief", outcome: "succeeded", phase: "report_submission" });
  });

  it("records a terminal session even when the model route is unavailable", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "live", provider: "anthropic", modelId: "no-such-model-000", apiKey: "unused" }, lifecycle }).review(reviewContext(false), reviewPorts());
    expect(outcome.trace.terminalReason).toBe("model_unavailable");
    const snapshot = await lifecycle.loadSnapshot(RUN_ID);
    expect(snapshot).toMatchObject({ status: "terminal", terminalReason: "model_unavailable", attempts: 1 });
    expect(snapshot?.steps).toEqual([]);
  });
});
