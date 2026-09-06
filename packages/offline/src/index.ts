import { createHash } from "node:crypto";
import { reconcileSingleAcceptedCandidate, type AgentEligibilityDecision, type AgentSessionTrace, type CandidateReconciliation, type ExtractionCandidate, type ExtractionGap, type GapResolution, type OfflineCaseResult, type OfflineClaimResult, type OfflineDeterministicResult, type OfflineEvidenceResult, type OfflineReportInput, type OfflineReportResult, type PersistedCandidateReconciliation } from "@findoc/core";
import { FAKE_HARNESS_DESCRIPTOR, FakeCaseReviewAgentHarness, buildSyntheticSessionTrace, hashArguments, runVerifiedReport, type AdaptiveRecoveryContext, type CaseReviewAgentHarness, type RecoveryToolPorts, type SubmittedExtractionCandidate } from "@findoc/agent";
import { evaluateRuleSet, mapDisposition, type MatchResult, type ValidationInput } from "@findoc/validation";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";
export const GOLDEN_FIXTURE_IDS = ["golden-001-native-clear", "golden-002-employer-conflict", "golden-003-multiple-review-issues", "golden-004-missing-bank-evidence", "golden-005-instruction-inert", "golden-006-scanned-adaptive-unavailable"] as const;
export class OfflineFixtureUnavailableError extends Error {}

export interface OfflineFixtureContext {
  readonly inputSnapshotId: string; readonly resultRevisionId: string; readonly referenceDate: string;
  readonly applicationSnapshotId: string; readonly applicationData: Readonly<Record<string, unknown>>;
  readonly pages: readonly { submittedFilename: string; documentVersionId: string; pageNumber: number; needsOcr?: boolean; nativeCharacterCount?: number; ocrAvailable?: boolean; renderAvailable?: boolean }[];
  readonly logicalDocuments: readonly { logicalDocumentRevisionId: string; documentVersionId: string; startPage: number; endPage: number }[];
}

/** Outcome of an optional adaptive-recovery attempt supplied by the Worker before validation. */
export interface OfflineRecoveryInput {
  readonly eligibility: AgentEligibilityDecision;
  readonly candidates: readonly SubmittedExtractionCandidate[];
  readonly trace?: AgentSessionTrace;
}

export interface OfflineExtraction {
  readonly fixtureId: string;
  readonly records: Records;
  readonly gaps: readonly ExtractionGap[];
}

interface Definition {
  pageCount: number; identityPage: number; payslipPage: number; bankPage?: number; boundaryUncertain?: boolean;
  payslipEmployer: string; counterparty?: string; employerResult: MatchResult; payslipIncome: string; incomeEvidenceSufficient: boolean; accountCredit?: string;
  /** The scanned payslip page yields no usable income value from fixed paths; a required gap is opened for bounded recovery. */
  incomeRecoveryGap?: boolean;
}

const DEFINITIONS: Readonly<Record<string, Definition>> = Object.freeze({
  "golden-001-native-clear": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Mustertechnik GmbH", counterparty: "Mustertechnik GmbH", employerResult: "match", payslipIncome: "3200.00", incomeEvidenceSufficient: true },
  "golden-002-employer-conflict": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Nordwerk Demo GmbH", counterparty: "Suedwerk Demo Services", employerResult: "mismatch", payslipIncome: "2900.00", incomeEvidenceSufficient: true },
  "golden-003-multiple-review-issues": { pageCount: 4, identityPage: 1, payslipPage: 2, bankPage: 4, boundaryUncertain: true, payslipEmployer: "Beispieltechnik GmbH", counterparty: "Beispiel Tech Services", employerResult: "mismatch", payslipIncome: "3480.00", incomeEvidenceSufficient: false },
  "golden-004-missing-bank-evidence": { pageCount: 2, identityPage: 1, payslipPage: 2, payslipEmployer: "Sample Works Ltd", employerResult: "match", payslipIncome: "3100.00", incomeEvidenceSufficient: true },
  "golden-005-instruction-inert": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Testbetrieb GmbH", counterparty: "Testbetrieb GmbH", employerResult: "match", payslipIncome: "2750.00", incomeEvidenceSufficient: true },
  "golden-006-scanned-adaptive-unavailable": { pageCount: 3, identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Demowerk GmbH", counterparty: "Demowerk GmbH", employerResult: "match", payslipIncome: "2980.00", incomeEvidenceSufficient: true, accountCredit: "3010.00", incomeRecoveryGap: true },
});

export const INCOME_FIELD_SCHEMA = Object.freeze({ fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" as const });

function resolveDefinition(fixtureId: unknown): { id: string; definition: Definition } {
  const id = fixtureId === ANNA_EXAMPLE_FIXTURE_ID ? "golden-003-multiple-review-issues" : fixtureId;
  const definition = typeof id === "string" ? DEFINITIONS[id] : undefined;
  if (!definition || typeof id !== "string") throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  return { id, definition };
}

/** Fixed extraction stage: evidence, candidates, reconciliations, claims, and explicit unresolved gaps (ARC-REQ-044). */
export function buildOfflineExtraction(fixtureId: unknown, context: OfflineFixtureContext): OfflineExtraction {
  const { id, definition } = resolveDefinition(fixtureId);
  const records = buildRecords(id, definition, context);
  const gaps: ExtractionGap[] = [];
  if (definition.incomeRecoveryGap) {
    const payslip = findPage(context, definition.payslipPage);
    gaps.push({
      gapId: uuid(`${context.resultRevisionId}:gap:payslip-income`), ...INCOME_FIELD_SCHEMA, required: true, originatingStage: "extract",
      reasonCode: "scanned_page_value_unresolved", attemptedPaths: ["native_text", "fixture_ocr"],
      scope: { documentVersionId: payslip.documentVersionId, logicalDocumentRevisionId: findLogical(context, payslip).logicalDocumentRevisionId, pageNumber: payslip.pageNumber },
    });
  }
  return { fixtureId: id, records, gaps };
}

/** Bounded recovery context: only the gap pages' logical document and the gap field schema (AGT-REQ-013). */
export function buildRecoveryContext(runId: string, extraction: OfflineExtraction, context: OfflineFixtureContext): AdaptiveRecoveryContext {
  const logicalDocumentIds = new Set(extraction.gaps.map((gap) => gap.scope.logicalDocumentRevisionId));
  const pages = context.pages.flatMap((page) => {
    const logical = context.logicalDocuments.find((item) => item.documentVersionId === page.documentVersionId && item.startPage <= page.pageNumber && item.endPage >= page.pageNumber);
    if (!logical || !logicalDocumentIds.has(logical.logicalDocumentRevisionId)) return [];
    return [{
      documentVersionId: page.documentVersionId, logicalDocumentRevisionId: logical.logicalDocumentRevisionId, pageNumber: page.pageNumber,
      needsOcr: page.needsOcr ?? false, ocrAvailable: page.ocrAvailable ?? false, nativeCharacterCount: page.nativeCharacterCount ?? 0, renderAvailable: page.renderAvailable ?? false,
    }];
  });
  const fieldSchemas = [...new Map(extraction.gaps.map((gap) => [gap.fieldSchemaId, { fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType }])).values()];
  return { runId, gaps: extraction.gaps, pages, fieldSchemas };
}

/**
 * Fake recovery ports for the synthetic demo. OCR lines and VLM values are fixture data, not recognition;
 * the ports still enforce that only the gap page yields the gap field.
 */
export function createOfflineRecoveryPorts(fixtureId: unknown, context: OfflineFixtureContext): RecoveryToolPorts {
  const { definition } = resolveDefinition(fixtureId);
  const page = (reference: { documentVersionId: string; pageNumber: number }) => context.pages.find((item) => item.documentVersionId === reference.documentVersionId && item.pageNumber === reference.pageNumber);
  const incomeRegion = { x: 0.58, y: 0.46, width: 0.18, height: 0.035 };
  const isPayslip = (reference: { pageNumber: number }) => reference.pageNumber === definition.payslipPage;
  return {
    inspectPage: async (reference) => {
      const record = page(reference);
      if (!record) throw new Error("Page outside fixture");
      return { needsOcr: record.needsOcr ?? false, ...(record.needsOcr ? { ocrReason: "no_native_text" } : {}), hasTable: false, hasColumns: false, nativeCharacterCount: record.nativeCharacterCount ?? 0, renderAvailable: record.renderAvailable ?? false, ocrAvailable: record.ocrAvailable ?? false };
    },
    getNativeText: async (reference) => {
      const record = page(reference);
      const available = Boolean(record && (record.nativeCharacterCount ?? 0) > 0);
      return { available, text: available ? "SYNTHETIC DEMO DOCUMENT - native text is available for this page." : "", truncated: false };
    },
    runOcr: async (reference) => ({
      engine: "fake-fixture-ocr", engineVersion: "1.0.0", modelAssetVersion: "fixture", reusedCommittedOutput: true,
      lines: isPayslip(reference)
        ? [{ text: "SYNTHETIC DEMO PAYSLIP", region: { x: 0.1, y: 0.05, width: 0.5, height: 0.04 }, rawConfidence: 0.99 }, { text: "Nettoeinkommen", region: { x: 0.1, y: 0.46, width: 0.3, height: 0.035 }, rawConfidence: 0.98 }, { text: definition.payslipIncome, region: incomeRegion, rawConfidence: 0.97 }]
        : [{ text: "SYNTHETIC DEMO DOCUMENT", region: { x: 0.1, y: 0.05, width: 0.5, height: 0.04 }, rawConfidence: 0.99 }],
    }),
    renderPageRegion: async (reference, region) => ({ artifactReference: `render:${reference.documentVersionId}:${reference.pageNumber}:${region.x},${region.y},${region.width},${region.height}`, width: 300, height: 60 }),
    classifyPage: async (reference) => ({ candidates: [{ type: isPayslip(reference) ? "payslip" : reference.pageNumber === definition.identityPage ? "identity_document" : "bank_statement", rawConfidence: 0.99 }], method: "synthetic-demo-heading", version: "1.0.0" }),
    extractWithVlm: async (request) => ({
      modelLabel: "fake-vlm-gateway", promptVersion: "income-monthly-net-extract-1.0.0",
      ...(isPayslip(request.page) && request.fieldSchemaId === INCOME_FIELD_SCHEMA.fieldSchemaId
        ? { value: { rawValue: definition.payslipIncome, normalizedValue: { amount: definition.payslipIncome, currency: "EUR" }, region: incomeRegion, rawConfidence: 0.91 } }
        : {}),
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  };
}

export function buildOfflineFixture(fixtureId: unknown, context: OfflineFixtureContext, recovery?: OfflineRecoveryInput): OfflineDeterministicResult {
  const extraction = buildOfflineExtraction(fixtureId, context);
  const { definition } = resolveDefinition(fixtureId);
  const { records, resolutions } = applyRecoveredCandidates(extraction, recovery?.candidates ?? [], context);
  const unresolved = extraction.gaps.filter((gap) => gap.required && !resolutions.some((resolution) => resolution.gapId === gap.gapId));
  const input = buildInput(definition, context, records, unresolved.length > 0);
  const findings = evaluateRuleSet(input);
  return {
    resultRevisionId: context.resultRevisionId, findings, recommendedDisposition: mapDisposition(input, findings),
    evidence: records.evidence, candidates: records.candidates, reconciliations: records.reconciliations, claims: records.claims,
    gaps: extraction.gaps, gapResolutions: resolutions,
    ...(recovery ? { eligibility: recovery.eligibility } : {}),
    ...(recovery?.trace ? { recoverySession: recovery.trace } : {}),
  };
}

/** Submitted Agent candidates enter the same reconciliation and claim path as fixed candidates (AGT-REQ-048). */
function applyRecoveredCandidates(extraction: OfflineExtraction, submitted: readonly SubmittedExtractionCandidate[], context: OfflineFixtureContext): { records: Records; resolutions: GapResolution[] } {
  const records: MutableRecords = { evidence: [...extraction.records.evidence], candidates: [...extraction.records.candidates], reconciliations: [...extraction.records.reconciliations], claims: [...extraction.records.claims], evidenceIds: { ...extraction.records.evidenceIds }, claimIds: { ...extraction.records.claimIds } };
  const resolutions: GapResolution[] = [];
  const id = (kind: string, key: string) => uuid(`${context.resultRevisionId}:${kind}:${key}`);
  for (const gap of extraction.gaps) {
    const candidates = submitted.filter((candidate) => candidate.gapId === gap.gapId && candidate.fieldSchemaId === gap.fieldSchemaId
      && candidate.page.documentVersionId === gap.scope.documentVersionId && candidate.page.pageNumber === gap.scope.pageNumber);
    if (candidates.length === 0) continue;
    const key = gap.fieldSchemaId === INCOME_FIELD_SCHEMA.fieldSchemaId ? "payslip-income" : gap.gapId;
    const extractionCandidates = candidates.map((candidate, index): ExtractionCandidate => {
      const evidenceId = id("evidence", `${key}-recovered-${index}`);
      records.evidence.push({ evidenceId, evidenceType: "page_level", documentVersionId: candidate.page.documentVersionId, pageNumber: candidate.page.pageNumber, extractionMethod: candidate.extractionMethod, processorVersion: candidate.processorVersion });
      return { candidateId: id("candidate", `${key}-recovered-${index}`), fieldSchemaId: candidate.fieldSchemaId, fieldSchemaVersion: candidate.fieldSchemaVersion, valueType: candidate.valueType, rawValue: candidate.rawValue, normalizedValue: candidate.normalizedValue, extractionMethod: candidate.extractionMethod, processorVersion: candidate.processorVersion, evidenceIds: [evidenceId], qualityStatus: "accepted", source: { type: "logical_document", logicalDocumentRevisionId: gap.scope.logicalDocumentRevisionId } };
    });
    records.candidates.push(...extractionCandidates);
    const decision = reconcileSingleAcceptedCandidate(gap.fieldSchemaId, extractionCandidates);
    const claimId = id("claim", key);
    records.reconciliations.push({ reconciliationId: id("reconciliation", key), ...decision, ...(decision.status === "selected" ? { resultingClaimId: claimId } : {}) });
    if (decision.status !== "selected" || !decision.selectedCandidateId) continue;
    const selected = extractionCandidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId)!;
    records.claims.push({ claimId, fieldSchemaId: selected.fieldSchemaId, valueType: selected.valueType, rawValue: selected.rawValue, normalizedValue: selected.normalizedValue, normalizationVersion: "offline-normalization-1.0.0", evidenceIds: [...selected.evidenceIds], supportingCandidateIds: [selected.candidateId] });
    records.claimIds[key] = claimId;
    resolutions.push({ gapId: gap.gapId, resolutionType: "claim", reference: claimId });
  }
  return { records, resolutions };
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
interface MutableRecords { evidence: OfflineEvidenceResult[]; candidates: ExtractionCandidate[]; reconciliations: PersistedCandidateReconciliation[]; claims: OfflineClaimResult[]; evidenceIds: Record<string, string>; claimIds: Record<string, string> }
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
    ...(definition.incomeRecoveryGap ? [] : [["payslip-income", "income.monthly_net", "money", definition.payslipIncome, { amount: definition.payslipIncome, currency: "EUR" }, evidenceIds[`page${definition.payslipPage}`]!, payslip] as const]),
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

function buildInput(definition: Definition, context: OfflineFixtureContext, records: Records, unresolvedRequiredGap: boolean): ValidationInput {
  const page = (number: number) => records.evidenceIds[`page${number}`]!; const declaredIncome = readString(context.applicationData, ["income", "monthly_net"]);
  const payslipIncomeClaim = records.claimIds["payslip-income"];
  const payslipIncome = payslipIncomeClaim ? records.claims.find((claim) => claim.claimId === payslipIncomeClaim)?.rawValue ?? definition.payslipIncome : undefined;
  return {
    inputSnapshotId: context.inputSnapshotId, resultRevisionId: context.resultRevisionId, referenceDate: context.referenceDate, requiredStagesSucceeded: true, unresolvedRequiredGap,
    documents: [{ type: "identity_document", usability: "usable", reference: page(definition.identityPage) }, { type: "payslip", usability: "usable", reference: page(definition.payslipPage) }, ...(definition.bankPage ? [{ type: "bank_statement" as const, usability: definition.boundaryUncertain ? "uncertain" as const : "usable" as const, reference: page(definition.boundaryUncertain ? definition.bankPage - 1 : definition.bankPage) }] : [])],
    personMatches: [{ role: "identity_holder", result: "match", references: [records.claimIds["identity-name"]!] }, { role: "employee", result: "match", references: [records.claimIds["employee-name"]!] }, { role: "account_holder", result: "match", references: [records.claimIds["account-name"]!] }],
    organizationMatches: [{ role: "payslip_employer", result: "match", qualified: true, references: [records.claimIds["declared-employer"]!, records.claimIds["payslip-employer"]!] }, ...(records.claimIds["counterparty"] ? [{ role: "payment_counterparty" as const, result: definition.employerResult, qualified: true, references: [records.claimIds["declared-employer"]!, records.claimIds["counterparty"]!] }] : [])],
    incomes: [{ role: "declared", amount: declaredIncome, currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: [records.claimIds["declared-income"]!] }, ...(payslipIncome !== undefined && payslipIncomeClaim ? [{ role: "payslip" as const, amount: payslipIncome, currency: "EUR", basis: "net" as const, period: "monthly" as const, evidenceSufficient: definition.incomeEvidenceSufficient, references: [payslipIncomeClaim] }] : []), ...(definition.accountCredit && definition.bankPage ? [{ role: "account_credit" as const, amount: definition.accountCredit, currency: "EUR", basis: "account_credit" as const, period: "monthly" as const, evidenceSufficient: true, references: [page(definition.bankPage)] }] : [])],
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
