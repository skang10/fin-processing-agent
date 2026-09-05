import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@findoc/core";
import {
  PostgresCaseCommandService,
  PostgresCaseQueryService,
  PostgresWorkflowCoordinator,
  agentReports,
  applicationSnapshots,
  artifacts,
  cases,
  caseStateTransitions,
  createDatabase,
  idempotencyRecords,
  inputDocumentSelections,
  inputRevisions,
  documentVersions,
  documentInspections,
  outboxEvents,
  processingRuns,
  physicalDocuments,
  pages,
  reviewIssues,
  stageExecutions,
} from "./index.js";

describe("PostgresCaseCommandService", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connection: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.4-alpine").start();
    connection = createDatabase(container.getConnectionUri());
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection.client.end();
    await container.stop();
  });

  it("atomically creates one case, run, outbox event, and idempotency record", async () => {
    const service = new PostgresCaseCommandService(connection.db, "actor_1");
    const command = {
      applicantDisplayName: "Anna Beispiel",
      applicationData: { applicant_display_name: "Anna Beispiel", demo_fixture_id: "anna-example-v1" },
      idempotencyKey: "key_1",
      documents: [{
        submittedFilename: "statement.pdf",
        artifact: {
          objectKey: "source/object_1", sha256: "a".repeat(64), byteSize: 128,
          detectedMediaType: "application/pdf" as const,
        },
      }],
    };

    const accepted = await service.accept(command);
    await expect(service.accept(command)).resolves.toEqual({ ...accepted, replayed: true });
    await expect(service.accept({ ...command, applicantDisplayName: "Other" }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const [[caseCount], [runCount], [eventCount], [keyCount], [snapshotCount], [revisionCount], [selectionCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(cases),
      connection.db.select({ value: count() }).from(processingRuns),
      connection.db.select({ value: count() }).from(outboxEvents),
      connection.db.select({ value: count() }).from(idempotencyRecords),
      connection.db.select({ value: count() }).from(applicationSnapshots),
      connection.db.select({ value: count() }).from(inputRevisions),
      connection.db.select({ value: count() }).from(inputDocumentSelections),
    ]);
    expect([caseCount?.value, runCount?.value, eventCount?.value, keyCount?.value, snapshotCount?.value, revisionCount?.value, selectionCount?.value])
      .toEqual([1, 1, 1, 1, 1, 1, 1]);
    const [[artifactCount], [documentCount], [versionCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(artifacts),
      connection.db.select({ value: count() }).from(physicalDocuments),
      connection.db.select({ value: count() }).from(documentVersions),
    ]);
    expect([artifactCount?.value, documentCount?.value, versionCount?.value]).toEqual([1, 1, 1]);

    const coordinator = new PostgresWorkflowCoordinator(connection.db);
    await expect(coordinator.loadApplicationData(accepted.caseId, accepted.runId)).resolves.toEqual(command.applicationData);
    await expect(coordinator.hasInputDocuments(accepted.caseId, accepted.runId)).resolves.toBe(true);
    const [document] = await coordinator.loadUninspectedDocuments(accepted.caseId, accepted.runId);
    expect(document).toMatchObject({ mediaType: "application/pdf" });
    if (!document) throw new Error("Expected document fixture");
    await coordinator.persistInspection(accepted.runId, document, {
      processor: "firecrawl/pdf-inspector", processorVersion: "1.17.0",
      pdfType: "text_based", routingSignal: 0.99, isComplex: false,
      pages: [{ pageNumber: 1, needsOcr: false, hasTable: false, hasColumns: false, nativeCharacterCount: 42 }],
    });
    await coordinator.persistInspection(accepted.runId, document, {
      processor: "firecrawl/pdf-inspector", processorVersion: "1.17.0",
      pdfType: "text_based", routingSignal: 0.99, isComplex: false,
      pages: [{ pageNumber: 1, needsOcr: false, hasTable: false, hasColumns: false, nativeCharacterCount: 42 }],
    });
    expect(await coordinator.loadUninspectedDocuments(accepted.caseId, accepted.runId)).toEqual([]);
    const [[inspectionCount], [pageCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(documentInspections),
      connection.db.select({ value: count() }).from(pages),
    ]);
    expect([inspectionCount?.value, pageCount?.value]).toEqual([1, 1]);

    const result = {
      summary: "Synthetic case requires review.", modelLabel: "fake-pi-harness-v1", estimatedCost: "0.0000",
      issues: [{ code: "VAL_EMPLOYER_CONSISTENCY_001", description: "Employer differs.", recommendedAction: "Confirm the current employer." }],
    };
    await coordinator.completeOffline(accepted.caseId, accepted.runId, result);
    await coordinator.completeOffline(accepted.caseId, accepted.runId, result);

    const status = await new PostgresCaseQueryService(connection.db).get(accepted.caseId);
    const [[stageCount], [issueCount], [reportCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(stageExecutions),
      connection.db.select({ value: count() }).from(reviewIssues),
      connection.db.select({ value: count() }).from(agentReports),
    ]);
    expect(status).toMatchObject({ lifecycle: "ready_for_review", progress: "human_review", version: 2 });
    expect([stageCount?.value, issueCount?.value, reportCount?.value]).toEqual([4, 1, 1]);
    const [transitionCount] = await connection.db.select({ value: count() }).from(caseStateTransitions);
    expect(transitionCount?.value).toBe(2);
  });

  it("routes an unprocessable run to one durable processing exception", async () => {
    const service = new PostgresCaseCommandService(connection.db, "actor_2");
    const accepted = await service.accept({
      applicantDisplayName: "Synthetic Applicant",
      applicationData: { applicant_display_name: "Synthetic Applicant" },
      idempotencyKey: "missing_documents",
      documents: [],
    });
    const coordinator = new PostgresWorkflowCoordinator(connection.db);

    await expect(coordinator.hasInputDocuments(accepted.caseId, accepted.runId)).resolves.toBe(false);
    await coordinator.failRun(accepted.caseId, accepted.runId, "required_documents_missing");
    await coordinator.failRun(accepted.caseId, accepted.runId, "required_documents_missing");

    await expect(new PostgresCaseQueryService(connection.db).get(accepted.caseId)).resolves.toMatchObject({
      lifecycle: "processing_exception",
      resultAvailability: "unavailable",
      version: 2,
    });
    const [transitionCount] = await connection.db.select({ value: count() }).from(caseStateTransitions)
      .where(eq(caseStateTransitions.caseId, accepted.caseId));
    expect(transitionCount?.value).toBe(2);
  });
});
