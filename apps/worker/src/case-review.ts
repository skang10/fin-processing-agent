import { randomUUID } from "node:crypto";
import {
  evaluateCaseReviewEligibility,
  type AgentLedCaseReviewContext, type AgentLedCaseReviewHarness, type CaseReviewContext,
  type RecoveryPageView, type SubmittedExtractionCandidate,
} from "@findoc/agent";
import { CASE_REVIEW_TOOL_NAMES } from "@findoc/agent-pi";
import type { PiVlmExtractor } from "@findoc/agent-pi";
import { AgentSessionIncompatibleError } from "@findoc/core";
import {
  CaseAssemblyInputError, assembleCaseResult, buildExtractionPlan, findFixtureScannedPageAdapter, runOfflineReport,
  type CaseAssemblyContext,
} from "@findoc/offline";
import type { PostgresWorkflowCoordinator } from "@findoc/persistence";
import { createRuntimeDocumentPorts } from "./document-ports.js";

export type CaseReviewStageOutcome = "completed" | "processing_exception";

/** Reference date of the demonstration corpus; a production deployment would use the review date. */
const REVIEW_REFERENCE_DATE = "2026-09-05";

export interface CaseReviewStageLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface CaseReviewStageDependencies {
  readonly coordinator: PostgresWorkflowCoordinator;
  readonly selectHarness: (fixtureId: unknown) => AgentLedCaseReviewHarness;
  readonly logger: CaseReviewStageLogger;
  /** Reads one committed derived artifact; the Agent only ever sees it through a registered tool. */
  readonly readArtifact: (objectKey: string, maximumBytes: number) => Promise<Buffer>;
  readonly vlmExtractor?: PiVlmExtractor;
  /**
   * Test-only durable-boundary hook used by the Worker-termination acceptance suite. The delivered
   * Worker never supplies it, so a fault cannot be activated by configuration or document content.
   */
  readonly afterReportCommitted?: () => Promise<void>;
}

/**
 * Bounded Agent-led case-review stage for one processing run.
 *
 * The system inspects, renders, and selectively OCRs the documents before this stage, but it has no
 * deterministic field parser. Every document value therefore comes from the Agent through a
 * registered, scoped tool, and deterministic code still owns normalization, reconciliation, claims,
 * the registered rule set, the disposition, report verification, and workflow state. Every durable
 * decision reads committed PostgreSQL state, so a redelivered job resumes instead of restarting
 * (AGT-REQ-076).
 */
export async function processAgentLedCaseReview(
  dependencies: CaseReviewStageDependencies,
  job: { readonly case_id: string; readonly run_id: string },
): Promise<CaseReviewStageOutcome> {
  const { coordinator, selectHarness, logger } = dependencies;
  const applicationData = await coordinator.loadApplicationData(job.case_id, job.run_id);
  const fixtureId = applicationData["demo_fixture_id"];
  try {
    const inventory = await coordinator.loadCaseDocumentInventory(job.case_id, job.run_id);
    const assemblyContext: CaseAssemblyContext = {
      inputSnapshotId: inventory.inputRevisionId,
      resultRevisionId: job.run_id,
      referenceDate: REVIEW_REFERENCE_DATE,
      applicationSnapshotId: inventory.applicationSnapshotId,
      applicationData,
      documentProcessorVersion: inventory.documentProcessorVersion,
      pages: inventory.pages.map((page) => ({
        documentVersionId: page.documentVersionId, pageNumber: page.pageNumber, needsOcr: page.needsOcr,
        nativeCharacterCount: page.nativeCharacterCount, ocrAvailable: Boolean(page.ocr), renderAvailable: Boolean(page.render),
      })),
      logicalDocuments: inventory.logicalDocuments,
    };
    const plan = buildExtractionPlan(assemblyContext);
    const reviewContext: AgentLedCaseReviewContext = {
      runId: job.run_id, caseId: job.case_id,
      gaps: plan.gaps,
      pages: authorizedPages(assemblyContext),
      fieldSchemas: [...new Map(plan.gaps.map((gap) => [gap.fieldSchemaId, { fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType }])).values()],
      documents: plan.documents,
      applicationData,
      vlmConfigurationIdentity: dependencies.vlmExtractor?.configurationIdentity ?? `fixture-or-unconfigured:${fixtureId ?? "none"}`,
    };
    const eligibility = evaluateCaseReviewEligibility({
      gaps: plan.gaps, pages: reviewContext.pages, registeredToolNames: CASE_REVIEW_TOOL_NAMES,
      budgetAvailable: true, fatalFailure: false,
    }, randomUUID());
    if (eligibility.decision !== "eligible") throw new Error(`Case Review Agent is ineligible: ${eligibility.reasonCodes.join(",")}`);
    const fixtureScannedPages = findFixtureScannedPageAdapter(fixtureId, applicationData);
    const documentPorts = createRuntimeDocumentPorts({
      inventory, readArtifact: dependencies.readArtifact,
      ...(dependencies.vlmExtractor ? { vlmExtractor: (request) => dependencies.vlmExtractor!.extract(request) } : {}),
      ...(!dependencies.vlmExtractor && fixtureScannedPages ? { fixtureScannedPages } : {}),
    });
    let outcomeCandidates: readonly SubmittedExtractionCandidate[] = [];
    let outcome: Awaited<ReturnType<AgentLedCaseReviewHarness["review"]>>;
    try {
      outcome = await selectHarness(fixtureId).review(reviewContext, {
        ...documentPorts,
        requestReconciliation: async (candidates) => {
          outcomeCandidates = candidates;
          return { reference: `${job.run_id}:reconciliation:${candidates.length}` };
        },
        requestValidation: async (): Promise<CaseReviewContext> => {
          const deterministic = assembleCaseResult(assemblyContext, plan, outcomeCandidates, eligibility);
          await coordinator.persistOfflineDeterministic(job.case_id, job.run_id, deterministic);
          const committed = await coordinator.loadOfflineReportInput(job.case_id, job.run_id);
          return {
            resultRevisionId: committed.resultRevisionId,
            findings: committed.findings.map((finding) => ({ ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, status: finding.status, reasonCode: finding.reasonCode, references: finding.materialInputRefs })),
            recommendedDisposition: committed.recommendedDisposition,
            allowedReferences: new Set(committed.findings
              .filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable")
              .map((finding) => `finding:${finding.ruleId}`)),
          };
        },
      });
    } catch (error) {
      if (!(error instanceof AgentSessionIncompatibleError)) throw error;
      logger.warn({ case_id: job.case_id, run_id: job.run_id, reason_codes: error.reasonCodes }, "agent session is incompatible with the persisted attempt");
      await coordinator.failRun(job.case_id, job.run_id, "agent_session_incompatible");
      return "processing_exception";
    }
    // Durable state, not the in-process session, decides whether a reviewable result exists (AGT-REQ-152).
    const persistedResult = await coordinator.findOfflineReportInput(job.case_id, job.run_id);
    if (!persistedResult) {
      logger.warn({ case_id: job.case_id, run_id: job.run_id, terminal_reason: outcome.trace.terminalReason }, "agent session ended before a reviewable deterministic result");
      await coordinator.failRun(job.case_id, job.run_id, `agent_session_${outcome.trace.terminalReason}`);
      return "processing_exception";
    }
    const report = await runOfflineReport(persistedResult, {
      descriptor: selectHarness(fixtureId).descriptor,
      generate: async () => ({ ...(outcome.submission !== undefined ? { submission: outcome.submission } : {}), trace: outcome.trace }),
    }, fixtureId);
    await coordinator.completeOfflineReport(job.case_id, job.run_id, persistedResult.resultRevisionId, report);
    await dependencies.afterReportCommitted?.();
    logger.info({
      case_id: job.case_id, run_id: job.run_id, session_id: report.session?.sessionId,
      harness_id: report.session?.harnessId, model_label: report.modelLabel, terminal_reason: report.session?.terminalReason,
      iterations: report.session?.iterations, tool_calls: report.session?.toolCalls, report_availability: report.reportAvailability,
      report_failure_reason: report.reportFailureReason,
      extraction_requirements: plan.gaps.length, submitted_candidates: outcomeCandidates.length,
      attempt_number: outcome.attemptNumber, resumed: outcome.resumed,
    }, "agent-led case review session completed");
    return "completed";
  } catch (error) {
    if (!(error instanceof CaseAssemblyInputError)) throw error;
    await coordinator.failRun(job.case_id, job.run_id, "case_assembly_input_invalid");
    logger.warn({ case_id: job.case_id, run_id: job.run_id, reason: error.message }, "case routed to processing exception");
    return "processing_exception";
  }
}

/** Only pages that belong to a grouped logical document of this run may be touched by a tool. */
function authorizedPages(context: CaseAssemblyContext): readonly RecoveryPageView[] {
  return context.pages.flatMap((page) => {
    const logical = context.logicalDocuments.find((item) => item.documentVersionId === page.documentVersionId
      && item.startPage <= page.pageNumber && item.endPage >= page.pageNumber);
    if (!logical) return [];
    return [{
      documentVersionId: page.documentVersionId, logicalDocumentRevisionId: logical.logicalDocumentRevisionId,
      pageNumber: page.pageNumber, needsOcr: page.needsOcr, ocrAvailable: page.ocrAvailable,
      nativeCharacterCount: page.nativeCharacterCount, renderAvailable: page.renderAvailable,
    }];
  });
}
