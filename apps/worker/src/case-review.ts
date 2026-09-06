import { randomUUID } from "node:crypto";
import { evaluateCaseReviewEligibility, type AgentLedCaseReviewHarness, type CaseReviewContext, type SubmittedExtractionCandidate } from "@findoc/agent";
import { CASE_REVIEW_TOOL_NAMES } from "@findoc/agent-pi";
import { AgentSessionIncompatibleError } from "@findoc/core";
import { buildAgentReviewContext, buildOfflineExtraction, buildOfflineFixture, createOfflineRecoveryPorts, OfflineFixtureUnavailableError, runOfflineReport } from "@findoc/offline";
import type { PostgresWorkflowCoordinator } from "@findoc/persistence";

export type CaseReviewStageOutcome = "completed" | "processing_exception";

export interface CaseReviewStageLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface CaseReviewStageDependencies {
  readonly coordinator: PostgresWorkflowCoordinator;
  readonly selectHarness: (fixtureId: unknown) => AgentLedCaseReviewHarness;
  readonly logger: CaseReviewStageLogger;
  /**
   * Test-only durable-boundary hook used by the Worker-termination acceptance suite. The delivered
   * Worker never supplies it, so a fault cannot be activated by configuration or document content.
   */
  readonly afterReportCommitted?: () => Promise<void>;
}

/**
 * Bounded Agent-led case-review stage for one processing run. Every durable decision reads
 * committed PostgreSQL state, so a redelivered job resumes instead of restarting (AGT-REQ-076).
 */
export async function processAgentLedCaseReview(
  dependencies: CaseReviewStageDependencies,
  job: { readonly case_id: string; readonly run_id: string },
): Promise<CaseReviewStageOutcome> {
  const { coordinator, selectHarness, logger } = dependencies;
  const applicationData = await coordinator.loadApplicationData(job.case_id, job.run_id);
  const fixtureId = applicationData["demo_fixture_id"];
  try {
    const sourceContext = await coordinator.loadOfflineSourceContext(job.case_id, job.run_id);
    const fixtureContext = {
      inputSnapshotId: sourceContext.inputRevisionId,
      resultRevisionId: job.run_id,
      referenceDate: "2026-09-05",
      applicationSnapshotId: sourceContext.applicationSnapshotId,
      applicationData,
      pages: sourceContext.pages,
      logicalDocuments: sourceContext.logicalDocuments,
    };
    const extraction = buildOfflineExtraction(fixtureId, fixtureContext);
    const reviewContext = buildAgentReviewContext(job.run_id, extraction, fixtureContext);
    const eligibility = evaluateCaseReviewEligibility({
      gaps: extraction.gaps, pages: reviewContext.pages, registeredToolNames: CASE_REVIEW_TOOL_NAMES,
      budgetAvailable: true, fatalFailure: false,
    }, randomUUID());
    if (eligibility.decision !== "eligible") throw new Error(`Case Review Agent is ineligible: ${eligibility.reasonCodes.join(",")}`);
    const documentPorts = createOfflineRecoveryPorts(fixtureId, fixtureContext);
    let outcomeCandidates: readonly SubmittedExtractionCandidate[] = [];
    let outcome: Awaited<ReturnType<AgentLedCaseReviewHarness["review"]>>;
    try {
      outcome = await selectHarness(fixtureId).review({ ...reviewContext, caseId: job.case_id }, {
        ...documentPorts,
        requestReconciliation: async (candidates) => {
          outcomeCandidates = candidates;
          return { reference: `${job.run_id}:reconciliation:${candidates.length}` };
        },
        requestValidation: async (): Promise<CaseReviewContext> => {
          const deterministic = buildOfflineFixture(fixtureId, fixtureContext, { candidates: outcomeCandidates, eligibility });
          await coordinator.persistOfflineDeterministic(job.case_id, job.run_id, deterministic);
          const committed = await coordinator.loadOfflineReportInput(job.case_id, job.run_id);
          return {
            resultRevisionId: committed.resultRevisionId,
            findings: committed.findings.map((finding) => ({ ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, status: finding.status, reasonCode: finding.reasonCode, references: finding.materialInputRefs })),
            recommendedDisposition: committed.recommendedDisposition,
            allowedReferences: new Set(committed.findings.map((finding) => `finding:${finding.ruleId}`)),
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
      attempt_number: outcome.attemptNumber, resumed: outcome.resumed,
    }, "agent-led case review session completed");
    return "completed";
  } catch (error) {
    if (!(error instanceof OfflineFixtureUnavailableError)) throw error;
    await coordinator.failRun(job.case_id, job.run_id, "offline_fixture_unavailable");
    logger.warn({ case_id: job.case_id, run_id: job.run_id }, "case routed to processing exception");
    return "processing_exception";
  }
}
