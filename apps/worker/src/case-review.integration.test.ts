import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentLedCaseReviewHarness } from "@findoc/agent";
import { PiAgentLedCaseReviewHarness, policyViolationCaseReviewScript } from "@findoc/agent-pi";
import type { AgentSessionLifecyclePort, BeginAgentSessionInput, CommitAgentStepInput, TerminalizeAgentSessionInput } from "@findoc/core";
import {
  PostgresAgentSessionLifecycle, PostgresCaseCommandService, PostgresCaseQueryService, PostgresWorkflowCoordinator,
  agentReports, agentSessionAttempts, agentSessions, agentSteps, agentToolInvocations, cases, createDatabase,
  extractionCandidates, extractionGaps, gapResolutions, recommendedDispositions, resultRevisions, validationFindings,
} from "@findoc/persistence";
import { processAgentLedCaseReview } from "./case-review.js";

const FIXTURE_ID = "golden-006-scanned-adaptive-unavailable";
const WORKER_LOST = "worker terminated";

/** Test-only lifecycle that stops accepting durable writes once the named tool's step is committed. */
class TerminateAfterToolCommit implements AgentSessionLifecyclePort {
  private armed = true;
  constructor(private readonly inner: AgentSessionLifecyclePort, private readonly toolName: string) {}
  async beginSession(input: BeginAgentSessionInput) { return this.inner.beginSession(input); }
  async commitStep(input: CommitAgentStepInput) {
    if (!this.armed) throw new Error(WORKER_LOST);
    const result = await this.inner.commitStep(input);
    if (input.toolName === this.toolName && input.outcome === "succeeded") this.armed = false;
    return result;
  }
  async terminalizeSession(input: TerminalizeAgentSessionInput) {
    if (!this.armed) throw new Error(WORKER_LOST);
    return this.inner.terminalizeSession(input);
  }
  async loadSnapshot(runId: string) { return this.inner.loadSnapshot(runId); }
}

const silentLogger = { info: () => {}, warn: () => {} };

describe("Worker termination during Agent-led case review", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connection: ReturnType<typeof createDatabase>;
  let coordinator: PostgresWorkflowCoordinator;
  let durable: PostgresAgentSessionLifecycle;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.4-alpine").start();
    connection = createDatabase(container.getConnectionUri());
    await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL("../../../packages/persistence/migrations", import.meta.url)) });
    coordinator = new PostgresWorkflowCoordinator(connection.db);
    durable = new PostgresAgentSessionLifecycle(connection.db);
  }, 120_000);

  afterAll(async () => {
    await connection.client.end();
    await container.stop();
  });

  function harnessWith(lifecycle: AgentSessionLifecyclePort): (fixtureId: unknown) => AgentLedCaseReviewHarness {
    const harness = new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: policyViolationCaseReviewScript, scriptLabel: "policy_violation" }, lifecycle });
    return () => harness;
  }

  /** One scanned three-page synthetic case whose payslip page needs the bounded OCR and model path. */
  async function prepareCase(key: string) {
    const accepted = await new PostgresCaseCommandService(connection.db, `actor_${key}`).accept({
      applicantDisplayName: "Greta Demofall", idempotencyKey: key,
      applicationData: {
        applicant_display_name: "Greta Demofall", demo_fixture_id: FIXTURE_ID,
        employment: { employer: "Demowerk GmbH" }, income: { monthly_net: "3050.00", currency: "EUR", basis: "net" },
      },
      documents: [{
        submittedFilename: `${key}.pdf`,
        artifact: { objectKey: `source/${key}`, sha256: key.padEnd(64, "0").slice(0, 64), byteSize: 2048, detectedMediaType: "application/pdf" as const },
      }],
    });
    await coordinator.markRunRunning(accepted.caseId, accepted.runId);
    const [document] = await coordinator.loadUninspectedDocuments(accepted.caseId, accepted.runId);
    if (!document) throw new Error("Expected one uninspected document");
    await coordinator.persistInspection(accepted.runId, document, {
      processor: "firecrawl/pdf-inspector", processorVersion: "1.17.0",
      pdfType: "mixed", routingSignal: 0.5, isComplex: false,
      pages: [1, 2, 3].map((pageNumber) => ({
        pageNumber, needsOcr: pageNumber === 2, ...(pageNumber === 2 ? { ocrReason: "no_native_text" } : {}),
        hasTable: false, hasColumns: false, nativeCharacterCount: pageNumber === 2 ? 0 : 320,
        ...(pageNumber === 2 ? {} : {
          nativeTextArtifact: { caseId: accepted.caseId, objectKey: `derived/${key}/native/page-${pageNumber}`, sha256: `n${pageNumber}`.padEnd(64, "0"), byteSize: 32, mediaType: "text/markdown" as const },
        }),
        renderArtifact: {
          caseId: accepted.caseId, objectKey: `derived/${key}/render/page-${pageNumber}`, sha256: `r${pageNumber}`.padEnd(64, "0"),
          byteSize: 64, mediaType: "image/png" as const, width: 935, height: 1210, targetDpi: 110, rendererVersion: "@hyzyla/pdfium-2.1.13",
        },
        ...(pageNumber === 2 ? {
          ocrArtifact: {
            caseId: accepted.caseId, objectKey: `derived/${key}/ocr/page-2`, sha256: "o".repeat(64), byteSize: 128,
            mediaType: "application/json" as const, engine: "deterministic-fake-ocr", engineVersion: "1.0.0",
            modelAssetVersion: "synthetic-fixture-v1", languages: ["de", "en"], coordinateSpace: "render_pixels_top_left",
          },
        } : {}),
      })),
      classifications: [1, 2, 3].map((pageNumber) => ({
        pageNumber, selectedType: pageNumber === 1 ? "identity_document" : pageNumber === 2 ? "payslip" : "bank_statement",
        method: "synthetic-demo-heading-classifier", version: "1.0.0", qualityStatus: "accepted" as const,
        rawConfidence: { value: 1, scale: "zero_to_one" as const, producer: "deterministic-demo-rule" }, alternatives: [],
      })),
      boundaries: [2, 3].map((pageNumber) => ({
        pageNumber, startsNewDocument: true, method: "synthetic-demo-heading-boundary", version: "1.0.0",
        rawConfidence: { value: 1, scale: "zero_to_one" as const, producer: "deterministic-demo-rule" },
      })),
      logicalDocuments: [1, 2, 3].map((pageNumber) => ({
        startPage: pageNumber, endPage: pageNumber,
        documentType: pageNumber === 1 ? "identity_document" : pageNumber === 2 ? "payslip" : "bank_statement",
        uncertain: false, pageNumbers: [pageNumber],
      })),
    });
    return accepted;
  }

  /** Every count is scoped to one run so parallel fixtures cannot leak into an assertion. */
  async function tally(runId: string, caseId: string) {
    const [session] = await connection.db.select({ id: agentSessions.id }).from(agentSessions).where(eq(agentSessions.runId, runId));
    const [revision] = await connection.db.select({ id: resultRevisions.id }).from(resultRevisions).where(eq(resultRevisions.runId, runId));
    const gapRows = await connection.db.select({ id: extractionGaps.id }).from(extractionGaps).where(eq(extractionGaps.runId, runId));
    const scoped = async (query: Promise<{ value: number }[]>) => (await query)[0]?.value ?? 0;
    const [caseRow] = await connection.db.select({ lifecycle: cases.lifecycle }).from(cases).where(eq(cases.id, caseId)).limit(1);
    return {
      sessions: await scoped(connection.db.select({ value: count() }).from(agentSessions).where(eq(agentSessions.runId, runId))),
      attempts: session ? await scoped(connection.db.select({ value: count() }).from(agentSessionAttempts).where(eq(agentSessionAttempts.sessionId, session.id))) : 0,
      invocations: session ? await scoped(connection.db.select({ value: count() }).from(agentToolInvocations).where(eq(agentToolInvocations.sessionId, session.id))) : 0,
      revisions: await scoped(connection.db.select({ value: count() }).from(resultRevisions).where(eq(resultRevisions.runId, runId))),
      findings: revision ? await scoped(connection.db.select({ value: count() }).from(validationFindings).where(eq(validationFindings.resultRevisionId, revision.id))) : 0,
      dispositions: revision ? await scoped(connection.db.select({ value: count() }).from(recommendedDispositions).where(eq(recommendedDispositions.resultRevisionId, revision.id))) : 0,
      reports: await scoped(connection.db.select({ value: count() }).from(agentReports).where(eq(agentReports.runId, runId))),
      candidates: await scoped(connection.db.select({ value: count() }).from(extractionCandidates).where(eq(extractionCandidates.runId, runId))),
      gaps: gapRows.length,
      resolutions: gapRows[0] ? await scoped(connection.db.select({ value: count() }).from(gapResolutions).where(eq(gapResolutions.gapId, gapRows[0].id))) : 0,
      lifecycle: caseRow?.lifecycle,
    };
  }

  it("completes the uninterrupted case-review stage once", async () => {
    const accepted = await prepareCase("baseline");
    const outcome = await processAgentLedCaseReview({ coordinator, selectHarness: harnessWith(durable), logger: silentLogger }, { case_id: accepted.caseId, run_id: accepted.runId });
    expect(outcome).toBe("completed");
    const counts = await tally(accepted.runId, accepted.caseId);
    expect(counts).toMatchObject({ sessions: 1, revisions: 1, reports: 1, gaps: 1, resolutions: 1, lifecycle: "ready_for_review" });
    const [session] = await connection.db.select({ id: agentSessions.id }).from(agentSessions).where(eq(agentSessions.runId, accepted.runId));
    const steps = await connection.db.select().from(agentSteps).where(eq(agentSteps.sessionId, session!.id)).orderBy(agentSteps.sequence);
    expect(steps.map((step) => step.toolName)).toEqual([
      "get_extraction_gaps", "inspect_page", "run_ocr", "extract_with_vlm", "submit_extraction_candidates",
      "request_reconciliation", "request_validation", "get_current_result", "submit_case_review_brief",
    ]);
  });

  const boundaries = [
    { name: "document inspection", tool: "inspect_page" },
    { name: "fake OCR output", tool: "run_ocr" },
    { name: "model extraction output", tool: "extract_with_vlm" },
    { name: "extraction candidate submission", tool: "submit_extraction_candidates" },
    { name: "deterministic reconciliation", tool: "request_reconciliation" },
    { name: "deterministic validation and result sealing", tool: "request_validation" },
  ] as const;

  it.each(boundaries)("recovers after the Worker is lost following the $name commit", async ({ tool }) => {
    const accepted = await prepareCase(`lost_${tool}`);
    const job = { case_id: accepted.caseId, run_id: accepted.runId };
    const faulted = new TerminateAfterToolCommit(durable, tool);

    await expect(processAgentLedCaseReview({ coordinator, selectHarness: harnessWith(faulted), logger: silentLogger }, job))
      .rejects.toThrow(WORKER_LOST);
    const interrupted = await durable.loadSnapshot(accepted.runId);
    expect(interrupted?.status).toBe("running");
    expect(interrupted?.steps.map((step) => step.toolName)).toContain(tool);
    const consumedBeforeRecovery = interrupted?.consumed;

    const outcome = await processAgentLedCaseReview({ coordinator, selectHarness: harnessWith(durable), logger: silentLogger }, job);
    expect(outcome).toBe("completed");

    const counts = await tally(accepted.runId, accepted.caseId);
    expect(counts).toMatchObject({ sessions: 1, attempts: 2, revisions: 1, findings: 5, dispositions: 1, reports: 1, gaps: 1, resolutions: 1, lifecycle: "ready_for_review" });
    const recovered = await durable.loadSnapshot(accepted.runId);
    expect(recovered).toMatchObject({ status: "terminal", terminalReason: "report_submitted", attempts: 2 });
    expect(recovered?.consumed.iterations).toBeGreaterThanOrEqual(consumedBeforeRecovery?.iterations ?? 0);
    expect(recovered?.consumed.ocrPages).toBe(1);
    expect(recovered?.consumed.vlmCalls).toBe(1);
    const sequences = recovered?.steps.map((step) => step.sequence) ?? [];
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(recovered?.steps.filter((step) => step.toolName === "submit_case_review_brief" && step.outcome === "succeeded")).toHaveLength(1);

    const report = await new PostgresCaseQueryService(connection.db).getAgentReport(accepted.caseId);
    expect(report).toMatchObject({ availability: "unavailable", failureReason: "policy_rejected_loan_approval" });
  }, 120_000);

  it("does not create a second report when the Worker is lost after report completion", async () => {
    const accepted = await prepareCase("lost_after_report");
    const job = { case_id: accepted.caseId, run_id: accepted.runId };
    await expect(processAgentLedCaseReview({
      coordinator, selectHarness: harnessWith(durable), logger: silentLogger,
      afterReportCommitted: async () => { throw new Error(WORKER_LOST); },
    }, job)).rejects.toThrow(WORKER_LOST);

    const outcome = await processAgentLedCaseReview({ coordinator, selectHarness: harnessWith(durable), logger: silentLogger }, job);
    expect(outcome).toBe("completed");
    const counts = await tally(accepted.runId, accepted.caseId);
    expect(counts).toMatchObject({ sessions: 1, revisions: 1, reports: 1, lifecycle: "ready_for_review" });
    const recovered = await durable.loadSnapshot(accepted.runId);
    expect(recovered).toMatchObject({ status: "terminal", terminalReason: "report_submitted", attempts: 1 });
  }, 120_000);
});
