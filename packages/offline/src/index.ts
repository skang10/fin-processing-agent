import { createHash } from "node:crypto";
import type { OfflineCaseResult, OfflineClaimResult, OfflineDeterministicResult, OfflineEvidenceResult, OfflineReportInput, OfflineReportResult } from "@findoc/core";
import { FakeCaseReviewAgentHarness, runVerifiedReport, type CaseReviewAgentHarness } from "@findoc/agent";
import { evaluateRuleSet, mapDisposition, type ValidationInput } from "@findoc/validation";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";

export class OfflineFixtureUnavailableError extends Error {}

export interface OfflineFixtureContext {
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly referenceDate: string;
  readonly applicationSnapshotId: string;
  readonly applicationData: Readonly<Record<string, unknown>>;
  readonly pages: readonly { submittedFilename: string; documentVersionId: string; pageNumber: number }[];
}

export function buildOfflineFixture(fixtureId: unknown, context: OfflineFixtureContext): OfflineDeterministicResult {
  if (fixtureId !== ANNA_EXAMPLE_FIXTURE_ID) {
    throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  }
  const fixture = annaExampleRecords(context);
  const input = annaExampleInput(context, fixture);
  const findings = evaluateRuleSet(input);
  const recommendedDisposition = mapDisposition(input, findings);
  return {
    resultRevisionId: context.resultRevisionId,
    findings,
    recommendedDisposition,
    evidence: fixture.evidence,
    claims: fixture.claims,
  };
}

export async function runOfflineReport(
  result: OfflineReportInput,
  harness: CaseReviewAgentHarness = new FakeCaseReviewAgentHarness(),
): Promise<OfflineReportResult> {
  const report = await runVerifiedReport(harness, {
    resultRevisionId: result.resultRevisionId,
    findings: result.findings,
    recommendedDisposition: result.recommendedDisposition,
    allowedReferences: new Set(result.findings.map((finding) => `finding:${finding.ruleId}`)),
  });
  const issues = report.verified ? report.brief.attention_items.map(issueFromAttentionItem) : [];
  return {
    reportAvailability: report.verified ? "ready" : "unavailable",
    ...(report.verified ? {} : { reportFailureReason: report.reason }),
    summary: report.verified ? report.brief.summary : "Agent report unavailable.",
    modelLabel: "fake-pi-harness-v1",
    estimatedCost: "0.0000",
    issues,
  };
}

export async function runOfflineFixture(
  fixtureId: unknown,
  context: OfflineFixtureContext,
  harness: CaseReviewAgentHarness = new FakeCaseReviewAgentHarness(),
): Promise<OfflineCaseResult> {
  const deterministic = buildOfflineFixture(fixtureId, context);
  return { ...deterministic, ...await runOfflineReport(deterministic, harness) };
}

interface AnnaExampleRecords {
  readonly evidence: readonly OfflineEvidenceResult[];
  readonly claims: readonly OfflineClaimResult[];
  readonly evidenceIds: Readonly<Record<string, string>>;
  readonly claimIds: Readonly<Record<string, string>>;
}

function annaExampleRecords(context: OfflineFixtureContext): AnnaExampleRecords {
  const requiredPages = {
    identity: findFixturePage(context, "case-package.pdf", 1),
    payslip: findFixturePage(context, "case-package.pdf", 2),
    boundary: findFixturePage(context, "case-package.pdf", 3),
    bank: findFixturePage(context, "case-package.pdf", 4),
  };
  const employer = readString(context.applicationData, ["employment", "employer"]);
  const declaredIncome = readString(context.applicationData, ["income", "monthly_net"]);
  readString(context.applicationData, ["applicant_display_name"]);
  const evidenceId = (key: string) => deterministicUuid(`${context.resultRevisionId}:evidence:${key}`);
  const claimId = (key: string) => deterministicUuid(`${context.resultRevisionId}:claim:${key}`);
  const evidenceIds = {
    applicant: evidenceId("applicant"), declaredEmployer: evidenceId("declared-employer"),
    declaredIncome: evidenceId("declared-income"), identity: evidenceId("identity-page"),
    payslip: evidenceId("payslip-page"), bank: evidenceId("bank-page"), boundary: evidenceId("boundary-page"),
  };
  const claimIds = {
    identityName: claimId("identity-name"), employeeName: claimId("employee-name"), accountName: claimId("account-name"),
    declaredEmployer: claimId("declared-employer"), payslipEmployer: claimId("payslip-employer"),
    salaryCounterparty: claimId("salary-counterparty"), declaredIncome: claimId("declared-income"),
    payslipIncome: claimId("payslip-income"), identityExpiry: claimId("identity-expiry"),
  };
  const structured = (id: string, jsonPointer: string): OfflineEvidenceResult => ({
    evidenceId: id, evidenceType: "structured_input", applicationSnapshotId: context.applicationSnapshotId,
    jsonPointer, extractionMethod: "structured_input", processorVersion: "application-schema-1.0.0",
  });
  const page = (id: string, source: { documentVersionId: string; pageNumber: number }): OfflineEvidenceResult => ({
    evidenceId: id, evidenceType: "page_level", documentVersionId: source.documentVersionId,
    pageNumber: source.pageNumber, extractionMethod: "offline_fixture", processorVersion: ANNA_EXAMPLE_FIXTURE_ID,
  });
  const evidence = [
    structured(evidenceIds.applicant, "/applicant_display_name"),
    structured(evidenceIds.declaredEmployer, "/employment/employer"),
    structured(evidenceIds.declaredIncome, "/income/monthly_net"),
    page(evidenceIds.identity, requiredPages.identity), page(evidenceIds.payslip, requiredPages.payslip),
    page(evidenceIds.boundary, requiredPages.boundary), page(evidenceIds.bank, requiredPages.bank),
  ];
  const claim = (claimIdValue: string, fieldSchemaId: string, valueType: OfflineClaimResult["valueType"], rawValue: string, normalizedValue: unknown, evidenceIdValue: string): OfflineClaimResult => ({
    claimId: claimIdValue, fieldSchemaId, valueType, rawValue, normalizedValue,
    normalizationVersion: "offline-normalization-1.0.0", evidenceIds: [evidenceIdValue],
  });
  const claims = [
    claim(claimIds.identityName, "person.name", "string", "Anna Beispiel", "anna beispiel", evidenceIds.identity),
    claim(claimIds.employeeName, "person.name", "string", "Anna Beispiel", "anna beispiel", evidenceIds.payslip),
    claim(claimIds.accountName, "person.name", "string", "Anna Beispiel", "anna beispiel", evidenceIds.bank),
    claim(claimIds.declaredEmployer, "organization.name", "string", employer, employer.toLocaleLowerCase("de-DE"), evidenceIds.declaredEmployer),
    claim(claimIds.payslipEmployer, "organization.name", "string", "Beispieltechnik GmbH", "beispieltechnik gmbh", evidenceIds.payslip),
    claim(claimIds.salaryCounterparty, "organization.name", "string", "Beispiel Tech Services", "beispiel tech services", evidenceIds.bank),
    claim(claimIds.declaredIncome, "income.monthly_net", "money", declaredIncome, { amount: declaredIncome, currency: "EUR" }, evidenceIds.declaredIncome),
    claim(claimIds.payslipIncome, "income.monthly_net", "money", "3480.00", { amount: "3480.00", currency: "EUR" }, evidenceIds.payslip),
    claim(claimIds.identityExpiry, "identity.expiry_date", "date", "2030-08-31", "2030-08-31", evidenceIds.identity),
  ];
  return { evidence, claims, evidenceIds, claimIds };
}

function findFixturePage(context: OfflineFixtureContext, submittedFilename: string, pageNumber: number) {
  const page = context.pages.find((item) => item.submittedFilename === submittedFilename && item.pageNumber === pageNumber);
  if (!page) throw new OfflineFixtureUnavailableError(`Fixture source ${submittedFilename} page ${pageNumber} is unavailable`);
  return page;
}

function annaExampleInput(context: OfflineFixtureContext, fixture: AnnaExampleRecords): ValidationInput {
  const declaredIncome = readString(context.applicationData, ["income", "monthly_net"]);
  return {
    inputSnapshotId: context.inputSnapshotId, resultRevisionId: context.resultRevisionId,
    referenceDate: context.referenceDate, requiredStagesSucceeded: true, unresolvedRequiredGap: false,
    documents: [
      { type: "identity_document", usability: "usable", reference: fixture.evidenceIds.identity! },
      { type: "payslip", usability: "usable", reference: fixture.evidenceIds.payslip! },
      { type: "bank_statement", usability: "uncertain", reference: fixture.evidenceIds.boundary! },
    ],
    personMatches: [
      { role: "identity_holder", result: "match", references: [fixture.claimIds.identityName!] },
      { role: "employee", result: "match", references: [fixture.claimIds.employeeName!] },
      { role: "account_holder", result: "match", references: [fixture.claimIds.accountName!] },
    ],
    organizationMatches: [
      { role: "payslip_employer", result: "match", qualified: true, references: [fixture.claimIds.declaredEmployer!, fixture.claimIds.payslipEmployer!] },
      { role: "payment_counterparty", result: "mismatch", qualified: true, references: [fixture.claimIds.declaredEmployer!, fixture.claimIds.salaryCounterparty!] },
    ],
    incomes: [
      { role: "declared", amount: declaredIncome, currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: [fixture.claimIds.declaredIncome!] },
      { role: "payslip", amount: "3480.00", currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: false, references: [fixture.claimIds.payslipIncome!] },
    ],
    identityExpiry: { fullDate: "2030-08-31", holderResolved: true, evidenceSufficient: true, references: [fixture.claimIds.identityExpiry!] },
  };
}

function deterministicUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function readString(value: Readonly<Record<string, unknown>>, path: readonly string[]): string {
  let current: unknown = value;
  for (const part of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) throw new OfflineFixtureUnavailableError(`Fixture field /${path.join("/")} is missing`);
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string" || current.length === 0) throw new OfflineFixtureUnavailableError(`Fixture field /${path.join("/")} is missing`);
  return current;
}

function issueFromAttentionItem(item: {
  readonly description: string;
  readonly suggested_action: string;
  readonly references: readonly string[];
}) {
  const reference = item.references.find((value) => value.startsWith("finding:"));
  if (!reference) throw new Error("Agent attention item has no finding reference");
  const actions: Record<string, string> = {
    compare_claims: "Confirm the current employer and provide corrected supporting documents if needed.",
    verify_extracted_value: "Provide a legible payslip that shows the monthly net income.",
    review_document_boundary: "Resubmit the bank statement as one complete file if the displayed page boundary is incorrect.",
  };
  const recommendedAction = actions[item.suggested_action];
  if (!recommendedAction) throw new Error(`No applicant-readable action registered for ${item.suggested_action}`);
  return { code: reference.slice("finding:".length), description: item.description, recommendedAction };
}
