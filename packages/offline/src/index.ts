import type { OfflineCaseResult } from "@findoc/core";

export function runOfflineFixture(applicantDisplayName: string): OfflineCaseResult {
  if (applicantDisplayName === "Anna Beispiel") {
    return {
      summary: "The synthetic document package was processed. Three items require human review.",
      modelLabel: "fake-pi-agent-v1",
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

  return {
    summary: "The synthetic document package was processed with no review issue in the offline fixture.",
    modelLabel: "fake-pi-agent-v1",
    estimatedCost: "0.0000",
    issues: [],
  };
}
