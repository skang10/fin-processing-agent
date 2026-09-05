import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CaseNotFoundError, IdempotencyConflictError, type AcceptedCase, type AgentReportView, type ApplicationDataView, type CaseCommandService, type CaseIntakeCommand, type CaseQueryService, type CaseReviewQueryService, type CaseStatus, type DocumentPageView, type DocumentView, type EvidenceView, type FindingView, type OfflineDeterministicResult, type OfflineReportInput, type OfflineReportResult, type ReviewIssueView } from "@findoc/core";
import { agentReports, applicationSnapshots, artifacts, cases, caseStateTransitions, claimEvidenceLinks, claimRecords, documentInspections, documentVersions, evidenceRecords, idempotencyRecords, inputDocumentSelections, inputRevisions, outboxEvents, pages, physicalDocuments, processingRuns, processingRunTransitions, recommendedDispositions, resultRevisions, reviewIssues, stageExecutions, validationFindings } from "./schema.js";

const COMMAND_TYPE = "create_case";
const WORKFLOW_VERSION = "case-processing-v1";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return { client, db: drizzle(client) };
}

export class PostgresCaseCommandService implements CaseCommandService {
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
        workflowVersion: WORKFLOW_VERSION,
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
}

export class PostgresCaseQueryService implements CaseQueryService, CaseReviewQueryService {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async get(caseId: string): Promise<CaseStatus> {
    const [record] = await this.db.select({
      caseId: cases.id,
      applicantDisplayName: cases.applicantDisplayName,
      lifecycle: cases.lifecycle,
      version: cases.version,
    }).from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!record) throw new CaseNotFoundError();

    const lifecycle = asCaseLifecycle(record.lifecycle);
    return {
      ...record,
      lifecycle,
      progress: lifecycle === "processing" ? "submitted" : lifecycle === "ready_for_review" ? "human_review" : "outcome",
      resultAvailability: lifecycle === "processing" ? "pending" : lifecycle === "processing_exception" ? "unavailable" : "ready",
    };
  }

  async getAgentReport(caseId: string): Promise<AgentReportView> {
    await this.assertCaseExists(caseId);
    const [report] = await this.db.select({
      availability: agentReports.availability,
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
      ...(report.resultRevisionId && report.resultRevisionNumber !== null
        ? { resultRevision: { id: report.resultRevisionId, revision: report.resultRevisionNumber } }
        : {}),
      summary: report.summary,
      issueLinks: report.issueLinks as string[],
      checkedFacts: report.checkedFacts as AgentReportView["checkedFacts"],
    };
  }

  async getIssues(caseId: string): Promise<readonly ReviewIssueView[]> {
    await this.assertCaseExists(caseId);
    const records = await this.db.select().from(reviewIssues).where(eq(reviewIssues.caseId, caseId))
      .orderBy(asc(reviewIssues.createdAt));
    return records.map((record) => ({
      issueId: record.id,
      origin: record.origin === "human" ? "human" : "agent",
      code: record.code,
      description: record.description,
      recommendedAction: record.recommendedAction,
      reviewState: record.reviewState === "confirmed" ? "confirmed" : record.reviewState === "ignored" ? "ignored" : "pending",
      version: record.version,
    }));
  }

  async getEvidence(caseId: string, evidenceId: string): Promise<EvidenceView> {
    const [record] = await this.db.select({
      evidenceId: evidenceRecords.id,
      evidenceType: evidenceRecords.evidenceType,
      jsonPointer: evidenceRecords.jsonPointer,
      documentVersionId: evidenceRecords.documentVersionId,
      pageNumber: evidenceRecords.pageNumber,
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
    throw new Error("Persisted evidence subtype is invalid");
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

  async getDocumentPage(caseId: string, documentId: string, pageNumber: number): Promise<DocumentPageView> {
    const [record] = await this.db.select({
      documentId: documentVersions.id,
      pageNumber: pages.pageNumber,
      needsOcr: pages.needsOcr,
      ocrReason: pages.ocrReason,
      hasTable: pages.hasTable,
      hasColumns: pages.hasColumns,
      nativeCharacterCount: pages.nativeCharacterCount,
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
      nativeCharacterCount: record.nativeCharacterCount,
    };
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

export class PostgresWorkflowCoordinator {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

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

  async loadOfflineSourceContext(caseId: string, runId: string): Promise<{
    inputRevisionId: string;
    applicationSnapshotId: string;
    pages: readonly { documentVersionId: string; submittedFilename: string; pageNumber: number }[];
  }> {
    const [run] = await this.db.select({
      inputRevisionId: processingRuns.inputRevisionId,
      applicationSnapshotId: inputRevisions.applicationSnapshotId,
    }).from(processingRuns).innerJoin(inputRevisions, eq(processingRuns.inputRevisionId, inputRevisions.id))
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
    if (!run) throw new CaseNotFoundError();
    const pageRecords = await this.db.select({
      documentVersionId: pages.documentVersionId,
      submittedFilename: documentVersions.submittedFilename,
      pageNumber: pages.pageNumber,
    }).from(pages)
      .innerJoin(documentInspections, eq(pages.documentInspectionId, documentInspections.id))
      .innerJoin(documentVersions, eq(pages.documentVersionId, documentVersions.id))
      .where(eq(documentInspections.runId, runId))
      .orderBy(asc(documentVersions.submittedFilename), asc(pages.pageNumber));
    return { ...run, pages: pageRecords };
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
      await tx.insert(pages).values(inspection.pages.map((page) => ({
        id: randomUUID(), documentInspectionId: inspectionId,
        documentVersionId: document.documentVersionId, pageNumber: page.pageNumber,
        needsOcr: page.needsOcr, ocrReason: page.ocrReason,
        hasTable: page.hasTable, hasColumns: page.hasColumns,
        nativeCharacterCount: page.nativeCharacterCount,
      })));
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
      validateOfflineProvenance(result, run.applicationSnapshotId, run.applicationContent, new Set(allowedPages.map((page) => `${page.documentVersionId}:${page.pageNumber}`)));

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
        extractionMethod: item.extractionMethod, processorVersion: item.processorVersion,
      })));
      await tx.insert(claimRecords).values(result.claims.map((item) => ({
        id: item.claimId, runId, fieldSchemaId: item.fieldSchemaId, valueType: item.valueType,
        rawValue: item.rawValue, normalizedValue: item.normalizedValue,
        normalizationVersion: item.normalizationVersion,
      })));
      await tx.insert(claimEvidenceLinks).values(result.claims.flatMap((claim) => claim.evidenceIds.map((evidenceId) => ({
        id: randomUUID(), claimId: claim.claimId, evidenceId, relationship: "direct_support",
      }))));
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
        id: randomUUID(), caseId, runId, origin: "agent", code: issue.code,
        description: issue.description, recommendedAction: issue.recommendedAction, reviewState: "pending",
      }));
      if (issues.length > 0) await tx.insert(reviewIssues).values(issues);
      await tx.insert(agentReports).values({
        id: randomUUID(), caseId, runId, resultRevisionId, availability: report.reportAvailability,
        verificationStatus: report.reportAvailability === "ready" ? "verified" : "rejected",
        verificationFailureReason: report.reportFailureReason, summary: report.summary,
        issueLinks: issues.map((issue) => issue.id),
        checkedFacts,
        modelLabel: report.modelLabel, estimatedCost: report.estimatedCost,
      });
      const completedAt = new Date();
      await tx.insert(stageExecutions).values({
        id: randomUUID(), runId, stageType: "agent_report", sequence: 4, status: "succeeded", completedAt,
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

function validateOfflineProvenance(result: OfflineDeterministicResult, applicationSnapshotId: string, applicationContent: unknown, allowedPages: ReadonlySet<string>): void {
  const evidenceIds = new Set(result.evidence.map((item) => item.evidenceId));
  const claimIds = new Set(result.claims.map((item) => item.claimId));
  if (evidenceIds.size !== result.evidence.length || claimIds.size !== result.claims.length) throw new Error("Duplicate offline provenance identity");
  for (const evidence of result.evidence) {
    const structured = evidence.evidenceType === "structured_input" && evidence.applicationSnapshotId && evidence.jsonPointer && !evidence.documentVersionId && evidence.pageNumber === undefined;
    const page = evidence.evidenceType === "page_level" && evidence.documentVersionId && evidence.pageNumber !== undefined && !evidence.applicationSnapshotId && !evidence.jsonPointer;
    if (!structured && !page) throw new Error("Offline evidence subtype is invalid");
    if (structured && evidence.applicationSnapshotId !== applicationSnapshotId) throw new Error("Offline structured evidence is outside the run input");
    if (structured && !jsonPointerExists(applicationContent, evidence.jsonPointer!)) throw new Error("Offline structured evidence pointer is invalid");
    if (page && !allowedPages.has(`${evidence.documentVersionId}:${evidence.pageNumber}`)) throw new Error("Offline page evidence is outside the run input");
  }
  if (result.claims.some((claim) => claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !evidenceIds.has(id)))) throw new Error("Offline claim evidence is invalid");
  if (result.findings.some((item) => item.materialInputRefs.length === 0 || item.materialInputRefs.some((id) => !evidenceIds.has(id) && !claimIds.has(id)))) {
    throw new Error("Offline finding reference is invalid");
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
  }[];
}

export * from "./schema.js";
