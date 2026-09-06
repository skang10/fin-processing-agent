import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaseNotFoundError, HandoffUnavailableError, IdempotencyConflictError } from "@findoc/core";
import {
  PostgresCaseCommandService,
  PostgresCaseQueryService,
  PostgresWorkflowCoordinator,
  agentEligibilityDecisions,
  agentReports,
  agentSessions,
  agentSteps,
  applicationSnapshots,
  artifacts,
  cases,
  caseStateTransitions,
  candidateEvidenceLinks,
  claimCandidateLinks,
  claimEvidenceLinks,
  claimRecords,
  createDatabase,
  boundaryPredictions,
  idempotencyRecords,
  inputDocumentSelections,
  inputRevisions,
  logicalDocumentPages,
  logicalDocumentRevisions,
  documentVersions,
  documentInspections,
  evidenceRecords,
  extractionCandidates,
  extractionGaps,
  gapResolutions,
  outboxEvents,
  pageOcrOutputs,
  pageClassifications,
  processingRuns,
  processingRunTransitions,
  physicalDocuments,
  pages,
  reconciliationCandidateLinks,
  reconciliationDecisions,
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
    await expect(queriesBeforeProcessing.getSourceDocumentArtifact(accepted.caseId, document.documentVersionId)).resolves.toMatchObject({
      objectKey: command.documents[0]?.artifact.objectKey, mediaType: "application/pdf",
    });
    await expect(queriesBeforeProcessing.getSourceDocumentArtifact("00000000-0000-4000-8000-000000000000", document.documentVersionId))
      .rejects.toBeInstanceOf(CaseNotFoundError);
    await coordinator.persistInspection(accepted.runId, document, {
      processor: "firecrawl/pdf-inspector", processorVersion: "1.17.0",
      pdfType: "text_based", routingSignal: 0.99, isComplex: false,
      pages: [{
        pageNumber: 1, needsOcr: true, ocrReason: "low_native_text", hasTable: false, hasColumns: false, nativeCharacterCount: 42,
        nativeTextArtifact: {
          caseId: accepted.caseId, objectKey: "derived/native/page-1", sha256: "b".repeat(64),
          byteSize: 16, mediaType: "text/markdown",
        },
        renderArtifact: {
          caseId: accepted.caseId, objectKey: "derived/render/page-1", sha256: "c".repeat(64),
          byteSize: 8, mediaType: "image/png", width: 935, height: 1210,
          targetDpi: 110, rendererVersion: "@hyzyla/pdfium-2.1.13",
        },
        ocrArtifact: {
          caseId: accepted.caseId, objectKey: "derived/ocr/page-1", sha256: "d".repeat(64), byteSize: 128,
          mediaType: "application/json", engine: "deterministic-fake-ocr", engineVersion: "1.0.0",
          modelAssetVersion: "synthetic-fixture-v1", languages: ["de", "en"], coordinateSpace: "render_pixels_top_left",
        },
      }],
      classifications: [{
        pageNumber: 1, selectedType: "bank_statement", method: "synthetic-demo-heading-classifier", version: "1.0.0",
        qualityStatus: "accepted", rawConfidence: { value: 1, scale: "zero_to_one", producer: "deterministic-demo-rule" },
        alternatives: [],
      }],
      boundaries: [],
      logicalDocuments: [{ startPage: 1, endPage: 1, documentType: "bank_statement", uncertain: false, pageNumbers: [1] }],
    });
    await coordinator.persistInspection(accepted.runId, document, {
      processor: "firecrawl/pdf-inspector", processorVersion: "1.17.0",
      pdfType: "text_based", routingSignal: 0.99, isComplex: false,
      pages: [{ pageNumber: 1, needsOcr: false, hasTable: false, hasColumns: false, nativeCharacterCount: 42 }],
    });
    expect(await coordinator.loadUninspectedDocuments(accepted.caseId, accepted.runId)).toEqual([]);
    const [[inspectionCount], [pageCount], [ocrCount], [classificationCount], [boundaryCount], [logicalCount], [logicalPageCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(documentInspections),
      connection.db.select({ value: count() }).from(pages),
      connection.db.select({ value: count() }).from(pageOcrOutputs),
      connection.db.select({ value: count() }).from(pageClassifications),
      connection.db.select({ value: count() }).from(boundaryPredictions),
      connection.db.select({ value: count() }).from(logicalDocumentRevisions),
      connection.db.select({ value: count() }).from(logicalDocumentPages),
    ]);
    expect([inspectionCount?.value, pageCount?.value, ocrCount?.value]).toEqual([1, 1, 1]);
    expect([classificationCount?.value, boundaryCount?.value, logicalCount?.value, logicalPageCount?.value]).toEqual([1, 0, 1, 1]);
    await expect(queriesBeforeProcessing.getDocumentPage(accepted.caseId, document.documentVersionId, 1)).resolves.toMatchObject({
      pageNumber: 1, nativeCharacterCount: 42, nativeTextAvailable: true, renderAvailable: true,
    });
    await expect(queriesBeforeProcessing.getNativeTextArtifact(accepted.caseId, document.documentVersionId, 1)).resolves.toEqual({
      objectKey: "derived/native/page-1", byteSize: 16, mediaType: "text/markdown",
    });
    await expect(queriesBeforeProcessing.getNativeTextArtifact("00000000-0000-4000-8000-000000000000", document.documentVersionId, 1))
      .rejects.toBeInstanceOf(CaseNotFoundError);
    await expect(queriesBeforeProcessing.getPageRenderArtifact(accepted.caseId, document.documentVersionId, 1)).resolves.toEqual({
      objectKey: "derived/render/page-1", byteSize: 8, mediaType: "image/png",
    });

    const inputRevisionId = await coordinator.loadInputRevisionId(accepted.caseId, accepted.runId);
    const sourceContext = await coordinator.loadOfflineSourceContext(accepted.caseId, accepted.runId);
    expect(sourceContext.pages).toHaveLength(1);
    const resultRevisionId = "4c816f67-5f2f-4e21-8c17-7eb1e5383999";
    const evidenceId = "4c816f67-5f2f-4e21-8c17-7eb1e5383998";
    const claimId = "4c816f67-5f2f-4e21-8c17-7eb1e5383997";
    const candidateId = "4c816f67-5f2f-4e21-8c17-7eb1e5383996";
    const reconciliationId = "4c816f67-5f2f-4e21-8c17-7eb1e5383995";
    const [logicalDocument] = await connection.db.select({ id: logicalDocumentRevisions.id })
      .from(logicalDocumentRevisions).where(eq(logicalDocumentRevisions.runId, accepted.runId)).limit(1);
    if (!logicalDocument) throw new Error("Expected persisted logical document");
    const ruleIds = [
      "VAL_DOC_COMPLETENESS_001", "VAL_NAME_CONSISTENCY_001", "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001", "VAL_ID_EXPIRY_001",
    ];
    const result = {
      resultRevisionId,
      reportAvailability: "ready" as const,
      summary: "Synthetic case requires review.", modelLabel: "fake-pi-harness-v1", estimatedCost: "0.0000",
      session: {
        sessionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383aaa", mode: "case_review_report" as const,
        harnessId: "pi-case-review-harness", harnessVersion: "pi-coding-agent@0.85.1", modelLabel: "findoc-fake/case-review-script-v1", modelRoute: "fake" as const,
        promptVersion: "case-review-report-prompt-1.0.0", promptHash: "abc", configurationVersion: "pi-harness-1.0.0", toolRegistryVersion: "case-review-tools-1.0.0",
        offeredTools: ["list_findings", "get_finding_references", "submit_case_review_brief"],
        budget: { maxIterations: 6, maxToolCalls: 8, maxModelCalls: 6, maxInputTokens: 60000, maxOutputTokens: 8000, maxWallClockMs: 60000, maxEstimatedCostUsd: 0.25, maxVlmCalls: 2, maxOcrPages: 3, maxConsecutiveNoProgressSteps: 2 },
        iterations: 2, toolCalls: 2, usage: { available: true, modelCalls: 2, inputTokens: 400, outputTokens: 80 },
        estimatedCost: { amount: "0.0000", currency: "EUR" as const }, terminalReason: "report_submitted" as const,
        steps: [
          { sequence: 1, toolName: "list_findings", toolVersion: "1.0.0", argumentHash: "h1", outcome: "succeeded" as const, summary: "Listed deterministic findings", startedAt: "2026-09-06T10:00:00.000Z", completedAt: "2026-09-06T10:00:01.000Z", budgetState: { iterationsUsed: 1, toolCallsUsed: 1 } },
          { sequence: 2, toolName: "submit_case_review_brief", toolVersion: "1.0.0", argumentHash: "h2", outcome: "succeeded" as const, summary: "Submitted a Case Review Brief", startedAt: "2026-09-06T10:00:02.000Z", completedAt: "2026-09-06T10:00:03.000Z", budgetState: { iterationsUsed: 2, toolCallsUsed: 2 } },
        ],
        startedAt: "2026-09-06T10:00:00.000Z", completedAt: "2026-09-06T10:00:04.000Z",
      },
      originalSubmission: { schema_version: "1.0.0", summary: "Synthetic case requires review." },
      gaps: [{
        gapId: "4c816f67-5f2f-4e21-8c17-7eb1e5383bbb", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" as const, required: true,
        originatingStage: "extract" as const, reasonCode: "scanned_page_value_unresolved", attemptedPaths: ["native_text", "fixture_ocr"],
        scope: { documentVersionId: document.documentVersionId, logicalDocumentRevisionId: logicalDocument.id, pageNumber: 1 },
      }],
      gapResolutions: [{ gapId: "4c816f67-5f2f-4e21-8c17-7eb1e5383bbb", resolutionType: "claim" as const, reference: claimId }],
      eligibility: { decisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383ccc", policyVersion: "recovery-eligibility-1.0.0", gapIds: ["4c816f67-5f2f-4e21-8c17-7eb1e5383bbb"], decision: "eligible" as const, reasonCodes: ["eligible_required_gap"] },
      recoverySession: {
        sessionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383ddd", mode: "adaptive_recovery" as const,
        harnessId: "pi-adaptive-recovery-harness", harnessVersion: "pi-coding-agent@0.85.1", modelLabel: "findoc-fake/case-review-script-v1", modelRoute: "fake" as const,
        promptVersion: "adaptive-recovery-prompt-1.0.0", promptHash: "abc", configurationVersion: "pi-harness-1.1.0", toolRegistryVersion: "adaptive-recovery-tools-1.0.0",
        offeredTools: ["get_extraction_gaps", "extract_with_vlm", "submit_extraction_candidates"],
        budget: { maxIterations: 6, maxToolCalls: 8, maxModelCalls: 6, maxInputTokens: 60000, maxOutputTokens: 8000, maxWallClockMs: 60000, maxEstimatedCostUsd: 0.25, maxVlmCalls: 2, maxOcrPages: 3, maxConsecutiveNoProgressSteps: 2 },
        iterations: 3, toolCalls: 3, usage: { available: true, modelCalls: 3, inputTokens: 300, outputTokens: 60 },
        estimatedCost: { amount: "0.0000", currency: "EUR" as const }, terminalReason: "gaps_resolved" as const,
        boundGapIds: ["4c816f67-5f2f-4e21-8c17-7eb1e5383bbb"],
        steps: [
          { sequence: 1, toolName: "get_extraction_gaps", toolVersion: "1.0.0", argumentHash: "g1", outcome: "succeeded" as const, summary: "Listed bound extraction gaps", startedAt: "2026-09-06T09:59:00.000Z", completedAt: "2026-09-06T09:59:01.000Z", budgetState: { iterationsUsed: 1, toolCallsUsed: 1 } },
          { sequence: 2, toolName: "submit_extraction_candidates", toolVersion: "1.0.0", argumentHash: "g2", outcome: "succeeded" as const, summary: "Submitted 1 extraction candidate(s)", startedAt: "2026-09-06T09:59:02.000Z", completedAt: "2026-09-06T09:59:03.000Z", budgetState: { iterationsUsed: 2, toolCallsUsed: 2 } },
        ],
        startedAt: "2026-09-06T09:59:00.000Z", completedAt: "2026-09-06T09:59:04.000Z",
      },
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
      candidates: [{
        candidateId, fieldSchemaId: "fixture.field", fieldSchemaVersion: "1.0.0", valueType: "string" as const,
        rawValue: "fixture", normalizedValue: "fixture", extractionMethod: "offline_fixture",
        processorVersion: "fixture-v1", evidenceIds: [evidenceId], qualityStatus: "accepted" as const,
        source: { type: "logical_document" as const, logicalDocumentRevisionId: logicalDocument.id },
      }],
      claims: [{
        claimId, fieldSchemaId: "fixture.field", valueType: "string" as const,
        rawValue: "fixture", normalizedValue: "fixture", normalizationVersion: "fixture-v1",
        evidenceIds: [evidenceId], supportingCandidateIds: [candidateId],
      }],
      reconciliations: [{
        reconciliationId, fieldSchemaId: "fixture.field", method: "single_accepted_candidate" as const,
        version: "1.0.0" as const, status: "selected" as const,
        candidates: [{ candidateId, status: "selected" as const }], selectedCandidateId: candidateId,
        reason: "one_accepted_candidate" as const, resultingClaimId: claimId,
      }],
      issues: [{ origin: "agent" as const, code: "VAL_EMPLOYER_CONSISTENCY_001", description: "Employer differs.", recommendedAction: "Confirm the current employer." }],
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
    const [[stageCount], [issueCount], [reportCount], [resultCount], [findingCount], [dispositionCount], [evidenceCount], [claimCount], [claimEvidenceCount], [candidateCount], [candidateEvidenceCount], [claimCandidateCount], [reconciliationCount], [reconciliationCandidateCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(stageExecutions),
      connection.db.select({ value: count() }).from(reviewIssues),
      connection.db.select({ value: count() }).from(agentReports),
      connection.db.select({ value: count() }).from(resultRevisions),
      connection.db.select({ value: count() }).from(validationFindings),
      connection.db.select({ value: count() }).from(recommendedDispositions),
      connection.db.select({ value: count() }).from(evidenceRecords),
      connection.db.select({ value: count() }).from(claimRecords),
      connection.db.select({ value: count() }).from(claimEvidenceLinks),
      connection.db.select({ value: count() }).from(extractionCandidates),
      connection.db.select({ value: count() }).from(candidateEvidenceLinks),
      connection.db.select({ value: count() }).from(claimCandidateLinks),
      connection.db.select({ value: count() }).from(reconciliationDecisions),
      connection.db.select({ value: count() }).from(reconciliationCandidateLinks),
    ]);
    expect(status).toMatchObject({ lifecycle: "ready_for_review", progress: "human_review", version: 2 });
    expect([stageCount?.value, issueCount?.value, reportCount?.value]).toEqual([5, 1, 1]);
    expect([resultCount?.value, findingCount?.value, dispositionCount?.value]).toEqual([1, 5, 1]);
    expect([evidenceCount?.value, claimCount?.value, claimEvidenceCount?.value]).toEqual([1, 1, 1]);
    expect([candidateCount?.value, candidateEvidenceCount?.value, claimCandidateCount?.value]).toEqual([1, 1, 1]);
    expect([reconciliationCount?.value, reconciliationCandidateCount?.value]).toEqual([1, 1]);
    await expect(queries.getEvidence(accepted.caseId, evidenceId)).resolves.toMatchObject({
      evidenceType: "page_level", documentVersionId: document.documentVersionId, pageNumber: 1,
    });
    await expect(queries.getEvidence("4c816f67-5f2f-4e21-8c17-7eb1e5383000", evidenceId)).rejects.toBeInstanceOf(CaseNotFoundError);
    const report = await queries.getAgentReport(accepted.caseId);
    expect(report.checkedFacts).toHaveLength(4);
    expect(report.checkedFacts[0]?.references[0]).toContain(`/evidence/${evidenceId}`);
    await expect(queries.getAgentLog(accepted.caseId)).resolves.toMatchObject({
      availability: "ready", modelLabel: "fake-pi-harness-v1", estimatedCost: { amount: "0.0000", currency: "EUR" },
      currentStep: "awaiting_human_review",
      session: { harnessLabel: "pi-case-review-harness (pi-coding-agent@0.85.1)", mode: "case_review_report", terminalReason: "report_submitted", iterations: 2, toolCalls: 2, usageAvailable: true },
      recoverySession: { harnessLabel: "pi-adaptive-recovery-harness (pi-coding-agent@0.85.1)", mode: "adaptive_recovery", terminalReason: "gaps_resolved", iterations: 3, toolCalls: 3, usageAvailable: true, gapCount: 1, candidatesSubmitted: 1 },
      events: [
        { activity: "Started adaptive recovery session" },
        { activity: "Listed bound extraction gaps", toolLabel: "get_extraction_gaps" },
        { activity: "Submitted 1 extraction candidate(s)", toolLabel: "submit_extraction_candidates" },
        { activity: "Session ended: gaps resolved" },
        { activity: "Started case review report session" },
        { activity: "Listed deterministic findings", toolLabel: "list_findings" },
        { activity: "Submitted a Case Review Brief", toolLabel: "submit_case_review_brief" },
        { activity: "Session ended: report submitted" },
        { activity: "Checked 4 facts" }, { activity: "Created 1 review issues" }, { activity: "Generated review report" },
      ],
    });
    const [[sessionCount], [stepCount], [gapCount], [resolutionCount], [eligibilityCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(agentSessions),
      connection.db.select({ value: count() }).from(agentSteps),
      connection.db.select({ value: count() }).from(extractionGaps),
      connection.db.select({ value: count() }).from(gapResolutions),
      connection.db.select({ value: count() }).from(agentEligibilityDecisions),
    ]);
    expect([sessionCount?.value, stepCount?.value, gapCount?.value, resolutionCount?.value, eligibilityCount?.value]).toEqual([2, 4, 1, 1, 1]);
    const [persistedReport] = await connection.db.select({ sessionId: agentReports.sessionId, originalSubmission: agentReports.originalSubmission }).from(agentReports)
      .where(eq(agentReports.caseId, accepted.caseId)).limit(1);
    expect(persistedReport).toMatchObject({ sessionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383aaa", originalSubmission: { schema_version: "1.0.0" } });
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
    await expect(new PostgresCaseQueryService(connection.db).getDownstreamHandoff(reviewFixture.caseId))
      .rejects.toBeInstanceOf(HandoffUnavailableError);
    await expect(service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "incomplete_final", expectedCaseVersion: 2, action: "request_changes",
      selectedDraftRevisionIds: [],
    })).rejects.toMatchObject({ code: "review_incomplete" });
    const created = await service.createIssue({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "create_human_1", expectedCaseVersion: 2, title: "Missing supporting page",
      description: "A supporting page appears to be missing.", recommendedAction: "Please provide the missing page.",
      supportingReferences: [], noReferenceReason: "Reviewer observed a sequence gap in the synthetic package.",
    });
    expect(created).toMatchObject({ issueVersion: 1, caseVersion: 3 });
    const edited = await service.editIssue({
      caseId: reviewFixture.caseId, issueId: created.issueId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "edit_human_1", expectedIssueVersion: 1, title: "Missing document page",
      description: "One supporting document page appears to be missing.", recommendedAction: "Please provide the complete supporting document.",
      supportingReferences: [], noReferenceReason: "Reviewer observed a sequence gap in the synthetic package.",
    });
    expect(edited).toEqual({ issueVersion: 2 });
    await service.resolveIssue({
      caseId: reviewFixture.caseId, issueId: created.issueId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "confirm_human_1", expectedIssueVersion: 2, action: "accept_signal",
    });
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
      commandId: "excluded_final", expectedCaseVersion: 3, action: "request_changes",
      selectedDraftRevisionIds: [firstDraft.draftRevisionId],
    })).rejects.toMatchObject({ code: "invalid_review_action" });
    const final = await service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "final_1", expectedCaseVersion: 3, action: "clear_for_downstream",
      selectedDraftRevisionIds: [], internalNote: "Reviewed synthetic fixture.",
    });
    expect(final).toMatchObject({ action: "clear_for_downstream", caseVersion: 4 });
    await expect(service.submitFinalReview({
      caseId: reviewFixture.caseId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "final_1", expectedCaseVersion: 3, action: "clear_for_downstream",
      selectedDraftRevisionIds: [],
    })).resolves.toEqual(final);
    await expect(new PostgresCaseQueryService(connection.db).get(reviewFixture.caseId)).resolves.toMatchObject({
      lifecycle: "review_complete", finalReviewAction: "clear_for_downstream", version: 4,
    });
    await expect(service.editIssue({
      caseId: reviewFixture.caseId, issueId: created.issueId, resultRevisionId: reviewFixture.resultRevisionId,
      commandId: "edit_after_final", expectedIssueVersion: 3, title: "Late edit",
      description: "This edit must not be accepted.", recommendedAction: "Please provide information.",
      supportingReferences: [], noReferenceReason: "Attempted after final review.",
    })).rejects.toMatchObject({ code: "stale_review" });
    const persistedIssues = await new PostgresCaseQueryService(connection.db).getIssues(reviewFixture.caseId);
    expect(persistedIssues).toEqual(expect.arrayContaining([expect.objectContaining({
      reviewState: "confirmed", version: 2,
      requestedChange: expect.objectContaining({ draftRevisionId: firstDraft.draftRevisionId, revision: 1, included: false }),
    }), expect.objectContaining({
      issueId: created.issueId, origin: "human", title: "Missing document page",
      description: "One supporting document page appears to be missing.", editRevision: 2,
      reviewState: "confirmed", version: 3,
    })]));
    const queries = new PostgresCaseQueryService(connection.db);
    await expect(queries.list("review")).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId }),
    ]));
    await expect(queries.list("changes_requested")).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId }),
    ]));
    await expect(queries.list("completed")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: reviewFixture.caseId, workflowStatus: "ready_for_handoff", issueCount: 2 }),
    ]));
    await expect(queries.getDownstreamHandoff(reviewFixture.caseId)).resolves.toMatchObject({
      caseId: reviewFixture.caseId, status: "ready_for_handoff",
      resultRevision: { id: reviewFixture.resultRevisionId, revision: 1 },
      finalReview: { action: "clear_for_downstream", reviewerId: "reviewer_1", resultingCaseVersion: 4 },
      claims: [{ fieldSchemaId: "fixture.field", normalizedValue: "fixture",
        evidenceReferences: [expect.stringContaining(`/evidence/`)] }],
      findings: expect.arrayContaining([expect.objectContaining({ ruleId: "VAL_EMPLOYER_CONSISTENCY_001" })]),
    });
    await expect(queries.getAgentLog(reviewFixture.caseId)).resolves.toMatchObject({ currentStep: "review_completed" });
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
