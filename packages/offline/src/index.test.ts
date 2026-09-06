import { describe, expect, it } from "vitest";
import { evaluateCaseReviewEligibility, type SubmittedExtractionCandidate } from "@findoc/agent";
import {
  ANNA_EXAMPLE_FIXTURE_ID, CaseAssemblyInputError, DOCUMENT_FIELD_REQUIREMENTS, assembleCaseResult, buildExtractionPlan,
  defaultOfflineHarness, findFixtureScannedPageAdapter, normalizeAmount, normalizeDate, normalizeValue, runOfflineReport,
  type CaseAssemblyContext, type CaseLogicalDocumentView,
} from "./index.js";

const DOCUMENT = "document-1";

function logical(id: string, documentType: string, startPage: number, endPage = startPage, uncertain = false): CaseLogicalDocumentView {
  return { logicalDocumentRevisionId: id, documentVersionId: DOCUMENT, startPage, endPage, documentType, uncertain };
}

function context(overrides: Partial<CaseAssemblyContext> = {}): CaseAssemblyContext {
  const logicalDocuments = overrides.logicalDocuments ?? [
    logical("logical-identity", "identity_document", 1),
    logical("logical-payslip", "payslip", 2),
    logical("logical-bank", "bank_statement", 3),
  ];
  const pageCount = Math.max(...logicalDocuments.map((document) => document.endPage));
  return {
    inputSnapshotId: "input-1", resultRevisionId: "result-1", referenceDate: "2026-09-05",
    applicationSnapshotId: "application-1", documentProcessorVersion: "firecrawl/pdf-inspector@1.17.0",
    applicationData: {
      applicant_display_name: "Clara Muster",
      employment: { employer: "Mustertechnik GmbH" },
      income: { monthly_net: "3200.00" },
    },
    pages: Array.from({ length: pageCount }, (_, index) => ({
      documentVersionId: DOCUMENT, pageNumber: index + 1, needsOcr: false,
      nativeCharacterCount: 500, ocrAvailable: false, renderAvailable: true,
    })),
    logicalDocuments,
    ...overrides,
  };
}

/** Candidate values as an Agent would submit them: raw page text, no normalization, no fixture truth. */
function candidatesFor(
  assembly: CaseAssemblyContext,
  values: Readonly<Record<string, string>>,
): readonly SubmittedExtractionCandidate[] {
  const plan = buildExtractionPlan(assembly);
  return plan.gaps.flatMap((gap) => {
    const requirement = plan.requirementByGapId.get(gap.gapId)!;
    const rawValue = values[requirement.requirementId];
    return rawValue === undefined ? [] : [{
      gapId: gap.gapId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion,
      valueType: gap.valueType, rawValue,
      page: { documentVersionId: gap.scope.documentVersionId, pageNumber: gap.scope.pageNumber },
      extractionMethod: "agent_native_text_reading" as const, processorVersion: "agent-native-text-reading-1.0.0",
    }];
  });
}

const CLEAN_VALUES = {
  identity_holder_name: "Clara Muster", identity_expiry_date: "31 August 2030",
  employee_name: "Clara Muster", payslip_employer_name: "Mustertechnik GmbH", payslip_monthly_net_income: "3200.00",
  account_holder_name: "Clara Muster", payment_counterparty_name: "Mustertechnik GmbH",
};

function issuesOf(result: ReturnType<typeof assembleCaseResult>) {
  return result.findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable").map((finding) => finding.ruleId);
}

describe("extraction plan", () => {
  it("derives one gap per declared field requirement that this run actually has a document for", () => {
    const plan = buildExtractionPlan(context());
    expect(plan.gaps).toHaveLength(DOCUMENT_FIELD_REQUIREMENTS.length);
    expect(plan.gaps.every((gap) => gap.reasonCode === "no_deterministic_field_extractor")).toBe(true);
    expect([...plan.requirementByGapId.values()].map((requirement) => requirement.requirementId).sort()).toEqual(
      DOCUMENT_FIELD_REQUIREMENTS.map((requirement) => requirement.requirementId).sort(),
    );
    expect(plan.documents.map((document) => document.documentType)).toEqual(["identity_document", "payslip", "bank_statement"]);
  });

  it("opens no gap for a document type the run does not contain", () => {
    const plan = buildExtractionPlan(context({
      logicalDocuments: [logical("logical-identity", "identity_document", 1), logical("logical-payslip", "payslip", 2)],
    }));
    expect(plan.gaps.map((gap) => plan.requirementByGapId.get(gap.gapId)!.documentType)).toEqual([
      "identity_document", "identity_document", "payslip", "payslip", "payslip",
    ]);
  });

  it("anchors a multi-page logical document on its first page and stays eligible", () => {
    const assembly = multiPageContext();
    const plan = buildExtractionPlan(assembly);
    const payslipGaps = plan.gaps.filter((gap) => gap.scope.logicalDocumentRevisionId === "logical-payslip");
    expect(payslipGaps.map((gap) => gap.scope.pageNumber)).toEqual([2, 2, 2]);
    const eligibility = evaluateCaseReviewEligibility({
      gaps: plan.gaps,
      pages: assembly.pages.map((page) => ({ ...page, logicalDocumentRevisionId: "logical-payslip" })),
      registeredToolNames: ["request_validation", "submit_case_review_brief"], budgetAvailable: true, fatalFailure: false,
    }, "decision-1");
    expect(eligibility.decision).toBe("eligible");
  });
});

/** A payslip that spans pages 2 and 3, so a field may legitimately sit on the second page. */
function multiPageContext(): CaseAssemblyContext {
  return context({
    logicalDocuments: [
      logical("logical-identity", "identity_document", 1),
      logical("logical-payslip", "payslip", 2, 3),
      logical("logical-bank", "bank_statement", 4),
    ],
  });
}

describe("multi-page logical documents", () => {
  it("accepts a value the Agent read from the continuation page of its own document", () => {
    const assembly = multiPageContext();
    const plan = buildExtractionPlan(assembly);
    // The income sits on page 3, the payslip's continuation page, not on the anchor page 2.
    const candidates = candidatesFor(assembly, CLEAN_VALUES).map((candidate) =>
      candidate.fieldSchemaId === "income.monthly_net" && candidate.page.pageNumber === 2
        ? { ...candidate, page: { documentVersionId: DOCUMENT, pageNumber: 3 } }
        : candidate);
    const result = assembleCaseResult(assembly, plan, candidates);

    expect(result.gapResolutions).toHaveLength(DOCUMENT_FIELD_REQUIREMENTS.length);
    expect(issuesOf(result)).toEqual([]);
    const income = result.claims.find((claim) => claim.fieldSchemaId === "income.monthly_net" && claim.rawValue === "3200.00" && claim.claimId !== undefined);
    expect(income).toBeDefined();
    const evidence = result.evidence.filter((item) => item.evidenceType === "page_level" && item.pageNumber === 3);
    expect(evidence.map((item) => item.extractionMethod)).toContain("agent_native_text_reading");
  });

  it("still ignores a value read from a page outside the requirement's own document", () => {
    const assembly = multiPageContext();
    const plan = buildExtractionPlan(assembly);
    const candidates = candidatesFor(assembly, CLEAN_VALUES).map((candidate) =>
      candidate.fieldSchemaId === "income.monthly_net"
        ? { ...candidate, rawValue: "9999.00", page: { documentVersionId: DOCUMENT, pageNumber: 4 } }
        : candidate);
    const result = assembleCaseResult(assembly, plan, candidates);
    expect(result.claims.some((claim) => claim.rawValue === "9999.00")).toBe(false);
    expect(issuesOf(result)).toEqual(["VAL_INCOME_CONSISTENCY_001"]);
  });
});

describe("deterministic case assembly", () => {
  it("turns Agent candidates into evidence, reconciliations, claims, and passing findings", () => {
    const assembly = context();
    const plan = buildExtractionPlan(assembly);
    const result = assembleCaseResult(assembly, plan, candidatesFor(assembly, CLEAN_VALUES));

    expect(issuesOf(result)).toEqual([]);
    expect(result.recommendedDisposition).toBe("ready_for_downstream_processing");
    expect(result.findings).toHaveLength(5);
    expect(result.gapResolutions).toHaveLength(DOCUMENT_FIELD_REQUIREMENTS.length);
    // Three structured-input candidates plus one per satisfied requirement.
    expect(result.candidates).toHaveLength(3 + DOCUMENT_FIELD_REQUIREMENTS.length);
    expect(result.claims).toHaveLength(result.candidates.length);
    expect(result.reconciliations).toHaveLength(result.candidates.length);
    expect(result.candidates.filter((candidate) => candidate.extractionMethod === "agent_native_text_reading")).toHaveLength(DOCUMENT_FIELD_REQUIREMENTS.length);
    expect(result.candidates.some((candidate) => candidate.extractionMethod === "offline_fixture")).toBe(false);

    for (const claim of result.claims) {
      const reconciliation = result.reconciliations.find((item) => item.resultingClaimId === claim.claimId);
      expect(reconciliation).toMatchObject({ status: "selected", selectedCandidateId: claim.supportingCandidateIds[0] });
      expect(claim.evidenceIds.every((evidenceId) => result.evidence.some((item) => item.evidenceId === evidenceId))).toBe(true);
    }
    expect(result.findings.every((finding) => finding.materialInputRefs.length > 0 && finding.materialInputRefs.every((reference) =>
      result.claims.some((claim) => claim.claimId === reference) || result.evidence.some((item) => item.evidenceId === reference),
    ))).toBe(true);
  });

  it("normalizes deterministically rather than trusting a submitted value", () => {
    const assembly = context();
    const plan = buildExtractionPlan(assembly);
    const result = assembleCaseResult(assembly, plan, candidatesFor(assembly, {
      ...CLEAN_VALUES, payslip_monthly_net_income: "3.200,00", identity_expiry_date: "31.08.2030",
    }));
    expect(result.claims.find((claim) => claim.fieldSchemaId === "identity.expiry_date")).toMatchObject({ rawValue: "31.08.2030", normalizedValue: "2030-08-31" });
    expect(issuesOf(result)).toEqual([]);
    expect(result.claims.filter((claim) => claim.fieldSchemaId === "income.monthly_net").map((claim) => claim.normalizedValue))
      .toEqual([{ amount: "3200.00", currency: "EUR" }, { amount: "3200.00", currency: "EUR" }]);
  });

  it("finds the employer conflict the bank statement actually shows", () => {
    const assembly = context();
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, {
      ...CLEAN_VALUES, payment_counterparty_name: "Suedwerk Demo KG",
    }));
    expect(issuesOf(result)).toEqual(["VAL_EMPLOYER_CONSISTENCY_001"]);
    expect(result.findings.find((finding) => finding.ruleId === "VAL_EMPLOYER_CONSISTENCY_001")).toMatchObject({ status: "failed", reasonCode: "employer_conflict" });
    expect(result.recommendedDisposition).toBe("human_review_required");
  });

  it("finds the income conflict the payslip actually shows", () => {
    const assembly = context();
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, {
      ...CLEAN_VALUES, payslip_monthly_net_income: "2980.00",
    }));
    expect(issuesOf(result)).toEqual(["VAL_INCOME_CONSISTENCY_001"]);
  });

  it("reports the missing document and the account holder it could not confirm", () => {
    const assembly = context({
      logicalDocuments: [logical("logical-identity", "identity_document", 1), logical("logical-payslip", "payslip", 2)],
    });
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, CLEAN_VALUES));
    expect(issuesOf(result)).toEqual(["VAL_DOC_COMPLETENESS_001", "VAL_NAME_CONSISTENCY_001"]);
    expect(result.findings.find((finding) => finding.ruleId === "VAL_DOC_COMPLETENESS_001")).toMatchObject({ reasonCode: "required_document_missing" });
    expect(result.recommendedDisposition).toBe("additional_documents_needed");
  });

  it("keeps an uncertain document boundary visible to the completeness rule", () => {
    const assembly = context({
      logicalDocuments: [
        logical("logical-identity", "identity_document", 1),
        logical("logical-payslip", "payslip", 2),
        logical("logical-bank", "bank_statement", 3, 3, true),
      ],
    });
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, CLEAN_VALUES));
    expect(result.findings.find((finding) => finding.ruleId === "VAL_DOC_COMPLETENESS_001")).toMatchObject({ status: "inconclusive", reasonCode: "required_document_uncertain" });
  });

  it("routes to human review with referenced findings when the Agent extracted nothing", () => {
    const assembly = context();
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), []);
    expect(result.gapResolutions).toEqual([]);
    expect(result.recommendedDisposition).toBe("human_review_required");
    expect(issuesOf(result)).toEqual([
      "VAL_NAME_CONSISTENCY_001", "VAL_EMPLOYER_CONSISTENCY_001", "VAL_INCOME_CONSISTENCY_001", "VAL_ID_EXPIRY_001",
    ]);
    expect(result.findings.every((finding) => finding.materialInputRefs.length > 0)).toBe(true);
    expect(result.claims).toHaveLength(3);
  });

  it("ignores a candidate that names a page outside its own requirement scope", () => {
    const assembly = context();
    const plan = buildExtractionPlan(assembly);
    const clean = candidatesFor(assembly, CLEAN_VALUES);
    const rogue = clean.map((candidate) => candidate.fieldSchemaId === "income.monthly_net"
      ? { ...candidate, rawValue: "9999.00", page: { documentVersionId: DOCUMENT, pageNumber: 3 } }
      : candidate);
    const result = assembleCaseResult(assembly, plan, rogue);
    expect(result.claims.some((claim) => claim.rawValue === "9999.00")).toBe(false);
    expect(issuesOf(result)).toEqual(["VAL_INCOME_CONSISTENCY_001"]);
  });

  it("rejects a case whose application input is incomplete", () => {
    const assembly = context({ applicationData: { applicant_display_name: "Clara Muster" } });
    expect(() => assembleCaseResult(assembly, buildExtractionPlan(assembly), [])).toThrow(CaseAssemblyInputError);
  });

  it("produces the same result twice for the same inputs", () => {
    const assembly = context();
    const plan = buildExtractionPlan(assembly);
    expect(assembleCaseResult(assembly, plan, candidatesFor(assembly, CLEAN_VALUES)))
      .toEqual(assembleCaseResult(assembly, plan, candidatesFor(assembly, CLEAN_VALUES)));
  });
});

describe("deterministic normalization", () => {
  it("parses the money formats the corpus produces", () => {
    expect(normalizeAmount("3200.00")).toBe("3200.00");
    expect(normalizeAmount("3,200.00")).toBe("3200.00");
    expect(normalizeAmount("3.200,00")).toBe("3200.00");
    expect(normalizeAmount("3200")).toBe("3200.00");
    expect(normalizeAmount("-1,120.30")).toBe("-1120.30");
    expect(normalizeAmount("+???.??")).toBeUndefined();
  });

  it("parses the date formats the corpus produces", () => {
    expect(normalizeDate("31 August 2030")).toBe("2030-08-31");
    expect(normalizeDate("31.08.2030")).toBe("2030-08-31");
    expect(normalizeDate("2030-08-31")).toBe("2030-08-31");
    expect(normalizeDate("31 Foo 2030")).toBeUndefined();
    expect(normalizeDate("31 February 2030")).toBeUndefined();
  });

  it("folds case and whitespace before comparing names", () => {
    expect(normalizeValue("string", "  Mustertechnik   GmbH ")).toBe("mustertechnik gmbh");
  });
});

describe("synthetic scanned-page fixture adapter", () => {
  it("answers only for a registered synthetic case", () => {
    expect(findFixtureScannedPageAdapter("not-a-fixture", {})).toBeUndefined();
    expect(findFixtureScannedPageAdapter("Clara Muster", {})).toBeUndefined();
    const adapter = findFixtureScannedPageAdapter(ANNA_EXAMPLE_FIXTURE_ID, { applicant_display_name: "Anna Beispiel" })!;
    expect(adapter.fixtureId).toBe("golden-003-multiple-review-issues");
    expect(adapter.pageType(2)).toBe("payslip");
    expect(adapter.value(2, "income.monthly_net")).toBe("3480.00");
    expect(adapter.value(2, "person.name")).toBe("Anna Beispiel");
    expect(adapter.value(9, "person.name")).toBeUndefined();
  });
});

describe("deterministic report verification", () => {
  it("keeps deterministic results available when the Agent report is rejected", async () => {
    const assembly = context();
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, {
      ...CLEAN_VALUES, payment_counterparty_name: "Suedwerk Demo KG",
    }));
    const report = await runOfflineReport(result, defaultOfflineHarness("golden-006-scanned-adaptive-unavailable"));
    expect(report).toMatchObject({ reportAvailability: "unavailable", reportFailureReason: "policy_rejected_loan_approval" });
    expect(report.issues.map((issue) => [issue.origin, issue.code])).toEqual([["system", "VAL_EMPLOYER_CONSISTENCY_001"]]);
  });

  it("publishes the verified Agent brief when the report passes verification", async () => {
    const assembly = context();
    const result = assembleCaseResult(assembly, buildExtractionPlan(assembly), candidatesFor(assembly, CLEAN_VALUES));
    const report = await runOfflineReport(result);
    expect(report).toMatchObject({ reportAvailability: "ready", modelLabel: "fake-pi-harness-v1" });
    expect(report.issues).toEqual([]);
  });
});
