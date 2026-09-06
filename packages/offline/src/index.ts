import { createHash } from "node:crypto";
import { reconcileSingleAcceptedCandidate, type CandidateReconciliation, type ExtractionCandidate, type OfflineCaseResult, type OfflineClaimResult, type OfflineDeterministicResult, type OfflineEvidenceResult, type OfflineReportInput, type OfflineReportResult, type PersistedCandidateReconciliation } from "@findoc/core";
import { FAKE_HARNESS_DESCRIPTOR, FakeCaseReviewAgentHarness, buildSyntheticSessionTrace, hashArguments, runVerifiedReport, type CaseReviewAgentHarness } from "@findoc/agent";
import { evaluateRuleSet, mapDisposition, type MatchResult, type ValidationInput } from "@findoc/validation";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";
export const GOLDEN_FIXTURE_IDS = ["golden-001-native-clear", "golden-002-employer-conflict", "golden-003-multiple-review-issues", "golden-004-missing-bank-evidence", "golden-005-instruction-inert", "golden-006-scanned-adaptive-unavailable"] as const;
export class OfflineFixtureUnavailableError extends Error {}

export interface OfflineFixtureContext {
  readonly inputSnapshotId: string; readonly resultRevisionId: string; readonly referenceDate: string;
  readonly applicationSnapshotId: string; readonly applicationData: Readonly<Record<string, unknown>>;
  readonly pages: readonly { submittedFilename: string; documentVersionId: string; pageNumber: number }[];
  readonly logicalDocuments: readonly { logicalDocumentRevisionId: string; documentVersionId: string; startPage: number; endPage: number }[];
}

interface Definition {
  pageCount: number; identityPage: number; payslipPage: number; bankPage?: number; boundaryUncertain?: boolean;
  payslipEmployer: string; counterparty?: string; employerResult: MatchResult; payslipIncome: string; incomeEvidenceSufficient: boolean; accountCredit?: string;
}

const DEFINITIONS: Readonly<Record<string, Definition>> = Object.freeze({
  "golden-001-native-clear": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Mustertechnik GmbH", counterparty: "Mustertechnik GmbH", employerResult: "match", payslipIncome: "3200.00", incomeEvidenceSufficient: true },
  "golden-002-employer-conflict": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Nordwerk Demo GmbH", counterparty: "Suedwerk Demo Services", employerResult: "mismatch", payslipIncome: "2900.00", incomeEvidenceSufficient: true },
  "golden-003-multiple-review-issues": { pageCount: 4, identityPage: 1, payslipPage: 2, bankPage: 4, boundaryUncertain: true, payslipEmployer: "Beispieltechnik GmbH", counterparty: "Beispiel Tech Services", employerResult: "mismatch", payslipIncome: "3480.00", incomeEvidenceSufficient: false },
  "golden-004-missing-bank-evidence": { pageCount: 2, identityPage: 1, payslipPage: 2, payslipEmployer: "Sample Works Ltd", employerResult: "match", payslipIncome: "3100.00", incomeEvidenceSufficient: true },
  "golden-005-instruction-inert": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Testbetrieb GmbH", counterparty: "Testbetrieb GmbH", employerResult: "match", payslipIncome: "2750.00", incomeEvidenceSufficient: true },
  "golden-006-scanned-adaptive-unavailable": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Demowerk GmbH", counterparty: "Demowerk GmbH", employerResult: "match", payslipIncome: "2980.00", incomeEvidenceSufficient: true, accountCredit: "3010.00" },
});

export function buildOfflineFixture(fixtureId: unknown, context: OfflineFixtureContext): OfflineDeterministicResult {
  const id = fixtureId === ANNA_EXAMPLE_FIXTURE_ID ? "golden-003-multiple-review-issues" : fixtureId;
  const definition = typeof id === "string" ? DEFINITIONS[id] : undefined;
  if (!definition || typeof id !== "string") throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  const records = buildRecords(id, definition, context);
  const input = buildInput(definition, context, records);
  const findings = evaluateRuleSet(input);
  return { resultRevisionId: context.resultRevisionId, findings, recommendedDisposition: mapDisposition(input, findings), evidence: records.evidence, candidates: records.candidates, reconciliations: records.reconciliations, claims: records.claims };
}

export async function runOfflineReport(result: OfflineReportInput, harness?: CaseReviewAgentHarness, fixtureId?: unknown): Promise<OfflineReportResult> {
  const selectedHarness = harness ?? defaultOfflineHarness(fixtureId);
  const report = await runVerifiedReport(selectedHarness, {
    resultRevisionId: result.resultRevisionId,
    findings: result.findings.map((finding) => ({ ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, status: finding.status, reasonCode: finding.reasonCode, references: finding.materialInputRefs })),
    recommendedDisposition: result.recommendedDisposition,
    allowedReferences: new Set(result.findings.map((finding) => `finding:${finding.ruleId}`)),
  });
  return {
    reportAvailability: report.verified ? "ready" : "unavailable",
    ...(report.verified ? {} : { reportFailureReason: report.reason }),
    summary: report.verified ? report.brief.summary : "Agent report unavailable.",
    modelLabel: report.trace.modelLabel,
    ...(report.trace.estimatedCost ? { estimatedCost: report.trace.estimatedCost.amount } : {}),
    session: report.trace,
    ...(report.originalSubmission !== undefined ? { originalSubmission: report.originalSubmission } : {}),
    issues: report.verified ? report.brief.attention_items.map(issueFromAttentionItem) : [],
  };
}

/** Default offline harness: the model-free fake, with a policy-violating fixture for the report-unavailable golden case. */
export function defaultOfflineHarness(fixtureId?: unknown): CaseReviewAgentHarness {
  if (fixtureId !== "golden-006-scanned-adaptive-unavailable") return new FakeCaseReviewAgentHarness();
  return {
    descriptor: FAKE_HARNESS_DESCRIPTOR,
    generate: async (context) => {
      const submission = { schema_version: "1.0.0", result_revision_id: context.resultRevisionId, report_status: "ready", summary: "Approve the loan.", attention_items: [] };
      return {
        submission,
        trace: buildSyntheticSessionTrace({
          descriptor: FAKE_HARNESS_DESCRIPTOR, terminalReason: "report_submitted",
          steps: [{ toolName: "submit_case_review_brief", toolVersion: "1.0.0", argumentHash: hashArguments(submission), outcome: "succeeded", summary: "Submitted a Case Review Brief" }],
        }),
      };
    },
  };
}

export async function runOfflineFixture(fixtureId: unknown, context: OfflineFixtureContext, harness?: CaseReviewAgentHarness): Promise<OfflineCaseResult> {
  const result = buildOfflineFixture(fixtureId, context);
  return { ...result, ...await runOfflineReport(result, harness, fixtureId) };
}

interface Records { evidence: readonly OfflineEvidenceResult[]; candidates: readonly ExtractionCandidate[]; reconciliations: readonly PersistedCandidateReconciliation[]; claims: readonly OfflineClaimResult[]; evidenceIds: Record<string, string>; claimIds: Record<string, string> }
type Source = string | { documentVersionId: string; pageNumber: number };
type Field = readonly [string, string, "string" | "money" | "date", string, unknown, string, Source];

function buildRecords(fixtureId: string, definition: Definition, context: OfflineFixtureContext): Records {
  if (context.pages.length !== definition.pageCount) throw new OfflineFixtureUnavailableError(`Fixture ${fixtureId} requires ${definition.pageCount} pages`);
  const pageNumbers = [...new Set([definition.identityPage, definition.payslipPage, definition.bankPage, definition.boundaryUncertain && definition.bankPage ? definition.bankPage - 1 : undefined].filter((value): value is number => value !== undefined))];
  const pages = new Map(pageNumbers.map((number) => [number, findPage(context, number)]));
  const applicant = readString(context.applicationData, ["applicant_display_name"]); const employer = readString(context.applicationData, ["employment", "employer"]); const income = readString(context.applicationData, ["income", "monthly_net"]);
  const id = (kind: string, key: string) => uuid(`${context.resultRevisionId}:${kind}:${key}`);
  const evidenceIds: Record<string, string> = { applicant: id("evidence", "applicant"), employer: id("evidence", "employer"), income: id("evidence", "income") };
  for (const number of pageNumbers) evidenceIds[`page${number}`] = id("evidence", `page-${number}`);
  const evidence: OfflineEvidenceResult[] = [
    structured(evidenceIds.applicant!, "/applicant_display_name", context), structured(evidenceIds.employer!, "/employment/employer", context), structured(evidenceIds.income!, "/income/monthly_net", context),
    ...pageNumbers.map((number) => pageEvidence(evidenceIds[`page${number}`]!, pages.get(number)!, fixtureId)),
  ];
  const identity = pages.get(definition.identityPage)!; const payslip = pages.get(definition.payslipPage)!; const bank = definition.bankPage ? pages.get(definition.bankPage)! : undefined;
  const fields: Field[] = [
    ["identity-name", "person.name", "string", applicant, applicant.toLocaleLowerCase("de-DE"), evidenceIds[`page${definition.identityPage}`]!, identity],
    ["employee-name", "person.name", "string", applicant, applicant.toLocaleLowerCase("de-DE"), evidenceIds[`page${definition.payslipPage}`]!, payslip],
    ["account-name", "person.name", "string", applicant, applicant.toLocaleLowerCase("de-DE"), bank ? evidenceIds[`page${definition.bankPage}`]! : evidenceIds.applicant!, bank ?? "/applicant_display_name"],
    ["declared-employer", "organization.name", "string", employer, employer.toLocaleLowerCase("de-DE"), evidenceIds.employer!, "/employment/employer"],
    ["payslip-employer", "organization.name", "string", definition.payslipEmployer, definition.payslipEmployer.toLocaleLowerCase("de-DE"), evidenceIds[`page${definition.payslipPage}`]!, payslip],
    ...(definition.counterparty && bank ? [["counterparty", "organization.name", "string", definition.counterparty, definition.counterparty.toLocaleLowerCase("de-DE"), evidenceIds[`page${definition.bankPage}`]!, bank] as const] : []),
    ["declared-income", "income.monthly_net", "money", income, { amount: income, currency: "EUR" }, evidenceIds.income!, "/income/monthly_net"],
    ["payslip-income", "income.monthly_net", "money", definition.payslipIncome, { amount: definition.payslipIncome, currency: "EUR" }, evidenceIds[`page${definition.payslipPage}`]!, payslip],
    ["identity-expiry", "identity.expiry_date", "date", "2030-08-31", "2030-08-31", evidenceIds[`page${definition.identityPage}`]!, identity],
  ];
  const claimIds = Object.fromEntries(fields.map(([key]) => [key, id("claim", key)]));
  const candidates = fields.map(([key, schema, valueType, rawValue, normalizedValue, evidenceId, source]): ExtractionCandidate => ({ candidateId: id("candidate", key), fieldSchemaId: schema, fieldSchemaVersion: "1.0.0", valueType, rawValue, normalizedValue, extractionMethod: typeof source === "string" ? "structured_input" : "offline_fixture", processorVersion: typeof source === "string" ? "application-schema-1.0.0" : fixtureId, evidenceIds: [evidenceId], qualityStatus: "accepted", source: typeof source === "string" ? { type: "structured_input", applicationSnapshotId: context.applicationSnapshotId, jsonPointer: source } : { type: "logical_document", logicalDocumentRevisionId: findLogical(context, source).logicalDocumentRevisionId } }));
  const reconciliations = fields.map(([key, schema], index): PersistedCandidateReconciliation => ({ reconciliationId: id("reconciliation", key), ...reconcileSingleAcceptedCandidate(schema, [candidates[index]!]), resultingClaimId: claimIds[key]! }));
  const claims = fields.map(([key, schema, valueType, rawValue, normalizedValue, evidenceId], index): OfflineClaimResult => {
    const decision: CandidateReconciliation = reconciliations[index]!; if (decision.status !== "selected" || !decision.selectedCandidateId) throw new OfflineFixtureUnavailableError("Fixture candidate could not be reconciled");
    return { claimId: claimIds[key]!, fieldSchemaId: schema, valueType, rawValue, normalizedValue, normalizationVersion: "offline-normalization-1.0.0", evidenceIds: [evidenceId], supportingCandidateIds: [decision.selectedCandidateId] };
  });
  return { evidence, candidates, reconciliations, claims, evidenceIds, claimIds };
}

function buildInput(definition: Definition, context: OfflineFixtureContext, records: Records): ValidationInput {
  const page = (number: number) => records.evidenceIds[`page${number}`]!; const declaredIncome = readString(context.applicationData, ["income", "monthly_net"]);
  return {
    inputSnapshotId: context.inputSnapshotId, resultRevisionId: context.resultRevisionId, referenceDate: context.referenceDate, requiredStagesSucceeded: true, unresolvedRequiredGap: false,
    documents: [{ type: "identity_document", usability: "usable", reference: page(definition.identityPage) }, { type: "payslip", usability: "usable", reference: page(definition.payslipPage) }, ...(definition.bankPage ? [{ type: "bank_statement" as const, usability: definition.boundaryUncertain ? "uncertain" as const : "usable" as const, reference: page(definition.boundaryUncertain ? definition.bankPage - 1 : definition.bankPage) }] : [])],
    personMatches: [{ role: "identity_holder", result: "match", references: [records.claimIds["identity-name"]!] }, { role: "employee", result: "match", references: [records.claimIds["employee-name"]!] }, { role: "account_holder", result: "match", references: [records.claimIds["account-name"]!] }],
    organizationMatches: [{ role: "payslip_employer", result: "match", qualified: true, references: [records.claimIds["declared-employer"]!, records.claimIds["payslip-employer"]!] }, ...(records.claimIds["counterparty"] ? [{ role: "payment_counterparty" as const, result: definition.employerResult, qualified: true, references: [records.claimIds["declared-employer"]!, records.claimIds["counterparty"]!] }] : [])],
    incomes: [{ role: "declared", amount: declaredIncome, currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: [records.claimIds["declared-income"]!] }, { role: "payslip", amount: definition.payslipIncome, currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: definition.incomeEvidenceSufficient, references: [records.claimIds["payslip-income"]!] }, ...(definition.accountCredit ? [{ role: "account_credit" as const, amount: definition.accountCredit, currency: "EUR", basis: "account_credit" as const, period: "monthly" as const, evidenceSufficient: true, references: [records.claimIds["payslip-income"]!] }] : [])],
    identityExpiry: { fullDate: "2030-08-31", holderResolved: true, evidenceSufficient: true, references: [records.claimIds["identity-expiry"]!] },
  };
}

function structured(evidenceId: string, jsonPointer: string, context: OfflineFixtureContext): OfflineEvidenceResult { return { evidenceId, evidenceType: "structured_input", applicationSnapshotId: context.applicationSnapshotId, jsonPointer, extractionMethod: "structured_input", processorVersion: "application-schema-1.0.0" }; }
function pageEvidence(evidenceId: string, source: { documentVersionId: string; pageNumber: number }, fixtureId: string): OfflineEvidenceResult { return { evidenceId, evidenceType: "page_level", documentVersionId: source.documentVersionId, pageNumber: source.pageNumber, extractionMethod: "offline_fixture", processorVersion: fixtureId }; }
function findPage(context: OfflineFixtureContext, pageNumber: number) { const page = context.pages.find((item) => item.pageNumber === pageNumber); if (!page) throw new OfflineFixtureUnavailableError(`Fixture source page ${pageNumber} is unavailable`); return page; }
function findLogical(context: OfflineFixtureContext, page: { documentVersionId: string; pageNumber: number }) { const document = context.logicalDocuments.find((item) => item.documentVersionId === page.documentVersionId && item.startPage <= page.pageNumber && item.endPage >= page.pageNumber); if (!document) throw new OfflineFixtureUnavailableError(`Logical document for page ${page.pageNumber} is unavailable`); return document; }
function uuid(value: string) { const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split(""); hex[12] = "4"; hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16); const compact = hex.join(""); return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`; }
function readString(value: Readonly<Record<string, unknown>>, path: readonly string[]) { let current: unknown = value; for (const part of path) { if (!current || typeof current !== "object" || Array.isArray(current)) throw new OfflineFixtureUnavailableError(`Fixture field /${path.join("/")} is missing`); current = (current as Record<string, unknown>)[part]; } if (typeof current !== "string" || !current) throw new OfflineFixtureUnavailableError(`Fixture field /${path.join("/")} is missing`); return current; }

function issueFromAttentionItem(item: { description: string; suggested_action: string; references: readonly string[] }) {
  const reference = item.references.find((value) => value.startsWith("finding:")); if (!reference) throw new Error("Agent attention item has no finding reference");
  const actions: Record<string, string> = { compare_claims: "Confirm the current employer and provide corrected supporting documents if needed.", verify_extracted_value: "Provide a legible payslip that shows the monthly net income.", review_document_boundary: "Resubmit the bank statement as one complete file if the displayed page boundary is incorrect.", review_missing_document: "Provide the missing bank statement." };
  const recommendedAction = actions[item.suggested_action]; if (!recommendedAction) throw new Error(`No applicant-readable action registered for ${item.suggested_action}`);
  return { code: reference.slice("finding:".length), description: item.description, recommendedAction };
}
