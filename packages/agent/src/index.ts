import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { CaseReviewBriefCandidateSchema, type CaseReviewBriefCandidate } from "@findoc/contracts";
import type { AgentBudgetEnvelope, AgentEligibilityDecision, AgentSessionTrace, AgentStepTrace, AgentTerminalReason, ExtractionGap } from "@findoc/core";

export interface ReportFindingView {
  readonly ruleId: string;
  readonly ruleVersion?: string;
  readonly status: string;
  readonly reasonCode: string;
  readonly references?: readonly string[];
}

export interface CaseReviewContext {
  readonly resultRevisionId: string;
  readonly findings: readonly ReportFindingView[];
  readonly recommendedDisposition: string;
  readonly allowedReferences: ReadonlySet<string>;
}

export interface CaseReviewHarnessDescriptor {
  readonly harnessId: string;
  readonly harnessVersion: string;
  readonly modelLabel: string;
  readonly modelRoute: "fake" | "live";
}

export interface CaseReviewSessionOutcome {
  /** The raw brief submitted by the Agent, or undefined when the session ended without a submission. */
  readonly submission?: unknown;
  readonly trace: AgentSessionTrace;
}

export interface CaseReviewAgentHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  generate(context: CaseReviewContext): Promise<CaseReviewSessionOutcome>;
}

/** Deterministic component callbacks available through registered tools in one Agent-led review. */
export interface CaseReviewProcessingPorts extends RecoveryToolPorts {
  requestReconciliation(candidates: readonly SubmittedExtractionCandidate[]): Promise<{ readonly reference: string }>;
  requestValidation(): Promise<CaseReviewContext>;
}

export interface AgentLedCaseReviewContext extends AdaptiveRecoveryContext {
  readonly fixtureLabel?: string;
}

export interface AgentLedCaseReviewOutcome extends CaseReviewSessionOutcome {
  readonly candidates: readonly SubmittedExtractionCandidate[];
  readonly result?: CaseReviewContext;
}

export interface AgentLedCaseReviewHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  review(context: AgentLedCaseReviewContext, ports: CaseReviewProcessingPorts): Promise<AgentLedCaseReviewOutcome>;
}

export type ReportVerificationFailure = "schema_rejected" | "reference_rejected"
  | "policy_rejected_loan_approval" | "policy_rejected_loan_rejection" | "policy_rejected_creditworthiness"
  | "policy_rejected_aml_kyc_decision" | "policy_rejected_account_or_disbursement"
  | "policy_rejected_customer_contact" | "timeout" | "unavailable";
export type ReportVerificationResult =
  | { readonly verified: true; readonly brief: CaseReviewBriefCandidate }
  | { readonly verified: false; readonly reason: ReportVerificationFailure };
export type VerifiedReportOutcome = ReportVerificationResult & {
  readonly trace: AgentSessionTrace;
  readonly originalSubmission?: unknown;
};

export class AgentReportExecutionError extends Error {
  constructor(readonly reason: "timeout" | "unavailable") {
    super(reason);
  }
}

/** Configuration-controlled report-session budget envelope (AGT-REQ-057). */
export const AGENT_BUDGET_CONFIGURATION_VERSION = "agent-budget-1.0.0";
export const DEFAULT_AGENT_BUDGET: AgentBudgetEnvelope = Object.freeze({
  maxIterations: 14,
  maxToolCalls: 18,
  maxModelCalls: 14,
  maxInputTokens: 60_000,
  maxOutputTokens: 8_000,
  maxWallClockMs: 60_000,
  maxEstimatedCostUsd: 0.25,
  maxVlmCalls: 2,
  maxOcrPages: 3,
  maxConsecutiveNoProgressSteps: 2,
});

export function hashArguments(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface FakeTraceOptions {
  readonly descriptor: CaseReviewHarnessDescriptor;
  readonly steps: readonly Omit<AgentStepTrace, "sequence" | "startedAt" | "completedAt" | "budgetState">[];
  readonly terminalReason: AgentTerminalReason;
  readonly now?: () => Date;
}

/** Build a deterministic synthetic session trace for fake harnesses and tests. */
export function buildSyntheticSessionTrace(options: FakeTraceOptions): AgentSessionTrace {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const steps = options.steps.map((step, index): AgentStepTrace => {
    const timestamp = now().toISOString();
    return { ...step, sequence: index + 1, startedAt: timestamp, completedAt: timestamp, budgetState: { iterationsUsed: 1, toolCallsUsed: index + 1 } };
  });
  return {
    sessionId: uuidFrom(`${options.descriptor.harnessId}:${startedAt}:${steps.length}`),
    mode: "case_review",
    harnessId: options.descriptor.harnessId,
    harnessVersion: options.descriptor.harnessVersion,
    modelLabel: options.descriptor.modelLabel,
    modelRoute: options.descriptor.modelRoute,
    promptVersion: "none", promptHash: "none",
    configurationVersion: AGENT_BUDGET_CONFIGURATION_VERSION,
    toolRegistryVersion: "synthetic-1.0.0",
    offeredTools: [...new Set(steps.map((step) => step.toolName))],
    budget: DEFAULT_AGENT_BUDGET,
    iterations: steps.length > 0 ? 1 : 0,
    toolCalls: steps.length,
    usage: { available: true, modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    estimatedCost: { amount: "0.0000", currency: "EUR" },
    terminalReason: options.terminalReason,
    steps,
    startedAt,
    completedAt: now().toISOString(),
  };
}

const DISPLAYS: Readonly<Record<string, {
  signal: CaseReviewBriefCandidate["attention_items"][number]["signal"];
  action: CaseReviewBriefCandidate["attention_items"][number]["suggested_action"];
  description: string;
}>> = Object.freeze({
  required_document_uncertain: { signal: "document_boundary_uncertain", action: "review_document_boundary", description: "The bank statement boundary is uncertain, so document completeness cannot be confirmed." },
  employer_conflict: { signal: "validation_finding_requires_attention", action: "compare_claims", description: "The declared employer differs from the qualified salary payment counterparty." },
  income_input_incomparable: { signal: "evidence_ambiguous", action: "verify_extracted_value", description: "The monthly income value does not have sufficient evidence for comparison." },
  income_conflict: { signal: "validation_finding_requires_attention", action: "verify_extracted_value", description: "The submitted monthly income values do not agree." },
  required_document_missing: { signal: "document_missing", action: "review_missing_document", description: "A required bank statement was not submitted." },
});

/** Registered display text for deterministic reason codes; shared by fake harness and fake model scripts. */
export function attentionItemsForFindings(findings: readonly ReportFindingView[]): CaseReviewBriefCandidate["attention_items"] {
  return findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable")
    .map((finding) => {
      const display = DISPLAYS[finding.reasonCode];
      if (!display) throw new Error(`No fake report fixture for ${finding.reasonCode}`);
      return {
        signal: display.signal, suggested_action: display.action, description: display.description,
        references: [`finding:${finding.ruleId}`],
      };
    });
}

export function buildFakeBrief(context: CaseReviewContext): CaseReviewBriefCandidate {
  const attentionItems = attentionItemsForFindings(context.findings);
  return {
    schema_version: "1.0.0", result_revision_id: context.resultRevisionId, report_status: "ready",
    summary: `Document processing completed with ${attentionItems.length} items requiring human review.`,
    attention_items: attentionItems,
  };
}

export const FAKE_HARNESS_DESCRIPTOR: CaseReviewHarnessDescriptor = Object.freeze({
  harnessId: "fake-case-review-harness", harnessVersion: "1.0.0", modelLabel: "fake-pi-harness-v1", modelRoute: "fake",
});

/** Deterministic harness that reads the persisted deterministic result and needs no model at all. */
export class FakeCaseReviewAgentHarness implements CaseReviewAgentHarness {
  readonly descriptor = FAKE_HARNESS_DESCRIPTOR;

  async generate(context: CaseReviewContext): Promise<CaseReviewSessionOutcome> {
    const submission = buildFakeBrief(context);
    return {
      submission,
      trace: buildSyntheticSessionTrace({
        descriptor: this.descriptor, terminalReason: "report_submitted",
        steps: [{ toolName: "submit_case_review_brief", toolVersion: "1.0.0", argumentHash: hashArguments(submission), outcome: "succeeded", summary: "Submitted a Case Review Brief" }],
      }),
    };
  }
}

const PROHIBITED_REPORT_PATTERNS: readonly { reason: ReportVerificationFailure; pattern: RegExp }[] = [
  { reason: "policy_rejected_loan_approval", pattern: /\bapprove(?:d|s)?\s+(?:the\s+)?(?:loan|application)\b/i },
  { reason: "policy_rejected_loan_rejection", pattern: /\b(?:decline|reject)(?:d|s)?\s+(?:the\s+)?(?:loan|application)\b/i },
  { reason: "policy_rejected_creditworthiness", pattern: /\bcreditworth(?:y|iness)\b/i },
  { reason: "policy_rejected_aml_kyc_decision", pattern: /\b(?:complete|pass|fail)(?:ed|s)?\s+(?:the\s+)?(?:aml|kyc)\b/i },
  { reason: "policy_rejected_account_or_disbursement", pattern: /\b(?:open|disburse)(?:d|s)?\s+(?:the\s+)?(?:account|funds|loan)\b/i },
  { reason: "policy_rejected_customer_contact", pattern: /\bcontact(?:ed|s)?\s+(?:the\s+)?(?:customer|applicant)\b/i },
];

export function verifyCaseReviewBrief(candidate: unknown, context: CaseReviewContext): ReportVerificationResult {
  if (!Value.Check(CaseReviewBriefCandidateSchema, candidate)) return { verified: false, reason: "schema_rejected" };
  if (candidate.result_revision_id !== context.resultRevisionId || candidate.attention_items.some((item) => item.references.some((reference) => !context.allowedReferences.has(reference)))) {
    return { verified: false, reason: "reference_rejected" };
  }
  const prose = [candidate.summary, ...candidate.attention_items.map((item) => item.description)].join("\n");
  const policyViolation = PROHIBITED_REPORT_PATTERNS.find(({ pattern }) => pattern.test(prose));
  if (policyViolation) return { verified: false, reason: policyViolation.reason };
  return { verified: true, brief: candidate };
}

export async function runVerifiedReport(harness: CaseReviewAgentHarness, context: CaseReviewContext): Promise<VerifiedReportOutcome> {
  let outcome: CaseReviewSessionOutcome;
  try {
    outcome = await harness.generate(context);
  } catch (error) {
    const reason = error instanceof AgentReportExecutionError ? error.reason : "unavailable";
    return {
      verified: false, reason,
      trace: buildSyntheticSessionTrace({ descriptor: harness.descriptor, steps: [], terminalReason: reason === "timeout" ? "timeout" : "internal_error" }),
    };
  }
  if (outcome.submission === undefined) {
    return { verified: false, reason: outcome.trace.terminalReason === "timeout" ? "timeout" : "unavailable", trace: outcome.trace };
  }
  return { ...verifyCaseReviewBrief(outcome.submission, context), trace: outcome.trace, originalSubmission: outcome.submission };
}

function uuidFrom(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Adaptive recovery mode (AGT sections 3, 6, 7)
// ---------------------------------------------------------------------------

export interface RecoveryPageView {
  readonly documentVersionId: string;
  readonly logicalDocumentRevisionId: string;
  readonly pageNumber: number;
  readonly needsOcr: boolean;
  readonly ocrAvailable: boolean;
  readonly nativeCharacterCount: number;
  readonly renderAvailable: boolean;
}

export interface RecoveryFieldSchemaView {
  readonly fieldSchemaId: string;
  readonly fieldSchemaVersion: string;
  readonly valueType: "string" | "money" | "date";
}

/** Minimum bounded document context for one case-review session (AGT-REQ-013 to AGT-REQ-015). */
export interface AdaptiveRecoveryContext {
  readonly runId: string;
  readonly gaps: readonly ExtractionGap[];
  readonly pages: readonly RecoveryPageView[];
  readonly fieldSchemas: readonly RecoveryFieldSchemaView[];
}

export interface NormalizedRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageReference {
  readonly documentVersionId: string;
  readonly pageNumber: number;
}

/** Scoped service capabilities held by tool wrappers, never by the model (AGT-REQ-027). */
export interface RecoveryToolPorts {
  inspectPage(page: PageReference): Promise<{ readonly needsOcr: boolean; readonly ocrReason?: string; readonly hasTable: boolean; readonly hasColumns: boolean; readonly nativeCharacterCount: number; readonly renderAvailable: boolean; readonly ocrAvailable: boolean }>;
  getNativeText(page: PageReference): Promise<{ readonly available: boolean; readonly text: string; readonly truncated: boolean }>;
  runOcr(page: PageReference): Promise<{ readonly engine: string; readonly engineVersion: string; readonly modelAssetVersion: string; readonly lines: readonly { readonly text: string; readonly region: NormalizedRegion; readonly rawConfidence: number }[]; readonly reusedCommittedOutput: boolean }>;
  renderPageRegion(page: PageReference, region: NormalizedRegion): Promise<{ readonly artifactReference: string; readonly width: number; readonly height: number }>;
  classifyPage(page: PageReference): Promise<{ readonly candidates: readonly { readonly type: string; readonly rawConfidence: number }[]; readonly method: string; readonly version: string }>;
  detectDocumentBoundaries(page: PageReference): Promise<{ readonly startsNewDocument: boolean; readonly method: string; readonly version: string; readonly rawConfidence?: number }>;
  extractLocalTable(page: PageReference): Promise<{ readonly available: boolean; readonly rowCount: number; readonly artifactReference?: string }>;
  extractWithVlm(request: { readonly page: PageReference; readonly fieldSchemaId: string; readonly region?: NormalizedRegion }): Promise<{ readonly modelLabel: string; readonly promptVersion: string; readonly value?: { readonly rawValue: string; readonly normalizedValue: unknown; readonly region: NormalizedRegion; readonly rawConfidence: number }; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } }>;
}

export interface SubmittedExtractionCandidate {
  readonly gapId: string;
  readonly fieldSchemaId: string;
  readonly fieldSchemaVersion: string;
  readonly valueType: "string" | "money" | "date";
  readonly rawValue: string;
  readonly normalizedValue: unknown;
  readonly page: PageReference;
  readonly region: NormalizedRegion;
  readonly extractionMethod: "agent_vlm_extraction" | "agent_ocr_reading";
  readonly processorVersion: string;
}

export const CASE_REVIEW_ELIGIBILITY_POLICY_VERSION = "case-review-eligibility-2.0.0";

export interface CaseReviewEligibilityInput {
  readonly gaps: readonly ExtractionGap[];
  readonly pages: readonly RecoveryPageView[];
  readonly registeredToolNames: readonly string[];
  readonly budgetAvailable: boolean;
  readonly fatalFailure: boolean;
  readonly previousAttemptWithoutNewInputs?: boolean;
}

/**
 * Versioned deterministic eligibility policy for the mandatory case-review session
 * (AGT-REQ-104 to AGT-REQ-108). Extraction gaps affect the tools the Agent may
 * use; they do not determine whether a processable case gets reviewed.
 */
export function evaluateCaseReviewEligibility(input: CaseReviewEligibilityInput, decisionId: string): AgentEligibilityDecision {
  const openRequired = input.gaps.filter((gap) => gap.required);
  const reasonCodes: string[] = [];
  if (input.fatalFailure) reasonCodes.push("fatal_processing_failure");
  if (!input.budgetAvailable) reasonCodes.push("budget_unavailable");
  if (input.previousAttemptWithoutNewInputs) reasonCodes.push("equivalent_attempt_completed");
  if (openRequired.some((gap) => !input.pages.some((page) => page.documentVersionId === gap.scope.documentVersionId && page.pageNumber === gap.scope.pageNumber))) reasonCodes.push("gap_scope_outside_run");
  if (!input.registeredToolNames.includes("request_validation") || !input.registeredToolNames.includes("submit_case_review_brief")) reasonCodes.push("required_case_review_tools_unavailable");
  return {
    decisionId, policyVersion: CASE_REVIEW_ELIGIBILITY_POLICY_VERSION,
    gapIds: openRequired.map((gap) => gap.gapId),
    decision: reasonCodes.length === 0 ? "eligible" : "ineligible",
    reasonCodes: reasonCodes.length === 0 ? ["processable_case"] : reasonCodes,
  };
}
