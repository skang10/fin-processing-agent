import { Value } from "@sinclair/typebox/value";
import { CaseReviewBriefCandidateSchema, type CaseReviewBriefCandidate } from "@findoc/contracts";

export interface ReportFindingView {
  readonly ruleId: string;
  readonly status: string;
  readonly reasonCode: string;
}

export interface CaseReviewContext {
  readonly resultRevisionId: string;
  readonly findings: readonly ReportFindingView[];
  readonly recommendedDisposition: string;
  readonly allowedReferences: ReadonlySet<string>;
}

export type ReportVerificationFailure = "schema_rejected" | "reference_rejected" | "policy_rejected" | "timeout" | "unavailable";
export type ReportVerificationResult =
  | { readonly verified: true; readonly brief: CaseReviewBriefCandidate }
  | { readonly verified: false; readonly reason: ReportVerificationFailure };

export interface CaseReviewAgentHarness {
  generate(context: CaseReviewContext): Promise<unknown>;
}

export class AgentReportExecutionError extends Error {
  constructor(readonly reason: "timeout" | "unavailable") {
    super(reason);
  }
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

export class FakeCaseReviewAgentHarness implements CaseReviewAgentHarness {
  async generate(context: CaseReviewContext): Promise<unknown> {
    const attentionItems = context.findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable")
      .map((finding) => {
        const display = DISPLAYS[finding.reasonCode];
        if (!display) throw new Error(`No fake report fixture for ${finding.reasonCode}`);
        return {
          signal: display.signal, suggested_action: display.action, description: display.description,
          references: [`finding:${finding.ruleId}`],
        };
      });
    return {
      schema_version: "1.0.0", result_revision_id: context.resultRevisionId, report_status: "ready",
      summary: `Document processing completed with ${attentionItems.length} items requiring human review.`,
      attention_items: attentionItems,
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

export async function runVerifiedReport(harness: CaseReviewAgentHarness, context: CaseReviewContext): Promise<ReportVerificationResult> {
  try {
    return verifyCaseReviewBrief(await harness.generate(context), context);
  } catch (error) {
    return { verified: false, reason: error instanceof AgentReportExecutionError ? error.reason : "unavailable" };
  }
}
