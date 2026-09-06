import { describe, expect, it } from "vitest";
import { AgentReportExecutionError, FAKE_HARNESS_DESCRIPTOR, FakeCaseReviewAgentHarness, buildSyntheticSessionTrace, canonicalJson, evaluateCaseReviewEligibility, hashArguments, runVerifiedReport, verifyCaseReviewBrief, type CaseReviewContext } from "./index.js";

function context(): CaseReviewContext {
  return {
    resultRevisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
    findings: [{ ruleId: "VAL_EMPLOYER_CONSISTENCY_001", status: "failed", reasonCode: "employer_conflict" }],
    recommendedDisposition: "human_review_required",
    allowedReferences: new Set(["finding:VAL_EMPLOYER_CONSISTENCY_001"]),
  };
}

describe("Case Review Brief verification", () => {
  it("accepts the deterministic fake Agent report and records a session trace", async () => {
    const result = await runVerifiedReport(new FakeCaseReviewAgentHarness(), context());
    expect(result).toMatchObject({ verified: true, brief: { report_status: "ready" }, trace: { terminalReason: "report_submitted", harnessId: "fake-case-review-harness", toolCalls: 1 } });
    expect(result.originalSubmission).toEqual(result.verified ? result.brief : undefined);
  });

  it("rejects schema-invalid output", () => {
    expect(verifyCaseReviewBrief({ summary: "Incomplete" }, context())).toEqual({ verified: false, reason: "schema_rejected" });
  });

  it("rejects references outside the result revision", () => {
    const candidate = {
      schema_version: "1.0.0", result_revision_id: context().resultRevisionId, report_status: "ready",
      summary: "Review required.", attention_items: [{
        signal: "validation_finding_requires_attention", suggested_action: "compare_claims",
        description: "Compare the employer values.", references: ["finding:other"],
      }],
    };
    expect(verifyCaseReviewBrief(candidate, context())).toEqual({ verified: false, reason: "reference_rejected" });
  });

  it("rejects prohibited decision language", () => {
    const candidate = {
      schema_version: "1.0.0", result_revision_id: context().resultRevisionId, report_status: "ready",
      summary: "Approve the loan.", attention_items: [],
    };
    expect(verifyCaseReviewBrief(candidate, context())).toEqual({ verified: false, reason: "policy_rejected" });
  });

  it("returns an unavailable outcome when the harness times out", async () => {
    const timeoutHarness = { descriptor: FAKE_HARNESS_DESCRIPTOR, generate: async () => { throw new AgentReportExecutionError("timeout"); } };
    await expect(runVerifiedReport(timeoutHarness, context())).resolves.toMatchObject({ verified: false, reason: "timeout", trace: { terminalReason: "timeout", steps: [] } });
  });

  it("maps a session that ends without a submission to an unavailable report", async () => {
    const harness = {
      descriptor: FAKE_HARNESS_DESCRIPTOR,
      generate: async () => ({ trace: buildSyntheticSessionTrace({ descriptor: FAKE_HARNESS_DESCRIPTOR, steps: [], terminalReason: "tool_budget_exhausted" }) }),
    };
    await expect(runVerifiedReport(harness, context())).resolves.toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "tool_budget_exhausted" } });
  });

  it("hashes arguments canonically regardless of key order", () => {
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: "x" })).toBe('{"a":"x","b":[1,{"c":3,"d":2}]}');
    expect(hashArguments({ a: 1, b: 2 })).toBe(hashArguments({ b: 2, a: 1 }));
  });
});

describe("case-review eligibility", () => {
  const page = { documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1, needsOcr: false, ocrAvailable: true, nativeCharacterCount: 100, renderAvailable: true };
  const tools = ["request_validation", "submit_case_review_brief"];

  it("schedules every processable case, including cases without extraction gaps", () => {
    expect(evaluateCaseReviewEligibility({ gaps: [], pages: [page], registeredToolNames: tools, budgetAvailable: true, fatalFailure: false }, "decision-1"))
      .toMatchObject({ decision: "eligible", reasonCodes: ["processable_case"], gapIds: [], policyVersion: "case-review-eligibility-2.0.0" });
  });

  it("rejects fatal, unbudgeted, stale, or incompletely registered sessions", () => {
    const base = { gaps: [], pages: [page], registeredToolNames: tools, budgetAvailable: true, fatalFailure: false };
    expect(evaluateCaseReviewEligibility({ ...base, fatalFailure: true }, "d").reasonCodes).toContain("fatal_processing_failure");
    expect(evaluateCaseReviewEligibility({ ...base, budgetAvailable: false }, "d").reasonCodes).toContain("budget_unavailable");
    expect(evaluateCaseReviewEligibility({ ...base, previousAttemptWithoutNewInputs: true }, "d").reasonCodes).toContain("equivalent_attempt_completed");
    expect(evaluateCaseReviewEligibility({ ...base, registeredToolNames: [] }, "d").reasonCodes).toContain("required_case_review_tools_unavailable");
  });
});
