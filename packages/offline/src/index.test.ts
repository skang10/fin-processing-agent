import { describe, expect, it } from "vitest";
import { ANNA_EXAMPLE_FIXTURE_ID, OfflineFixtureUnavailableError, runOfflineFixture } from "./index.js";

describe("offline fixture", () => {
  const context = { inputSnapshotId: "input-1", resultRevisionId: "result-1", referenceDate: "2026-09-05" };

  it("reproduces the Anna Beispiel review result", async () => {
    const result = await runOfflineFixture(ANNA_EXAMPLE_FIXTURE_ID, context);
    expect(result.modelLabel).toBe("fake-pi-harness-v1");
    expect(result.reportAvailability).toBe("ready");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "VAL_DOC_COMPLETENESS_001",
      "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001",
    ]);
    expect(result.findings).toHaveLength(5);
    expect(result.recommendedDisposition).toBe("human_review_required");
  });

  it("does not infer a successful fixture from applicant identity", async () => {
    await expect(runOfflineFixture("Anna Beispiel", context)).rejects.toThrow(OfflineFixtureUnavailableError);
  });

  it("keeps deterministic results available when the Agent report is rejected", async () => {
    const policyViolatingHarness = { generate: async () => ({
      schema_version: "1.0.0", result_revision_id: context.resultRevisionId, report_status: "ready",
      summary: "Approve the loan.", attention_items: [],
    }) };
    const result = await runOfflineFixture(ANNA_EXAMPLE_FIXTURE_ID, context, policyViolatingHarness);
    expect(result).toMatchObject({ reportAvailability: "unavailable", reportFailureReason: "policy_rejected" });
    expect(result.findings).toHaveLength(5);
    expect(result.recommendedDisposition).toBe("human_review_required");
  });
});
