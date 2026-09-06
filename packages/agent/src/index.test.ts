import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET, InMemoryAgentSessionLifecycle, AgentReportExecutionError, FAKE_HARNESS_DESCRIPTOR, FakeCaseReviewAgentHarness, buildSyntheticSessionTrace, canonicalJson, evaluateCaseReviewEligibility, hashArguments, runVerifiedReport, verifyCaseReviewBrief, type CaseReviewContext } from "./index.js";
import { AgentAttemptSupersededError, AgentInvocationConflictError, AgentSessionIncompatibleError, AgentSessionTerminalError, AgentStepConflictError, type AgentSessionConfiguration } from "@findoc/core";

function context(): CaseReviewContext {
  return {
    resultRevisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
    findings: [{ ruleId: "VAL_EMPLOYER_CONSISTENCY_001", status: "failed", reasonCode: "employer_conflict" }],
    recommendedDisposition: "human_review_required",
    allowedReferences: new Set(["finding:VAL_EMPLOYER_CONSISTENCY_001"]),
  };
}

describe("Case Review Brief verification", () => {
  it("accepts the deterministic fake Agent report and records a session trace", async () => {
    const result = await runVerifiedReport(new FakeCaseReviewAgentHarness(), context());
    expect(result).toMatchObject({ verified: true, brief: { report_status: "ready" }, trace: { terminalReason: "report_submitted", harnessId: "fake-case-review-harness", toolCalls: 1 } });
    expect(result.originalSubmission).toEqual(result.verified ? result.brief : undefined);
  });

  it("rejects schema-invalid output", () => {
    expect(verifyCaseReviewBrief({ summary: "Incomplete" }, context())).toEqual({ verified: false, reason: "schema_rejected" });
  });

  it("rejects references outside the result revision", () => {
    const candidate = {
      schema_version: "1.0.0", result_revision_id: context().resultRevisionId, report_status: "ready",
      summary: "Review required.", attention_items: [{
        signal: "validation_finding_requires_attention", suggested_action: "compare_claims",
        description: "Compare the employer values.", references: ["finding:other"],
      }],
    };
    expect(verifyCaseReviewBrief(candidate, context())).toEqual({ verified: false, reason: "reference_rejected" });
  });

  it("rejects prohibited decision language", () => {
    const candidate = {
      schema_version: "1.0.0", result_revision_id: context().resultRevisionId, report_status: "ready",
      summary: "Approve the loan.", attention_items: [],
    };
    expect(verifyCaseReviewBrief(candidate, context())).toEqual({ verified: false, reason: "policy_rejected_loan_approval" });
  });

  it("returns an unavailable outcome when the harness times out", async () => {
    const timeoutHarness = { descriptor: FAKE_HARNESS_DESCRIPTOR, generate: async () => { throw new AgentReportExecutionError("timeout"); } };
    await expect(runVerifiedReport(timeoutHarness, context())).resolves.toMatchObject({ verified: false, reason: "timeout", trace: { terminalReason: "timeout", steps: [] } });
  });

  it("maps a session that ends without a submission to an unavailable report", async () => {
    const harness = {
      descriptor: FAKE_HARNESS_DESCRIPTOR,
      generate: async () => ({ trace: buildSyntheticSessionTrace({ descriptor: FAKE_HARNESS_DESCRIPTOR, steps: [], terminalReason: "tool_budget_exhausted" }) }),
    };
    await expect(runVerifiedReport(harness, context())).resolves.toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "tool_budget_exhausted" } });
  });

  it("hashes arguments canonically regardless of key order", () => {
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: "x" })).toBe('{"a":"x","b":[1,{"c":3,"d":2}]}');
    expect(hashArguments({ a: 1, b: 2 })).toBe(hashArguments({ b: 2, a: 1 }));
  });
});

describe("case-review eligibility", () => {
  const page = { documentVersionId: "document-1", logicalDocumentRevisionId: "logical-1", pageNumber: 1, needsOcr: false, ocrAvailable: true, nativeCharacterCount: 100, renderAvailable: true };
  const tools = ["request_validation", "submit_case_review_brief"];

  it("schedules every processable case, including cases without extraction gaps", () => {
    expect(evaluateCaseReviewEligibility({ gaps: [], pages: [page], registeredToolNames: tools, budgetAvailable: true, fatalFailure: false }, "decision-1"))
      .toMatchObject({ decision: "eligible", reasonCodes: ["processable_case"], gapIds: [], policyVersion: "case-review-eligibility-2.0.0" });
  });

  it("rejects fatal, unbudgeted, stale, or incompletely registered sessions", () => {
    const base = { gaps: [], pages: [page], registeredToolNames: tools, budgetAvailable: true, fatalFailure: false };
    expect(evaluateCaseReviewEligibility({ ...base, fatalFailure: true }, "d").reasonCodes).toContain("fatal_processing_failure");
    expect(evaluateCaseReviewEligibility({ ...base, budgetAvailable: false }, "d").reasonCodes).toContain("budget_unavailable");
    expect(evaluateCaseReviewEligibility({ ...base, previousAttemptWithoutNewInputs: true }, "d").reasonCodes).toContain("equivalent_attempt_completed");
    expect(evaluateCaseReviewEligibility({ ...base, registeredToolNames: [] }, "d").reasonCodes).toContain("required_case_review_tools_unavailable");
  });
});

describe("InMemoryAgentSessionLifecycle", () => {
  const budget = DEFAULT_AGENT_BUDGET;
  const configuration: AgentSessionConfiguration = {
    mode: "case_review", harnessId: "pi", harnessVersion: "pi-coding-agent@0.85.1",
    modelLabel: "findoc-fake/case-review-script-v1", modelRoute: "fake",
    promptVersion: "case-review-prompt-2.0.0", promptHash: "abc",
    configurationVersion: "pi-harness-1.1.0", toolRegistryVersion: "case-review-tools-2.0.0",
    contextManifestVersion: "case-review-context-1.0.0:1234", offeredTools: ["get_extraction_gaps"], budget,
  };
  const begin = { caseId: "case-1", runId: "run-1", configuration, startedAt: "2026-09-06T10:00:00.000Z" };
  const step = (sequence: number, overrides: Partial<Parameters<InMemoryAgentSessionLifecycle["commitStep"]>[0]> = {}) => ({
    sessionId: "", attemptId: "", sequence, phase: "document_inspection" as const, toolName: "inspect_page",
    toolVersion: "1.0.0", argumentHash: `hash-${sequence}`, outcome: "succeeded" as const, summary: `Inspected ${sequence}`,
    startedAt: "2026-09-06T10:00:01.000Z", completedAt: "2026-09-06T10:00:02.000Z",
    budgetDelta: { toolCalls: 1, iterations: 1 }, budgetState: { iterationsUsed: sequence, toolCallsUsed: sequence },
    ...overrides,
  });

  it("returns one authoritative session identity for repeated begins and links later attempts", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const first = await lifecycle.beginSession(begin);
    const second = await lifecycle.beginSession(begin);
    expect(second.sessionId).toBe(first.sessionId);
    expect(first).toMatchObject({ attemptNumber: 1, startReason: "initial", resumed: false });
    expect(second).toMatchObject({ attemptNumber: 2, startReason: "recovery", resumed: true });
    expect(second.attemptId).not.toBe(first.attemptId);
    await expect(lifecycle.commitStep({ ...step(1), sessionId: first.sessionId, attemptId: first.attemptId }))
      .rejects.toBeInstanceOf(AgentAttemptSupersededError);
    await expect(lifecycle.terminalizeSession({
      sessionId: first.sessionId, attemptId: first.attemptId, terminalReason: "internal_error",
      completedAt: "2026-09-06T10:00:03.000Z", offeredTools: [], budgetDelta: {},
    })).rejects.toBeInstanceOf(AgentAttemptSupersededError);
  });

  it("refuses an incompatible configuration instead of silently starting over", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    await lifecycle.beginSession(begin);
    await expect(lifecycle.beginSession({ ...begin, configuration: { ...configuration, toolRegistryVersion: "case-review-tools-3.0.0" } }))
      .rejects.toBeInstanceOf(AgentSessionIncompatibleError);
  });

  it("appends a step exactly once and rejects a conflicting sequence", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const start = await lifecycle.beginSession(begin);
    const base = { ...step(1), sessionId: start.sessionId, attemptId: start.attemptId };
    const first = await lifecycle.commitStep(base);
    const repeat = await lifecycle.commitStep(base);
    expect(first.alreadyCommitted).toBe(false);
    expect(repeat).toMatchObject({ alreadyCommitted: true, stepId: first.stepId });
    await expect(lifecycle.commitStep({ ...base, toolName: "run_ocr" })).rejects.toBeInstanceOf(AgentStepConflictError);
    const snapshot = await lifecycle.loadSnapshot("run-1");
    expect(snapshot?.steps).toHaveLength(1);
  });

  it("resolves a duplicate tool invocation to the committed result without a second side effect", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const start = await lifecycle.beginSession(begin);
    const invocation = {
      idempotencyKey: "inspect_page@1.0.0:hash", outputSchemaVersion: "1.0.0", outputHash: "output-hash",
      safeOutput: { pageNumber: 1 }, producedReferences: [{ kind: "artifact" as const, id: "artifact-1" }],
      authorizedInputVersions: { documentVersion: "v1" }, terminatesSession: false,
    };
    const first = await lifecycle.commitStep({ ...step(1), sessionId: start.sessionId, attemptId: start.attemptId, invocation });
    const second = await lifecycle.commitStep({ ...step(2), sessionId: start.sessionId, attemptId: start.attemptId, invocation });
    expect(second.invocationId).toBe(first.invocationId);
    const snapshot = await lifecycle.loadSnapshot("run-1");
    expect(snapshot?.committedToolResults).toHaveLength(1);
    expect(snapshot?.committedToolResults[0]).toMatchObject({ idempotencyKey: invocation.idempotencyKey, outputHash: "output-hash", safeOutput: { pageNumber: 1 } });
    await expect(lifecycle.commitStep({
      ...step(3), sessionId: start.sessionId, attemptId: start.attemptId,
      invocation: { ...invocation, outputHash: "different-output" },
    })).rejects.toBeInstanceOf(AgentInvocationConflictError);
  });

  it("preserves consumed budgets across a recovery attempt", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const first = await lifecycle.beginSession(begin);
    await lifecycle.commitStep({ ...step(1), sessionId: first.sessionId, attemptId: first.attemptId, budgetDelta: { iterations: 3, toolCalls: 2, ocrPages: 1, costUsd: 0.05 } });
    const second = await lifecycle.beginSession(begin);
    expect(second.snapshot.consumed).toMatchObject({ iterations: 3, toolCalls: 2, ocrPages: 1, costUsd: 0.05 });
    expect(second.snapshot.lastSequence).toBe(1);
    await lifecycle.commitStep({ ...step(2), sessionId: second.sessionId, attemptId: second.attemptId, budgetDelta: { iterations: 1, toolCalls: 1 } });
    const snapshot = await lifecycle.loadSnapshot("run-1");
    expect(snapshot?.consumed).toMatchObject({ iterations: 4, toolCalls: 3, ocrPages: 1 });
    expect(snapshot?.attempts).toBe(2);
  });

  it("records exactly one terminal reason and refuses later mutation", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const start = await lifecycle.beginSession(begin);
    const terminal = { sessionId: start.sessionId, attemptId: start.attemptId, completedAt: "2026-09-06T10:05:00.000Z", offeredTools: ["get_extraction_gaps"], budgetDelta: {} };
    await expect(lifecycle.terminalizeSession({ ...terminal, terminalReason: "report_submitted" })).resolves.toMatchObject({ applied: true, terminalReason: "report_submitted" });
    await expect(lifecycle.terminalizeSession({ ...terminal, terminalReason: "no_progress" })).resolves.toMatchObject({ applied: false, terminalReason: "report_submitted" });
    await expect(lifecycle.commitStep({ ...step(1), sessionId: start.sessionId, attemptId: start.attemptId })).rejects.toBeInstanceOf(AgentSessionTerminalError);
    await expect(lifecycle.beginSession(begin)).rejects.toBeInstanceOf(AgentSessionTerminalError);
    expect((await lifecycle.loadSnapshot("run-1"))?.status).toBe("terminal");
  });

  it("exposes only safe snapshot fields", async () => {
    const lifecycle = new InMemoryAgentSessionLifecycle();
    const start = await lifecycle.beginSession(begin);
    await lifecycle.commitStep({ ...step(1), sessionId: start.sessionId, attemptId: start.attemptId });
    const snapshot = await lifecycle.loadSnapshot("run-1");
    expect(Object.keys(snapshot?.steps[0] ?? {}).sort()).toEqual([
      "argumentHash", "budgetState", "completedAt", "outcome", "phase", "sequence", "startedAt", "summary", "toolName", "toolVersion",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("stepId");
  });
});
