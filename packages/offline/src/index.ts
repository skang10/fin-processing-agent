import type { OfflineReportInput, OfflineReportResult } from "@findoc/core";
import {
  FAKE_HARNESS_DESCRIPTOR, FakeCaseReviewAgentHarness, attentionItemsForFindings, buildSyntheticSessionTrace, hashArguments,
  runVerifiedReport, type CaseReviewAgentHarness,
} from "@findoc/agent";

export * from "./case-assembly.js";

/** The bundled demo case reuses the golden-003 application data under its own fixture identifier. */
export const ANNA_EXAMPLE_FIXTURE_ID = "anna-example-v1";

// ---------------------------------------------------------------------------
// Explicit synthetic-fixture adapter for pages the runtime genuinely cannot read
// ---------------------------------------------------------------------------

/**
 * Declared content of the synthetic scanned pages of the demonstration corpus.
 *
 * The delivered OCR adapter is a deterministic fixture, so an image-only page carries no recoverable
 * text at runtime and no VLM gateway is wired yet. This adapter stands in for both, and only for a
 * page that has no committed native text. Everything it returns is fixture data that demonstrates
 * orchestration; it is not OCR or VLM recognition and must never be reported as recognition quality.
 * Native-text pages never touch it. See LIMITATIONS.md.
 */
export const FIXTURE_SCANNED_PAGE_ADAPTER_VERSION = "fixture-scanned-page-adapter-1.0.0";

export type FixturePageType = "identity_document" | "payslip" | "bank_statement";

interface FixtureCase {
  readonly identityPage: number;
  readonly payslipPage: number;
  readonly bankPage?: number;
  readonly payslipEmployer: string;
  readonly counterparty?: string;
  readonly payslipIncome: string;
  readonly identityExpiry: string;
}

/** Values match `scripts/generate-golden-documents.py`; they describe what the page image shows. */
const FIXTURE_CASES: Readonly<Record<string, FixtureCase>> = Object.freeze({
  "golden-001-native-clear": { identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Mustertechnik GmbH", counterparty: "Mustertechnik GmbH", payslipIncome: "3200.00", identityExpiry: "31 August 2030" },
  "golden-002-employer-conflict": { identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Nordwerk Demo GmbH", counterparty: "Suedwerk Demo KG", payslipIncome: "2900.00", identityExpiry: "31 August 2030" },
  "golden-003-multiple-review-issues": { identityPage: 1, payslipPage: 2, bankPage: 4, payslipEmployer: "Beispieltechnik GmbH", counterparty: "Beispiel Tech Services", payslipIncome: "3480.00", identityExpiry: "31 August 2030" },
  "golden-004-missing-bank-evidence": { identityPage: 1, payslipPage: 2, payslipEmployer: "Sample Works Ltd", payslipIncome: "3100.00", identityExpiry: "31 August 2030" },
  "golden-005-instruction-inert": { identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Testbetrieb GmbH", counterparty: "Testbetrieb GmbH", payslipIncome: "2750.00", identityExpiry: "31 August 2030" },
  "golden-006-scanned-adaptive-unavailable": { identityPage: 1, payslipPage: 2, bankPage: 3, payslipEmployer: "Demowerk GmbH", counterparty: "Demowerk GmbH", payslipIncome: "2980.00", identityExpiry: "31 August 2030" },
});

export interface FixtureScannedPageAdapter {
  readonly fixtureId: string;
  readonly adapterVersion: string;
  /** Declared page type of one synthetic page; used only when a page has no committed native text. */
  pageType(pageNumber: number): FixturePageType | undefined;
  /** Declared value of one field on one synthetic page; fixture data, never recognition output. */
  value(pageNumber: number, fieldSchemaId: string): string | undefined;
}

/** Resolve the adapter for a registered synthetic fixture, or undefined for any other case. */
export function findFixtureScannedPageAdapter(
  fixtureId: unknown,
  applicationData: Readonly<Record<string, unknown>>,
): FixtureScannedPageAdapter | undefined {
  const id = fixtureId === ANNA_EXAMPLE_FIXTURE_ID ? "golden-003-multiple-review-issues" : fixtureId;
  if (typeof id !== "string") return undefined;
  const fixture = FIXTURE_CASES[id];
  if (!fixture) return undefined;
  const applicant = typeof applicationData["applicant_display_name"] === "string" ? applicationData["applicant_display_name"] : undefined;
  const pageType = (pageNumber: number): FixturePageType | undefined =>
    pageNumber === fixture.identityPage ? "identity_document"
      : pageNumber === fixture.payslipPage ? "payslip"
        : pageNumber === fixture.bankPage ? "bank_statement" : undefined;
  return {
    fixtureId: id, adapterVersion: FIXTURE_SCANNED_PAGE_ADAPTER_VERSION, pageType,
    value: (pageNumber, fieldSchemaId) => {
      const type = pageType(pageNumber);
      if (!type) return undefined;
      if (fieldSchemaId === "person.name") return applicant;
      if (type === "identity_document" && fieldSchemaId === "identity.expiry_date") return fixture.identityExpiry;
      if (type === "payslip" && fieldSchemaId === "organization.name") return fixture.payslipEmployer;
      if (type === "payslip" && fieldSchemaId === "income.monthly_net") return fixture.payslipIncome;
      if (type === "bank_statement" && fieldSchemaId === "organization.name") return fixture.counterparty;
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic report verification
// ---------------------------------------------------------------------------

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
    issues: report.verified
      ? report.brief.attention_items.map((item) => ({ ...issueFromAttentionItem(item), origin: "agent" as const }))
      : attentionItemsForFindings(result.findings).map((item) => ({ ...issueFromAttentionItem(item), origin: "system" as const })),
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

function issueFromAttentionItem(item: { description: string; suggested_action: string; references: readonly string[] }) {
  const reference = item.references.find((value) => value.startsWith("finding:"));
  if (!reference) throw new Error("Agent attention item has no finding reference");
  const actions: Record<string, string> = {
    compare_claims: "Confirm the current employer and provide corrected supporting documents if needed.",
    verify_extracted_value: "Provide a legible payslip that shows the monthly net income.",
    review_document_boundary: "Resubmit the bank statement as one complete file if the displayed page boundary is incorrect.",
    review_missing_document: "Provide the missing bank statement.",
    inspect_evidence: "Check the highlighted document evidence and provide a clearer document if the value is wrong.",
  };
  const recommendedAction = actions[item.suggested_action];
  if (!recommendedAction) throw new Error(`No applicant-readable action registered for ${item.suggested_action}`);
  return { code: reference.slice("finding:".length), description: item.description, recommendedAction };
}
