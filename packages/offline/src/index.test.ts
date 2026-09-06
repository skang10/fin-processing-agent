import { describe, expect, it } from "vitest";
import { ANNA_EXAMPLE_FIXTURE_ID, GOLDEN_FIXTURE_IDS, OfflineFixtureUnavailableError, runOfflineFixture } from "./index.js";

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

  it("covers all six named golden fixtures with deterministic rule outcomes", async () => {
    const cases = [
      [GOLDEN_FIXTURE_IDS[0], "Clara Muster", "Mustertechnik GmbH", "3200.00", 3, []],
      [GOLDEN_FIXTURE_IDS[1], "David Beispiel", "Nordwerk Demo GmbH", "2900.00", 3, ["VAL_EMPLOYER_CONSISTENCY_001"]],
      [GOLDEN_FIXTURE_IDS[2], "Anna Beispiel", "Beispieltechnik GmbH", "3480.00", 4, ["VAL_DOC_COMPLETENESS_001", "VAL_EMPLOYER_CONSISTENCY_001", "VAL_INCOME_CONSISTENCY_001"]],
      [GOLDEN_FIXTURE_IDS[3], "Eva Sample", "Sample Works Ltd", "3100.00", 2, ["VAL_DOC_COMPLETENESS_001"]],
      [GOLDEN_FIXTURE_IDS[4], "Felix Test", "Testbetrieb GmbH", "2750.00", 3, []],
      [GOLDEN_FIXTURE_IDS[5], "Greta Demofall", "Demowerk GmbH", "3050.00", 3, ["VAL_INCOME_CONSISTENCY_001"]],
    ] as const;
    for (const [fixtureId, applicant, employer, income, pageCount, expectedIssues] of cases) {
      const fixtureContext = {
        ...context,
        resultRevisionId: `result-${fixtureId}`,
        applicationData: { applicant_display_name: applicant, employment: { employer }, income: { monthly_net: income } },
        pages: Array.from({ length: pageCount }, (_, index) => ({ submittedFilename: `${fixtureId}.pdf`, documentVersionId: fixtureId, pageNumber: index + 1 })),
        logicalDocuments: Array.from({ length: pageCount }, (_, index) => ({ logicalDocumentRevisionId: `${fixtureId}-${index + 1}`, documentVersionId: fixtureId, startPage: index + 1, endPage: index + 1 })),
      };
      const first = await runOfflineFixture(fixtureId, fixtureContext);
      const second = await runOfflineFixture(fixtureId, fixtureContext);
      expect(first).toEqual(second);
      expect(first.issues.map((issue) => issue.code)).toEqual(fixtureId === "golden-006-scanned-adaptive-unavailable" ? [] : expectedIssues);
      expect(first.findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable").map((finding) => finding.ruleId)).toEqual(expectedIssues);
      expect(first.findings).toHaveLength(5);
      expect(first.reportAvailability).toBe(fixtureId === "golden-006-scanned-adaptive-unavailable" ? "unavailable" : "ready");
      if (fixtureId === "golden-006-scanned-adaptive-unavailable") expect(first.reportFailureReason).toBe("policy_rejected");
    }
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
