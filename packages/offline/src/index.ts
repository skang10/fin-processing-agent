import type { OfflineCaseResult } from "@findoc/core";
import { evaluateRuleSet, mapDisposition, type ValidationFinding, type ValidationInput } from "@findoc/validation";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";

export class OfflineFixtureUnavailableError extends Error {}

export interface OfflineFixtureContext {
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly referenceDate: string;
}

export function runOfflineFixture(fixtureId: unknown, context: OfflineFixtureContext): OfflineCaseResult {
  if (fixtureId !== ANNA_EXAMPLE_FIXTURE_ID) {
    throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  }
  const input = annaExampleInput(context);
  const findings = evaluateRuleSet(input);
  const recommendedDisposition = mapDisposition(input, findings);
  const issues = findings.filter((item) => item.status !== "passed" && item.status !== "not_applicable").map(issueFromFinding);
  return {
    resultRevisionId: context.resultRevisionId,
    summary: `The synthetic document package was processed. ${issues.length} items require human review.`,
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

function issueFromFinding(finding: ValidationFinding) {
  const displays: Record<string, { description: string; recommendedAction: string }> = {
    employer_conflict: {
      description: "The declared employer differs from the qualified salary payment counterparty.",
      recommendedAction: "Confirm the current employer and provide corrected supporting documents if needed.",
    },
    income_input_incomparable: {
      description: "The monthly income value does not have sufficient evidence for comparison.",
      recommendedAction: "Provide a legible payslip that shows the monthly net income.",
    },
    required_document_uncertain: {
      description: "The bank statement boundary is uncertain, so document completeness cannot be confirmed.",
      recommendedAction: "Resubmit the bank statement as one complete file if the displayed page boundary is incorrect.",
    },
  };
  const display = displays[finding.reasonCode];
  if (!display) throw new Error(`No reviewer display registered for ${finding.reasonCode}`);
  return { code: finding.ruleId, ...display };
}
