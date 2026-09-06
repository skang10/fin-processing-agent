import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { CaseReviewBriefCandidateSchema, type CaseReviewBriefCandidate } from "@findoc/contracts";
import type { AgentBudgetEnvelope, AgentSessionTrace, AgentStepTrace, AgentTerminalReason } from "@findoc/core";

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

export type ReportVerificationFailure = "schema_rejected" | "reference_rejected" | "policy_rejected" | "timeout" | "unavailable";
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
  maxIterations: 6,
  maxToolCalls: 8,
  maxModelCalls: 6,
  maxInputTokens: 60_000,
  maxOutputTokens: 8_000,
  maxWallClockMs: 60_000,
  maxEstimatedCostUsd: 0.25,
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
    mode: "case_review_report",
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

const PROHIBITED_DECISION_LANGUAGE = [
  /\bapprove(?:d|s)?\s+(?:the\s+)?(?:loan|application)\b/i,
  /\b(?:decline|reject)(?:d|s)?\s+(?:the\s+)?(?:loan|application)\b/i,
  /\bcreditworth(?:y|iness)\b/i,
  /\b(?:complete|pass|fail)(?:ed|s)?\s+(?:the\s+)?(?:aml|kyc)\b/i,
  /\b(?:open|disburse)(?:d|s)?\s+(?:the\s+)?(?:account|funds|loan)\b/i,
  /\bcontact(?:ed|s)?\s+(?:the\s+)?(?:customer|applicant)\b/i,
];

export function verifyCaseReviewBrief(candidate: unknown, context: CaseReviewContext): ReportVerificationResult {
  if (!Value.Check(CaseReviewBriefCandidateSchema, candidate)) return { verified: false, reason: "schema_rejected" };
  if (candidate.result_revision_id !== context.resultRevisionId || candidate.attention_items.some((item) => item.references.some((reference) => !context.allowedReferences.has(reference)))) {
    return { verified: false, reason: "reference_rejected" };
  }
  const prose = [candidate.summary, ...candidate.attention_items.map((item) => item.description)].join("\n");
  if (PROHIBITED_DECISION_LANGUAGE.some((pattern) => pattern.test(prose))) return { verified: false, reason: "policy_rejected" };
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
