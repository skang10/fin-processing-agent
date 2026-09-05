import type { OfflineCaseResult } from "@findoc/core";

export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";

export class OfflineFixtureUnavailableError extends Error {}

export function runOfflineFixture(fixtureId: unknown): OfflineCaseResult {
  if (fixtureId !== ANNA_EXAMPLE_FIXTURE_ID) {
    throw new OfflineFixtureUnavailableError("No registered offline fixture was selected");
  }
  return {
    summary: "The synthetic document package was processed. Three items require human review.",
    modelLabel: "fake-pi-harness-v1",
    estimatedCost: "0.0000",
    issues: [
      {
        code: "VAL_EMPLOYER_CONSISTENCY_001",
        description: "The declared employer differs from the salary payment counterparty.",
        recommendedAction: "Ask the applicant to confirm the current employer and provide corrected supporting documents if needed.",
      },
      {
        code: "VAL_INCOME_CONSISTENCY_001",
        description: "The recovered monthly income requires visual confirmation.",
        recommendedAction: "Ask the applicant for a legible payslip if the amount cannot be confirmed.",
      },
      {
        code: "VAL_DOC_COMPLETENESS_001",
        description: "The logical boundary between pages 3 and 4 requires confirmation.",
        recommendedAction: "Ask the applicant to resubmit the affected document as a complete file if the boundary is incorrect.",
      },
    ],
  };
}
