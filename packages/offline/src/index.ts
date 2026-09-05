import type { OfflineCaseResult } from "@findoc/core";
import { FakeCaseReviewAgentHarness, runVerifiedReport, type CaseReviewAgentHarness } from "@findoc/agent";
import { evaluateRuleSet, mapDisposition, type ValidationInput } from "@findoc/validation";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";

export class OfflineFixtureUnavailableError extends Error {}

export interface OfflineFixtureContext {
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly referenceDate: string;
}

export async function runOfflineFixture(
  fixtureId: unknown,
  context: OfflineFixtureContext,
  harness: CaseReviewAgentHarness = new FakeCaseReviewAgentHarness(),
): Promise<OfflineCaseResult> {
  if (fixtureId !== ANNA_EXAMPLE_FIXTURE_ID) {
    throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  }
  const input = annaExampleInput(context);
  const findings = evaluateRuleSet(input);
  const recommendedDisposition = mapDisposition(input, findings);
  const reportContext = {
    resultRevisionId: context.resultRevisionId,
    findings,
    recommendedDisposition,
    allowedReferences: new Set(findings.map((finding) => `finding:${finding.ruleId}`)),
  };
  const report = await runVerifiedReport(harness, reportContext);
  const issues = report.verified ? report.brief.attention_items.map(issueFromAttentionItem) : [];
  return {
    resultRevisionId: context.resultRevisionId,
    reportAvailability: report.verified ? "ready" : "unavailable",
    ...(report.verified ? {} : { reportFailureReason: report.reason }),
    summary: report.verified ? report.brief.summary : "Agent report unavailable.",
    modelLabel: "fake-pi-harness-v1",
    estimatedCost: "0.0000",
    findings,
    recommendedDisposition,
    issues,
  };
}

function annaExampleInput(context: OfflineFixtureContext): ValidationInput {
  return {
    inputSnapshotId: context.inputSnapshotId, resultRevisionId: context.resultRevisionId,
    referenceDate: context.referenceDate, requiredStagesSucceeded: true, unresolvedRequiredGap: false,
    documents: [
      { type: "identity_document", usability: "usable", reference: "fixture-evidence:identity" },
      { type: "payslip", usability: "usable", reference: "fixture-evidence:payslip" },
      { type: "bank_statement", usability: "uncertain", reference: "fixture-evidence:bank-boundary" },
    ],
    personMatches: [
      { role: "identity_holder", result: "match", references: ["fixture-claim:identity-name"] },
      { role: "employee", result: "match", references: ["fixture-claim:employee-name"] },
      { role: "account_holder", result: "match", references: ["fixture-claim:account-name"] },
    ],
    organizationMatches: [
      { role: "payslip_employer", result: "match", qualified: true, references: ["fixture-claim:payslip-employer"] },
      { role: "payment_counterparty", result: "mismatch", qualified: true, references: ["fixture-claim:salary-counterparty"] },
    ],
    incomes: [
      { role: "declared", amount: "3480.00", currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: ["fixture-claim:declared-income"] },
      { role: "payslip", amount: "3480.00", currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: false, references: ["fixture-claim:payslip-income"] },
    ],
    identityExpiry: { fullDate: "2030-08-31", holderResolved: true, evidenceSufficient: true, references: ["fixture-claim:identity-expiry"] },
  };
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
