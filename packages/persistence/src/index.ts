import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CaseNotFoundError, HandoffUnavailableError, IdempotencyConflictError, ReviewConflictError, AgentAttemptSupersededError, AgentInvocationConflictError, AgentSessionIncompatibleError, AgentSessionTerminalError, AgentStepConflictError, EMPTY_AGENT_CONSUMED_BUDGET,
  addConsumedBudget, evaluateAgentSessionCompatibility,
  type AcceptedCase, type AgentAttemptStartReason, type AgentCommittedToolResult, type AgentConsumedBudget, type AgentReviewCommandService,
  type AgentLogSessionView, type AgentLogView, type AgentProducedReference, type AgentRecoverySnapshot,
  type AgentSessionConfiguration, type AgentSessionLifecyclePort, type AgentSessionMode, type AgentSessionStart,
  type AgentSessionTerminalResult, type AgentSessionTrace, type AgentStepOutcome, type AgentStepPhase,
  type AgentStepTrace, type AgentTerminalReason, type BeginAgentSessionInput, type CommitAgentStepInput,
  type CommitAgentStepResult, type TerminalizeAgentSessionInput, type AgentReportView, type ApplicationDataView, type CaseCommandService, type CaseIntakeCommand, type CaseQueryService, type CaseReviewQueryService, type CaseStatus, type DocumentPageView, type DocumentView, type DownstreamHandoffView, type EvidenceView, type FindingView, type NativeTextArtifactView, type OfflineDeterministicResult, type OfflineReportInput, type OfflineReportResult, type PageRenderArtifactView, type QueueCaseView, type ReviewCommandService, type ReviewIssueView, type SourceDocumentArtifactView, type StoredDerivedArtifact, type StoredOcrArtifact, type StoredPageRenderArtifact } from "@findoc/core";
import { agentEligibilityDecisions, agentReports, agentSessionAttempts, agentSessions, agentSteps, agentToolInvocations, applicationSnapshots, extractionGaps, gapResolutions, artifacts, boundaryPredictions, candidateEvidenceLinks, cases, caseStateTransitions, claimCandidateLinks, claimEvidenceLinks, claimRecords, documentInspections, documentVersions, evidenceRecords, extractionCandidates, finalReviews, idempotencyRecords, inputDocumentSelections, inputRevisions, logicalDocumentPages, logicalDocumentRevisions, outboxEvents, pageClassifications, pageOcrOutputs, pages, physicalDocuments, processingRuns, processingRunTransitions, reconciliationCandidateLinks, reconciliationDecisions, recommendedDispositions, requestedChangeRevisions, resultRevisions, reviewIssueActions, reviewIssueEditRevisions, reviewIssues, stageExecutions, validationFindings } from "./schema.js";

const COMMAND_TYPE = "create_case";
const WORKFLOW_VERSION = "case-processing-v1";

function caseCode(createdAt: Date, displayNumber: number): string {
  return `FD-${createdAt.getUTCFullYear()}-${String(displayNumber).padStart(4, "0")}`;
}

function asFinalAction(value: string): "request_changes" | "escalate_review" | "clear_for_downstream" {
  if (value === "request_changes" || value === "escalate_review" || value === "clear_for_downstream") return value;
  throw new Error("Persisted final-review action is invalid");
}

function reviewIssueContent(command: { title: string; description: string; recommendedAction: string; supportingReferences: readonly string[]; noReferenceReason?: string }) {
  const title = command.title.trim();
  const description = command.description.trim();
  const recommendedAction = command.recommendedAction.trim();
  const supportingReferences = [...new Set(command.supportingReferences.map((value) => value.trim()).filter(Boolean))];
  const noReferenceReason = command.noReferenceReason?.trim();
  if (!title || !description || !recommendedAction || (supportingReferences.length === 0 && !noReferenceReason)) {
    throw new ReviewConflictError("invalid_review_action", "An issue requires text and supporting evidence or a no-reference reason");
  }
  if (/\b(approve|reject|decline)\b.{0,24}\b(loan|application)\b/i.test(recommendedAction)) {
    throw new ReviewConflictError("invalid_review_action", "The recommended action contains a prohibited decision");
  }
  return { title, description, recommendedAction, supportingReferences, noReferenceReason: noReferenceReason || null };
}

async function assertSupportingReferences(db: Pick<ReturnType<typeof drizzle>, "select">, caseId: string, references: readonly string[]) {
  for (const reference of references) {
    const evidenceId = reference.split("/").filter(Boolean).at(-1);
    if (!evidenceId) throw new ReviewConflictError("invalid_review_action", "A supporting reference is invalid");
    const [evidence] = await db.select({ id: evidenceRecords.id }).from(evidenceRecords)
      .innerJoin(processingRuns, eq(evidenceRecords.runId, processingRuns.id))
      .where(and(eq(evidenceRecords.id, evidenceId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!evidence) throw new ReviewConflictError("invalid_review_action", "A supporting reference does not belong to this case");
  }
}

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return { client, db: drizzle(client) };
}

export class PostgresCaseCommandService implements CaseCommandService, ReviewCommandService, AgentReviewCommandService {
  constructor(
    private readonly db: ReturnType<typeof drizzle>,
    private readonly actorId: string,
  ) {}

  async accept(command: CaseIntakeCommand): Promise<AcceptedCase> {
    const requestHash = hashIntake(command);
    return this.db.transaction(async (tx) => {
      const lockIdentity = `${this.actorId}:${COMMAND_TYPE}:${command.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`);

      const [existing] = await tx.select().from(idempotencyRecords).where(and(
        eq(idempotencyRecords.actorId, this.actorId),
        eq(idempotencyRecords.commandType, COMMAND_TYPE),
        eq(idempotencyRecords.key, command.idempotencyKey),
      )).limit(1);

      if (existing) {
        if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
        return { ...(existing.result as Omit<AcceptedCase, "replayed">), replayed: true };
      }

      const accepted = { caseId: randomUUID(), runId: randomUUID(), replayed: false };
      const applicationData = command.applicationData;
      const applicationSnapshotId = randomUUID();
      const inputRevisionId = randomUUID();
      await tx.insert(cases).values({
        id: accepted.caseId,
        applicantDisplayName: command.applicantDisplayName,
        lifecycle: "processing",
      });
      await tx.insert(applicationSnapshots).values({
        id: applicationSnapshotId, caseId: accepted.caseId,
        schemaId: "synthetic-personal-loan-application",
        schemaVersion: "1.0.0",
        contentHash: hashCanonical(applicationData),
        content: applicationData,
      });
      await tx.insert(inputRevisions).values({
        id: inputRevisionId, caseId: accepted.caseId,
        applicationSnapshotId, revision: 1,
      });
      await tx.insert(processingRuns).values({
        id: accepted.runId,
        caseId: accepted.caseId,
        inputRevisionId,
        workflowVersion: command.startAgentReview === false ? "manual-review-preparation-v1" : WORKFLOW_VERSION,
        agentModel: command.agentModel,
        status: "created",
      });
      await tx.insert(processingRunTransitions).values({
        id: randomUUID(), runId: accepted.runId, priorStatus: null,
        newStatus: "created", reason: "case_accepted",
      });
      await tx.update(cases).set({ currentRunId: accepted.runId }).where(eq(cases.id, accepted.caseId));
      for (const document of command.documents ?? []) {
        const artifactId = randomUUID();
        const physicalDocumentId = randomUUID();
        await tx.insert(artifacts).values({
          id: artifactId,
          caseId: accepted.caseId,
          objectKey: document.artifact.objectKey,
          sha256: document.artifact.sha256,
          byteSize: document.artifact.byteSize,
          detectedMediaType: document.artifact.detectedMediaType,
          artifactKind: "source",
        });
        await tx.insert(physicalDocuments).values({ id: physicalDocumentId, caseId: accepted.caseId });
        const documentVersionId = randomUUID();
        await tx.insert(documentVersions).values({
          id: documentVersionId, physicalDocumentId, sourceArtifactId: artifactId, version: 1,
          submittedFilename: document.submittedFilename,
          detectedMediaType: document.artifact.detectedMediaType,
          integrityState: "verified",
          readabilityState: "not_inspected",
          malwareScanState: "not_scanned",
        });
        await tx.insert(inputDocumentSelections).values({
          id: randomUUID(), inputRevisionId, physicalDocumentId, documentVersionId,
        });
      }
      await tx.insert(caseStateTransitions).values({
        id: randomUUID(), caseId: accepted.caseId, runId: accepted.runId,
        priorState: null, newState: "processing", reason: "case_accepted", actor: this.actorId,
      });
      await tx.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: "case_processing_requested",
        aggregateId: accepted.caseId,
        payload: { case_id: accepted.caseId, run_id: accepted.runId },
      });
      await tx.insert(idempotencyRecords).values({
        id: randomUUID(),
        actorId: this.actorId,
        commandType: COMMAND_TYPE,
        key: command.idempotencyKey,
        requestHash,
        responseStatus: 202,
        result: accepted,
      });
      return accepted;
    });
  }

  async startAgentReview(caseId: string, agentModel: string): Promise<{ caseId: string; runId: string; started: boolean }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${caseId}, 0))`);
      const [record] = await tx.select({ lifecycle: cases.lifecycle, runId: cases.currentRunId })
        .from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!record?.runId) throw new CaseNotFoundError();
      const [prior] = await tx.select({ inputRevisionId: processingRuns.inputRevisionId, workflowVersion: processingRuns.workflowVersion })
        .from(processingRuns).where(eq(processingRuns.id, record.runId)).limit(1);
      const [issue] = await tx.select({ id: reviewIssues.id }).from(reviewIssues).where(eq(reviewIssues.caseId, caseId)).limit(1);
      const [finalReview] = await tx.select({ id: finalReviews.id }).from(finalReviews).where(eq(finalReviews.caseId, caseId)).limit(1);
      if (record.lifecycle !== "ready_for_review" || prior?.workflowVersion !== "manual-review-preparation-v1" || issue || finalReview) {
        return { caseId, runId: record.runId, started: false };
      }
      const runId = randomUUID();
      await tx.insert(processingRuns).values({ id: runId, caseId, inputRevisionId: prior.inputRevisionId,
        workflowVersion: WORKFLOW_VERSION, agentModel, status: "created" });
      await tx.insert(processingRunTransitions).values({ id: randomUUID(), runId, priorStatus: null,
        newStatus: "created", reason: "reviewer_started_agent" });
      await tx.update(cases).set({ currentRunId: runId, lifecycle: "processing", version: sql`${cases.version} + 1` }).where(eq(cases.id, caseId));
      await tx.insert(caseStateTransitions).values({ id: randomUUID(), caseId, runId, priorState: "ready_for_review",
        newState: "processing", reason: "reviewer_started_agent", actor: this.actorId });
      await tx.insert(outboxEvents).values({ id: randomUUID(), eventType: "case_processing_requested",
        aggregateId: caseId, payload: { case_id: caseId, run_id: runId } });
      return { caseId, runId, started: true };
    });
  }

  async stopAgentReview(caseId: string): Promise<{ caseId: string; runId: string; stopped: boolean }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${caseId}, 0))`);
      const [record] = await tx.select({ lifecycle: cases.lifecycle, runId: cases.currentRunId })
        .from(cases).where(eq(cases.id, caseId)).limit(1);
      if (!record?.runId) throw new CaseNotFoundError();
      if (record.lifecycle !== "processing") return { caseId, runId: record.runId, stopped: false };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${record.runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status }).from(processingRuns)
        .where(and(eq(processingRuns.id, record.runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run || (run.status !== "created" && run.status !== "running")) return { caseId, runId: record.runId, stopped: false };

      const [session] = await tx.select({ id: agentSessions.id })
        .from(agentSessions).where(eq(agentSessions.runId, record.runId)).limit(1);
      const completedAt = new Date();
      if (session) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${session.id}, 2))`);
        const [lockedSession] = await tx.select({ terminalReason: agentSessions.terminalReason })
          .from(agentSessions).where(eq(agentSessions.id, session.id)).limit(1);
        if (lockedSession?.terminalReason) return { caseId, runId: record.runId, stopped: false };
        await tx.update(agentSessionAttempts).set({
          status: "terminal", terminalReason: "cancelled_by_workflow", completedAt,
        }).where(and(eq(agentSessionAttempts.sessionId, session.id), eq(agentSessionAttempts.status, "running")));
        await tx.update(agentSessions).set({ terminalReason: "cancelled_by_workflow", completedAt })
          .where(and(eq(agentSessions.id, session.id), isNull(agentSessions.terminalReason)));
      }
      await tx.update(processingRuns).set({ status: "failed", completedAt }).where(eq(processingRuns.id, record.runId));
      await tx.insert(processingRunTransitions).values({
        id: randomUUID(), runId: record.runId, priorStatus: run.status, newStatus: "failed", reason: "reviewer_requested_agent_stop",
      });
      const [existingRevision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions)
        .where(eq(resultRevisions.runId, record.runId)).limit(1);
      const resultRevisionId = existingRevision?.id ?? randomUUID();
      if (!existingRevision) await tx.insert(resultRevisions).values({
        id: resultRevisionId, caseId, runId: record.runId, inputRevisionId: (await tx.select({ id: processingRuns.inputRevisionId })
          .from(processingRuns).where(eq(processingRuns.id, record.runId)).limit(1))[0]!.id,
        revision: 1, revisionType: "human_review", sealedAt: completedAt,
      });
      if (!existingRevision) await tx.insert(recommendedDispositions).values({
        id: randomUUID(), resultRevisionId, policyId: "manual-document-review-fallback", policyVersion: "1.0.0",
        disposition: "human_review_required", reasonCodes: ["agent_stopped_by_reviewer"],
      });
      const [existingReport] = await tx.select({ id: agentReports.id }).from(agentReports)
        .where(eq(agentReports.runId, record.runId)).limit(1);
      if (!existingReport) await tx.insert(agentReports).values({
        id: randomUUID(), caseId, runId: record.runId, resultRevisionId, sessionId: session?.id ?? null,
        availability: "unavailable", verificationStatus: null, verificationFailureReason: "reviewer_stopped_agent",
        summary: "Agent review was stopped. Human review can continue from the submitted application and documents.",
        issueLinks: [], checkedFacts: [], originalSubmission: null,
        modelLabel: (await tx.select({ model: processingRuns.agentModel }).from(processingRuns)
          .where(eq(processingRuns.id, record.runId)).limit(1))[0]!.model,
        estimatedCost: null,
      });
      await tx.update(cases).set({ lifecycle: "ready_for_review", version: sql`${cases.version} + 1` }).where(eq(cases.id, caseId));
      await tx.insert(caseStateTransitions).values({
        id: randomUUID(), caseId, runId: record.runId, priorState: "processing",
        newState: "ready_for_review", reason: "reviewer_requested_agent_stop", actor: this.actorId,
      });
      return { caseId, runId: record.runId, stopped: true };
    });
  }

  async restartAgentReview(caseId: string): Promise<{ caseId: string; runId: string; restarted: boolean }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${caseId}, 0))`);
      const [record] = await tx.select({ lifecycle: cases.lifecycle, runId: cases.currentRunId }).from(cases)
        .where(eq(cases.id, caseId)).limit(1);
      if (!record?.runId) throw new CaseNotFoundError();
      const [prior] = await tx.select({ inputRevisionId: processingRuns.inputRevisionId, workflowVersion: processingRuns.workflowVersion,
        agentModel: processingRuns.agentModel, status: processingRuns.status, terminalReason: agentSessions.terminalReason,
        stopReason: agentReports.verificationFailureReason })
        .from(processingRuns).leftJoin(agentSessions, eq(agentSessions.runId, processingRuns.id))
        .leftJoin(agentReports, eq(agentReports.runId, processingRuns.id))
        .where(eq(processingRuns.id, record.runId)).limit(1);
      const [issue] = await tx.select({ id: reviewIssues.id }).from(reviewIssues).where(eq(reviewIssues.caseId, caseId)).limit(1);
      const [finalReview] = await tx.select({ id: finalReviews.id }).from(finalReviews).where(eq(finalReviews.caseId, caseId)).limit(1);
      const restartableLifecycle = record.lifecycle === "ready_for_review" ||
        (record.lifecycle === "processing_exception" && prior?.terminalReason === "cancelled_by_workflow");
      if (!restartableLifecycle || prior?.status !== "failed" ||
        (prior.terminalReason !== "cancelled_by_workflow" && prior.stopReason !== "reviewer_stopped_agent") || issue || finalReview) {
        return { caseId, runId: record.runId, restarted: false };
      }
      const runId = randomUUID();
      await tx.insert(processingRuns).values({ id: runId, caseId, inputRevisionId: prior.inputRevisionId,
        workflowVersion: prior.workflowVersion, agentModel: prior.agentModel, status: "created" });
      await tx.insert(processingRunTransitions).values({ id: randomUUID(), runId, priorStatus: null,
        newStatus: "created", reason: "reviewer_restarted_agent" });
      await tx.update(cases).set({ currentRunId: runId, lifecycle: "processing", version: sql`${cases.version} + 1` }).where(eq(cases.id, caseId));
      await tx.insert(caseStateTransitions).values({ id: randomUUID(), caseId, runId, priorState: record.lifecycle,
        newState: "processing", reason: "reviewer_restarted_agent", actor: this.actorId });
      await tx.insert(outboxEvents).values({ id: randomUUID(), eventType: "case_processing_requested",
        aggregateId: caseId, payload: { case_id: caseId, run_id: runId } });
      return { caseId, runId, restarted: true };
    });
  }

  async createIssue(command: Parameters<ReviewCommandService["createIssue"]>[0]): ReturnType<ReviewCommandService["createIssue"]> {
    const content = reviewIssueContent(command);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.caseId}, 0))`);
      const [replayed] = await tx.select().from(reviewIssueEditRevisions).where(and(
        eq(reviewIssueEditRevisions.actorId, this.actorId), eq(reviewIssueEditRevisions.commandId, command.commandId),
      )).limit(1);
      if (replayed?.resultingCaseVersion) return { issueId: replayed.issueId, issueVersion: replayed.resultingIssueVersion, caseVersion: replayed.resultingCaseVersion };
      const [caseRecord] = await tx.select().from(cases).where(eq(cases.id, command.caseId)).limit(1);
      if (!caseRecord) throw new CaseNotFoundError();
      if (caseRecord.lifecycle !== "ready_for_review" || caseRecord.version !== command.expectedCaseVersion || !caseRecord.currentRunId) {
        throw new ReviewConflictError("stale_review", "The case changed after it was loaded");
      }
      const [revision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions).where(and(
        eq(resultRevisions.id, command.resultRevisionId), eq(resultRevisions.caseId, command.caseId), eq(resultRevisions.runId, caseRecord.currentRunId),
      )).limit(1);
      if (!revision) throw new ReviewConflictError("stale_review", "The reviewed result revision is stale");
      await assertSupportingReferences(tx, command.caseId, content.supportingReferences);
      const issueId = randomUUID();
      const nextCaseVersion = caseRecord.version + 1;
      await tx.insert(reviewIssues).values({
        id: issueId, caseId: command.caseId, runId: caseRecord.currentRunId, origin: "human",
        code: `HUMAN_REVIEW_${issueId}`, description: content.description,
        recommendedAction: content.recommendedAction, reviewState: "pending", version: 1,
      });
      await tx.insert(reviewIssueEditRevisions).values({
        id: randomUUID(), issueId, resultRevisionId: revision.id, revision: 1,
        ...content, actorId: this.actorId, commandId: command.commandId,
        resultingIssueVersion: 1, resultingCaseVersion: nextCaseVersion,
      });
      await tx.update(cases).set({ version: nextCaseVersion }).where(and(eq(cases.id, command.caseId), eq(cases.version, caseRecord.version)));
      return { issueId, issueVersion: 1, caseVersion: nextCaseVersion };
    });
  }

  async editIssue(command: Parameters<ReviewCommandService["editIssue"]>[0]): ReturnType<ReviewCommandService["editIssue"]> {
    const content = reviewIssueContent(command);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.issueId}, 0))`);
      const [replayed] = await tx.select().from(reviewIssueEditRevisions).where(and(
        eq(reviewIssueEditRevisions.actorId, this.actorId), eq(reviewIssueEditRevisions.commandId, command.commandId),
      )).limit(1);
      if (replayed) return { issueVersion: replayed.resultingIssueVersion };
      const [issue] = await tx.select({
        id: reviewIssues.id, version: reviewIssues.version, reviewState: reviewIssues.reviewState,
        runId: reviewIssues.runId, lifecycle: cases.lifecycle,
      }).from(reviewIssues).innerJoin(cases, eq(reviewIssues.caseId, cases.id)).where(and(
        eq(reviewIssues.id, command.issueId), eq(reviewIssues.caseId, command.caseId),
      )).limit(1);
      if (!issue) throw new CaseNotFoundError();
      if (issue.lifecycle !== "ready_for_review" || issue.version !== command.expectedIssueVersion || issue.reviewState !== "pending") {
        throw new ReviewConflictError("stale_review", "This issue has changed. Refresh to review the latest version.");
      }
      const [revision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions).where(and(
        eq(resultRevisions.id, command.resultRevisionId), eq(resultRevisions.caseId, command.caseId), eq(resultRevisions.runId, issue.runId),
      )).limit(1);
      if (!revision) throw new ReviewConflictError("stale_review", "The reviewed result revision is stale");
      await assertSupportingReferences(tx, command.caseId, content.supportingReferences);
      const [latest] = await tx.select({ revision: reviewIssueEditRevisions.revision }).from(reviewIssueEditRevisions)
        .where(eq(reviewIssueEditRevisions.issueId, issue.id)).orderBy(sql`${reviewIssueEditRevisions.revision} desc`).limit(1);
      const nextVersion = issue.version + 1;
      const updated = await tx.update(reviewIssues).set({ version: nextVersion }).where(and(
        eq(reviewIssues.id, issue.id), eq(reviewIssues.version, issue.version),
      )).returning({ id: reviewIssues.id });
      if (updated.length !== 1) throw new ReviewConflictError("stale_review", "This issue has changed. Refresh to review the latest version.");
      await tx.insert(reviewIssueEditRevisions).values({
        id: randomUUID(), issueId: issue.id, resultRevisionId: revision.id, revision: (latest?.revision ?? 0) + 1,
        ...content, actorId: this.actorId, commandId: command.commandId,
        resultingIssueVersion: nextVersion, resultingCaseVersion: null,
      });
      return { issueVersion: nextVersion };
    });
  }

  async resolveIssue(command: Parameters<ReviewCommandService["resolveIssue"]>[0]): ReturnType<ReviewCommandService["resolveIssue"]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.issueId}, 0))`);
      const [replayed] = await tx.select().from(reviewIssueActions).where(and(
        eq(reviewIssueActions.actorId, this.actorId), eq(reviewIssueActions.commandId, command.commandId),
      )).limit(1);
      if (replayed) return {
        issueVersion: replayed.resultingVersion,
        reviewState: replayed.action === "accept_signal" ? "confirmed" as const
          : replayed.action === "dismiss_signal" ? "ignored" as const : "pending" as const,
      };
      const [issue] = await tx.select({
        id: reviewIssues.id, version: reviewIssues.version, reviewState: reviewIssues.reviewState,
        runId: reviewIssues.runId, lifecycle: cases.lifecycle,
      }).from(reviewIssues).innerJoin(cases, eq(reviewIssues.caseId, cases.id)).where(and(
        eq(reviewIssues.id, command.issueId), eq(reviewIssues.caseId, command.caseId),
      )).limit(1);
      if (!issue) throw new CaseNotFoundError();
      const [revision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions).where(and(
        eq(resultRevisions.id, command.resultRevisionId), eq(resultRevisions.caseId, command.caseId), eq(resultRevisions.runId, issue.runId),
      )).limit(1);
      const reopening = command.action === "reopen_issue";
      const stateAllowsAction = reopening ? issue.reviewState !== "pending" : issue.reviewState === "pending";
      if (!revision || issue.lifecycle !== "ready_for_review" || issue.version !== command.expectedIssueVersion || !stateAllowsAction) {
        throw new ReviewConflictError("stale_review", "This issue has changed. Refresh to review the latest version.");
      }
      const reviewState = command.action === "accept_signal" ? "confirmed" as const
        : command.action === "dismiss_signal" ? "ignored" as const : "pending" as const;
      const nextVersion = issue.version + 1;
      const updated = await tx.update(reviewIssues).set({ reviewState, version: nextVersion }).where(and(
        eq(reviewIssues.id, issue.id), eq(reviewIssues.version, issue.version),
      )).returning({ id: reviewIssues.id });
      if (updated.length !== 1) throw new ReviewConflictError("stale_review", "This issue has changed. Refresh to review the latest version.");
      await tx.insert(reviewIssueActions).values({
        id: randomUUID(), issueId: issue.id, resultRevisionId: revision.id, action: command.action,
        reason: command.reason?.trim(), actorId: this.actorId, commandId: command.commandId, resultingVersion: nextVersion,
      });
      return { issueVersion: nextVersion, reviewState };
    });
  }

  async saveRequestedChange(command: Parameters<ReviewCommandService["saveRequestedChange"]>[0]): ReturnType<ReviewCommandService["saveRequestedChange"]> {
    const text = command.text.trim();
    if (!text || /\b(approve|reject|decline)\b.{0,24}\b(loan|application)\b/i.test(text)) {
      throw new ReviewConflictError("invalid_review_action", "Requested-change text is empty or contains a prohibited decision");
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.issueId}, 0))`);
      const [replayed] = await tx.select().from(requestedChangeRevisions).where(and(
        eq(requestedChangeRevisions.actorId, this.actorId), eq(requestedChangeRevisions.commandId, command.commandId),
      )).limit(1);
      if (replayed) return { draftRevisionId: replayed.id, revision: replayed.revision };
      const [issue] = await tx.select({
        id: reviewIssues.id, reviewState: reviewIssues.reviewState, runId: reviewIssues.runId,
        recommendedAction: reviewIssues.recommendedAction, lifecycle: cases.lifecycle,
      }).from(reviewIssues).innerJoin(cases, eq(reviewIssues.caseId, cases.id)).where(and(
        eq(reviewIssues.id, command.issueId), eq(reviewIssues.caseId, command.caseId),
      )).limit(1);
      if (!issue || issue.lifecycle !== "ready_for_review" || issue.reviewState !== "confirmed") throw new ReviewConflictError("stale_review", "The issue is not confirmed");
      const [resultRevision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions).where(and(
        eq(resultRevisions.id, command.resultRevisionId), eq(resultRevisions.caseId, command.caseId), eq(resultRevisions.runId, issue.runId),
      )).limit(1);
      if (!resultRevision) throw new ReviewConflictError("stale_review", "The reviewed result revision is stale");
      const [latest] = await tx.select({ revision: requestedChangeRevisions.revision }).from(requestedChangeRevisions)
        .where(eq(requestedChangeRevisions.issueId, issue.id)).orderBy(sql`${requestedChangeRevisions.revision} desc`).limit(1);
      const revision = (latest?.revision ?? 0) + 1;
      const id = randomUUID();
      await tx.insert(requestedChangeRevisions).values({
        id, issueId: issue.id, resultRevisionId: resultRevision.id, revision,
        agentProposedText: issue.recommendedAction || null, currentText: text, included: command.included,
        actorId: this.actorId, commandId: command.commandId,
      });
      return { draftRevisionId: id, revision };
    });
  }

  async submitFinalReview(command: Parameters<ReviewCommandService["submitFinalReview"]>[0]): ReturnType<ReviewCommandService["submitFinalReview"]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.caseId}, 0))`);
      const [replayed] = await tx.select().from(finalReviews).where(and(
        eq(finalReviews.actorId, this.actorId), eq(finalReviews.commandId, command.commandId),
      )).limit(1);
      if (replayed) return { finalReviewId: replayed.id, caseVersion: replayed.resultingCaseVersion, action: asFinalAction(replayed.action) };
      const [caseRecord] = await tx.select().from(cases).where(eq(cases.id, command.caseId)).limit(1);
      if (!caseRecord) throw new CaseNotFoundError();
      if (caseRecord.version !== command.expectedCaseVersion || caseRecord.lifecycle !== "ready_for_review") {
        throw new ReviewConflictError("stale_review", "The case changed after it was loaded");
      }
      const [revision] = await tx.select({ id: resultRevisions.id, runId: resultRevisions.runId }).from(resultRevisions).where(and(
        eq(resultRevisions.id, command.resultRevisionId), eq(resultRevisions.caseId, command.caseId),
      )).limit(1);
      if (!revision || revision.runId !== caseRecord.currentRunId) throw new ReviewConflictError("stale_review", "The reviewed result revision is stale");
      const unresolved = await tx.select({ id: reviewIssues.id }).from(reviewIssues).where(and(
        eq(reviewIssues.caseId, command.caseId), eq(reviewIssues.reviewState, "pending"),
      )).limit(1);
      if (unresolved.length > 0) throw new ReviewConflictError("review_incomplete", "Every issue must be reviewed before final submission");
      const selected = command.selectedDraftRevisionIds.length === 0 ? [] : await tx.select().from(requestedChangeRevisions)
        .where(inArray(requestedChangeRevisions.id, command.selectedDraftRevisionIds));
      const validSelected = selected.length === command.selectedDraftRevisionIds.length && selected.every((draft) =>
        draft.resultRevisionId === revision.id && draft.included && draft.currentText.trim().length > 0,
      );
      if (!validSelected || (command.action === "request_changes" && selected.length === 0) || (command.action === "clear_for_downstream" && selected.length > 0)) {
        throw new ReviewConflictError("invalid_review_action", "The selected requested-change drafts do not satisfy the final action");
      }
      const nextVersion = caseRecord.version + 1;
      const id = randomUUID();
      await tx.insert(finalReviews).values({
        id, caseId: command.caseId, resultRevisionId: revision.id, action: command.action,
        selectedDraftRevisionIds: command.selectedDraftRevisionIds, internalNote: command.internalNote?.trim() || null,
        actorId: this.actorId, commandId: command.commandId, resultingCaseVersion: nextVersion,
      });
      await tx.update(cases).set({ lifecycle: "review_complete", version: nextVersion }).where(eq(cases.id, command.caseId));
      await tx.insert(caseStateTransitions).values({
        id: randomUUID(), caseId: command.caseId, runId: caseRecord.currentRunId,
        priorState: "ready_for_review", newState: "review_complete", reason: command.action, actor: this.actorId,
      });
      return { finalReviewId: id, caseVersion: nextVersion, action: command.action };
    });
  }
}

export class PostgresCaseQueryService implements CaseQueryService, CaseReviewQueryService {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async list(view: "review" | "changes_requested" | "completed"): Promise<readonly QueueCaseView[]> {
    const records = await this.db.select({
      caseId: cases.id, displayNumber: cases.displayNumber, applicantDisplayName: cases.applicantDisplayName,
      lifecycle: cases.lifecycle, version: cases.version, createdAt: cases.createdAt,
    }).from(cases).orderBy(asc(cases.createdAt), asc(cases.id)).limit(100);
    const projected = await Promise.all(records.map(async (record): Promise<QueueCaseView | null> => {
      const [[report], issueRows, [finalReview], [session], [vlmInvocation]] = await Promise.all([
        this.db.select({ summary: agentReports.summary }).from(agentReports)
          .where(eq(agentReports.caseId, record.caseId)).orderBy(sql`${agentReports.createdAt} desc`).limit(1),
        this.db.select({ id: reviewIssues.id }).from(reviewIssues).where(eq(reviewIssues.caseId, record.caseId)),
        this.db.select({ action: finalReviews.action, createdAt: finalReviews.createdAt }).from(finalReviews)
          .where(eq(finalReviews.caseId, record.caseId)).limit(1),
        this.db.select({ modelLabel: agentSessions.modelLabel, modelRoute: agentSessions.modelRoute, vlmCalls: agentSessions.vlmCalls })
          .from(agentSessions).where(eq(agentSessions.caseId, record.caseId)).orderBy(desc(agentSessions.createdAt)).limit(1),
        this.db.select({ safeOutput: agentToolInvocations.safeOutput }).from(agentToolInvocations)
          .innerJoin(agentSessions, eq(agentToolInvocations.sessionId, agentSessions.id))
          .where(and(eq(agentSessions.caseId, record.caseId), eq(agentToolInvocations.toolName, "extract_with_vlm"), eq(agentToolInvocations.outcome, "succeeded")))
          .orderBy(desc(agentToolInvocations.completedAt)).limit(1),
      ]);
      const action = finalReview ? asFinalAction(finalReview.action) : undefined;
      const activeLifecycle = record.lifecycle === "processing" || record.lifecycle === "ready_for_review";
      const belongs = view === "changes_requested" ? action === "request_changes"
        : view === "completed" ? action === "clear_for_downstream"
          : action === "escalate_review" || (!action && activeLifecycle);
      if (!belongs) return null;
      const workflowStatus: QueueCaseView["workflowStatus"] = action === "request_changes" ? "changes_requested"
        : action === "clear_for_downstream" ? "ready_for_handoff"
          : action === "escalate_review" ? "escalated"
            : record.lifecycle === "processing" ? "processing" : "ready_for_review";
      const vlmOutput = vlmInvocation?.safeOutput && typeof vlmInvocation.safeOutput === "object"
        ? vlmInvocation.safeOutput as Record<string, unknown> : undefined;
      const vlmModelLabel = typeof vlmOutput?.["model_label"] === "string" ? vlmOutput["model_label"] : undefined;
      const reviewMethod: QueueCaseView["reviewMethod"] = report?.summary?.startsWith("No Agent review has been run") ? "manual"
        : !session || session.modelRoute === "fake" ? "deterministic"
        : session.vlmCalls > 0 ? "agent_vlm" : "agent";
      return {
        caseId: record.caseId, caseCode: caseCode(record.createdAt, record.displayNumber), applicantDisplayName: record.applicantDisplayName,
        summary: report?.summary ?? (workflowStatus === "processing" ? "Document processing is in progress." : "Review result available."),
        reviewMethod, ...(session?.modelRoute === "live" ? { agentModelLabel: session.modelLabel } : {}),
        ...(vlmModelLabel ? { vlmModelLabel } : {}),
        issueCount: issueRows.length, workflowStatus, lifecycle: asCaseLifecycle(record.lifecycle),
        waitingSince: (finalReview?.createdAt ?? record.createdAt).toISOString(), version: record.version,
      };
    }));
    return projected.filter((record): record is QueueCaseView => record !== null);
  }

  async get(caseId: string): Promise<CaseStatus> {
    const [record] = await this.db.select({
      caseId: cases.id,
      displayNumber: cases.displayNumber,
      applicantDisplayName: cases.applicantDisplayName,
      lifecycle: cases.lifecycle,
      version: cases.version,
      createdAt: cases.createdAt,
    }).from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!record) throw new CaseNotFoundError();

    const lifecycle = asCaseLifecycle(record.lifecycle);
    const [finalReview] = await this.db.select({ action: finalReviews.action }).from(finalReviews)
      .where(eq(finalReviews.caseId, caseId)).limit(1);
    return {
      caseId: record.caseId,
      caseCode: caseCode(record.createdAt, record.displayNumber),
      applicantDisplayName: record.applicantDisplayName,
      version: record.version,
      lifecycle,
      progress: lifecycle === "processing" ? "submitted" : lifecycle === "ready_for_review" ? "human_review" : "outcome",
      resultAvailability: lifecycle === "processing" ? "pending" : lifecycle === "processing_exception" ? "unavailable" : "ready",
      ...(finalReview ? { finalReviewAction: asFinalAction(finalReview.action) } : {}),
    };
  }

  async getDownstreamHandoff(caseId: string): Promise<DownstreamHandoffView> {
    const [record] = await this.db.select({
      caseId: cases.id, lifecycle: cases.lifecycle,
      finalReviewId: finalReviews.id, action: finalReviews.action, reviewerId: finalReviews.actorId,
      completedAt: finalReviews.createdAt, resultingCaseVersion: finalReviews.resultingCaseVersion,
      resultRevisionId: resultRevisions.id, resultRevisionNumber: resultRevisions.revision,
      resultSealedAt: resultRevisions.sealedAt, runId: resultRevisions.runId,
      disposition: recommendedDispositions.disposition, policyId: recommendedDispositions.policyId,
      policyVersion: recommendedDispositions.policyVersion,
    }).from(cases)
      .leftJoin(finalReviews, eq(finalReviews.caseId, cases.id))
      .leftJoin(resultRevisions, eq(resultRevisions.id, finalReviews.resultRevisionId))
      .leftJoin(recommendedDispositions, eq(recommendedDispositions.resultRevisionId, resultRevisions.id))
      .where(eq(cases.id, caseId)).limit(1);
    if (!record) throw new CaseNotFoundError();
    if (record.lifecycle !== "review_complete" || record.action !== "clear_for_downstream" || !record.finalReviewId ||
      !record.reviewerId || !record.completedAt || !record.resultRevisionId || record.resultRevisionNumber === null ||
      !record.resultSealedAt || !record.runId || !record.disposition || !record.policyId || !record.policyVersion) {
      throw new HandoffUnavailableError();
    }
    const disposition = record.disposition;
    if (disposition !== "ready_for_downstream_processing" && disposition !== "additional_documents_needed" && disposition !== "human_review_required") {
      throw new Error("Persisted disposition is invalid");
    }
    const [claims, findings] = await Promise.all([
      this.db.select({
        claimId: claimRecords.id, fieldSchemaId: claimRecords.fieldSchemaId, valueType: claimRecords.valueType,
        normalizedValue: claimRecords.normalizedValue, normalizationVersion: claimRecords.normalizationVersion,
      }).from(claimRecords).where(eq(claimRecords.runId, record.runId)).orderBy(asc(claimRecords.fieldSchemaId), asc(claimRecords.id)),
      this.getFindings(caseId),
    ]);
    const links = claims.length === 0 ? [] : await this.db.select({ claimId: claimEvidenceLinks.claimId, evidenceId: claimEvidenceLinks.evidenceId })
      .from(claimEvidenceLinks).where(inArray(claimEvidenceLinks.claimId, claims.map((claim) => claim.claimId)));
    const base = `/api/v1/cases/${caseId}/evidence/`;
    return {
      caseId, status: "ready_for_handoff",
      resultRevision: { id: record.resultRevisionId, revision: record.resultRevisionNumber, sealedAt: record.resultSealedAt.toISOString() },
      finalReview: { id: record.finalReviewId, action: "clear_for_downstream", reviewerId: record.reviewerId,
        completedAt: record.completedAt.toISOString(), resultingCaseVersion: record.resultingCaseVersion! },
      recommendedDisposition: { value: disposition, policyId: record.policyId, policyVersion: record.policyVersion },
      claims: claims.map((claim) => ({ ...claim, evidenceReferences: links.filter((link) => link.claimId === claim.claimId).map((link) => base + link.evidenceId) })),
      findings,
    };
  }

  async getAgentReport(caseId: string): Promise<AgentReportView> {
    await this.assertCaseExists(caseId);
    const [report] = await this.db.select({
      availability: agentReports.availability,
      failureReason: agentReports.verificationFailureReason,
      resultRevisionId: resultRevisions.id,
      resultRevisionNumber: resultRevisions.revision,
      summary: agentReports.summary,
      issueLinks: agentReports.issueLinks,
      checkedFacts: agentReports.checkedFacts,
    }).from(agentReports).leftJoin(resultRevisions, eq(agentReports.resultRevisionId, resultRevisions.id))
      .where(eq(agentReports.caseId, caseId))
      .orderBy(sql`${agentReports.createdAt} desc`).limit(1);
    if (!report) return { availability: "pending", issueLinks: [], checkedFacts: [] };
    return {
      availability: report.availability === "ready" ? "ready" : "unavailable",
      ...(report.failureReason ? { failureReason: report.failureReason } : {}),
      ...(report.resultRevisionId && report.resultRevisionNumber !== null
        ? { resultRevision: { id: report.resultRevisionId, revision: report.resultRevisionNumber } }
        : {}),
      summary: report.summary,
      issueLinks: report.issueLinks as string[],
      checkedFacts: report.checkedFacts as AgentReportView["checkedFacts"],
    };
  }

  /**
   * One bounded, chronological case Agent log (OPS-REQ-031). It represents a running, interrupted,
   * resumed, or terminal case-review attempt without exposing database vocabulary, hashes, prompts,
   * or raw model messages.
   */
  async getAgentLog(caseId: string): Promise<AgentLogView> {
    const [caseRecord] = await this.db.select({ lifecycle: cases.lifecycle, currentRunId: cases.currentRunId })
      .from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!caseRecord) throw new CaseNotFoundError();
    const [report] = await this.db.select({
      availability: agentReports.availability, modelLabel: agentReports.modelLabel,
      failureReason: agentReports.verificationFailureReason,
      estimatedCost: agentReports.estimatedCost, checkedFacts: agentReports.checkedFacts,
      issueLinks: agentReports.issueLinks, createdAt: agentReports.createdAt, sessionId: agentReports.sessionId, runId: agentReports.runId,
    }).from(agentReports).where(eq(agentReports.caseId, caseId)).orderBy(sql`${agentReports.createdAt} desc`).limit(1);
    const currentStep = caseRecord.lifecycle === "processing" ? "processing" as const
      : caseRecord.lifecycle === "review_complete" ? "review_completed" as const : "awaiting_human_review" as const;
    const runId = caseRecord.lifecycle === "processing" ? caseRecord.currentRunId : report?.runId ?? caseRecord.currentRunId;
    if (!runId) return { availability: "pending", currentStep, events: [] };
    const activeReport = report?.runId === runId ? report : undefined;

    const sessions = await this.db.select().from(agentSessions).where(eq(agentSessions.runId, runId)).orderBy(asc(agentSessions.startedAt));
    if (!activeReport && sessions.length === 0) return { availability: "pending", currentStep, events: [] };
    const preprocessing = await this.db.select({
      processor: documentInspections.processor, processorVersion: documentInspections.processorVersion,
      createdAt: documentInspections.createdAt, pageNumber: pages.pageNumber, needsOcr: pages.needsOcr,
    }).from(documentInspections).innerJoin(pages, eq(pages.documentInspectionId, documentInspections.id))
      .where(eq(documentInspections.runId, runId)).orderBy(asc(documentInspections.createdAt));
    const recognitionPageCount = preprocessing.filter((page) => page.needsOcr).length;
    const sessionIds = sessions.map((session) => session.id);
    const [steps, attempts, resolvedGaps] = await Promise.all([
      sessionIds.length ? this.db.select().from(agentSteps).where(inArray(agentSteps.sessionId, sessionIds)).orderBy(asc(agentSteps.sequence)) : [],
      sessionIds.length ? this.db.select().from(agentSessionAttempts).where(inArray(agentSessionAttempts.sessionId, sessionIds)).orderBy(asc(agentSessionAttempts.attemptNumber)) : [],
      this.db.select({
        fieldSchemaId: extractionGaps.fieldSchemaId, pageNumber: extractionGaps.pageNumber,
        reference: gapResolutions.reference,
        resolutionType: gapResolutions.resolutionType, createdAt: gapResolutions.createdAt,
      }).from(gapResolutions).innerJoin(extractionGaps, eq(gapResolutions.gapId, extractionGaps.id))
        .where(eq(extractionGaps.runId, runId)).orderBy(asc(gapResolutions.createdAt)),
    ]);
    const attemptCount = new Map<string, number>();
    for (const attempt of attempts) attemptCount.set(attempt.sessionId, (attemptCount.get(attempt.sessionId) ?? 0) + 1);
    const originatingAttempt = new Map<string, string | null>();
    for (const step of steps) {
      if (step.toolInvocationId && !step.reusedInvocationId) originatingAttempt.set(step.toolInvocationId, step.attemptId);
    }
    const view = (session: typeof sessions[number]): AgentLogSessionView => ({
      harnessLabel: `${session.harnessId} (${session.harnessVersion})`,
      mode: session.mode as AgentSessionMode,
      status: session.terminalReason ? "terminal" : "running",
      ...(session.terminalReason ? { terminalReason: session.terminalReason as AgentTerminalReason } : {}),
      attempts: attemptCount.get(session.id) ?? 1,
      iterations: session.iterations, toolCalls: session.toolCalls, modelCalls: session.modelCalls,
      usageAvailable: session.usageAvailable,
      ...(session.usageAvailable ? { inputTokens: session.inputTokens, outputTokens: session.outputTokens } : {}),
      ...(session.completedAt ? { durationMs: Math.max(0, session.completedAt.getTime() - session.startedAt.getTime()) } : {}),
    });
    const currentSession = sessions.find((session) => session.id === activeReport?.sessionId) ?? sessions.at(-1);
    const reportEvents = activeReport && activeReport.failureReason !== "agent_not_run"
      ? [{
        timestamp: activeReport.createdAt.toISOString(),
        activity: activeReport.availability === "ready"
          ? `Completed review: ${(activeReport.issueLinks as unknown[]).length} ${(activeReport.issueLinks as unknown[]).length === 1 ? "issue" : "issues"}, ${(activeReport.checkedFacts as unknown[]).length} checked facts`
          : "Report verification failed",
      }]
      : [];
    const reconciliationEvents = resolvedGaps.length > 0
      ? [{
        timestamp: resolvedGaps.at(-1)!.createdAt.toISOString(),
        activity: `Accepted ${resolvedGaps.length} extracted ${resolvedGaps.length === 1 ? "value" : "values"}`,
      }]
      : [];
    return {
      availability: activeReport ? (activeReport.availability === "ready" ? "ready" : "unavailable") : "pending",
      ...(activeReport ? { modelLabel: activeReport.modelLabel } : currentSession ? { modelLabel: currentSession.modelLabel } : {}),
      ...(currentSession?.modelRoute === "live" && currentSession.usageAvailable
        ? { estimatedCost: { amount: (currentSession.costMicroUsd / COST_MICRO_SCALE).toFixed(6), currency: "USD" as const } }
        : activeReport?.estimatedCost != null
          ? { estimatedCost: { amount: activeReport.estimatedCost, currency: "EUR" as const } }
          : {}),
      currentStep,
      ...(currentSession ? { session: view(currentSession) } : {}),
      events: [
        ...(preprocessing.length > 0
          ? [{
            timestamp: preprocessing[0]!.createdAt.toISOString(), actor: "system" as const,
            activity: `Prepared ${preprocessing.length} ${preprocessing.length === 1 ? "page" : "pages"}`
              + `${recognitionPageCount > 0
                ? `; ${recognitionPageCount} ${recognitionPageCount === 1 ? "requires" : "require"} text recognition`
                : ""}.`,
          }]
          : []),
        ...sessions.flatMap((session) => [
          { timestamp: session.startedAt.toISOString(), activity: "Started Agent review" },
          ...attempts.filter((attempt) => attempt.sessionId === session.id && attempt.attemptNumber > 1)
            .map((attempt) => ({ timestamp: attempt.startedAt.toISOString(), activity: "Processing resumed from saved progress" })),
          ...steps.filter((step) => step.sessionId === session.id)
            .map((step) => ({
              timestamp: step.completedAt.toISOString(), activity: reviewerActivity(step, originatingAttempt), toolLabel: step.toolName,
              actor: AGENT_DOCUMENT_TOOLS.has(step.toolName) ? "agent_document_tool" as const : "agent" as const,
            })),
          ...(session.completedAt && session.terminalReason && session.terminalReason !== "report_submitted"
            ? [{ timestamp: session.completedAt.toISOString(), activity: `Session ended: ${session.terminalReason.replace(/_/g, " ")}` }]
            : []),
        ]),
        ...reconciliationEvents,
        ...reportEvents,
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    };
  }

  async getIssues(caseId: string): Promise<readonly ReviewIssueView[]> {
    await this.assertCaseExists(caseId);
    const records = await this.db.select().from(reviewIssues).where(eq(reviewIssues.caseId, caseId))
      .orderBy(asc(reviewIssues.createdAt));
    const drafts = await this.db.select({
      issueId: requestedChangeRevisions.issueId, id: requestedChangeRevisions.id,
      revision: requestedChangeRevisions.revision, text: requestedChangeRevisions.currentText,
      included: requestedChangeRevisions.included,
    }).from(requestedChangeRevisions).innerJoin(reviewIssues, eq(requestedChangeRevisions.issueId, reviewIssues.id))
      .where(eq(reviewIssues.caseId, caseId)).orderBy(asc(requestedChangeRevisions.revision));
    const latestDraft = new Map(drafts.map((draft) => [draft.issueId, draft]));
    const edits = await this.db.select().from(reviewIssueEditRevisions).innerJoin(reviewIssues, eq(reviewIssueEditRevisions.issueId, reviewIssues.id))
      .where(eq(reviewIssues.caseId, caseId)).orderBy(asc(reviewIssueEditRevisions.revision));
    const latestEdit = new Map(edits.map(({ review_issue_edit_revisions: edit }) => [edit.issueId, edit]));
    return records.map((record) => ({
      ...(() => {
        const edit = latestEdit.get(record.id);
        return {
          description: edit?.description ?? record.description,
          ...(edit?.title ? { title: edit.title } : {}),
          recommendedAction: edit?.recommendedAction ?? record.recommendedAction,
          supportingReferences: (edit?.supportingReferences as string[] | undefined) ?? [],
          ...(edit?.noReferenceReason ? { noReferenceReason: edit.noReferenceReason } : {}),
          editRevision: edit?.revision ?? 0,
        };
      })(),
      issueId: record.id,
      origin: record.origin === "human" ? "human" : record.origin === "system" ? "system" : "agent",
      code: record.code,
      reviewState: record.reviewState === "confirmed" ? "confirmed" : record.reviewState === "ignored" ? "ignored" : "pending",
      version: record.version,
      ...(latestDraft.get(record.id) ? { requestedChange: {
        draftRevisionId: latestDraft.get(record.id)!.id, revision: latestDraft.get(record.id)!.revision,
        text: latestDraft.get(record.id)!.text, included: latestDraft.get(record.id)!.included,
      } } : {}),
    }));
  }

  async getEvidence(caseId: string, evidenceId: string): Promise<EvidenceView> {
    const [record] = await this.db.select({
      evidenceId: evidenceRecords.id,
      evidenceType: evidenceRecords.evidenceType,
      jsonPointer: evidenceRecords.jsonPointer,
      documentVersionId: evidenceRecords.documentVersionId,
      pageNumber: evidenceRecords.pageNumber,
      pageWidth: evidenceRecords.pageWidth, pageHeight: evidenceRecords.pageHeight,
      pageRotation: evidenceRecords.pageRotation, normalizedRegion: evidenceRecords.normalizedRegion,
      originalRegion: evidenceRecords.originalRegion, coordinateUnit: evidenceRecords.coordinateUnit, coordinateOrigin: evidenceRecords.coordinateOrigin,
      extractionMethod: evidenceRecords.extractionMethod,
      processorVersion: evidenceRecords.processorVersion,
    }).from(evidenceRecords)
      .innerJoin(processingRuns, eq(evidenceRecords.runId, processingRuns.id))
      .where(and(eq(processingRuns.caseId, caseId), eq(evidenceRecords.id, evidenceId))).limit(1);
    if (!record) throw new CaseNotFoundError();
    if (record.evidenceType === "structured_input" && record.jsonPointer) {
      return {
        evidenceId: record.evidenceId, evidenceType: "structured_input",
        jsonPointer: record.jsonPointer, extractionMethod: record.extractionMethod,
        processorVersion: record.processorVersion,
      };
    }
    if (record.evidenceType === "page_level" && record.documentVersionId && record.pageNumber !== null) {
      return {
        evidenceId: record.evidenceId, evidenceType: "page_level",
        documentVersionId: record.documentVersionId, pageNumber: record.pageNumber,
        extractionMethod: record.extractionMethod, processorVersion: record.processorVersion,
      };
    }
    if (record.evidenceType === "page_region" && record.documentVersionId && record.pageNumber !== null
      && record.pageWidth && record.pageHeight && record.pageRotation !== null && validNormalizedRegion(record.normalizedRegion)
      && validOriginalRegion(record.originalRegion) && record.coordinateUnit === "render_pixel" && record.coordinateOrigin === "top_left") {
      return { evidenceId: record.evidenceId, evidenceType: "page_region", documentVersionId: record.documentVersionId,
        pageNumber: record.pageNumber, pageWidth: record.pageWidth, pageHeight: record.pageHeight, pageRotation: record.pageRotation,
        normalizedRegion: record.normalizedRegion, originalRegion: record.originalRegion,
        coordinateUnit: "render_pixel", coordinateOrigin: "top_left",
        extractionMethod: record.extractionMethod, processorVersion: record.processorVersion };
    }
    throw new Error("Persisted evidence subtype is invalid");
  }

  async listEvidence(caseId: string): Promise<readonly EvidenceView[]> {
    const records = await this.db.select({
      evidenceId: evidenceRecords.id,
      evidenceType: evidenceRecords.evidenceType,
      jsonPointer: evidenceRecords.jsonPointer,
      documentVersionId: evidenceRecords.documentVersionId,
      pageNumber: evidenceRecords.pageNumber,
      pageWidth: evidenceRecords.pageWidth, pageHeight: evidenceRecords.pageHeight,
      pageRotation: evidenceRecords.pageRotation, normalizedRegion: evidenceRecords.normalizedRegion,
      originalRegion: evidenceRecords.originalRegion, coordinateUnit: evidenceRecords.coordinateUnit, coordinateOrigin: evidenceRecords.coordinateOrigin,
      extractionMethod: evidenceRecords.extractionMethod,
      processorVersion: evidenceRecords.processorVersion,
    }).from(evidenceRecords)
      .innerJoin(processingRuns, eq(evidenceRecords.runId, processingRuns.id))
      .innerJoin(cases, eq(processingRuns.id, cases.currentRunId))
      .where(eq(cases.id, caseId));
    return records.flatMap((record): EvidenceView[] => {
      if (record.evidenceType === "structured_input" && record.jsonPointer) return [{
        evidenceId: record.evidenceId, evidenceType: "structured_input", jsonPointer: record.jsonPointer,
        extractionMethod: record.extractionMethod, processorVersion: record.processorVersion,
      }];
      if (record.evidenceType === "page_level" && record.documentVersionId && record.pageNumber !== null) return [{
        evidenceId: record.evidenceId, evidenceType: "page_level", documentVersionId: record.documentVersionId,
        pageNumber: record.pageNumber, extractionMethod: record.extractionMethod, processorVersion: record.processorVersion,
      }];
      if (record.evidenceType === "page_region" && record.documentVersionId && record.pageNumber !== null
        && record.pageWidth && record.pageHeight && record.pageRotation !== null && validNormalizedRegion(record.normalizedRegion)
        && validOriginalRegion(record.originalRegion) && record.coordinateUnit === "render_pixel" && record.coordinateOrigin === "top_left") return [{
        evidenceId: record.evidenceId, evidenceType: "page_region", documentVersionId: record.documentVersionId,
        pageNumber: record.pageNumber, pageWidth: record.pageWidth, pageHeight: record.pageHeight, pageRotation: record.pageRotation,
        normalizedRegion: record.normalizedRegion, extractionMethod: record.extractionMethod, processorVersion: record.processorVersion,
        originalRegion: record.originalRegion, coordinateUnit: "render_pixel", coordinateOrigin: "top_left",
      }];
      return [];
    });
  }

  async getApplicationData(caseId: string): Promise<ApplicationDataView> {
    const [record] = await this.db.select({
      content: applicationSnapshots.content,
      createdAt: applicationSnapshots.createdAt,
    }).from(cases)
      .innerJoin(processingRuns, eq(cases.currentRunId, processingRuns.id))
      .innerJoin(inputRevisions, eq(processingRuns.inputRevisionId, inputRevisions.id))
      .innerJoin(applicationSnapshots, eq(inputRevisions.applicationSnapshotId, applicationSnapshots.id))
      .where(eq(cases.id, caseId)).limit(1);
    if (!record || typeof record.content !== "object" || record.content === null || Array.isArray(record.content)) throw new CaseNotFoundError();
    return projectApplicationData(record.content as Record<string, unknown>, record.createdAt);
  }

  async getDocuments(caseId: string): Promise<readonly DocumentView[]> {
    const records = await this.db.select({
      documentId: documentVersions.id,
      physicalDocumentId: documentVersions.physicalDocumentId,
      version: documentVersions.version,
      submittedFilename: documentVersions.submittedFilename,
      mediaType: documentVersions.detectedMediaType,
      pageCount: count(pages.id),
    }).from(cases)
      .innerJoin(processingRuns, eq(cases.currentRunId, processingRuns.id))
      .innerJoin(inputDocumentSelections, eq(processingRuns.inputRevisionId, inputDocumentSelections.inputRevisionId))
      .innerJoin(documentVersions, eq(inputDocumentSelections.documentVersionId, documentVersions.id))
      .leftJoin(documentInspections, and(eq(documentInspections.runId, processingRuns.id), eq(documentInspections.documentVersionId, documentVersions.id)))
      .leftJoin(pages, eq(pages.documentInspectionId, documentInspections.id))
      .where(eq(cases.id, caseId))
      .groupBy(documentVersions.id, documentVersions.physicalDocumentId, documentVersions.version, documentVersions.submittedFilename, documentVersions.detectedMediaType)
      .orderBy(asc(documentVersions.createdAt));
    await this.assertCaseExists(caseId);
    return records.map((record) => ({ ...record, pageCount: Number(record.pageCount) }));
  }

  async getSourceDocumentArtifact(caseId: string, documentId: string): Promise<SourceDocumentArtifactView> {
    const [record] = await this.db.select({
      objectKey: artifacts.objectKey, byteSize: artifacts.byteSize, mediaType: artifacts.detectedMediaType,
    }).from(cases)
      .innerJoin(processingRuns, eq(cases.currentRunId, processingRuns.id))
      .innerJoin(inputDocumentSelections, eq(processingRuns.inputRevisionId, inputDocumentSelections.inputRevisionId))
      .innerJoin(documentVersions, eq(inputDocumentSelections.documentVersionId, documentVersions.id))
      .innerJoin(artifacts, eq(documentVersions.sourceArtifactId, artifacts.id))
      .where(and(eq(cases.id, caseId), eq(documentVersions.id, documentId))).limit(1);
    if (!record) throw new CaseNotFoundError();
    if (record.mediaType !== "application/pdf" && record.mediaType !== "image/jpeg" && record.mediaType !== "image/png") {
      throw new Error("Persisted source-document media type is invalid");
    }
    return { objectKey: record.objectKey, byteSize: record.byteSize, mediaType: record.mediaType };
  }

  async getDocumentPage(caseId: string, documentId: string, pageNumber: number): Promise<DocumentPageView> {
    const [record] = await this.db.select({
      documentId: documentVersions.id,
      pageNumber: pages.pageNumber,
      needsOcr: pages.needsOcr,
      ocrReason: pages.ocrReason,
      hasTable: pages.hasTable,
      hasColumns: pages.hasColumns,
      nativeCharacterCount: pages.nativeCharacterCount, nativeTextArtifactId: pages.nativeTextArtifactId,
      renderArtifactId: pages.renderArtifactId,
    }).from(cases)
      .innerJoin(processingRuns, eq(cases.currentRunId, processingRuns.id))
      .innerJoin(inputDocumentSelections, eq(processingRuns.inputRevisionId, inputDocumentSelections.inputRevisionId))
      .innerJoin(documentVersions, eq(inputDocumentSelections.documentVersionId, documentVersions.id))
      .innerJoin(documentInspections, and(eq(documentInspections.runId, processingRuns.id), eq(documentInspections.documentVersionId, documentVersions.id)))
      .innerJoin(pages, eq(pages.documentInspectionId, documentInspections.id))
      .where(and(eq(cases.id, caseId), eq(documentVersions.id, documentId), eq(pages.pageNumber, pageNumber))).limit(1);
    if (!record) throw new CaseNotFoundError();
    return {
      documentId: record.documentId, pageNumber: record.pageNumber, needsOcr: record.needsOcr,
      ...(record.ocrReason ? { ocrReason: record.ocrReason } : {}),
      hasTable: record.hasTable, hasColumns: record.hasColumns,
      nativeCharacterCount: record.nativeCharacterCount, nativeTextAvailable: Boolean(record.nativeTextArtifactId),
      renderAvailable: Boolean(record.renderArtifactId),
    };
  }

  async getNativeTextArtifact(caseId: string, documentId: string, pageNumber: number): Promise<NativeTextArtifactView> {
    const [record] = await this.db.select({ objectKey: artifacts.objectKey, byteSize: artifacts.byteSize, mediaType: artifacts.detectedMediaType })
      .from(pages).innerJoin(documentVersions, eq(pages.documentVersionId, documentVersions.id))
      .innerJoin(physicalDocuments, eq(documentVersions.physicalDocumentId, physicalDocuments.id))
      .innerJoin(artifacts, eq(pages.nativeTextArtifactId, artifacts.id))
      .where(and(eq(physicalDocuments.caseId, caseId), eq(documentVersions.id, documentId), eq(pages.pageNumber, pageNumber))).limit(1);
    if (!record) throw new CaseNotFoundError();
    if (record.mediaType !== "text/markdown" && record.mediaType !== "application/json") throw new Error("Persisted native-text media type is invalid");
    return { objectKey: record.objectKey, byteSize: record.byteSize, mediaType: record.mediaType };
  }

  async getPageRenderArtifact(caseId: string, documentId: string, pageNumber: number): Promise<PageRenderArtifactView> {
    const [record] = await this.db.select({ objectKey: artifacts.objectKey, byteSize: artifacts.byteSize, mediaType: artifacts.detectedMediaType })
      .from(pages).innerJoin(documentVersions, eq(pages.documentVersionId, documentVersions.id))
      .innerJoin(physicalDocuments, eq(documentVersions.physicalDocumentId, physicalDocuments.id))
      .innerJoin(artifacts, eq(pages.renderArtifactId, artifacts.id))
      .where(and(eq(physicalDocuments.caseId, caseId), eq(documentVersions.id, documentId), eq(pages.pageNumber, pageNumber))).limit(1);
    if (!record) throw new CaseNotFoundError();
    if (record.mediaType !== "image/png") throw new Error("Persisted page-render media type is invalid");
    return { objectKey: record.objectKey, byteSize: record.byteSize, mediaType: "image/png" };
  }

  async getFindings(caseId: string): Promise<readonly FindingView[]> {
    const records = await this.db.select({
      findingId: validationFindings.id,
      ruleId: validationFindings.ruleId,
      ruleVersion: validationFindings.ruleVersion,
      status: validationFindings.status,
      reasonCode: validationFindings.reasonCode,
      references: validationFindings.materialInputRefs,
    }).from(cases)
      .innerJoin(processingRuns, eq(cases.currentRunId, processingRuns.id))
      .innerJoin(resultRevisions, eq(resultRevisions.runId, processingRuns.id))
      .innerJoin(validationFindings, eq(validationFindings.resultRevisionId, resultRevisions.id))
      .where(eq(cases.id, caseId)).orderBy(asc(validationFindings.ruleId));
    await this.assertCaseExists(caseId);
    const directEvidence = await this.db.select({ evidenceId: evidenceRecords.id }).from(evidenceRecords)
      .innerJoin(processingRuns, eq(evidenceRecords.runId, processingRuns.id))
      .innerJoin(cases, eq(cases.currentRunId, processingRuns.id)).where(eq(cases.id, caseId));
    const evidenceIds = new Set(directEvidence.map((item) => item.evidenceId));
    const claimLinks = await this.db.select({ claimId: claimEvidenceLinks.claimId, evidenceId: claimEvidenceLinks.evidenceId })
      .from(claimEvidenceLinks).innerJoin(claimRecords, eq(claimEvidenceLinks.claimId, claimRecords.id))
      .innerJoin(processingRuns, eq(claimRecords.runId, processingRuns.id))
      .innerJoin(cases, eq(cases.currentRunId, processingRuns.id)).where(eq(cases.id, caseId));
    const evidenceByClaim = new Map<string, string[]>();
    for (const link of claimLinks) evidenceByClaim.set(link.claimId, [...(evidenceByClaim.get(link.claimId) ?? []), link.evidenceId]);
    return records.map((record) => ({
      ...record,
      status: asFindingStatus(record.status),
      references: [...new Set((record.references as string[]).flatMap((reference) =>
        evidenceIds.has(reference) ? [reference] : evidenceByClaim.get(reference) ?? []))]
        .map((evidenceId) => `/api/v1/cases/${caseId}/evidence/${evidenceId}`),
    }));
  }

  private async assertCaseExists(caseId: string): Promise<void> {
    const [record] = await this.db.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!record) throw new CaseNotFoundError();
  }
}

function asCaseLifecycle(value: string): CaseStatus["lifecycle"] {
  if (value === "processing" || value === "ready_for_review" || value === "review_complete" || value === "processing_exception") return value;
  throw new Error(`Unsupported persisted case lifecycle: ${value}`);
}

export function hashIntake(command: CaseIntakeCommand): string {
  return hashCanonical({
      applicant_display_name: command.applicantDisplayName,
      application_data: command.applicationData,
      agent_model: command.agentModel,
      start_agent_review: command.startAgentReview !== false,
      documents: (command.documents ?? []).map((document) => ({
        filename: document.submittedFilename,
        sha256: document.artifact.sha256,
        byte_size: document.artifact.byteSize,
        media_type: document.artifact.detectedMediaType,
      })),
    });
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export interface PendingOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export class PostgresOutboxStore {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async nextBatch(limit = 20): Promise<PendingOutboxEvent[]> {
    return this.db.select({
      id: outboxEvents.id,
      eventType: outboxEvents.eventType,
      payload: outboxEvents.payload,
    }).from(outboxEvents).where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt)).limit(limit);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.db.update(outboxEvents).set({ publishedAt: new Date() }).where(and(
      eq(outboxEvents.id, eventId),
      isNull(outboxEvents.publishedAt),
    ));
  }
}

/** Committed page and logical-document inventory of one run (DAT sections 4 and 5). */
export interface CaseInventoryPage {
  readonly documentVersionId: string;
  readonly submittedFilename: string;
  readonly pageNumber: number;
  readonly needsOcr: boolean;
  readonly ocrReason?: string;
  readonly hasTable: boolean;
  readonly hasColumns: boolean;
  readonly nativeCharacterCount: number;
  readonly nativeTextObjectKey?: string;
  readonly render?: { readonly objectKey: string; readonly width: number; readonly height: number; readonly rendererVersion: string };
  readonly ocr?: { readonly objectKey: string; readonly engine: string; readonly engineVersion: string; readonly modelAssetVersion: string };
  readonly classification?: { readonly selectedType: string; readonly method: string; readonly version: string; readonly rawConfidence: number };
  readonly boundary?: { readonly startsNewDocument: boolean; readonly method: string; readonly version: string; readonly rawConfidence: number };
}

export interface CaseDocumentInventory {
  readonly inputRevisionId: string;
  readonly applicationSnapshotId: string;
  readonly documentProcessorVersion: string;
  readonly pages: readonly CaseInventoryPage[];
  readonly logicalDocuments: readonly {
    readonly logicalDocumentRevisionId: string; readonly documentVersionId: string;
    readonly startPage: number; readonly endPage: number; readonly documentType: string; readonly uncertain: boolean;
  }[];
}

function confidenceValue(value: unknown): number {
  return value && typeof value === "object" && typeof (value as { value?: unknown }).value === "number" ? (value as { value: number }).value : 0;
}

export class PostgresWorkflowCoordinator {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async loadAgentModel(caseId: string, runId: string): Promise<string> {
    const [run] = await this.db.select({ agentModel: processingRuns.agentModel }).from(processingRuns)
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!run) throw new Error("Processing run does not exist");
    return run.agentModel;
  }

  async isManualPreparation(caseId: string, runId: string): Promise<boolean> {
    const [run] = await this.db.select({ workflowVersion: processingRuns.workflowVersion }).from(processingRuns)
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!run) throw new Error("Processing run does not exist");
    return run.workflowVersion === "manual-review-preparation-v1";
  }

  async completeManualPreparation(caseId: string, runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status, inputRevisionId: processingRuns.inputRevisionId,
        agentModel: processingRuns.agentModel }).from(processingRuns)
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "completed") return;
      if (run.status !== "running") throw new Error("Manual preparation run must be running before completion");
      const completedAt = new Date();
      const resultRevisionId = randomUUID();
      const [input] = await tx.select({ applicationSnapshotId: inputRevisions.applicationSnapshotId,
        applicationContent: applicationSnapshots.content }).from(inputRevisions)
        .innerJoin(applicationSnapshots, eq(inputRevisions.applicationSnapshotId, applicationSnapshots.id))
        .where(eq(inputRevisions.id, run.inputRevisionId)).limit(1);
      if (!input) throw new Error("Manual preparation input revision is unavailable");
      const preparedPages = await tx.select({ documentVersionId: pages.documentVersionId, pageNumber: pages.pageNumber })
        .from(pages).innerJoin(documentInspections, eq(pages.documentInspectionId, documentInspections.id))
        .where(eq(documentInspections.runId, runId));
      const structuredPointers = ["/applicant_display_name", "/employment/employer", "/income/monthly_net"]
        .filter((pointer) => jsonPointerExists(input.applicationContent, pointer));
      await tx.insert(evidenceRecords).values([
        ...preparedPages.map((page) => ({ id: randomUUID(), runId, evidenceType: "page_level",
          documentVersionId: page.documentVersionId, pageNumber: page.pageNumber,
          extractionMethod: "pdf_inspector_inspection", processorVersion: "manual-review-preparation-1.0.0" })),
        ...structuredPointers.map((jsonPointer) => ({ id: randomUUID(), runId, evidenceType: "structured_input",
          applicationSnapshotId: input.applicationSnapshotId, jsonPointer,
          extractionMethod: "structured_input", processorVersion: "application-schema-1.0.0" })),
      ]);
      await tx.insert(resultRevisions).values({ id: resultRevisionId, caseId, runId,
        inputRevisionId: run.inputRevisionId, revision: 1, revisionType: "human_review", sealedAt: completedAt });
      await tx.insert(recommendedDispositions).values({ id: randomUUID(), resultRevisionId,
        policyId: "manual-document-review-baseline", policyVersion: "1.0.0",
        disposition: "human_review_required", reasonCodes: ["agent_not_run"] });
      await tx.insert(agentReports).values({ id: randomUUID(), caseId, runId, resultRevisionId, sessionId: null,
        availability: "unavailable", verificationStatus: null, verificationFailureReason: "agent_not_run",
        summary: "No Agent review has been run. Human review can continue from the submitted application and documents.",
        issueLinks: [], checkedFacts: [], originalSubmission: null, modelLabel: run.agentModel, estimatedCost: null });
      await tx.update(processingRuns).set({ status: "completed", completedAt }).where(eq(processingRuns.id, runId));
      await tx.insert(processingRunTransitions).values({ id: randomUUID(), runId, priorStatus: "running",
        newStatus: "completed", reason: "manual_review_prepared" });
      await tx.update(cases).set({ lifecycle: "ready_for_review", version: sql`${cases.version} + 1` }).where(eq(cases.id, caseId));
      await tx.insert(caseStateTransitions).values({ id: randomUUID(), caseId, runId, priorState: "processing",
        newState: "ready_for_review", reason: "manual_review_prepared", actor: "workflow_coordinator" });
    });
  }

  async loadApplicant(caseId: string, runId: string): Promise<string> {
    const [record] = await this.db.select({ applicantDisplayName: cases.applicantDisplayName })
      .from(processingRuns).innerJoin(cases, eq(processingRuns.caseId, cases.id))
      .where(and(eq(processingRuns.id, runId), eq(cases.id, caseId))).limit(1);
    if (!record) throw new CaseNotFoundError();
    return record.applicantDisplayName;
  }

  async loadApplicationData(caseId: string, runId: string): Promise<Readonly<Record<string, unknown>>> {
    const [record] = await this.db.select({ content: applicationSnapshots.content })
      .from(processingRuns)
      .innerJoin(inputRevisions, eq(processingRuns.inputRevisionId, inputRevisions.id))
      .innerJoin(applicationSnapshots, eq(inputRevisions.applicationSnapshotId, applicationSnapshots.id))
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!record || typeof record.content !== "object" || record.content === null || Array.isArray(record.content)) {
      throw new CaseNotFoundError();
    }
    return record.content as Record<string, unknown>;
  }

  async loadInputRevisionId(caseId: string, runId: string): Promise<string> {
    const [record] = await this.db.select({ inputRevisionId: processingRuns.inputRevisionId })
      .from(processingRuns).where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!record) throw new CaseNotFoundError();
    return record.inputRevisionId;
  }

  /**
   * Committed document inventory of one run: grouped logical documents, page metadata, derived
   * artifact keys, and the persisted classification and boundary of every page. It is the only
   * document input the Agent-led stage reads; no fixture supplies it.
   */
  async loadCaseDocumentInventory(caseId: string, runId: string): Promise<CaseDocumentInventory> {
    const [run] = await this.db.select({
      inputRevisionId: processingRuns.inputRevisionId,
      applicationSnapshotId: inputRevisions.applicationSnapshotId,
    }).from(processingRuns).innerJoin(inputRevisions, eq(processingRuns.inputRevisionId, inputRevisions.id))
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!run) throw new CaseNotFoundError();
    const [inspection] = await this.db.select({ processor: documentInspections.processor, processorVersion: documentInspections.processorVersion })
      .from(documentInspections).where(eq(documentInspections.runId, runId)).limit(1);
    const nativeArtifacts = alias(artifacts, "native_text_artifacts");
    const renderArtifacts = alias(artifacts, "render_artifacts");
    const ocrArtifacts = alias(artifacts, "ocr_artifacts");
    const pageRecords = await this.db.select({
      documentVersionId: pages.documentVersionId,
      submittedFilename: documentVersions.submittedFilename,
      pageNumber: pages.pageNumber,
      needsOcr: pages.needsOcr,
      ocrReason: pages.ocrReason,
      hasTable: pages.hasTable,
      hasColumns: pages.hasColumns,
      nativeCharacterCount: pages.nativeCharacterCount,
      nativeTextObjectKey: nativeArtifacts.objectKey,
      renderObjectKey: renderArtifacts.objectKey,
      renderWidth: pages.renderWidth,
      renderHeight: pages.renderHeight,
      rendererVersion: pages.rendererVersion,
      ocrObjectKey: ocrArtifacts.objectKey,
      ocrEngine: pageOcrOutputs.engine,
      ocrEngineVersion: pageOcrOutputs.engineVersion,
      ocrModelAssetVersion: pageOcrOutputs.modelAssetVersion,
      classificationType: pageClassifications.selectedType,
      classificationMethod: pageClassifications.method,
      classificationVersion: pageClassifications.version,
      classificationConfidence: pageClassifications.rawConfidence,
      boundaryStartsNewDocument: boundaryPredictions.startsNewDocument,
      boundaryMethod: boundaryPredictions.method,
      boundaryVersion: boundaryPredictions.version,
      boundaryConfidence: boundaryPredictions.rawConfidence,
    }).from(pages)
      .innerJoin(documentInspections, eq(pages.documentInspectionId, documentInspections.id))
      .innerJoin(documentVersions, eq(pages.documentVersionId, documentVersions.id))
      .leftJoin(nativeArtifacts, eq(pages.nativeTextArtifactId, nativeArtifacts.id))
      .leftJoin(renderArtifacts, eq(pages.renderArtifactId, renderArtifacts.id))
      .leftJoin(pageOcrOutputs, eq(pageOcrOutputs.pageId, pages.id))
      .leftJoin(ocrArtifacts, eq(pageOcrOutputs.artifactId, ocrArtifacts.id))
      .leftJoin(pageClassifications, eq(pageClassifications.pageId, pages.id))
      .leftJoin(boundaryPredictions, eq(boundaryPredictions.pageId, pages.id))
      .where(eq(documentInspections.runId, runId))
      .orderBy(asc(documentVersions.submittedFilename), asc(pages.pageNumber));
    const logicalDocuments = await this.db.select({
      logicalDocumentRevisionId: logicalDocumentRevisions.id,
      documentVersionId: logicalDocumentRevisions.documentVersionId,
      startPage: logicalDocumentRevisions.startPage,
      endPage: logicalDocumentRevisions.endPage,
      documentType: logicalDocumentRevisions.documentType,
      uncertain: logicalDocumentRevisions.uncertain,
    }).from(logicalDocumentRevisions).where(eq(logicalDocumentRevisions.runId, runId));
    return {
      inputRevisionId: run.inputRevisionId,
      applicationSnapshotId: run.applicationSnapshotId,
      documentProcessorVersion: inspection ? `${inspection.processor}@${inspection.processorVersion}` : "unknown",
      pages: pageRecords.map((page) => ({
        documentVersionId: page.documentVersionId, submittedFilename: page.submittedFilename, pageNumber: page.pageNumber,
        needsOcr: page.needsOcr, ...(page.ocrReason ? { ocrReason: page.ocrReason } : {}),
        hasTable: page.hasTable, hasColumns: page.hasColumns, nativeCharacterCount: page.nativeCharacterCount,
        ...(page.nativeTextObjectKey ? { nativeTextObjectKey: page.nativeTextObjectKey } : {}),
        ...(page.renderObjectKey ? { render: { objectKey: page.renderObjectKey, width: page.renderWidth ?? 0, height: page.renderHeight ?? 0, rendererVersion: page.rendererVersion ?? "unknown" } } : {}),
        ...(page.ocrObjectKey ? { ocr: { objectKey: page.ocrObjectKey, engine: page.ocrEngine ?? "unknown", engineVersion: page.ocrEngineVersion ?? "unknown", modelAssetVersion: page.ocrModelAssetVersion ?? "unknown" } } : {}),
        ...(page.classificationType ? { classification: { selectedType: page.classificationType, method: page.classificationMethod ?? "unknown", version: page.classificationVersion ?? "unknown", rawConfidence: confidenceValue(page.classificationConfidence) } } : {}),
        ...(page.boundaryStartsNewDocument !== null ? { boundary: { startsNewDocument: page.boundaryStartsNewDocument, method: page.boundaryMethod ?? "unknown", version: page.boundaryVersion ?? "unknown", rawConfidence: confidenceValue(page.boundaryConfidence) } } : {}),
      })),
      logicalDocuments,
    };
  }

  async hasInputDocuments(caseId: string, runId: string): Promise<boolean> {
    const [record] = await this.db.select({ id: inputDocumentSelections.id })
      .from(processingRuns)
      .innerJoin(inputDocumentSelections, eq(processingRuns.inputRevisionId, inputDocumentSelections.inputRevisionId))
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    return Boolean(record);
  }

  async loadUninspectedDocuments(caseId: string, runId: string): Promise<StoredDocumentReference[]> {
    const records = await this.db.select({
      documentVersionId: documentVersions.id,
      objectKey: artifacts.objectKey,
      sha256: artifacts.sha256,
      mediaType: documentVersions.detectedMediaType,
    }).from(documentVersions)
      .innerJoin(inputDocumentSelections, eq(documentVersions.id, inputDocumentSelections.documentVersionId))
      .innerJoin(processingRuns, eq(inputDocumentSelections.inputRevisionId, processingRuns.inputRevisionId))
      .innerJoin(physicalDocuments, eq(documentVersions.physicalDocumentId, physicalDocuments.id))
      .innerJoin(artifacts, eq(documentVersions.sourceArtifactId, artifacts.id))
      .leftJoin(documentInspections, and(
        eq(documentInspections.documentVersionId, documentVersions.id),
        eq(documentInspections.runId, runId),
      ))
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId), isNull(documentInspections.id)));
    return records;
  }

  async persistInspection(runId: string, document: StoredDocumentReference, inspection: InspectionRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inspectionId = randomUUID();
      await tx.insert(documentInspections).values({
        id: inspectionId, runId, documentVersionId: document.documentVersionId,
        processor: inspection.processor, processorVersion: inspection.processorVersion,
        pdfType: inspection.pdfType, routingSignal: String(inspection.routingSignal),
        isComplex: inspection.isComplex,
      }).onConflictDoNothing();
      const [persisted] = await tx.select({ id: documentInspections.id }).from(documentInspections)
        .where(and(eq(documentInspections.runId, runId), eq(documentInspections.documentVersionId, document.documentVersionId))).limit(1);
      if (!persisted || persisted.id !== inspectionId) return;
      const derivedArtifacts = inspection.pages.flatMap((page) => [
        ...(page.nativeTextArtifact ? [{
          id: randomUUID(), caseId: page.nativeTextArtifact.caseId, objectKey: page.nativeTextArtifact.objectKey,
          sha256: page.nativeTextArtifact.sha256, byteSize: page.nativeTextArtifact.byteSize,
          detectedMediaType: page.nativeTextArtifact.mediaType, artifactKind: "native_text",
        }] : []),
        ...(page.renderArtifact ? [{
          id: randomUUID(), caseId: page.renderArtifact.caseId, objectKey: page.renderArtifact.objectKey,
          sha256: page.renderArtifact.sha256, byteSize: page.renderArtifact.byteSize,
          detectedMediaType: page.renderArtifact.mediaType, artifactKind: "page_render",
        }] : []),
        ...(page.ocrArtifact ? [{
          id: randomUUID(), caseId: page.ocrArtifact.caseId, objectKey: page.ocrArtifact.objectKey,
          sha256: page.ocrArtifact.sha256, byteSize: page.ocrArtifact.byteSize,
          detectedMediaType: page.ocrArtifact.mediaType, artifactKind: "ocr_output",
        }] : []),
      ]);
      const artifactIds = new Map<string, string>();
      if (derivedArtifacts.length > 0) {
        await tx.insert(artifacts).values(derivedArtifacts).onConflictDoNothing();
        const persistedArtifacts = await tx.select({ id: artifacts.id, objectKey: artifacts.objectKey }).from(artifacts)
          .where(inArray(artifacts.objectKey, derivedArtifacts.map((artifact) => artifact.objectKey)));
        for (const artifact of persistedArtifacts) artifactIds.set(artifact.objectKey, artifact.id);
        if (artifactIds.size !== derivedArtifacts.length) throw new Error("Derived artifact metadata could not be resolved");
      }
      const pageRows = inspection.pages.map((page) => ({
        id: randomUUID(), source: page, documentInspectionId: inspectionId,
        documentVersionId: document.documentVersionId, pageNumber: page.pageNumber,
        needsOcr: page.needsOcr, ocrReason: page.ocrReason,
        hasTable: page.hasTable, hasColumns: page.hasColumns,
        nativeCharacterCount: page.nativeCharacterCount,
        nativeTextArtifactId: page.nativeTextArtifact ? artifactIds.get(page.nativeTextArtifact.objectKey) : null,
        renderArtifactId: page.renderArtifact ? artifactIds.get(page.renderArtifact.objectKey) : null,
        renderWidth: page.renderArtifact?.width ?? null, renderHeight: page.renderArtifact?.height ?? null,
        renderDpi: page.renderArtifact?.targetDpi ?? null, rendererVersion: page.renderArtifact?.rendererVersion ?? null,
      }));
      await tx.insert(pages).values(pageRows.map(({ source: _source, ...row }) => row));
      const ocrRows = pageRows.flatMap(({ id: pageId, source: page }) => page.ocrArtifact ? [{
        id: randomUUID(), pageId, artifactId: artifactIds.get(page.ocrArtifact.objectKey)!,
        engine: page.ocrArtifact.engine, engineVersion: page.ocrArtifact.engineVersion,
        modelAssetVersion: page.ocrArtifact.modelAssetVersion, languages: [...page.ocrArtifact.languages],
        coordinateSpace: page.ocrArtifact.coordinateSpace,
      }] : []);
      if (ocrRows.length > 0) await tx.insert(pageOcrOutputs).values(ocrRows);
      if (inspection.classifications) {
        const pageIds = new Map(pageRows.map((row) => [row.source.pageNumber, row.id]));
        const classifiedPages = new Set(inspection.classifications.map((item) => item.pageNumber));
        const groupedPages = (inspection.logicalDocuments ?? []).flatMap((group) => group.pageNumbers);
        if (classifiedPages.size !== pageRows.length || pageRows.some((row) => !classifiedPages.has(row.source.pageNumber)) ||
            !inspection.boundaries || inspection.boundaries.length !== Math.max(0, pageRows.length - 1) ||
            groupedPages.length !== pageRows.length || new Set(groupedPages).size !== pageRows.length ||
            pageRows.some((row) => !groupedPages.includes(row.source.pageNumber))) {
          throw new Error("Document classification and grouping do not cover the page inventory");
        }
        await tx.insert(pageClassifications).values(inspection.classifications.map((item) => ({
          id: randomUUID(), pageId: pageIds.get(item.pageNumber)!, selectedType: item.selectedType,
          method: item.method, version: item.version, qualityStatus: item.qualityStatus,
          rawConfidence: item.rawConfidence, alternatives: [...item.alternatives],
        })));
        if (inspection.boundaries && inspection.boundaries.length > 0) await tx.insert(boundaryPredictions).values(inspection.boundaries.map((item) => ({
          id: randomUUID(), pageId: pageIds.get(item.pageNumber)!, startsNewDocument: item.startsNewDocument,
          method: item.method, version: item.version, rawConfidence: item.rawConfidence,
        })));
        for (const group of inspection.logicalDocuments ?? []) {
          const logicalDocumentRevisionId = randomUUID();
          await tx.insert(logicalDocumentRevisions).values({
            id: logicalDocumentRevisionId, runId, documentVersionId: document.documentVersionId,
            startPage: group.startPage, endPage: group.endPage, documentType: group.documentType,
            uncertain: group.uncertain, groupingMethod: "deterministic-contiguous-grouping", groupingVersion: "1.0.0",
          });
          await tx.insert(logicalDocumentPages).values(group.pageNumbers.map((pageNumber) => ({
            id: randomUUID(), logicalDocumentRevisionId, pageId: pageIds.get(pageNumber)!,
          })));
        }
      }
      await tx.update(documentVersions).set({ readabilityState: "inspected" })
        .where(eq(documentVersions.id, document.documentVersionId));
    });
  }

  async markRunRunning(caseId: string, runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status }).from(processingRuns)
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "running" || run.status === "completed" || run.status === "failed") return;
      if (run.status !== "created") throw new Error(`Unsupported run status ${run.status}`);
      const startedAt = new Date();
      await tx.update(processingRuns).set({ status: "running", startedAt }).where(eq(processingRuns.id, runId));
      await tx.insert(processingRunTransitions).values({
        id: randomUUID(), runId, priorStatus: "created", newStatus: "running", reason: "job_claimed",
      });
    });
  }

  async persistOfflineDeterministic(caseId: string, runId: string, result: OfflineDeterministicResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({
        status: processingRuns.status,
        inputRevisionId: processingRuns.inputRevisionId,
        applicationSnapshotId: inputRevisions.applicationSnapshotId,
        applicationContent: applicationSnapshots.content,
      }).from(processingRuns).innerJoin(inputRevisions, eq(processingRuns.inputRevisionId, inputRevisions.id))
        .innerJoin(applicationSnapshots, eq(inputRevisions.applicationSnapshotId, applicationSnapshots.id))
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "failed" || run.status === "completed") return;
      if (run.status !== "running") throw new Error("Run must be running before deterministic result persistence");
      const [existing] = await tx.select({ id: resultRevisions.id }).from(resultRevisions).where(eq(resultRevisions.runId, runId)).limit(1);
      if (existing) {
        if (existing.id !== result.resultRevisionId) throw new Error("Run already has a different result revision");
        return;
      }
      if (result.findings.length !== 5 || result.findings.some((item) => item.inputSnapshotId !== run.inputRevisionId || item.resultRevisionId !== result.resultRevisionId)) {
        throw new Error("Offline result is not bound to this run input");
      }
      const allowedPages = await tx.select({ documentVersionId: pages.documentVersionId, pageNumber: pages.pageNumber })
        .from(pages).innerJoin(documentInspections, eq(pages.documentInspectionId, documentInspections.id))
        .where(eq(documentInspections.runId, runId));
      const allowedLogicalDocuments = await tx.select({ id: logicalDocumentRevisions.id })
        .from(logicalDocumentRevisions).where(eq(logicalDocumentRevisions.runId, runId));
      validateOfflineProvenance(
        result,
        run.applicationSnapshotId,
        run.applicationContent,
        new Set(allowedPages.map((page) => `${page.documentVersionId}:${page.pageNumber}`)),
        new Set(allowedLogicalDocuments.map((document) => document.id)),
      );

      const completedAt = new Date();
      const stages = ["inspect", "extract", "validate"];
      await tx.insert(stageExecutions).values(stages.map((stageType, sequence) => ({
        id: randomUUID(), runId, stageType, sequence: sequence + 1, status: "succeeded", completedAt,
      })));

      await tx.insert(resultRevisions).values({
        id: result.resultRevisionId, caseId, runId, inputRevisionId: run.inputRevisionId,
        revision: 1, revisionType: "machine_baseline", sealedAt: completedAt,
      });
      await tx.insert(evidenceRecords).values(result.evidence.map((item) => ({
        id: item.evidenceId, runId, evidenceType: item.evidenceType,
        applicationSnapshotId: item.applicationSnapshotId, jsonPointer: item.jsonPointer,
        documentVersionId: item.documentVersionId, pageNumber: item.pageNumber,
        pageWidth: item.pageWidth, pageHeight: item.pageHeight, pageRotation: item.pageRotation,
        normalizedRegion: item.normalizedRegion,
        originalRegion: item.originalRegion, coordinateUnit: item.coordinateUnit, coordinateOrigin: item.coordinateOrigin,
        extractionMethod: item.extractionMethod, processorVersion: item.processorVersion,
      })));
      if (result.candidates.length) {
        await tx.insert(extractionCandidates).values(result.candidates.map((item) => ({
          id: item.candidateId, runId, fieldSchemaId: item.fieldSchemaId, fieldSchemaVersion: item.fieldSchemaVersion,
          valueType: item.valueType, rawValue: item.rawValue, normalizedValue: item.normalizedValue,
          extractionMethod: item.extractionMethod, processorVersion: item.processorVersion, qualityStatus: item.qualityStatus,
          applicationSnapshotId: item.source.type === "structured_input" ? item.source.applicationSnapshotId : null,
          jsonPointer: item.source.type === "structured_input" ? item.source.jsonPointer : null,
          logicalDocumentRevisionId: item.source.type === "logical_document" ? item.source.logicalDocumentRevisionId : null,
        })));
        await tx.insert(candidateEvidenceLinks).values(result.candidates.flatMap((candidate) => candidate.evidenceIds.map((evidenceId) => ({
          id: randomUUID(), candidateId: candidate.candidateId, evidenceId, relationship: "direct_support",
        }))));
      }
      await tx.insert(claimRecords).values(result.claims.map((item) => ({
        id: item.claimId, runId, fieldSchemaId: item.fieldSchemaId, valueType: item.valueType,
        rawValue: item.rawValue, normalizedValue: item.normalizedValue,
        normalizationVersion: item.normalizationVersion,
      })));
      await tx.insert(claimEvidenceLinks).values(result.claims.flatMap((claim) => claim.evidenceIds.map((evidenceId) => ({
        id: randomUUID(), claimId: claim.claimId, evidenceId, relationship: "direct_support",
      }))));
      const claimCandidateRows = result.claims.flatMap((claim) => claim.supportingCandidateIds.map((candidateId) => ({
        id: randomUUID(), claimId: claim.claimId, candidateId, relationship: "selected_source",
      })));
      if (claimCandidateRows.length) await tx.insert(claimCandidateLinks).values(claimCandidateRows);
      if (result.reconciliations.length) {
        await tx.insert(reconciliationDecisions).values(result.reconciliations.map((item) => ({
          id: item.reconciliationId, runId, fieldSchemaId: item.fieldSchemaId, method: item.method,
          methodVersion: item.version, status: item.status, reason: item.reason,
          selectedCandidateId: item.selectedCandidateId, resultingClaimId: item.resultingClaimId,
        })));
        await tx.insert(reconciliationCandidateLinks).values(result.reconciliations.flatMap((item) => item.candidates.map((candidate) => ({
          id: randomUUID(), reconciliationId: item.reconciliationId, candidateId: candidate.candidateId, status: candidate.status,
        }))));
      }
      if (result.gaps?.length) {
        const gapIds = new Set(result.gaps.map((gap) => gap.gapId));
        await tx.insert(extractionGaps).values(result.gaps.map((gap) => ({
          id: gap.gapId, runId, fieldSchemaId: gap.fieldSchemaId, fieldSchemaVersion: gap.fieldSchemaVersion, valueType: gap.valueType,
          required: gap.required, originatingStage: gap.originatingStage, reasonCode: gap.reasonCode, attemptedPaths: gap.attemptedPaths,
          documentVersionId: gap.scope.documentVersionId, logicalDocumentRevisionId: gap.scope.logicalDocumentRevisionId, pageNumber: gap.scope.pageNumber,
        })));
        const resolutions = (result.gapResolutions ?? []).filter((resolution) => gapIds.has(resolution.gapId));
        if (resolutions.length) {
          await tx.insert(gapResolutions).values(resolutions.map((resolution) => ({
            id: randomUUID(), gapId: resolution.gapId, resolutionType: resolution.resolutionType, reference: resolution.reference,
          })));
        }
      }
      if (result.eligibility) {
        await tx.insert(agentEligibilityDecisions).values({
          id: result.eligibility.decisionId, runId, policyVersion: result.eligibility.policyVersion, gapIds: result.eligibility.gapIds,
          decision: result.eligibility.decision, reasonCodes: result.eligibility.reasonCodes,
        });
      }
      await tx.insert(validationFindings).values(result.findings.map((item) => ({
        id: randomUUID(), resultRevisionId: result.resultRevisionId,
        ruleId: item.ruleId, ruleVersion: item.ruleVersion, ruleSetId: item.ruleSetId,
        ruleSetVersion: item.ruleSetVersion, status: item.status, reasonCode: item.reasonCode,
        materialInputRefs: item.materialInputRefs,
      })));
      await tx.insert(recommendedDispositions).values({
        id: randomUUID(), resultRevisionId: result.resultRevisionId,
        policyId: "demo-document-processing-disposition", policyVersion: "1.0.0",
        disposition: result.recommendedDisposition,
        reasonCodes: result.findings.filter((item) => item.status !== "passed" && item.status !== "not_applicable").map((item) => item.reasonCode),
      });

    });
  }

  /** Durable check for an already committed reviewable result; undefined when the run has none. */
  async findOfflineReportInput(caseId: string, runId: string): Promise<OfflineReportInput | undefined> {
    try {
      return await this.loadOfflineReportInput(caseId, runId);
    } catch (error) {
      if (error instanceof CaseNotFoundError) return undefined;
      throw error;
    }
  }

  async loadOfflineReportInput(caseId: string, runId: string): Promise<OfflineReportInput> {
    const [revision] = await this.db.select({
      resultRevisionId: resultRevisions.id,
      inputRevisionId: resultRevisions.inputRevisionId,
    }).from(resultRevisions)
      .where(and(eq(resultRevisions.caseId, caseId), eq(resultRevisions.runId, runId))).limit(1);
    if (!revision) throw new CaseNotFoundError();
    const [findingRecords, dispositionRecords] = await Promise.all([
      this.db.select().from(validationFindings).where(eq(validationFindings.resultRevisionId, revision.resultRevisionId)),
      this.db.select({ disposition: recommendedDispositions.disposition }).from(recommendedDispositions)
        .where(eq(recommendedDispositions.resultRevisionId, revision.resultRevisionId)).limit(1),
    ]);
    const disposition = dispositionRecords[0]?.disposition;
    if (disposition !== "ready_for_downstream_processing" && disposition !== "additional_documents_needed" && disposition !== "human_review_required") throw new Error("Persisted disposition is invalid");
    return {
      resultRevisionId: revision.resultRevisionId,
      findings: findingRecords.map((item) => ({
        ruleId: item.ruleId, ruleVersion: item.ruleVersion, ruleSetId: item.ruleSetId,
        ruleSetVersion: item.ruleSetVersion, inputSnapshotId: revision.inputRevisionId,
        resultRevisionId: revision.resultRevisionId, status: item.status, reasonCode: item.reasonCode,
        materialInputRefs: item.materialInputRefs as string[],
      })),
      recommendedDisposition: disposition,
    };
  }

  async completeOfflineReport(caseId: string, runId: string, resultRevisionId: string, report: OfflineReportResult): Promise<void> {
    const checkedFacts = await buildCheckedFactsFromDatabase(this.db, caseId, runId, resultRevisionId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status }).from(processingRuns)
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "completed" || run.status === "failed") return;
      if (run.status !== "running") throw new Error("Run must be running before report completion");
      const [revision] = await tx.select({ id: resultRevisions.id }).from(resultRevisions)
        .where(and(eq(resultRevisions.id, resultRevisionId), eq(resultRevisions.runId, runId))).limit(1);
      if (!revision) throw new Error("Agent report is not bound to a persisted result revision");
      const issues = report.issues.map((issue) => ({
        id: randomUUID(), caseId, runId, origin: issue.origin, code: issue.code,
        description: issue.description, recommendedAction: issue.recommendedAction, reviewState: "pending",
      }));
      if (issues.length > 0) await tx.insert(reviewIssues).values(issues);
      const session = report.session;
      if (session) await insertAgentSession(tx, caseId, runId, resultRevisionId, session);
      await tx.insert(agentReports).values({
        id: randomUUID(), caseId, runId, resultRevisionId, sessionId: session?.sessionId ?? null,
        availability: report.reportAvailability,
        verificationStatus: report.reportAvailability === "ready" ? "verified" : "rejected",
        verificationFailureReason: report.reportFailureReason, summary: report.summary,
        issueLinks: issues.map((issue) => issue.id),
        checkedFacts,
        originalSubmission: report.originalSubmission === undefined ? null : report.originalSubmission,
        modelLabel: report.modelLabel, estimatedCost: report.estimatedCost ?? null,
      });
      const completedAt = new Date();
      const [{ value: stageCount } = { value: 0 }] = await tx.select({ value: count() }).from(stageExecutions).where(eq(stageExecutions.runId, runId));
      await tx.insert(stageExecutions).values({
        id: randomUUID(), runId, stageType: "agent_report", sequence: Number(stageCount) + 1, status: "succeeded", completedAt,
      });
      await tx.update(processingRuns).set({ status: "completed", completedAt }).where(eq(processingRuns.id, runId));
      await tx.insert(processingRunTransitions).values({
        id: randomUUID(), runId, priorStatus: "running", newStatus: "completed", reason: "report_terminal",
      });
      await tx.update(cases).set({ lifecycle: "ready_for_review", version: sql`${cases.version} + 1` })
        .where(eq(cases.id, caseId));
      await tx.insert(caseStateTransitions).values({
        id: randomUUID(), caseId, runId, priorState: "processing",
        newState: "ready_for_review", reason: "offline_result_ready", actor: "workflow_coordinator",
      });
    });
  }

  async failRun(caseId: string, runId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status }).from(processingRuns)
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "failed" || run.status === "completed") return;
      if (run.status !== "created" && run.status !== "running") throw new Error(`Unsupported run status ${run.status}`);
      const completedAt = new Date();
      await tx.update(processingRuns).set({ status: "failed", completedAt })
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId)));
      await tx.insert(processingRunTransitions).values({
        id: randomUUID(), runId, priorStatus: run.status, newStatus: "failed", reason,
      });
      await tx.update(cases).set({ lifecycle: "processing_exception", version: sql`${cases.version} + 1` })
        .where(and(eq(cases.id, caseId), eq(cases.lifecycle, "processing")));
      await tx.insert(caseStateTransitions).values({
        id: randomUUID(), caseId, runId, priorState: "processing",
        newState: "processing_exception", reason, actor: "workflow_coordinator",
      });
    });
  }
}

function validNormalizedRegion(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  const numbers = [region["x"], region["y"], region["width"], region["height"]];
  return numbers.every((item) => typeof item === "number" && Number.isFinite(item))
    && (region["x"] as number) >= 0 && (region["y"] as number) >= 0
    && (region["width"] as number) > 0 && (region["height"] as number) > 0
    && (region["x"] as number) + (region["width"] as number) <= 1
    && (region["y"] as number) + (region["height"] as number) <= 1;
}

function validOriginalRegion(value: unknown): value is { left: number; top: number; width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return [region["left"], region["top"], region["width"], region["height"]]
    .every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && (region["width"] as number) > 0 && (region["height"] as number) > 0;
}

function validateOfflineProvenance(
  result: OfflineDeterministicResult,
  applicationSnapshotId: string,
  applicationContent: unknown,
  allowedPages: ReadonlySet<string>,
  allowedLogicalDocuments: ReadonlySet<string>,
): void {
  const evidenceIds = new Set(result.evidence.map((item) => item.evidenceId));
  const claimIds = new Set(result.claims.map((item) => item.claimId));
  if (evidenceIds.size !== result.evidence.length || claimIds.size !== result.claims.length) throw new Error("Duplicate offline provenance identity");
  for (const evidence of result.evidence) {
    const structured = evidence.evidenceType === "structured_input" && evidence.applicationSnapshotId && evidence.jsonPointer && !evidence.documentVersionId && evidence.pageNumber === undefined;
    const page = evidence.evidenceType === "page_level" && evidence.documentVersionId && evidence.pageNumber !== undefined && !evidence.applicationSnapshotId && !evidence.jsonPointer;
    const region = evidence.evidenceType === "page_region" && evidence.documentVersionId && evidence.pageNumber !== undefined
      && evidence.pageWidth && evidence.pageHeight && evidence.pageRotation !== undefined && validNormalizedRegion(evidence.normalizedRegion)
      && validOriginalRegion(evidence.originalRegion) && evidence.coordinateUnit === "render_pixel" && evidence.coordinateOrigin === "top_left"
      && !evidence.applicationSnapshotId && !evidence.jsonPointer;
    if (!structured && !page && !region) throw new Error("Offline evidence subtype is invalid");
    if (structured && evidence.applicationSnapshotId !== applicationSnapshotId) throw new Error("Offline structured evidence is outside the run input");
    if (structured && !jsonPointerExists(applicationContent, evidence.jsonPointer!)) throw new Error("Offline structured evidence pointer is invalid");
    if ((page || region) && !allowedPages.has(`${evidence.documentVersionId}:${evidence.pageNumber}`)) throw new Error("Offline page evidence is outside the run input");
  }
  if (result.claims.some((claim) => claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !evidenceIds.has(id)))) throw new Error("Offline claim evidence is invalid");
  const candidateIds = new Set(result.candidates.map((item) => item.candidateId));
  if (candidateIds.size !== result.candidates.length) throw new Error("Duplicate extraction candidate identity");
  for (const candidate of result.candidates) {
    if (candidate.evidenceIds.length === 0 || candidate.evidenceIds.some((id) => !evidenceIds.has(id))) throw new Error("Extraction candidate evidence is invalid");
    if (candidate.source.type === "structured_input") {
      if (candidate.source.applicationSnapshotId !== applicationSnapshotId || !jsonPointerExists(applicationContent, candidate.source.jsonPointer)) {
        throw new Error("Structured-input candidate is outside the run input");
      }
    } else if (!allowedLogicalDocuments.has(candidate.source.logicalDocumentRevisionId)) {
      throw new Error("Document candidate is outside the run logical documents");
    }
  }
  if (result.claims.some((claim) => claim.supportingCandidateIds.length === 0 || claim.supportingCandidateIds.some((id) => !candidateIds.has(id)))) throw new Error("Claim candidate lineage is invalid");
  const reconciliationIds = new Set(result.reconciliations.map((item) => item.reconciliationId));
  if (reconciliationIds.size !== result.reconciliations.length) throw new Error("Duplicate reconciliation identity");
  const consideredCandidateIds = new Set<string>();
  const reconciledClaimIds = new Set<string>();
  for (const reconciliation of result.reconciliations) {
    if (reconciliation.candidates.length === 0 || reconciliation.candidates.some((item) => !candidateIds.has(item.candidateId))) throw new Error("Reconciliation candidate lineage is invalid");
    for (const item of reconciliation.candidates) consideredCandidateIds.add(item.candidateId);
    const selectedLinks = reconciliation.candidates.filter((item) => item.status === "selected");
    if (reconciliation.status === "selected") {
      if (!reconciliation.selectedCandidateId || selectedLinks.length !== 1 || selectedLinks[0]?.candidateId !== reconciliation.selectedCandidateId) throw new Error("Reconciliation selection is invalid");
      if (!reconciliation.resultingClaimId || !claimIds.has(reconciliation.resultingClaimId)) throw new Error("Reconciliation claim lineage is invalid");
      const claim = result.claims.find((item) => item.claimId === reconciliation.resultingClaimId)!;
      if (!claim.supportingCandidateIds.includes(reconciliation.selectedCandidateId)) throw new Error("Selected candidate does not support the resulting claim");
      reconciledClaimIds.add(reconciliation.resultingClaimId);
    } else if (reconciliation.selectedCandidateId || reconciliation.resultingClaimId || selectedLinks.length > 0) {
      throw new Error("Unresolved reconciliation cannot select a candidate or produce a claim");
    }
  }
  if (consideredCandidateIds.size !== candidateIds.size || [...candidateIds].some((id) => !consideredCandidateIds.has(id))) throw new Error("Every candidate must be considered by reconciliation");
  if (reconciledClaimIds.size !== claimIds.size || [...claimIds].some((id) => !reconciledClaimIds.has(id))) throw new Error("Every claim must result from reconciliation");
  if (result.findings.some((item) => item.materialInputRefs.length === 0 || item.materialInputRefs.some((id) => !evidenceIds.has(id) && !claimIds.has(id)))) {
    throw new Error("Offline finding reference is invalid");
  }
}

type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

const REUSED_WORK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  run_ocr: "Reused the previously extracted page result after processing resumed",
  get_native_text: "Reused the previously extracted page text after processing resumed",
  extract_with_vlm: "Reused the previously extracted field value after processing resumed",
  inspect_page: "Reused the previously inspected page after processing resumed",
});

/**
 * Reviewer-readable activity for one committed step. Work reused from an earlier attempt says so
 * plainly; a repeat inside the same attempt keeps its own wording.
 */
function reviewerActivity(
  step: typeof agentSteps.$inferSelect,
  originatingAttempt: ReadonlyMap<string, string | null>,
): string {
  if (!step.reusedInvocationId) return reviewerStepSummary(step);
  const origin = originatingAttempt.get(step.reusedInvocationId);
  if (origin && step.attemptId && origin === step.attemptId) return step.summary;
  return REUSED_WORK_LABELS[step.toolName] ?? "Reused previously saved work after processing resumed";
}

/** Tools the Agent itself called to look at document content, as opposed to system preprocessing. */
const AGENT_DOCUMENT_TOOLS: ReadonlySet<string> = new Set([
  "inspect_page", "get_native_text", "run_ocr", "render_page_region", "classify_page",
  "detect_document_boundaries", "extract_local_table", "extract_with_vlm",
]);

function reviewerStepSummary(step: typeof agentSteps.$inferSelect): string {
  const page = /page (\d+)/iu.exec(step.summary)?.[1];
  const onPage = (activity: string): string => page ? `${activity} on page ${page}` : activity;
  if (step.toolName === "get_case_manifest") return "Read case details";
  if (step.toolName === "inspect_page") return page ? `Inspected page ${page}` : "Inspected page";
  if (step.toolName === "get_native_text") return onPage("Read text");
  if (step.toolName === "run_ocr") return onPage("Read scanned text");
  if (step.toolName === "render_page_region") return onPage("Viewed document");
  if (step.toolName === "classify_page") return page ? `Classified page ${page}` : "Classified page";
  if (step.toolName === "detect_document_boundaries") return "Checked document boundaries";
  if (step.toolName === "extract_local_table") return onPage("Checked tables");
  if (step.toolName === "extract_with_vlm") return onPage("Read with visual model");
  if (step.toolName === "submit_extraction_candidates") {
    const count = /(?:Proposed|Submitted) (\d+)/u.exec(step.summary)?.[1];
    return count ? `Submitted ${count} extracted values` : "Submitted extracted values";
  }
  if (step.toolName === "request_reconciliation" && step.summary.startsWith("Sent 0 Agent-proposed values")) {
    return "No document value could be extracted for reconciliation";
  }
  if (step.toolName === "request_reconciliation") return "Checked extracted values";
  if (step.toolName === "request_validation") {
    const attention = /; (\d+) findings? requires? attention$/u.exec(step.summary)?.[1];
    if (attention === "0") return "Validation checks found no issues";
    if (attention) return `Validation checks found ${attention} ${attention === "1" ? "issue" : "issues"}`;
    return "Ran validation checks";
  }
  if (step.toolName === "get_current_result") return "Reviewed case results";
  if (step.toolName === "list_findings") return "Reviewed validation findings";
  if (step.toolName === "submit_case_review_brief") return "Prepared Agent report";
  return step.summary;
}

/**
 * Durable Agent session and step records (DAT-REQ-131, DAT-REQ-132) for harnesses that do not
 * persist incrementally. A session already committed by the durable lifecycle is only linked.
 */
async function insertAgentSession(tx: Transaction, caseId: string, runId: string, resultRevisionId: string | null, session: AgentSessionTrace): Promise<void> {
  const [existing] = await tx.select({ id: agentSessions.id }).from(agentSessions).where(eq(agentSessions.id, session.sessionId)).limit(1);
  if (existing) {
    await tx.update(agentSessions)
      .set({ resultRevisionId, estimatedCost: session.estimatedCost?.amount ?? null, boundGapIds: session.boundGapIds ?? null })
      .where(eq(agentSessions.id, session.sessionId));
    return;
  }
  await tx.insert(agentSessions).values({
    id: session.sessionId, caseId, runId, resultRevisionId, mode: session.mode,
    harnessId: session.harnessId, harnessVersion: session.harnessVersion,
    modelLabel: session.modelLabel, modelRoute: session.modelRoute,
    promptVersion: session.promptVersion, promptHash: session.promptHash,
    configurationVersion: session.configurationVersion, toolRegistryVersion: session.toolRegistryVersion,
    offeredTools: session.offeredTools, budget: session.budget,
    iterations: session.iterations, toolCalls: session.toolCalls, usage: session.usage,
    estimatedCost: session.estimatedCost?.amount ?? null, terminalReason: session.terminalReason,
    boundGapIds: session.boundGapIds ?? null, submittedCandidateIds: session.submittedCandidateIds ?? null,
    startedAt: new Date(session.startedAt), completedAt: new Date(session.completedAt),
  });
  if (session.steps.length > 0) {
    await tx.insert(agentSteps).values(session.steps.map((step) => ({
      id: randomUUID(), sessionId: session.sessionId, sequence: step.sequence,
      phase: step.phase ?? "planning",
      toolName: step.toolName, toolVersion: step.toolVersion ?? null, argumentHash: step.argumentHash,
      outcome: step.outcome, summary: step.summary, budgetState: step.budgetState,
      startedAt: new Date(step.startedAt), completedAt: new Date(step.completedAt),
    })));
  }
}

async function buildCheckedFactsFromDatabase(
  db: ReturnType<typeof drizzle>,
  caseId: string,
  runId: string,
  resultRevisionId: string,
): Promise<AgentReportView["checkedFacts"]> {
  const statements: Readonly<Record<string, string>> = {
    VAL_DOC_COMPLETENESS_001: "All required document types are present and usable.",
    VAL_NAME_CONSISTENCY_001: "The applicant name is consistent across the available documents.",
    VAL_EMPLOYER_CONSISTENCY_001: "The employer information is consistent across the available sources.",
    VAL_INCOME_CONSISTENCY_001: "The comparable monthly income values are consistent.",
    VAL_ID_EXPIRY_001: "The identity document expiry date is on or after the review reference date.",
  };
  const [findings, evidence, links] = await Promise.all([
    db.select({ ruleId: validationFindings.ruleId, status: validationFindings.status, materialInputRefs: validationFindings.materialInputRefs })
      .from(validationFindings).where(eq(validationFindings.resultRevisionId, resultRevisionId)),
    db.select({ evidenceId: evidenceRecords.id }).from(evidenceRecords).where(eq(evidenceRecords.runId, runId)),
    db.select({ claimId: claimEvidenceLinks.claimId, evidenceId: claimEvidenceLinks.evidenceId })
      .from(claimEvidenceLinks).innerJoin(claimRecords, eq(claimEvidenceLinks.claimId, claimRecords.id))
      .where(eq(claimRecords.runId, runId)),
  ]);
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const evidenceByClaim = new Map<string, string[]>();
  for (const link of links) evidenceByClaim.set(link.claimId, [...(evidenceByClaim.get(link.claimId) ?? []), link.evidenceId]);
  return findings.filter((finding) => finding.status === "passed").map((finding) => {
    const referencedEvidence = new Set<string>();
    for (const reference of finding.materialInputRefs as string[]) {
      if (evidenceIds.has(reference)) referencedEvidence.add(reference);
      for (const evidenceId of evidenceByClaim.get(reference) ?? []) referencedEvidence.add(evidenceId);
    }
    if (referencedEvidence.size === 0) throw new Error(`Passed finding ${finding.ruleId} has no evidence`);
    const statement = statements[finding.ruleId];
    if (!statement) throw new Error(`No checked-fact display registered for ${finding.ruleId}`);
    return {
      ruleId: finding.ruleId,
      statement, sourceType: "deterministic_check" as const, status: "passed" as const,
      references: [...referencedEvidence].sort().map((evidenceId) => `/api/v1/cases/${caseId}/evidence/${evidenceId}`),
    };
  });
}

function asFindingStatus(value: string): FindingView["status"] {
  if (value === "passed" || value === "warning" || value === "failed" || value === "inconclusive" || value === "not_applicable") return value;
  throw new Error(`Unsupported persisted finding status: ${value}`);
}

function jsonPointerExists(value: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/")) return false;
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function projectApplicationData(content: Readonly<Record<string, unknown>>, createdAt: Date): ApplicationDataView {
  const field = (key: string, path: readonly string[], transform: (value: string) => string = (value) => value) => {
    const value = nestedString(content, path);
    return value === undefined ? undefined : { key, displayValue: transform(value), jsonPointer: `/${path.join("/")}` };
  };
  const compact = <T>(items: readonly (T | undefined)[]): T[] => items.filter((item): item is T => item !== undefined);
  const groups: ApplicationDataView["groups"] = [
    { group: "applicant", fields: compact([
      field("display_name", ["applicant_display_name"]), field("birth_date", ["birth_date"]),
      field("location", ["location"]), field("preferred_language", ["preferred_language"]),
    ]) },
    { group: "contact", fields: compact([
      field("email", ["contact", "email"], maskEmail), field("phone", ["contact", "phone"], maskPhone),
    ]) },
    { group: "employment", fields: compact([
      field("employer", ["employment", "employer"]), field("employment_type", ["employment", "type"]),
      field("started_on", ["employment", "started_on"]),
    ]) },
    { group: "income", fields: compact([
      field("monthly_net", ["income", "monthly_net"]), field("currency", ["income", "currency"]),
      field("basis", ["income", "basis"]),
    ]) },
  ];
  const created = createdAt.toISOString();
  return {
    groups,
    submissionHistory: {
      initialSubmittedAt: isoTimestamp(content["initial_submitted_at"]) ?? created,
      latestSubmittedAt: isoTimestamp(content["latest_submitted_at"]) ?? created,
      applicationDataUpdatedAt: isoTimestamp(content["application_data_updated_at"]) ?? created,
    },
  };
}

function nestedString(value: Readonly<Record<string, unknown>>, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const part of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function maskEmail(value: string): string {
  const separator = value.indexOf("@");
  if (separator <= 0 || separator === value.length - 1) return "Unavailable";
  return `${value[0]}***${value.slice(separator)}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 2 ? `•••• ${digits.slice(-2)}` : "Unavailable";
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export interface StoredDocumentReference {
  readonly documentVersionId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly mediaType: string;
}

export interface InspectionRecord {
  readonly processor: string;
  readonly processorVersion: string;
  readonly pdfType: string;
  readonly routingSignal: number;
  readonly isComplex: boolean;
  readonly pages: readonly {
    pageNumber: number;
    needsOcr: boolean;
    ocrReason?: string;
    hasTable: boolean;
    hasColumns: boolean;
    nativeCharacterCount: number;
    nativeTextArtifact?: StoredDerivedArtifact & { readonly caseId: string };
    renderArtifact?: StoredPageRenderArtifact & { readonly caseId: string };
    ocrArtifact?: StoredOcrArtifact & { readonly caseId: string; readonly coordinateSpace: "render_pixels_top_left" };
  }[];
  readonly classifications?: readonly {
    readonly pageNumber: number; readonly selectedType: "identity_document" | "payslip" | "bank_statement" | "other" | "unknown";
    readonly method: string; readonly version: string; readonly qualityStatus: "accepted" | "uncertain";
    readonly rawConfidence: { readonly value: number; readonly scale: "zero_to_one"; readonly producer: string };
    readonly alternatives: readonly { readonly type: "identity_document" | "payslip" | "bank_statement" | "other" | "unknown"; readonly value: number }[];
  }[];
  readonly boundaries?: readonly {
    readonly pageNumber: number; readonly startsNewDocument: boolean; readonly method: string; readonly version: string;
    readonly rawConfidence: { readonly value: number; readonly scale: "zero_to_one"; readonly producer: string };
  }[];
  readonly logicalDocuments?: readonly {
    readonly startPage: number; readonly endPage: number;
    readonly documentType: "identity_document" | "payslip" | "bank_statement" | "other" | "unknown";
    readonly uncertain: boolean; readonly pageNumbers: readonly number[];
  }[];
}

export * from "./schema.js";

// ---------------------------------------------------------------------------
// Durable Agent session lifecycle (AGT-REQ-072 to AGT-REQ-079)
// ---------------------------------------------------------------------------

const COST_MICRO_SCALE = 1_000_000;
type SessionRow = typeof agentSessions.$inferSelect;

function configurationOf(session: SessionRow): AgentSessionConfiguration {
  return {
    mode: session.mode as AgentSessionMode,
    harnessId: session.harnessId, harnessVersion: session.harnessVersion,
    modelLabel: session.modelLabel, modelRoute: session.modelRoute === "live" ? "live" : "fake",
    promptVersion: session.promptVersion, promptHash: session.promptHash,
    configurationVersion: session.configurationVersion, toolRegistryVersion: session.toolRegistryVersion,
    contextManifestVersion: session.contextManifestVersion ?? "unversioned",
    offeredTools: session.offeredTools as string[],
    budget: session.budget as AgentSessionConfiguration["budget"],
  };
}

function consumedOf(session: SessionRow): AgentConsumedBudget {
  return {
    iterations: session.iterations, toolCalls: session.toolCalls, modelCalls: session.modelCalls,
    vlmCalls: session.vlmCalls, ocrPages: session.ocrPages,
    inputTokens: session.inputTokens, outputTokens: session.outputTokens,
    costUsd: session.costMicroUsd / COST_MICRO_SCALE, usageAvailable: session.usageAvailable,
  };
}

function budgetIncrements(delta: Partial<AgentConsumedBudget>) {
  return {
    iterations: sql`${agentSessions.iterations} + ${delta.iterations ?? 0}`,
    toolCalls: sql`${agentSessions.toolCalls} + ${delta.toolCalls ?? 0}`,
    modelCalls: sql`${agentSessions.modelCalls} + ${delta.modelCalls ?? 0}`,
    vlmCalls: sql`${agentSessions.vlmCalls} + ${delta.vlmCalls ?? 0}`,
    ocrPages: sql`${agentSessions.ocrPages} + ${delta.ocrPages ?? 0}`,
    inputTokens: sql`${agentSessions.inputTokens} + ${delta.inputTokens ?? 0}`,
    outputTokens: sql`${agentSessions.outputTokens} + ${delta.outputTokens ?? 0}`,
    costMicroUsd: sql`${agentSessions.costMicroUsd} + ${Math.round((delta.costUsd ?? 0) * COST_MICRO_SCALE)}`,
    ...(delta.usageAvailable === false ? { usageAvailable: false } : {}),
  };
}

function stepTraceOf(step: typeof agentSteps.$inferSelect): AgentStepTrace {
  return {
    sequence: step.sequence, phase: step.phase as AgentStepPhase, toolName: step.toolName,
    ...(step.toolVersion ? { toolVersion: step.toolVersion } : {}),
    argumentHash: step.argumentHash, outcome: step.outcome as AgentStepOutcome, summary: step.summary,
    startedAt: step.startedAt.toISOString(), completedAt: step.completedAt.toISOString(),
    budgetState: step.budgetState as AgentStepTrace["budgetState"],
  };
}

function committedResultOf(invocation: typeof agentToolInvocations.$inferSelect): AgentCommittedToolResult {
  return {
    invocationId: invocation.id, idempotencyKey: invocation.idempotencyKey,
    toolName: invocation.toolName, toolVersion: invocation.toolVersion,
    outcome: invocation.outcome as AgentStepOutcome,
    outputSchemaVersion: invocation.outputSchemaVersion, outputHash: invocation.outputHash,
    ...(invocation.safeOutput === null ? {} : { safeOutput: invocation.safeOutput }),
    producedReferences: invocation.producedReferences as AgentProducedReference[],
    authorizedInputVersions: invocation.authorizedInputVersions as Record<string, string>,
    terminatesSession: invocation.terminatesSession,
  };
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function invocationRowMatches(
  row: typeof agentToolInvocations.$inferSelect,
  input: CommitAgentStepInput,
): boolean {
  const invocation = input.invocation;
  return invocation !== undefined
    && row.toolName === input.toolName
    && row.toolVersion === (input.toolVersion ?? "unknown")
    && row.outcome === input.outcome
    && row.outputSchemaVersion === invocation.outputSchemaVersion
    && row.outputHash === invocation.outputHash
    && sameCanonicalValue(row.authorizedInputVersions, invocation.authorizedInputVersions)
    && sameCanonicalValue(row.producedReferences, invocation.producedReferences)
    && row.terminatesSession === invocation.terminatesSession;
}

async function snapshotOf(tx: Transaction | ReturnType<typeof drizzle>, session: SessionRow): Promise<AgentRecoverySnapshot> {
  const [steps, invocations, attempts] = await Promise.all([
    tx.select().from(agentSteps).where(eq(agentSteps.sessionId, session.id)).orderBy(asc(agentSteps.sequence)),
    tx.select().from(agentToolInvocations).where(eq(agentToolInvocations.sessionId, session.id)).orderBy(asc(agentToolInvocations.startedAt)),
    tx.select({ value: count() }).from(agentSessionAttempts).where(eq(agentSessionAttempts.sessionId, session.id)),
  ]);
  return {
    sessionId: session.id, caseId: session.caseId, runId: session.runId,
    status: session.terminalReason ? "terminal" : "running",
    ...(session.terminalReason ? { terminalReason: session.terminalReason as AgentTerminalReason } : {}),
    configuration: configurationOf(session), consumed: consumedOf(session),
    attempts: Number(attempts[0]?.value ?? 0), lastSequence: steps.at(-1)?.sequence ?? 0,
    steps: steps.map(stepTraceOf), committedToolResults: invocations.map(committedResultOf),
    startedAt: session.startedAt.toISOString(),
  };
}

/**
 * PostgreSQL owner of Agent session identity, attempts, steps, tool invocation results, and
 * cumulative budgets. Duplicate delivery resolves through database uniqueness and a run-scoped
 * advisory lock rather than process-local state (AGT-REQ-079, DAT-REQ-199).
 */
export class PostgresAgentSessionLifecycle implements AgentSessionLifecyclePort {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async beginSession(input: BeginAgentSessionInput): Promise<AgentSessionStart> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.runId}, 1))`);
      const [found] = await tx.select().from(agentSessions)
        .where(and(eq(agentSessions.runId, input.runId), eq(agentSessions.mode, input.configuration.mode))).limit(1);
      let session = found;
      if (session) {
        const compatibility = evaluateAgentSessionCompatibility(configurationOf(session), input.configuration);
        if (!compatibility.compatible) throw new AgentSessionIncompatibleError(compatibility.reasonCodes);
        if (session.terminalReason) throw new AgentSessionTerminalError(session.terminalReason as AgentTerminalReason);
      } else {
        const configuration = input.configuration;
        const [created] = await tx.insert(agentSessions).values({
          id: randomUUID(), caseId: input.caseId, runId: input.runId, resultRevisionId: null,
          mode: configuration.mode, harnessId: configuration.harnessId, harnessVersion: configuration.harnessVersion,
          modelLabel: configuration.modelLabel, modelRoute: configuration.modelRoute,
          promptVersion: configuration.promptVersion, promptHash: configuration.promptHash,
          configurationVersion: configuration.configurationVersion, toolRegistryVersion: configuration.toolRegistryVersion,
          contextManifestVersion: configuration.contextManifestVersion,
          offeredTools: configuration.offeredTools, budget: configuration.budget,
          iterations: 0, toolCalls: 0, usage: { available: true, modelCalls: 0, inputTokens: 0, outputTokens: 0 },
          terminalReason: null, startedAt: new Date(input.startedAt), completedAt: null,
        }).returning();
        if (!created) throw new Error("Agent session could not be created");
        session = created;
      }
      const snapshot = await snapshotOf(tx, session);
      const attemptNumber = snapshot.attempts + 1;
      const startReason: AgentAttemptStartReason = attemptNumber === 1 ? "initial" : "recovery";
      await tx.update(agentSessionAttempts)
        .set({ status: "abandoned", completedAt: new Date(input.startedAt) })
        .where(and(eq(agentSessionAttempts.sessionId, session.id), eq(agentSessionAttempts.status, "running")));
      const attemptId = randomUUID();
      await tx.insert(agentSessionAttempts).values({
        id: attemptId, sessionId: session.id, attemptNumber, startReason, status: "running",
        startedAt: new Date(input.startedAt), completedAt: null, terminalReason: null,
      });
      await tx.update(agentSessions).set({ currentAttempt: attemptNumber }).where(eq(agentSessions.id, session.id));
      return { sessionId: session.id, attemptId, attemptNumber, startReason, resumed: attemptNumber > 1, snapshot };
    });
  }

  async commitStep(input: CommitAgentStepInput): Promise<CommitAgentStepResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.sessionId}, 2))`);
      const [session] = await tx.select().from(agentSessions).where(eq(agentSessions.id, input.sessionId)).limit(1);
      if (!session) throw new CaseNotFoundError();
      if (session.terminalReason) throw new AgentSessionTerminalError(session.terminalReason as AgentTerminalReason);
      const [attempt] = await tx.select().from(agentSessionAttempts)
        .where(and(eq(agentSessionAttempts.id, input.attemptId), eq(agentSessionAttempts.sessionId, input.sessionId))).limit(1);
      if (!attempt || attempt.status !== "running" || attempt.attemptNumber !== session.currentAttempt) {
        throw new AgentAttemptSupersededError(input.sessionId, input.attemptId);
      }
      const [existing] = await tx.select().from(agentSteps)
        .where(and(eq(agentSteps.sessionId, input.sessionId), eq(agentSteps.sequence, input.sequence))).limit(1);
      if (existing) {
        if (existing.toolName !== input.toolName || existing.toolVersion !== (input.toolVersion ?? null)
          || existing.argumentHash !== input.argumentHash || existing.outcome !== input.outcome) {
          throw new AgentStepConflictError(input.sessionId, input.sequence);
        }
        if (input.invocation) {
          const [committed] = existing.toolInvocationId
            ? await tx.select().from(agentToolInvocations).where(eq(agentToolInvocations.id, existing.toolInvocationId)).limit(1)
            : [];
          if (!committed || !invocationRowMatches(committed, input)) {
            throw new AgentInvocationConflictError(input.sessionId, input.invocation.idempotencyKey);
          }
        }
        return {
          stepId: existing.id, sequence: existing.sequence,
          ...(existing.toolInvocationId ? { invocationId: existing.toolInvocationId } : {}),
          alreadyCommitted: true, consumed: consumedOf(session),
        };
      }
      let invocationId = input.reusedInvocationId;
      if (input.reusedInvocationId) {
        const [reused] = await tx.select().from(agentToolInvocations)
          .where(and(eq(agentToolInvocations.id, input.reusedInvocationId), eq(agentToolInvocations.sessionId, input.sessionId))).limit(1);
        if (!reused || reused.toolName !== input.toolName || reused.toolVersion !== (input.toolVersion ?? "unknown")) {
          throw new AgentInvocationConflictError(input.sessionId, input.reusedInvocationId);
        }
      }
      if (input.invocation) {
        const [committed] = await tx.select().from(agentToolInvocations)
          .where(and(eq(agentToolInvocations.sessionId, input.sessionId), eq(agentToolInvocations.idempotencyKey, input.invocation.idempotencyKey))).limit(1);
        if (committed) {
          if (!invocationRowMatches(committed, input)) {
            throw new AgentInvocationConflictError(input.sessionId, input.invocation.idempotencyKey);
          }
          invocationId = committed.id;
        }
        else {
          invocationId = randomUUID();
          await tx.insert(agentToolInvocations).values({
            id: invocationId, sessionId: input.sessionId, idempotencyKey: input.invocation.idempotencyKey,
            toolName: input.toolName, toolVersion: input.toolVersion ?? "unknown", outcome: input.outcome,
            outputSchemaVersion: input.invocation.outputSchemaVersion, outputHash: input.invocation.outputHash,
            safeOutput: input.invocation.safeOutput === undefined ? null : input.invocation.safeOutput,
            producedReferences: input.invocation.producedReferences,
            authorizedInputVersions: input.invocation.authorizedInputVersions,
            terminatesSession: input.invocation.terminatesSession,
            startedAt: new Date(input.startedAt), completedAt: new Date(input.completedAt),
          });
        }
      }
      const stepId = randomUUID();
      await tx.insert(agentSteps).values({
        id: stepId, sessionId: input.sessionId, attemptId: input.attemptId, sequence: input.sequence,
        phase: input.phase, toolName: input.toolName, toolVersion: input.toolVersion ?? null,
        argumentHash: input.argumentHash, outcome: input.outcome, summary: input.summary,
        budgetState: input.budgetState, toolInvocationId: invocationId ?? null,
        reusedInvocationId: input.reusedInvocationId ?? null,
        integrityCheck: input.integrityCheck ?? null,
        producedReferences: input.invocation?.producedReferences ?? [],
        startedAt: new Date(input.startedAt), completedAt: new Date(input.completedAt),
      });
      const [updated] = await tx.update(agentSessions).set(budgetIncrements(input.budgetDelta))
        .where(eq(agentSessions.id, input.sessionId)).returning();
      if (!updated) throw new Error("Agent session budget could not be updated");
      return {
        stepId, sequence: input.sequence, ...(invocationId ? { invocationId } : {}),
        alreadyCommitted: false, consumed: consumedOf(updated),
      };
    });
  }

  async terminalizeSession(input: TerminalizeAgentSessionInput): Promise<AgentSessionTerminalResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.sessionId}, 2))`);
      const [session] = await tx.select().from(agentSessions).where(eq(agentSessions.id, input.sessionId)).limit(1);
      if (!session) throw new CaseNotFoundError();
      if (session.terminalReason) {
        return { applied: false, terminalReason: session.terminalReason as AgentTerminalReason, consumed: consumedOf(session) };
      }
      const [attempt] = await tx.select().from(agentSessionAttempts)
        .where(and(eq(agentSessionAttempts.id, input.attemptId), eq(agentSessionAttempts.sessionId, input.sessionId))).limit(1);
      if (!attempt || attempt.status !== "running" || attempt.attemptNumber !== session.currentAttempt) {
        throw new AgentAttemptSupersededError(input.sessionId, input.attemptId);
      }
      await tx.update(agentSessionAttempts)
        .set({ status: "terminal", terminalReason: input.terminalReason, completedAt: new Date(input.completedAt) })
        .where(eq(agentSessionAttempts.id, input.attemptId));
      const consumed = addConsumedBudget(consumedOf(session), input.budgetDelta);
      const [updated] = await tx.update(agentSessions).set({
        ...budgetIncrements(input.budgetDelta),
        terminalReason: input.terminalReason, completedAt: new Date(input.completedAt),
        offeredTools: input.offeredTools,
        usage: { available: consumed.usageAvailable, modelCalls: consumed.modelCalls, inputTokens: consumed.inputTokens, outputTokens: consumed.outputTokens },
      }).where(eq(agentSessions.id, input.sessionId)).returning();
      if (!updated) throw new Error("Agent session could not be terminalized");
      return { applied: true, terminalReason: input.terminalReason, consumed: consumedOf(updated) };
    });
  }

  async loadSnapshot(runId: string): Promise<AgentRecoverySnapshot | undefined> {
    const [session] = await this.db.select().from(agentSessions)
      .where(eq(agentSessions.runId, runId)).orderBy(asc(agentSessions.createdAt)).limit(1);
    return session ? snapshotOf(this.db, session) : undefined;
  }
}
