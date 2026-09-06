import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AgentSessionIncompatibleError, AgentSessionTerminalError, AgentStepConflictError,
  type AgentSessionConfiguration, type CommitAgentStepInput,
} from "@findoc/core";
import {
  PostgresAgentSessionLifecycle, PostgresCaseCommandService, agentSessionAttempts, agentSessions,
  agentSteps, agentToolInvocations, createDatabase,
} from "./index.js";

const budget = {
  maxIterations: 14, maxToolCalls: 18, maxModelCalls: 14, maxInputTokens: 60_000, maxOutputTokens: 8_000,
  maxWallClockMs: 60_000, maxEstimatedCostUsd: 0.25, maxVlmCalls: 2, maxOcrPages: 3, maxConsecutiveNoProgressSteps: 2,
};

const configuration: AgentSessionConfiguration = {
  mode: "case_review", harnessId: "pi-agent-led-case-review-harness", harnessVersion: "pi-coding-agent@0.85.1",
  modelLabel: "findoc-fake/case-review-script-v1", modelRoute: "fake",
  promptVersion: "case-review-prompt-2.0.0", promptHash: "prompt-hash",
  configurationVersion: "pi-harness-1.1.0", toolRegistryVersion: "case-review-tools-2.0.0",
  contextManifestVersion: "case-review-context-1.0.0:abcd", offeredTools: ["get_extraction_gaps"], budget,
};

describe("PostgresAgentSessionLifecycle", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connection: ReturnType<typeof createDatabase>;
  let lifecycle: PostgresAgentSessionLifecycle;
  let sequence = 0;

  async function newRun(key: string) {
    const service = new PostgresCaseCommandService(connection.db, "actor_lifecycle");
    return service.accept({
      applicantDisplayName: "Greta Demofall", idempotencyKey: key,
      applicationData: { applicant_display_name: "Greta Demofall", demo_fixture_id: "golden-001-native-clear" },
    });
  }

  function step(overrides: Partial<CommitAgentStepInput> & Pick<CommitAgentStepInput, "sessionId" | "attemptId">): CommitAgentStepInput {
    sequence += 1;
    return {
      sequence, phase: "document_inspection", toolName: "inspect_page", toolVersion: "1.0.0",
      argumentHash: `hash-${sequence}`, outcome: "succeeded", summary: `Inspected page ${sequence}`,
      startedAt: "2026-09-06T10:00:00.000Z", completedAt: "2026-09-06T10:00:01.000Z",
      budgetDelta: { toolCalls: 1, iterations: 1 }, budgetState: { iterationsUsed: 1, toolCallsUsed: 1 },
      ...overrides,
    };
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.4-alpine").start();
    connection = createDatabase(container.getConnectionUri());
    await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
    lifecycle = new PostgresAgentSessionLifecycle(connection.db);
  });

  afterAll(async () => {
    await connection.client.end();
    await container.stop();
  });

  it("keeps one authoritative session identity for duplicate and concurrent delivery", async () => {
    const accepted = await newRun("lifecycle_identity");
    const begin = { caseId: accepted.caseId, runId: accepted.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" };
    const first = await lifecycle.beginSession(begin);
    const second = await lifecycle.beginSession(begin);
    expect(second.sessionId).toBe(first.sessionId);
    expect([first.attemptNumber, second.attemptNumber]).toEqual([1, 2]);
    expect([first.startReason, second.startReason]).toEqual(["initial", "recovery"]);
    expect([first.resumed, second.resumed]).toEqual([false, true]);

    const concurrent = await newRun("lifecycle_concurrent");
    const concurrentBegin = { caseId: concurrent.caseId, runId: concurrent.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" };
    const results = await Promise.all([lifecycle.beginSession(concurrentBegin), lifecycle.beginSession(concurrentBegin)]);
    expect(new Set(results.map((result) => result.sessionId)).size).toBe(1);
    expect([...results.map((result) => result.attemptNumber)].sort()).toEqual([1, 2]);
    const [sessionRows] = await connection.db.select({ value: count() }).from(agentSessions).where(eq(agentSessions.runId, concurrent.runId));
    expect(sessionRows?.value).toBe(1);
    const [attemptRows] = await connection.db.select({ value: count() }).from(agentSessionAttempts).where(eq(agentSessionAttempts.sessionId, results[0]!.sessionId));
    expect(attemptRows?.value).toBe(2);
    const running = await connection.db.select().from(agentSessionAttempts)
      .where(eq(agentSessionAttempts.sessionId, results[0]!.sessionId));
    expect(running.filter((attempt) => attempt.status === "running")).toHaveLength(1);
  });

  it("refuses an incompatible configuration rather than starting over with fresh budgets", async () => {
    const accepted = await newRun("lifecycle_incompatible");
    const begin = { caseId: accepted.caseId, runId: accepted.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" };
    await lifecycle.beginSession(begin);
    await expect(lifecycle.beginSession({ ...begin, configuration: { ...configuration, promptHash: "changed" } }))
      .rejects.toBeInstanceOf(AgentSessionIncompatibleError);
  });

  it("appends each step once, rejects a conflicting sequence, and reuses a committed invocation", async () => {
    const accepted = await newRun("lifecycle_steps");
    const start = await lifecycle.beginSession({ caseId: accepted.caseId, runId: accepted.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" });
    const invocation = {
      idempotencyKey: "inspect_page@1.0.0:args", outputSchemaVersion: "1.0.0", outputHash: "hash-output",
      safeOutput: { page_number: 1 }, producedReferences: [{ kind: "artifact" as const, id: "0f1e2d3c-4b5a-4968-8776-554433221100" }],
      authorizedInputVersions: { documentVersion: "1" }, terminatesSession: false,
    };
    const base = step({ sessionId: start.sessionId, attemptId: start.attemptId, invocation });
    const first = await lifecycle.commitStep(base);
    const replay = await lifecycle.commitStep(base);
    expect(first.alreadyCommitted).toBe(false);
    expect(replay).toMatchObject({ alreadyCommitted: true, stepId: first.stepId, invocationId: first.invocationId });
    await expect(lifecycle.commitStep({ ...base, toolName: "run_ocr" })).rejects.toBeInstanceOf(AgentStepConflictError);

    const reuse = await lifecycle.commitStep(step({ sessionId: start.sessionId, attemptId: start.attemptId, invocation, outcome: "duplicate_resolved", summary: "Reused a committed result", integrityCheck: "hash_match" }));
    expect(reuse.invocationId).toBe(first.invocationId);
    const [invocationRows] = await connection.db.select({ value: count() }).from(agentToolInvocations).where(eq(agentToolInvocations.sessionId, start.sessionId));
    expect(invocationRows?.value).toBe(1);
    const stepRows = await connection.db.select().from(agentSteps).where(eq(agentSteps.sessionId, start.sessionId));
    expect(stepRows).toHaveLength(2);
    expect(stepRows.every((row) => row.attemptId === start.attemptId)).toBe(true);
    expect(stepRows.find((row) => row.outcome === "duplicate_resolved")?.integrityCheck).toBe("hash_match");
  });

  it("preserves consumed budget across attempts and returns a safe snapshot", async () => {
    const accepted = await newRun("lifecycle_budget");
    const begin = { caseId: accepted.caseId, runId: accepted.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" };
    const first = await lifecycle.beginSession(begin);
    await lifecycle.commitStep(step({ sessionId: first.sessionId, attemptId: first.attemptId, budgetDelta: { iterations: 3, toolCalls: 2, ocrPages: 1, vlmCalls: 1, inputTokens: 120, outputTokens: 40, costUsd: 0.125, modelCalls: 3 } }));
    const second = await lifecycle.beginSession(begin);
    expect(second.snapshot.consumed).toMatchObject({
      iterations: 3, toolCalls: 2, ocrPages: 1, vlmCalls: 1, inputTokens: 120, outputTokens: 40, modelCalls: 3, costUsd: 0.125, usageAvailable: true,
    });
    expect(second.snapshot.lastSequence).toBeGreaterThan(0);
    await lifecycle.commitStep(step({ sessionId: second.sessionId, attemptId: second.attemptId, budgetDelta: { iterations: 1, toolCalls: 1, usageAvailable: false } }));
    const snapshot = await lifecycle.loadSnapshot(accepted.runId);
    expect(snapshot).toMatchObject({ status: "running", attempts: 2, configuration: { toolRegistryVersion: "case-review-tools-2.0.0" } });
    expect(snapshot?.consumed).toMatchObject({ iterations: 4, toolCalls: 3, usageAvailable: false });
    expect(Object.keys(snapshot?.steps[0] ?? {}).sort()).toEqual([
      "argumentHash", "budgetState", "completedAt", "outcome", "phase", "sequence", "startedAt", "summary", "toolName", "toolVersion",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("attemptId");
  });

  it("records exactly one terminal reason and refuses later running mutation", async () => {
    const accepted = await newRun("lifecycle_terminal");
    const begin = { caseId: accepted.caseId, runId: accepted.runId, configuration, startedAt: "2026-09-06T10:00:00.000Z" };
    const start = await lifecycle.beginSession(begin);
    const terminal = { sessionId: start.sessionId, attemptId: start.attemptId, completedAt: "2026-09-06T10:10:00.000Z", offeredTools: ["get_extraction_gaps"], budgetDelta: { iterations: 1 } };
    await expect(lifecycle.terminalizeSession({ ...terminal, terminalReason: "report_submitted" })).resolves.toMatchObject({ applied: true, terminalReason: "report_submitted" });
    await expect(lifecycle.terminalizeSession({ ...terminal, terminalReason: "no_progress" })).resolves.toMatchObject({ applied: false, terminalReason: "report_submitted" });
    await expect(lifecycle.commitStep(step({ sessionId: start.sessionId, attemptId: start.attemptId }))).rejects.toBeInstanceOf(AgentSessionTerminalError);
    await expect(lifecycle.beginSession(begin)).rejects.toBeInstanceOf(AgentSessionTerminalError);
    const snapshot = await lifecycle.loadSnapshot(accepted.runId);
    expect(snapshot).toMatchObject({ status: "terminal", terminalReason: "report_submitted" });
    expect(snapshot?.consumed.iterations).toBe(1);
  });

  it("returns no snapshot for a run without an Agent session", async () => {
    const accepted = await newRun("lifecycle_absent");
    await expect(lifecycle.loadSnapshot(accepted.runId)).resolves.toBeUndefined();
  });
});
