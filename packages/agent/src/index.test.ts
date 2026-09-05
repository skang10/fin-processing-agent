import { describe, expect, it } from "vitest";
import { AgentReportExecutionError, FakeCaseReviewAgentHarness, runVerifiedReport, verifyCaseReviewBrief, type CaseReviewContext } from "./index.js";

function context(): CaseReviewContext {
  return {
    resultRevisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
    findings: [{ ruleId: "VAL_EMPLOYER_CONSISTENCY_001", status: "failed", reasonCode: "employer_conflict" }],
    recommendedDisposition: "human_review_required",
    allowedReferences: new Set(["finding:VAL_EMPLOYER_CONSISTENCY_001"]),
  };
}

describe("Case Review Brief verification", () => {
  it("accepts the deterministic fake Agent report", async () => {
    const result = await runVerifiedReport(new FakeCaseReviewAgentHarness(), context());
    expect(result).toMatchObject({ verified: true, brief: { report_status: "ready" } });
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
    const timeoutHarness = { generate: async () => { throw new AgentReportExecutionError("timeout"); } };
    await expect(runVerifiedReport(timeoutHarness, context())).resolves.toEqual({ verified: false, reason: "timeout" });
  });
});
