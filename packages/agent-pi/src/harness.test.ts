import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET, runVerifiedReport, type CaseReviewContext } from "@findoc/agent";
import { CASE_REVIEW_REPORT_PROMPT_HASH, FAKE_MODEL_SCRIPTS, PiCaseReviewAgentHarness, buildUserMessage } from "./index.js";

const BUILT_IN_PI_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];

function context(): CaseReviewContext {
  return {
    resultRevisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
    findings: [
      { ruleId: "VAL_DOC_COMPLETENESS_001", ruleVersion: "1.0.0", status: "passed", reasonCode: "required_documents_usable", references: ["evidence-1"] },
      { ruleId: "VAL_EMPLOYER_CONSISTENCY_001", ruleVersion: "1.0.0", status: "failed", reasonCode: "employer_conflict", references: ["claim-a", "claim-b"] },
      { ruleId: "VAL_NAME_CONSISTENCY_001", ruleVersion: "1.0.0", status: "passed", reasonCode: "person_names_consistent", references: ["claim-c"] },
    ],
    recommendedDisposition: "human_review_required",
    allowedReferences: new Set(["finding:VAL_DOC_COMPLETENESS_001", "finding:VAL_EMPLOYER_CONSISTENCY_001", "finding:VAL_NAME_CONSISTENCY_001"]),
  };
}

function harness(script: keyof typeof FAKE_MODEL_SCRIPTS, budget: Partial<typeof DEFAULT_AGENT_BUDGET> = {}) {
  return new PiCaseReviewAgentHarness({ model: { route: "fake", script: FAKE_MODEL_SCRIPTS[script], scriptLabel: script }, budget: { ...DEFAULT_AGENT_BUDGET, ...budget } });
}

const stepView = (trace: { steps: readonly { toolName: string; outcome: string }[] }) => trace.steps.map((step) => `${step.toolName}:${step.outcome}`);

describe("PiCaseReviewAgentHarness", () => {
  it("exposes only the registered report tools and no Pi coding tools", async () => {
    const outcome = await harness("standard").generate(context());
    expect(outcome.trace.offeredTools).toEqual(["list_findings", "get_finding_references", "submit_case_review_brief"]);
    for (const name of BUILT_IN_PI_TOOLS) expect(outcome.trace.offeredTools).not.toContain(name);
    expect(outcome.trace.harnessVersion).toMatch(/^pi-coding-agent@\d+\.\d+\.\d+$/);
    expect(outcome.trace.promptHash).toBe(CASE_REVIEW_REPORT_PROMPT_HASH);
  });

  it("produces a verified brief through registered tool calls", async () => {
    const result = await runVerifiedReport(harness("standard"), context());
    expect(result).toMatchObject({ verified: true, brief: { report_status: "ready", attention_items: [{ signal: "validation_finding_requires_attention", references: ["finding:VAL_EMPLOYER_CONSISTENCY_001"] }] } });
    expect(stepView(result.trace)).toEqual(["list_findings:succeeded", "get_finding_references:succeeded", "submit_case_review_brief:succeeded"]);
    expect(result.trace).toMatchObject({ terminalReason: "report_submitted", iterations: 3, toolCalls: 3, modelRoute: "fake", usage: { available: true, modelCalls: 3 }, estimatedCost: { amount: "0.0000", currency: "EUR" } });
    expect(result.trace.usage.inputTokens).toBeGreaterThan(0);
  });

  it("rejects shell, file, and out-of-scope requests without executing them", async () => {
    const result = await runVerifiedReport(harness("injection_attempt", { maxConsecutiveNoProgressSteps: 5 }), context());
    expect(stepView(result.trace)).toEqual([
      "bash:unknown_tool_rejected", "read:unknown_tool_rejected",
      "get_finding_references:authorization_rejected",
      "list_findings:succeeded", "submit_case_review_brief:succeeded",
    ]);
    expect(result.verified).toBe(true);
    expect(result.trace.toolCalls).toBe(2);
  });

  it("stops with no_progress when rejected requests repeat under the default policy", async () => {
    const result = await runVerifiedReport(harness("injection_attempt"), context());
    expect(result).toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "no_progress", toolCalls: 0 } });
    expect(result.originalSubmission).toBeUndefined();
  });

  it("stops with no_progress on repeated identical tool calls", async () => {
    const result = await runVerifiedReport(harness("runaway"), context());
    expect(stepView(result.trace)).toEqual(["list_findings:succeeded", "list_findings:duplicate_resolved", "list_findings:duplicate_resolved"]);
    expect(result.trace.terminalReason).toBe("no_progress");
    expect(result.trace.toolCalls).toBe(1);
  });

  it("stops at the tool-call budget", async () => {
    const result = await runVerifiedReport(harness("injection_attempt", { maxConsecutiveNoProgressSteps: 5, maxToolCalls: 1 }), context());
    expect(stepView(result.trace).at(-1)).toBe("submit_case_review_brief:budget_rejected");
    expect(result).toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "tool_budget_exhausted", toolCalls: 1 } });
  });

  it("stops at the iteration budget", async () => {
    const result = await runVerifiedReport(harness("standard", { maxIterations: 1 }), context());
    expect(stepView(result.trace)).toEqual(["list_findings:succeeded"]);
    expect(result.trace).toMatchObject({ terminalReason: "iteration_budget_exhausted", iterations: 1 });
  });

  it("stops at the token budget", async () => {
    const result = await runVerifiedReport(harness("standard", { maxInputTokens: 1 }), context());
    expect(result.trace).toMatchObject({ terminalReason: "token_budget_exhausted", iterations: 1 });
  });

  it("stops at the estimated-cost budget", async () => {
    const result = await runVerifiedReport(harness("expensive", { maxEstimatedCostUsd: 0.5 }), context());
    expect(result.trace).toMatchObject({ terminalReason: "cost_budget_exhausted", iterations: 1 });
  });

  it("stops at the wall-clock budget", async () => {
    const started = Date.now();
    const result = await runVerifiedReport(harness("stall", { maxWallClockMs: 150 }), context());
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ verified: false, reason: "timeout", trace: { terminalReason: "timeout", steps: [] } });
  });

  it("reports model_unavailable on provider failure", async () => {
    const result = await runVerifiedReport(harness("provider_error"), context());
    expect(result).toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "model_unavailable" } });
  });

  it("records report_not_submitted when the model stops without submitting", async () => {
    const result = await runVerifiedReport(harness("silent"), context());
    expect(result).toMatchObject({ verified: false, reason: "unavailable", trace: { terminalReason: "report_not_submitted", iterations: 1, toolCalls: 0 } });
  });

  it("keeps a policy-violating submission out of the verified report but in the trace", async () => {
    const result = await runVerifiedReport(harness("policy_violation"), context());
    expect(result).toMatchObject({ verified: false, reason: "policy_rejected", trace: { terminalReason: "report_submitted" } });
    expect(result.originalSubmission).toMatchObject({ summary: "Approve the loan." });
  });

  it("rejects a schema-invalid brief at the tool boundary", async () => {
    const script = (turn: number) => turn === 1
      ? { kind: "tool_calls" as const, calls: [{ name: "submit_case_review_brief", args: { brief: { schema_version: "9.9.9" } } }] }
      : { kind: "text" as const, text: "done" };
    const outcome = await new PiCaseReviewAgentHarness({ model: { route: "fake", script } }).generate(context());
    expect(stepView(outcome.trace)).toEqual(["submit_case_review_brief:schema_rejected"]);
    expect(outcome.submission).toBeUndefined();
  });

  it("builds the same session inputs and step records for identical inputs", async () => {
    const [first, second] = await Promise.all([harness("standard").generate(context()), harness("standard").generate(context())]);
    const shape = (trace: typeof first.trace) => trace.steps.map((step) => [step.toolName, step.outcome, step.argumentHash]);
    expect(shape(first.trace)).toEqual(shape(second.trace));
    expect(buildUserMessage(context())).toBe(buildUserMessage(context()));
    expect(buildUserMessage(context())).not.toContain("claim-a");
  });

  it("does not start a live session for an unregistered model route", async () => {
    const live = new PiCaseReviewAgentHarness({ model: { route: "live", provider: "anthropic", modelId: "no-such-model-000", apiKey: "not-a-real-key" } });
    const outcome = await live.generate(context());
    expect(outcome.submission).toBeUndefined();
    expect(outcome.trace).toMatchObject({ terminalReason: "model_unavailable", modelRoute: "live", iterations: 0, offeredTools: [] });
    expect(outcome.trace.estimatedCost).toBeUndefined();
  });
});
