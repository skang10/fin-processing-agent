import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaseNotFoundError, IdempotencyConflictError } from "@findoc/core";
import {
  PostgresCaseCommandService,
  PostgresCaseQueryService,
  PostgresWorkflowCoordinator,
  agentReports,
  applicationSnapshots,
  artifacts,
  cases,
  caseStateTransitions,
  claimEvidenceLinks,
  claimRecords,
  createDatabase,
  idempotencyRecords,
  inputDocumentSelections,
  inputRevisions,
  documentVersions,
  documentInspections,
  evidenceRecords,
  outboxEvents,
  processingRuns,
  processingRunTransitions,
  physicalDocuments,
  pages,
  recommendedDispositions,
  resultRevisions,
  reviewIssues,
  stageExecutions,
  validationFindings,
} from "./index.js";

describe("PostgresCaseCommandService", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connection: ReturnType<typeof createDatabase>;
  let reviewFixture: { caseId: string; resultRevisionId: string; issueId: string };

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
      applicationData: {
        applicant_display_name: "Anna Beispiel", demo_fixture_id: "anna-example-v1",
        contact: { email: "anna@example.invalid", phone: "+49 170 1234567" },
        employment: { employer: "Beispieltechnik GmbH" },
        income: { monthly_net: "3480.00", currency: "EUR", basis: "net" },
      },
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
    const queriesBeforeProcessing = new PostgresCaseQueryService(connection.db);
    const applicationProjection = await queriesBeforeProcessing.getApplicationData(accepted.caseId);
    expect(applicationProjection.groups.find((group) => group.group === "contact")?.fields.map((field) => field.displayValue))
      .toEqual(["a***@example.invalid", "•••• 67"]);
    await expect(queriesBeforeProcessing.getDocuments(accepted.caseId)).resolves.toMatchObject([{
      submittedFilename: "statement.pdf", pageCount: 0,
    }]);
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
    await expect(queriesBeforeProcessing.getDocumentPage(accepted.caseId, document.documentVersionId, 1)).resolves.toMatchObject({
      pageNumber: 1, nativeCharacterCount: 42,
    });

    const inputRevisionId = await coordinator.loadInputRevisionId(accepted.caseId, accepted.runId);
    const sourceContext = await coordinator.loadOfflineSourceContext(accepted.caseId, accepted.runId);
    expect(sourceContext.pages).toHaveLength(1);
    const resultRevisionId = "4c816f67-5f2f-4e21-8c17-7eb1e5383999";
    const evidenceId = "4c816f67-5f2f-4e21-8c17-7eb1e5383998";
    const claimId = "4c816f67-5f2f-4e21-8c17-7eb1e5383997";
    const ruleIds = [
      "VAL_DOC_COMPLETENESS_001", "VAL_NAME_CONSISTENCY_001", "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001", "VAL_ID_EXPIRY_001",
    ];
    const result = {
      resultRevisionId,
      reportAvailability: "ready" as const,
      summary: "Synthetic case requires review.", modelLabel: "fake-pi-harness-v1", estimatedCost: "0.0000",
      findings: ruleIds.map((ruleId) => ({
        ruleId, ruleVersion: "1.0.0", ruleSetId: "demo-de-personal-loan-v1", ruleSetVersion: "1.0.0",
        inputSnapshotId: inputRevisionId, resultRevisionId, status: ruleId === "VAL_EMPLOYER_CONSISTENCY_001" ? "failed" : "passed",
        reasonCode: ruleId === "VAL_EMPLOYER_CONSISTENCY_001" ? "employer_conflict" : "fixture_passed",
        materialInputRefs: [claimId],
      })),
      recommendedDisposition: "human_review_required" as const,
      evidence: [{
        evidenceId, evidenceType: "page_level" as const,
        documentVersionId: document.documentVersionId, pageNumber: 1,
        extractionMethod: "offline_fixture" as const, processorVersion: "fixture-v1",
      }],
      claims: [{
        claimId, fieldSchemaId: "fixture.field", valueType: "string" as const,
        rawValue: "fixture", normalizedValue: "fixture", normalizationVersion: "fixture-v1",
        evidenceIds: [evidenceId],
      }],
      issues: [{ code: "VAL_EMPLOYER_CONSISTENCY_001", description: "Employer differs.", recommendedAction: "Confirm the current employer." }],
    };
    await coordinator.markRunRunning(accepted.caseId, accepted.runId);
    await coordinator.persistOfflineDeterministic(accepted.caseId, accepted.runId, result);
    await coordinator.persistOfflineDeterministic(accepted.caseId, accepted.runId, result);
    const persistedReportInput = await coordinator.loadOfflineReportInput(accepted.caseId, accepted.runId);
    expect(persistedReportInput.findings[0]?.inputSnapshotId).toBe(inputRevisionId);
    await coordinator.completeOfflineReport(accepted.caseId, accepted.runId, resultRevisionId, result);
    await coordinator.completeOfflineReport(accepted.caseId, accepted.runId, resultRevisionId, result);

    const queries = new PostgresCaseQueryService(connection.db);
    const status = await queries.get(accepted.caseId);
    const [[stageCount], [issueCount], [reportCount], [resultCount], [findingCount], [dispositionCount], [evidenceCount], [claimCount], [claimEvidenceCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(stageExecutions),
      connection.db.select({ value: count() }).from(reviewIssues),
      connection.db.select({ value: count() }).from(agentReports),
      connection.db.select({ value: count() }).from(resultRevisions),
      connection.db.select({ value: count() }).from(validationFindings),
      connection.db.select({ value: count() }).from(recommendedDispositions),
      connection.db.select({ value: count() }).from(evidenceRecords),
      connection.db.select({ value: count() }).from(claimRecords),
      connection.db.select({ value: count() }).from(claimEvidenceLinks),
    ]);
    expect(status).toMatchObject({ lifecycle: "ready_for_review", progress: "human_review", version: 2 });
    expect([stageCount?.value, issueCount?.value, reportCount?.value]).toEqual([4, 1, 1]);
    expect([resultCount?.value, findingCount?.value, dispositionCount?.value]).toEqual([1, 5, 1]);
    expect([evidenceCount?.value, claimCount?.value, claimEvidenceCount?.value]).toEqual([1, 1, 1]);
    await expect(queries.getEvidence(accepted.caseId, evidenceId)).resolves.toMatchObject({
      evidenceType: "page_level", documentVersionId: document.documentVersionId, pageNumber: 1,
    });
    await expect(queries.getEvidence("4c816f67-5f2f-4e21-8c17-7eb1e5383000", evidenceId)).rejects.toBeInstanceOf(CaseNotFoundError);
    const report = await queries.getAgentReport(accepted.caseId);
    expect(report.checkedFacts).toHaveLength(4);
    expect(report.checkedFacts[0]?.references[0]).toContain(`/evidence/${evidenceId}`);
    await expect(queries.getFindings(accepted.caseId)).resolves.toHaveLength(5);
    const [transitionCount] = await connection.db.select({ value: count() }).from(caseStateTransitions);
    expect(transitionCount?.value).toBe(2);
    const [runTransitionCount] = await connection.db.select({ value: count() }).from(processingRunTransitions)
      .where(eq(processingRunTransitions.runId, accepted.runId));
    expect(runTransitionCount?.value).toBe(3);
    const [persistedIssue] = await connection.db.select({ id: reviewIssues.id }).from(reviewIssues)
      .where(eq(reviewIssues.caseId, accepted.caseId)).limit(1);
    if (!persistedIssue) throw new Error("Expected review issue fixture");
    reviewFixture = { caseId: accepted.caseId, resultRevisionId, issueId: persistedIssue.id };
  });

  it("persists issue resolution, requested-change revisions, and final review atomically", async () => {
    const service = new PostgresCaseCommandService(connection.db, "reviewer_1");
    await expect(service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "incomplete_final", expectedCaseVersion: 2, action: "request_changes",
      selectedDraftRevisionIds: [],
    })).rejects.toMatchObject({ code: "review_incomplete" });
    const resolved = await service.resolveIssue({
      ...reviewFixture, expectedIssueVersion: 1, action: "accept_signal", commandId: "confirm_1",
    });
    expect(resolved).toEqual({ issueVersion: 2, reviewState: "confirmed" });
    await expect(service.resolveIssue({
      ...reviewFixture, expectedIssueVersion: 1, action: "accept_signal", commandId: "confirm_1",
    })).resolves.toEqual(resolved);
    const firstDraft = await service.saveRequestedChange({
      ...reviewFixture, text: "Please provide a current employer document.", included: false, commandId: "draft_1",
    });
    expect(firstDraft.revision).toBe(1);
    await expect(service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "excluded_final", expectedCaseVersion: 2, action: "request_changes",
      selectedDraftRevisionIds: [firstDraft.draftRevisionId],
    })).rejects.toMatchObject({ code: "invalid_review_action" });
    const selectedDraft = await service.saveRequestedChange({
      ...reviewFixture, text: "Please provide a current employer document.", included: true, commandId: "draft_2",
    });
    const final = await service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "final_1", expectedCaseVersion: 2, action: "request_changes",
      selectedDraftRevisionIds: [selectedDraft.draftRevisionId], internalNote: "Reviewed synthetic fixture.",
    });
    expect(final).toMatchObject({ action: "request_changes", caseVersion: 3 });
    await expect(service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "final_1", expectedCaseVersion: 2, action: "request_changes",
      selectedDraftRevisionIds: [selectedDraft.draftRevisionId],
    })).resolves.toEqual(final);
    await expect(new PostgresCaseQueryService(connection.db).get(reviewFixture.caseId)).resolves.toMatchObject({
      lifecycle: "review_complete", finalReviewAction: "request_changes", version: 3,
    });
    await expect(new PostgresCaseQueryService(connection.db).getIssues(reviewFixture.caseId)).resolves.toMatchObject([{
      reviewState: "confirmed", version: 2,
      requestedChange: { draftRevisionId: selectedDraft.draftRevisionId, revision: 2, included: true },
    }]);
    const queries = new PostgresCaseQueryService(connection.db);
    await expect(queries.list("review")).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId }),
    ]));
    await expect(queries.list("changes_requested")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId, workflowStatus: "changes_requested", issueCount: 1 }),
    ]));
    await expect(queries.list("completed")).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId }),
    ]));
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
    await coordinator.markRunRunning(accepted.caseId, accepted.runId);
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
    const [runTransitionCount] = await connection.db.select({ value: count() }).from(processingRunTransitions)
      .where(eq(processingRunTransitions.runId, accepted.runId));
    expect(runTransitionCount?.value).toBe(3);
  });
});
