import { describe, expect, it, vi } from "vitest";
import { AGENT_STEP_PHASES, AGENT_STEP_PHASE_VOCABULARY_VERSION, EMPTY_AGENT_CONSUMED_BUDGET, addConsumedBudget, evaluateAgentSessionCompatibility, type AgentSessionConfiguration, processCase, reconcileSingleAcceptedCandidate, type CasePipelinePorts, type ExtractionCandidate } from "./index.js";

describe("processCase", () => {
  it("runs the bounded processing stages in order", async () => {
    const calls: string[] = [];
    const stage = (name: string) => vi.fn(async () => void calls.push(name));
    const ports: CasePipelinePorts = {
      inspector: { inspect: stage("inspect") },
      extractor: { extract: stage("extract") },
      validator: { validate: stage("validate") },
      agentReporter: { generate: stage("agent_report") },
    };

    await processCase("case_1", "run_1", ports);

    expect(calls).toEqual(["inspect", "extract", "validate", "agent_report"]);
  });
});

describe("candidate reconciliation", () => {
  const candidate = (candidateId: string, qualityStatus: ExtractionCandidate["qualityStatus"]): ExtractionCandidate => ({
    candidateId, fieldSchemaId: "organization.name", fieldSchemaVersion: "1.0.0", valueType: "string",
    rawValue: "Beispieltechnik GmbH", normalizedValue: "beispieltechnik gmbh",
    extractionMethod: "deterministic_fixture", processorVersion: "1.0.0", evidenceIds: ["evidence-1"],
    source: { type: "logical_document", logicalDocumentRevisionId: "logical-document-1" }, qualityStatus,
  });

  it("selects the only accepted candidate", () => {
    expect(reconcileSingleAcceptedCandidate("organization.name", [candidate("one", "accepted"), candidate("two", "rejected")]))
      .toMatchObject({ status: "selected", selectedCandidateId: "one", reason: "one_accepted_candidate" });
  });

  it("preserves competing accepted candidates without selecting one", () => {
    const result = reconcileSingleAcceptedCandidate("organization.name", [candidate("one", "accepted"), candidate("two", "accepted")]);
    expect(result).toMatchObject({ status: "unresolved", reason: "competing_accepted_candidates" });
    expect(result.candidates).toEqual([
      { candidateId: "one", status: "not_selected" }, { candidateId: "two", status: "not_selected" },
    ]);
  });
});

describe("Agent session compatibility", () => {
  const budget = {
    maxIterations: 14, maxToolCalls: 18, maxModelCalls: 14, maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, maxEstimatedCostUsd: 0.25, maxVlmCalls: 2, maxOcrPages: 3, maxConsecutiveNoProgressSteps: 2,
  };
  const configuration: AgentSessionConfiguration = {
    mode: "case_review", harnessId: "pi", harnessVersion: "pi-coding-agent@0.85.1",
    modelLabel: "findoc-fake/case-review-script-v1", modelRoute: "fake",
    promptVersion: "case-review-prompt-2.0.0", promptHash: "abc",
    configurationVersion: "pi-harness-1.1.0", toolRegistryVersion: "case-review-tools-2.0.0",
    contextManifestVersion: "case-review-context-1.0.0:1234", offeredTools: ["list"], budget,
  };

  it("accepts an identical configuration", () => {
    expect(evaluateAgentSessionCompatibility(configuration, { ...configuration })).toEqual({ compatible: true });
  });

  it("rejects each changed identity dimension with a stable reason code", () => {
    const cases: readonly [Partial<AgentSessionConfiguration>, string][] = [
      [{ harnessVersion: "pi-coding-agent@0.86.0" }, "harness_version_changed"],
      [{ harnessId: "other" }, "harness_changed"],
      [{ configurationVersion: "pi-harness-2.0.0" }, "harness_configuration_changed"],
      [{ toolRegistryVersion: "case-review-tools-3.0.0" }, "tool_registry_changed"],
      [{ contextManifestVersion: "case-review-context-1.0.0:9999" }, "context_manifest_changed"],
      [{ promptHash: "def" }, "prompt_changed"],
      [{ modelRoute: "live" }, "model_route_changed"],
      [{ modelLabel: "anthropic/claude" }, "model_changed"],
      [{ budget: { ...budget, maxOcrPages: 9 } }, "budget_changed"],
    ];
    for (const [change, reasonCode] of cases) {
      const result = evaluateAgentSessionCompatibility(configuration, { ...configuration, ...change });
      expect(result.compatible).toBe(false);
      if (!result.compatible) expect(result.reasonCodes).toContain(reasonCode);
    }
  });

  it("keeps the registered step-phase vocabulary versioned and complete", () => {
    expect(AGENT_STEP_PHASE_VOCABULARY_VERSION).toBe("agent-step-phase-1.0.0");
    expect(AGENT_STEP_PHASES).toEqual([
      "planning", "document_inspection", "extraction", "reconciliation", "validation", "report_submission", "terminal",
    ]);
  });

  it("accumulates consumed budget and never restores unavailable usage", () => {
    const first = addConsumedBudget(EMPTY_AGENT_CONSUMED_BUDGET, { iterations: 2, toolCalls: 1, ocrPages: 1, costUsd: 0.5 });
    expect(first).toMatchObject({ iterations: 2, toolCalls: 1, ocrPages: 1, costUsd: 0.5, usageAvailable: true });
    const second = addConsumedBudget(first, { iterations: 1, usageAvailable: false });
    expect(second).toMatchObject({ iterations: 3, usageAvailable: false });
    expect(addConsumedBudget(second, { iterations: 1 }).usageAvailable).toBe(false);
  });
});
