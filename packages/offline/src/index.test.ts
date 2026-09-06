import { describe, expect, it } from "vitest";
import { evaluateCaseReviewEligibility } from "@findoc/agent";
import { ANNA_EXAMPLE_FIXTURE_ID, GOLDEN_FIXTURE_IDS, OfflineFixtureUnavailableError, buildAgentReviewContext, buildOfflineExtraction, buildOfflineFixture, createOfflineRecoveryPorts, defaultOfflineHarness, runOfflineFixture } from "./index.js";

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
      const { session: firstSession, ...firstResult } = first;
      const { session: secondSession, ...secondResult } = second;
      expect(firstResult).toEqual(secondResult);
      const sessionShape = (session: typeof firstSession) => session && { terminalReason: session.terminalReason, steps: session.steps.map((step) => [step.toolName, step.outcome, step.argumentHash]) };
      expect(sessionShape(firstSession)).toEqual(sessionShape(secondSession));
      expect(first.issues.map((issue) => issue.code)).toEqual(expectedIssues);
      expect(first.issues.every((issue) => issue.origin === (fixtureId === "golden-006-scanned-adaptive-unavailable" ? "system" : "agent"))).toBe(true);
      expect(first.findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable").map((finding) => finding.ruleId)).toEqual(expectedIssues);
      expect(first.findings).toHaveLength(5);
      expect(first.reportAvailability).toBe(fixtureId === "golden-006-scanned-adaptive-unavailable" ? "unavailable" : "ready");
      if (fixtureId === "golden-006-scanned-adaptive-unavailable") expect(first.reportFailureReason).toBe("policy_rejected");
    }
  });

  it("keeps deterministic results available when the Agent report is rejected", async () => {
    const policyViolatingHarness = defaultOfflineHarness("golden-006-scanned-adaptive-unavailable");
    const result = await runOfflineFixture(ANNA_EXAMPLE_FIXTURE_ID, context, policyViolatingHarness);
    expect(result).toMatchObject({ reportAvailability: "unavailable", reportFailureReason: "policy_rejected", session: { terminalReason: "report_submitted", toolCalls: 1 } });
    expect(result.originalSubmission).toMatchObject({ summary: "Approve the loan." });
    expect(result.findings).toHaveLength(5);
    expect(result.issues.map((issue) => [issue.origin, issue.code])).toEqual([
      ["system", "VAL_DOC_COMPLETENESS_001"],
      ["system", "VAL_EMPLOYER_CONSISTENCY_001"],
      ["system", "VAL_INCOME_CONSISTENCY_001"],
    ]);
    expect(result.recommendedDisposition).toBe("human_review_required");
  });
});

describe("adaptive recovery gap path", () => {
  const fixtureId = "golden-006-scanned-adaptive-unavailable";
  const context = {
    inputSnapshotId: "input-6", resultRevisionId: "result-6", referenceDate: "2026-09-05", applicationSnapshotId: "application-6",
    applicationData: { applicant_display_name: "Greta Demofall", employment: { employer: "Demowerk GmbH" }, income: { monthly_net: "3050.00" } },
    pages: [1, 2, 3].map((pageNumber) => ({ submittedFilename: `${fixtureId}.pdf`, documentVersionId: "document-6", pageNumber, needsOcr: pageNumber === 2, nativeCharacterCount: pageNumber === 2 ? 0 : 800, ocrAvailable: pageNumber === 2, renderAvailable: true })),
    logicalDocuments: [1, 2, 3].map((pageNumber) => ({ logicalDocumentRevisionId: `logical-6-${pageNumber}`, documentVersionId: "document-6", startPage: pageNumber, endPage: pageNumber })),
  };

  it("opens a required income gap on the scanned payslip page instead of fabricating a claim", () => {
    const extraction = buildOfflineExtraction(fixtureId, context);
    expect(extraction.gaps).toHaveLength(1);
    expect(extraction.gaps[0]).toMatchObject({ fieldSchemaId: "income.monthly_net", required: true, reasonCode: "scanned_page_value_unresolved", attemptedPaths: ["native_text", "fixture_ocr"], scope: { documentVersionId: "document-6", pageNumber: 2, logicalDocumentRevisionId: "logical-6-2" } });
    expect(extraction.records.claims.some((claim) => claim.fieldSchemaId === "income.monthly_net" && claim.rawValue === "2980.00")).toBe(false);
    const reviewContext = buildAgentReviewContext("run-6", extraction, context);
    expect(reviewContext.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(reviewContext.fieldSchemas).toEqual([{ fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" }]);
  });

  it("keeps the gap explicit and routes to human review when no recovery happens", () => {
    const result = buildOfflineFixture(fixtureId, context);
    expect(result.gaps).toHaveLength(1);
    expect(result.gapResolutions).toEqual([]);
    expect(result.findings.find((finding) => finding.ruleId === "VAL_INCOME_CONSISTENCY_001")).toMatchObject({ status: "inconclusive", reasonCode: "income_input_incomparable" });
    expect(result.recommendedDisposition).toBe("human_review_required");
  });

  it("resolves the gap through the fake recovery harness and reconciliation, then finds the income conflict", async () => {
    const extraction = buildOfflineExtraction(fixtureId, context);
    const reviewContext = buildAgentReviewContext("run-6", extraction, context);
    const eligibility = evaluateCaseReviewEligibility({ gaps: extraction.gaps, pages: reviewContext.pages, registeredToolNames: ["request_validation", "submit_case_review_brief"], budgetAvailable: true, fatalFailure: false }, "decision-6");
    expect(eligibility.decision).toBe("eligible");
    const gap = extraction.gaps[0]!;
    const page = { documentVersionId: gap.scope.documentVersionId, pageNumber: gap.scope.pageNumber };
    const value = (await createOfflineRecoveryPorts(fixtureId, context).extractWithVlm({ page, fieldSchemaId: gap.fieldSchemaId })).value!;
    const candidates = [{ gapId: gap.gapId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType, rawValue: value.rawValue, normalizedValue: value.normalizedValue, page, region: value.region, extractionMethod: "agent_vlm_extraction" as const, processorVersion: "fake-vlm-gateway/income-monthly-net-extract-1.0.0" }];
    const result = buildOfflineFixture(fixtureId, context, { eligibility, candidates });
    expect(result.gapResolutions).toEqual([{ gapId: extraction.gaps[0]!.gapId, resolutionType: "claim", reference: expect.any(String) }]);
    const claim = result.claims.find((item) => item.claimId === result.gapResolutions![0]!.reference);
    expect(claim).toMatchObject({ fieldSchemaId: "income.monthly_net", rawValue: "2980.00" });
    const candidate = result.candidates.find((item) => item.candidateId === claim?.supportingCandidateIds[0]);
    expect(candidate).toMatchObject({ extractionMethod: "agent_vlm_extraction", qualityStatus: "accepted", source: { type: "logical_document", logicalDocumentRevisionId: "logical-6-2" } });
    expect(result.evidence.find((item) => item.evidenceId === candidate?.evidenceIds[0])).toMatchObject({ evidenceType: "page_level", pageNumber: 2, extractionMethod: "agent_vlm_extraction" });
    expect(result.findings.find((finding) => finding.ruleId === "VAL_INCOME_CONSISTENCY_001")).toMatchObject({ status: "failed", reasonCode: "income_conflict" });
    expect(result.recommendedDisposition).toBe("human_review_required");
    expect(result.eligibility).toBe(eligibility);
  });

  it("ignores submitted candidates that fall outside the gap scope", () => {
    const extraction = buildOfflineExtraction(fixtureId, context);
    const gap = extraction.gaps[0]!;
    const rogue = { gapId: gap.gapId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: "1.0.0", valueType: "money" as const, rawValue: "9999.00", normalizedValue: { amount: "9999.00", currency: "EUR" }, page: { documentVersionId: "document-6", pageNumber: 3 }, region: { x: 0, y: 0, width: 1, height: 1 }, extractionMethod: "agent_vlm_extraction" as const, processorVersion: "x" };
    const result = buildOfflineFixture(fixtureId, context, { eligibility: { decisionId: "d", policyVersion: "case-review-eligibility-2.0.0", gapIds: [gap.gapId], decision: "eligible", reasonCodes: ["processable_case"] }, candidates: [rogue] });
    expect(result.gapResolutions).toEqual([]);
    expect(result.claims.some((claim) => claim.rawValue === "9999.00")).toBe(false);
  });
});
