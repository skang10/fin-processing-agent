import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CaseNotFoundError, IdempotencyConflictError, type AcceptedCase, type AgentReportView, type CaseCommandService, type CaseIntakeCommand, type CaseQueryService, type CaseReviewQueryService, type CaseStatus, type OfflineCaseResult, type ReviewIssueView } from "@findoc/core";
import { agentReports, artifacts, cases, documentInspections, documentVersions, idempotencyRecords, outboxEvents, pages, physicalDocuments, processingRuns, reviewIssues, stageExecutions } from "./schema.js";

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
      await tx.insert(cases).values({
        id: accepted.caseId,
        applicantDisplayName: command.applicantDisplayName,
        lifecycle: "processing",
      });
      await tx.insert(processingRuns).values({
        id: accepted.runId,
        caseId: accepted.caseId,
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
      });
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
        await tx.insert(documentVersions).values({
          id: randomUUID(), physicalDocumentId, sourceArtifactId: artifactId, version: 1,
          submittedFilename: document.submittedFilename,
          detectedMediaType: document.artifact.detectedMediaType,
          integrityState: "verified",
          readabilityState: "not_inspected",
          malwareScanState: "not_scanned",
        });
      }
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
      summary: agentReports.summary,
      issueLinks: agentReports.issueLinks,
      checkedFacts: agentReports.checkedFacts,
    }).from(agentReports).where(eq(agentReports.caseId, caseId))
      .orderBy(sql`${agentReports.createdAt} desc`).limit(1);
    if (!report) return { availability: "pending", issueLinks: [], checkedFacts: [] };
    return {
      availability: report.availability === "ready" ? "ready" : "unavailable",
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
  return createHash("sha256")
    .update(JSON.stringify({
      applicant_display_name: command.applicantDisplayName,
      documents: (command.documents ?? []).map((document) => ({
        filename: document.submittedFilename,
        sha256: document.artifact.sha256,
        byte_size: document.artifact.byteSize,
        media_type: document.artifact.detectedMediaType,
      })),
    }))
    .digest("hex");
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

  async loadUninspectedDocuments(caseId: string, runId: string): Promise<StoredDocumentReference[]> {
    const records = await this.db.select({
      documentVersionId: documentVersions.id,
      objectKey: artifacts.objectKey,
      mediaType: documentVersions.detectedMediaType,
    }).from(documentVersions)
      .innerJoin(physicalDocuments, eq(documentVersions.physicalDocumentId, physicalDocuments.id))
      .innerJoin(artifacts, eq(documentVersions.sourceArtifactId, artifacts.id))
      .leftJoin(documentInspections, and(
        eq(documentInspections.documentVersionId, documentVersions.id),
        eq(documentInspections.runId, runId),
      ))
      .where(and(eq(physicalDocuments.caseId, caseId), isNull(documentInspections.id)));
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

  async completeOffline(caseId: string, runId: string, result: OfflineCaseResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select({ status: processingRuns.status }).from(processingRuns)
        .where(and(eq(processingRuns.id, runId), eq(processingRuns.caseId, caseId))).limit(1);
      if (!run) throw new CaseNotFoundError();
      if (run.status === "completed") return;

      const completedAt = new Date();
      const stages = ["inspect_and_classify", "extract", "validate", "agent_report"];
      await tx.insert(stageExecutions).values(stages.map((stageType, sequence) => ({
        id: randomUUID(), runId, stageType, sequence: sequence + 1, status: "completed", completedAt,
      })));

      const issues = result.issues.map((issue) => ({
        id: randomUUID(), caseId, runId, origin: "agent", code: issue.code,
        description: issue.description, recommendedAction: issue.recommendedAction,
        reviewState: "pending",
      }));
      if (issues.length > 0) await tx.insert(reviewIssues).values(issues);

      await tx.insert(agentReports).values({
        id: randomUUID(), caseId, runId, availability: "ready", summary: result.summary,
        issueLinks: issues.map((issue) => issue.id), checkedFacts: [],
        modelLabel: result.modelLabel, estimatedCost: result.estimatedCost,
      });
      await tx.update(processingRuns).set({ status: "completed" }).where(eq(processingRuns.id, runId));
      await tx.update(cases).set({ lifecycle: "ready_for_review", version: sql`${cases.version} + 1` })
        .where(eq(cases.id, caseId));
    });
  }
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
