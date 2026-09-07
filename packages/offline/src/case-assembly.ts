import { createHash } from "node:crypto";
import {
  reconcileSingleAcceptedCandidate,
  type AgentEligibilityDecision, type ExtractionCandidate, type ExtractionGap, type GapResolution,
  type OfflineClaimResult, type OfflineDeterministicResult, type OfflineEvidenceResult, type PersistedCandidateReconciliation,
} from "@findoc/core";
import type { CaseDocumentView, SubmittedExtractionCandidate } from "@findoc/agent";
import { evaluateRuleSet, mapDisposition, type MatchResult, type ValidationInput } from "@findoc/validation";

/**
 * Deterministic case assembly for the Agent-led path.
 *
 * The system inspects and renders documents before the Agent runs, but it has no deterministic
 * field parser. Every document value therefore reaches this module as an Agent candidate produced
 * through a registered, scoped tool. This module owns normalization, reconciliation, claims, entity
 * matching, the registered rule set, and the recommended disposition; the model owns none of them.
 */

export const EXTRACTION_REQUIREMENT_SET_VERSION = "document-field-requirements-1.0.0";
export const CASE_NORMALIZATION_VERSION = "case-normalization-1.1.0";

export type RequiredDocumentType = "identity_document" | "payslip" | "bank_statement";
export type RequirementRole = "identity_holder" | "employee" | "account_holder" | "payslip_employer" | "payment_counterparty" | "payslip_income";

export interface DocumentFieldRequirement {
  readonly requirementId: string;
  readonly documentType: RequiredDocumentType;
  readonly fieldSchemaId: string;
  readonly fieldSchemaVersion: string;
  readonly valueType: "string" | "money" | "date";
  readonly role: RequirementRole;
  readonly extractionGuidance: string;
  readonly required: boolean;
}

/**
 * The declared field requirements the registered rule set needs from documents. They are fixed
 * configuration: they never come from golden truth, and a model cannot add, remove, or reinterpret one.
 */
export const DOCUMENT_FIELD_REQUIREMENTS: readonly DocumentFieldRequirement[] = Object.freeze(([
  { requirementId: "identity_holder_name", documentType: "identity_document", fieldSchemaId: "person.name", fieldSchemaVersion: "1.0.0", valueType: "string", role: "identity_holder", extractionGuidance: "Extract the identity-document holder's name.", required: true },
  { requirementId: "identity_expiry_date", documentType: "identity_document", fieldSchemaId: "identity.expiry_date", fieldSchemaVersion: "1.0.0", valueType: "date", role: "identity_holder", extractionGuidance: "Extract the identity document's expiry date.", required: true },
  { requirementId: "employee_name", documentType: "payslip", fieldSchemaId: "person.name", fieldSchemaVersion: "1.0.0", valueType: "string", role: "employee", extractionGuidance: "Extract the employee name shown on the payslip.", required: true },
  { requirementId: "payslip_employer_name", documentType: "payslip", fieldSchemaId: "organization.name", fieldSchemaVersion: "1.0.0", valueType: "string", role: "payslip_employer", extractionGuidance: "Extract the employer that issued the payslip.", required: true },
  { requirementId: "payslip_monthly_net_income", documentType: "payslip", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money", role: "payslip_income", extractionGuidance: "Extract the payslip's monthly net-pay amount, without currency conversion.", required: true },
  { requirementId: "account_holder_name", documentType: "bank_statement", fieldSchemaId: "person.name", fieldSchemaVersion: "1.0.0", valueType: "string", role: "account_holder", extractionGuidance: "Extract the account holder's name, not a transaction counterparty.", required: true },
  { requirementId: "payment_counterparty_name", documentType: "bank_statement", fieldSchemaId: "organization.name", fieldSchemaVersion: "1.0.0", valueType: "string", role: "payment_counterparty", extractionGuidance: "Extract the sender or counterparty of the salary-credit transaction. Do not extract the account-holding bank, its logo, or a page-header institution name.", required: true },
] satisfies DocumentFieldRequirement[]).map((entry) => Object.freeze(entry)));

export const REQUIRED_DOCUMENT_TYPES: readonly RequiredDocumentType[] = Object.freeze(["identity_document", "payslip", "bank_statement"]);

export class CaseAssemblyInputError extends Error {}

export interface CasePageView {
  readonly documentVersionId: string;
  readonly pageNumber: number;
  readonly needsOcr: boolean;
  readonly nativeCharacterCount: number;
  readonly ocrAvailable: boolean;
  readonly renderAvailable: boolean;
}

export interface CaseLogicalDocumentView {
  readonly logicalDocumentRevisionId: string;
  readonly documentVersionId: string;
  readonly startPage: number;
  readonly endPage: number;
  readonly documentType: string;
  readonly uncertain: boolean;
}

export interface CaseAssemblyContext {
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly referenceDate: string;
  readonly applicationSnapshotId: string;
  readonly applicationData: Readonly<Record<string, unknown>>;
  readonly pages: readonly CasePageView[];
  readonly logicalDocuments: readonly CaseLogicalDocumentView[];
  /** Processor identity of the pre-Agent document inspection stage, recorded on page evidence. */
  readonly documentProcessorVersion: string;
}

export interface ExtractionPlan {
  readonly gaps: readonly ExtractionGap[];
  readonly documents: readonly CaseDocumentView[];
  readonly requirementByGapId: ReadonlyMap<string, DocumentFieldRequirement>;
  readonly documentByGapId: ReadonlyMap<string, CaseLogicalDocumentView>;
}

/**
 * Derive the Agent's work from the declared field requirements and the committed document and page
 * metadata of this run. Nothing here reads golden truth: a requirement becomes an explicit gap only
 * when the run actually contains a logical document of that type.
 */
export function buildExtractionPlan(context: CaseAssemblyContext): ExtractionPlan {
  const gaps: ExtractionGap[] = [];
  const requirementByGapId = new Map<string, DocumentFieldRequirement>();
  const documentByGapId = new Map<string, CaseLogicalDocumentView>();
  for (const requirement of DOCUMENT_FIELD_REQUIREMENTS) {
    const document = firstDocumentOfType(context, requirement.documentType);
    if (!document) continue;
    const page = context.pages.find((item) => item.documentVersionId === document.documentVersionId && item.pageNumber === document.startPage);
    if (!page) continue;
    const gapId = deterministicUuid(`${context.resultRevisionId}:gap:${requirement.requirementId}:${document.logicalDocumentRevisionId}`);
    gaps.push({
      gapId, requirementId: requirement.requirementId, role: requirement.role, extractionGuidance: requirement.extractionGuidance,
      fieldSchemaId: requirement.fieldSchemaId, fieldSchemaVersion: requirement.fieldSchemaVersion,
      valueType: requirement.valueType, required: requirement.required, originatingStage: "extract",
      reasonCode: "no_deterministic_field_extractor",
      attemptedPaths: ["pdf_inspector_native_extraction", ...(page.ocrAvailable ? ["selective_ocr"] : [])],
      scope: { documentVersionId: document.documentVersionId, logicalDocumentRevisionId: document.logicalDocumentRevisionId, pageNumber: document.startPage },
    });
    requirementByGapId.set(gapId, requirement);
    documentByGapId.set(gapId, document);
  }
  return {
    gaps, requirementByGapId, documentByGapId,
    documents: [...context.logicalDocuments]
      .sort((left, right) => left.startPage - right.startPage)
      .map((document) => ({
        logicalDocumentRevisionId: document.logicalDocumentRevisionId, documentVersionId: document.documentVersionId,
        documentType: document.documentType, startPage: document.startPage, endPage: document.endPage, uncertain: document.uncertain,
      })),
  };
}

function firstDocumentOfType(context: CaseAssemblyContext, documentType: string): CaseLogicalDocumentView | undefined {
  return [...context.logicalDocuments].filter((document) => document.documentType === documentType)
    .sort((left, right) => left.startPage - right.startPage)[0];
}

interface AssembledSlot {
  readonly key: string;
  readonly requirement?: DocumentFieldRequirement;
  readonly candidate: ExtractionCandidate;
  readonly claimId: string;
}

/**
 * Build one sealed deterministic result from the structured application input and the Agent's
 * evidence-backed candidates (AGT-REQ-048, VAL section 3).
 */
export function assembleCaseResult(
  context: CaseAssemblyContext,
  plan: ExtractionPlan,
  submitted: readonly SubmittedExtractionCandidate[],
  eligibility?: AgentEligibilityDecision,
): OfflineDeterministicResult {
  const id = (kind: string, key: string) => deterministicUuid(`${context.resultRevisionId}:${kind}:${key}`);
  const evidence: OfflineEvidenceResult[] = [];
  const candidates: ExtractionCandidate[] = [];
  const reconciliations: PersistedCandidateReconciliation[] = [];
  const claims: OfflineClaimResult[] = [];
  const slots: AssembledSlot[] = [];

  // Page-level evidence for every grouped logical document: the system genuinely inspected the page.
  const documentEvidence = new Map<string, string>();
  for (const document of plan.documents) {
    const evidenceId = id("evidence", `logical-document-${document.logicalDocumentRevisionId}`);
    documentEvidence.set(document.logicalDocumentRevisionId, evidenceId);
    evidence.push({
      evidenceId, evidenceType: "page_level", documentVersionId: document.documentVersionId, pageNumber: document.startPage,
      extractionMethod: "pdf_inspector_inspection", processorVersion: context.documentProcessorVersion,
    });
  }

  const addSlot = (key: string, requirement: DocumentFieldRequirement | undefined, candidate: ExtractionCandidate): string => {
    const claimId = id("claim", key);
    candidates.push(candidate);
    const decision = reconcileSingleAcceptedCandidate(candidate.fieldSchemaId, [candidate]);
    if (decision.status !== "selected" || !decision.selectedCandidateId) throw new CaseAssemblyInputError(`Candidate ${key} could not be reconciled`);
    reconciliations.push({ reconciliationId: id("reconciliation", key), ...decision, resultingClaimId: claimId });
    claims.push({
      claimId, fieldSchemaId: candidate.fieldSchemaId, valueType: candidate.valueType, rawValue: candidate.rawValue,
      normalizedValue: candidate.normalizedValue, normalizationVersion: CASE_NORMALIZATION_VERSION,
      evidenceIds: [...candidate.evidenceIds], supportingCandidateIds: [candidate.candidateId],
    });
    slots.push({ key, ...(requirement ? { requirement } : {}), candidate, claimId });
    return claimId;
  };

  // 1. Structured application input. It is never document evidence and never satisfies a requirement.
  const structured: readonly { key: string; pointer: string; fieldSchemaId: string; valueType: "string" | "money" | "date"; path: readonly string[] }[] = [
    { key: "declared-applicant-name", pointer: "/applicant_display_name", fieldSchemaId: "person.name", valueType: "string", path: ["applicant_display_name"] },
    { key: "declared-employer", pointer: "/employment/employer", fieldSchemaId: "organization.name", valueType: "string", path: ["employment", "employer"] },
    { key: "declared-income", pointer: "/income/monthly_net", fieldSchemaId: "income.monthly_net", valueType: "money", path: ["income", "monthly_net"] },
  ];
  const structuredClaims = new Map<string, string>();
  for (const field of structured) {
    const rawValue = readString(context.applicationData, field.path);
    const evidenceId = id("evidence", field.key);
    evidence.push({
      evidenceId, evidenceType: "structured_input", applicationSnapshotId: context.applicationSnapshotId, jsonPointer: field.pointer,
      extractionMethod: "structured_input", processorVersion: "application-schema-1.0.0",
    });
    structuredClaims.set(field.key, addSlot(field.key, undefined, {
      candidateId: id("candidate", field.key), fieldSchemaId: field.fieldSchemaId, fieldSchemaVersion: "1.0.0",
      valueType: field.valueType, rawValue, normalizedValue: normalizeValue(field.valueType, rawValue),
      extractionMethod: "structured_input", processorVersion: "application-schema-1.0.0",
      evidenceIds: [evidenceId], qualityStatus: "accepted",
      source: { type: "structured_input", applicationSnapshotId: context.applicationSnapshotId, jsonPointer: field.pointer },
    }));
  }

  // 2. Agent candidates. Only a candidate bound to a planned gap and its authorized page is accepted.
  const resolutions: GapResolution[] = [];
  const seenGapIds = new Set<string>();
  for (const gap of plan.gaps) {
    const requirement = plan.requirementByGapId.get(gap.gapId);
    const document = plan.documentByGapId.get(gap.gapId);
    if (!requirement || !document) continue;
    // The gap anchors on its logical document's first page, but the value may sit on any page of
    // that document, so a multi-page payslip or statement is not restricted to its first page.
    const proposal = submitted.find((item) => item.gapId === gap.gapId
      && item.fieldSchemaId === gap.fieldSchemaId
      && item.page.documentVersionId === document.documentVersionId
      && item.page.pageNumber >= document.startPage
      && item.page.pageNumber <= document.endPage);
    if (!proposal || seenGapIds.has(gap.gapId)) continue;
    seenGapIds.add(gap.gapId);
    const normalizedValue = normalizeValue(gap.valueType, proposal.rawValue);
    if (normalizedValue === undefined) continue;
    const key = requirement.requirementId;
    const evidenceId = id("evidence", key);
    evidence.push({
      evidenceId, evidenceType: "page_level", documentVersionId: proposal.page.documentVersionId, pageNumber: proposal.page.pageNumber,
      extractionMethod: proposal.extractionMethod, processorVersion: proposal.processorVersion,
    });
    addSlot(key, requirement, {
      candidateId: id("candidate", key), fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion,
      valueType: gap.valueType, rawValue: proposal.rawValue, normalizedValue,
      extractionMethod: proposal.extractionMethod, processorVersion: proposal.processorVersion,
      evidenceIds: [evidenceId], qualityStatus: "accepted",
      source: { type: "logical_document", logicalDocumentRevisionId: document.logicalDocumentRevisionId },
    });
    resolutions.push({ gapId: gap.gapId, resolutionType: "claim", reference: id("claim", key) });
  }
  /** The identity page carries two requirements for one role, so slots stay addressable by requirement. */
  const claimOf = (requirementId: string) => slots.find((slot) => slot.requirement?.requirementId === requirementId);

  const unresolvedRequiredGap = plan.gaps.some((gap) => gap.required && !resolutions.some((resolution) => resolution.gapId === gap.gapId));
  const input = buildValidationInput(context, plan, {
    documentEvidence, structuredClaims, claimOf, evidence, unresolvedRequiredGap,
  });
  const findings = evaluateRuleSet(input);
  return {
    resultRevisionId: context.resultRevisionId, findings, recommendedDisposition: mapDisposition(input, findings),
    evidence, candidates, reconciliations, claims,
    gaps: plan.gaps, gapResolutions: resolutions,
    ...(eligibility ? { eligibility } : {}),
  };
}

interface ValidationSources {
  readonly documentEvidence: ReadonlyMap<string, string>;
  readonly structuredClaims: ReadonlyMap<string, string>;
  readonly claimOf: (requirementId: string) => AssembledSlot | undefined;
  readonly evidence: readonly OfflineEvidenceResult[];
  readonly unresolvedRequiredGap: boolean;
}

/** Deterministic entity matching and rule input. Every reference is a persisted claim or evidence id. */
function buildValidationInput(context: CaseAssemblyContext, plan: ExtractionPlan, sources: ValidationSources): ValidationInput {
  const declaredName = sources.structuredClaims.get("declared-applicant-name")!;
  const declaredEmployer = sources.structuredClaims.get("declared-employer")!;
  const declaredIncome = sources.structuredClaims.get("declared-income")!;
  const declaredNameValue = normalizeValue("string", readString(context.applicationData, ["applicant_display_name"]));
  const declaredEmployerValue = normalizeValue("string", readString(context.applicationData, ["employment", "employer"]));
  const documentOfType = (documentType: RequiredDocumentType) => plan.documents.find((document) => document.documentType === documentType);
  const anyPageEvidence = sources.evidence.find((item) => item.evidenceType === "page_level")?.evidenceId;
  const fallbackReference = anyPageEvidence ?? declaredName;

  const documents = REQUIRED_DOCUMENT_TYPES.flatMap((documentType) => {
    const document = documentOfType(documentType);
    const reference = document ? sources.documentEvidence.get(document.logicalDocumentRevisionId) : undefined;
    return document && reference
      ? [{ type: documentType, usability: document.uncertain ? "uncertain" as const : "usable" as const, reference }]
      : [];
  });

  const personMatch = (role: "identity_holder" | "employee" | "account_holder", requirementId: string, documentType: RequiredDocumentType) => {
    const slot = sources.claimOf(requirementId);
    const present = Boolean(documentOfType(documentType));
    const result: MatchResult = !present || !slot ? "missing"
      : slot.candidate.normalizedValue === declaredNameValue ? "match" : "mismatch";
    return { role, result, references: slot ? [declaredName, slot.claimId] : [declaredName] };
  };

  const employerSlot = sources.claimOf("payslip_employer_name");
  const counterpartySlot = sources.claimOf("payment_counterparty_name");
  const organizationMatches = [
    {
      role: "payslip_employer" as const, qualified: true,
      result: (!documentOfType("payslip") || !employerSlot ? "missing"
        : employerSlot.candidate.normalizedValue === declaredEmployerValue ? "match" : "mismatch") as MatchResult,
      references: employerSlot ? [declaredEmployer, employerSlot.claimId] : [declaredEmployer],
    },
    ...(documentOfType("bank_statement")
      ? [{
        role: "payment_counterparty" as const, qualified: true,
        result: (!counterpartySlot ? "missing"
          : counterpartySlot.candidate.normalizedValue === declaredEmployerValue ? "match" : "mismatch") as MatchResult,
        references: counterpartySlot ? [declaredEmployer, counterpartySlot.claimId] : [declaredEmployer],
      }]
      : []),
  ];

  const payslipIncome = sources.claimOf("payslip_monthly_net_income");
  const declaredAmount = moneyAmount(normalizeValue("money", readString(context.applicationData, ["income", "monthly_net"])));
  const payslipAmount = payslipIncome ? moneyAmount(payslipIncome.candidate.normalizedValue) : undefined;
  const incomes = [
    { role: "declared" as const, amount: declaredAmount ?? "", currency: "EUR", basis: "net" as const, period: "monthly" as const, evidenceSufficient: declaredAmount !== undefined, references: [declaredIncome] },
    ...(payslipIncome && payslipAmount !== undefined
      ? [{ role: "payslip" as const, amount: payslipAmount, currency: "EUR", basis: "net" as const, period: "monthly" as const, evidenceSufficient: true, references: [payslipIncome.claimId] }]
      : []),
  ];

  const expirySlot = sources.claimOf("identity_expiry_date");
  const identityDocument = documentOfType("identity_document");
  const identityReference = identityDocument ? sources.documentEvidence.get(identityDocument.logicalDocumentRevisionId) : undefined;
  const identityHolder = personMatch("identity_holder", "identity_holder_name", "identity_document");
  const identityExpiry = {
    fullDate: expirySlot ? String(expirySlot.candidate.normalizedValue) : "",
    holderResolved: identityHolder.result === "match",
    evidenceSufficient: Boolean(expirySlot),
    references: expirySlot ? [expirySlot.claimId] : [identityReference ?? fallbackReference],
  };

  return {
    inputSnapshotId: context.inputSnapshotId, resultRevisionId: context.resultRevisionId, referenceDate: context.referenceDate,
    requiredStagesSucceeded: true, unresolvedRequiredGap: sources.unresolvedRequiredGap,
    documents,
    personMatches: [
      identityHolder,
      personMatch("employee", "employee_name", "payslip"),
      personMatch("account_holder", "account_holder_name", "bank_statement"),
    ],
    organizationMatches,
    incomes,
    identityExpiry,
  };
}

function moneyAmount(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as { amount?: unknown }).amount === "string"
    ? (value as { amount: string }).amount
    : undefined;
}

// ---------------------------------------------------------------------------
// Deterministic normalization (never performed by a model)
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, string>> = Object.freeze({
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  januar: "01", februar: "02", "märz": "03", maerz: "03", mai: "05", juni: "06", juli: "07",
  oktober: "10", dezember: "12",
});

export function normalizeValue(valueType: "string" | "money" | "date", rawValue: string): unknown {
  if (valueType === "string") return rawValue.trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-DE");
  if (valueType === "money") {
    const amount = normalizeAmount(rawValue);
    return amount === undefined ? undefined : { amount, currency: "EUR" };
  }
  return normalizeDate(rawValue);
}

/** Accept `3200.00`, `3,200.00`, `3.200,00`, and `3200`; the last separator decides the decimal mark. */
export function normalizeAmount(rawValue: string): string | undefined {
  const match = /^\s*(?:(EUR|€)\s*)?(-?[\d.,\s ]+?)(?:\s*(EUR|€))?\s*$/iu.exec(rawValue);
  if (!match || (match[1] !== undefined && match[3] !== undefined)) return undefined;
  const cleaned = (match[2] ?? "").replace(/[\s ]/gu, "");
  if (!/^-?[\d.,]+$/u.test(cleaned) || !/\d/u.test(cleaned)) return undefined;
  const negative = cleaned.startsWith("-");
  const digitsAndMarks = cleaned.replace(/^-/u, "");
  const lastComma = digitsAndMarks.lastIndexOf(",");
  const lastDot = digitsAndMarks.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  const fraction = decimalIndex >= 0 && /^\d{1,2}$/u.test(digitsAndMarks.slice(decimalIndex + 1)) ? digitsAndMarks.slice(decimalIndex + 1) : "";
  const integer = (fraction ? digitsAndMarks.slice(0, decimalIndex) : digitsAndMarks).replace(/[.,]/gu, "");
  if (!/^\d+$/u.test(integer)) return undefined;
  return `${negative ? "-" : ""}${integer}.${fraction.padEnd(2, "0")}`;
}

/** Accept `2030-08-31`, `31 August 2030`, and `31.08.2030`. */
export function normalizeDate(rawValue: string): string | undefined {
  const value = rawValue.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (iso) return isValidDate(iso[1]!, iso[2]!, iso[3]!) ? value : undefined;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(value);
  if (dotted) return isValidDate(dotted[3]!, dotted[2]!.padStart(2, "0"), dotted[1]!.padStart(2, "0")) ? `${dotted[3]}-${dotted[2]!.padStart(2, "0")}-${dotted[1]!.padStart(2, "0")}` : undefined;
  const spelled = /^(\d{1,2})\s+([A-Za-zÄÖÜäöü]+)\s+(\d{4})$/u.exec(value);
  if (!spelled) return undefined;
  const month = MONTHS[spelled[2]!.toLocaleLowerCase("de-DE")];
  if (!month) return undefined;
  const day = spelled[1]!.padStart(2, "0");
  return isValidDate(spelled[3]!, month, day) ? `${spelled[3]}-${month}-${day}` : undefined;
}

function isValidDate(year: string, month: string, day: string): boolean {
  const timestamp = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day);
}

export function readString(value: Readonly<Record<string, unknown>>, path: readonly string[]): string {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new CaseAssemblyInputError(`Application field /${path.join("/")} is missing`);
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string" || !current) throw new CaseAssemblyInputError(`Application field /${path.join("/")} is missing`);
  return current;
}

export function deterministicUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
