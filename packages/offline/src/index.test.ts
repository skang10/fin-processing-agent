import { describe, expect, it } from "vitest";
import { ANNA_EXAMPLE_FIXTURE_ID, OfflineFixtureUnavailableError, runOfflineFixture } from "./index.js";

describe("offline fixture", () => {
  const context = {
    inputSnapshotId: "input-1", resultRevisionId: "result-1", referenceDate: "2026-09-05",
    applicationSnapshotId: "application-1",
    applicationData: {
      applicant_display_name: "Anna Beispiel",
      employment: { employer: "Beispieltechnik GmbH" },
      income: { monthly_net: "3480.00" },
    },
    pages: [1, 2, 3, 4].map((pageNumber) => ({ submittedFilename: "case-package.pdf", documentVersionId: "document-1", pageNumber })),
    logicalDocuments: [
      { logicalDocumentRevisionId: "logical-identity", documentVersionId: "document-1", startPage: 1, endPage: 1 },
      { logicalDocumentRevisionId: "logical-payslip", documentVersionId: "document-1", startPage: 2, endPage: 3 },
      { logicalDocumentRevisionId: "logical-bank", documentVersionId: "document-1", startPage: 4, endPage: 4 },
    ],
  };

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
    expect(result.evidence).toHaveLength(7);
    expect(result.claims).toHaveLength(9);
    expect(result.candidates).toHaveLength(9);
    expect(result.reconciliations).toHaveLength(9);
    expect(result.claims.every((claim) => claim.supportingCandidateIds.length === 1)).toBe(true);
    for (const claim of result.claims) {
      const reconciliation = result.reconciliations.find((item) => item.resultingClaimId === claim.claimId);
      expect(reconciliation).toMatchObject({ status: "selected", selectedCandidateId: claim.supportingCandidateIds[0] });
      const candidate = result.candidates.find((item) => item.candidateId === reconciliation?.selectedCandidateId);
      expect(candidate?.evidenceIds.every((evidenceId) => claim.evidenceIds.includes(evidenceId))).toBe(true);
      expect(result.evidence.some((evidence) => candidate?.evidenceIds.includes(evidence.evidenceId))).toBe(true);
    }
    expect(result.findings.every((finding) => finding.materialInputRefs.every((reference) =>
      result.claims.some((claim) => claim.claimId === reference) || result.evidence.some((evidence) => evidence.evidenceId === reference),
    ))).toBe(true);
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
