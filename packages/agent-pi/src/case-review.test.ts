import { describe, expect, it, vi } from "vitest";
import type { AgentLedCaseReviewContext, CaseReviewProcessingPorts } from "@findoc/agent";
import { PiAgentLedCaseReviewHarness } from "./harness.js";
import { policyViolationCaseReviewScript, standardCaseReviewScript } from "./fake-model.js";

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
  });

  it("keeps prohibited report language as an unverified submission for the external verifier", async () => {
    const outcome = await new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: policyViolationCaseReviewScript, scriptLabel: "policy_violation" } }).review(context(false), ports());
    expect(outcome.trace.terminalReason).toBe("report_submitted");
    expect(outcome.submission).toMatchObject({ summary: "Approve the loan." });
  });
});
