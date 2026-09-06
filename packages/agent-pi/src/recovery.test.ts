import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET, evaluateRecoveryEligibility, type AdaptiveRecoveryContext, type RecoveryToolPorts } from "@findoc/agent";
import { ADAPTIVE_RECOVERY_TOOL_NAMES, FAKE_RECOVERY_SCRIPTS, PiAdaptiveRecoveryHarness, buildRecoveryUserMessage } from "./index.js";

const DOCUMENT = "6a0d9b4e-0d5e-4a9e-9d0c-1b2c3d4e5f60";

function context(): AdaptiveRecoveryContext {
  return {
    runId: "run-1",
    gaps: [{
      gapId: "gap-income", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money", required: true,
      originatingStage: "extract", reasonCode: "scanned_page_value_unresolved", attemptedPaths: ["native_text", "fixture_ocr"],
      scope: { documentVersionId: DOCUMENT, logicalDocumentRevisionId: "logical-payslip", pageNumber: 2 },
    }],
    pages: [1, 2, 3].map((pageNumber) => ({ documentVersionId: DOCUMENT, logicalDocumentRevisionId: `logical-${pageNumber}`, pageNumber, needsOcr: pageNumber === 2, ocrAvailable: pageNumber === 2, nativeCharacterCount: pageNumber === 2 ? 0 : 900, renderAvailable: true })),
    fieldSchemas: [{ fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money" }],
  };
}

function ports(calls: string[] = []): RecoveryToolPorts {
  const region = { x: 0.55, y: 0.42, width: 0.2, height: 0.04 };
  return {
    inspectPage: async (page) => { calls.push(`inspect:${page.pageNumber}`); return { needsOcr: page.pageNumber === 2, hasTable: false, hasColumns: false, nativeCharacterCount: page.pageNumber === 2 ? 0 : 900, renderAvailable: true, ocrAvailable: page.pageNumber === 2 }; },
    getNativeText: async (page) => { calls.push(`native:${page.pageNumber}`); return { available: page.pageNumber !== 2, text: page.pageNumber === 2 ? "" : "SYNTHETIC DEMO PAGE", truncated: false }; },
    runOcr: async (page) => { calls.push(`ocr:${page.pageNumber}`); return { engine: "fake-fixture-ocr", engineVersion: "1.0.0", modelAssetVersion: "fixture", reusedCommittedOutput: true, lines: [{ text: "Nettoeinkommen", region: { x: 0.1, y: 0.42, width: 0.3, height: 0.04 }, rawConfidence: 0.98 }, { text: "2980.00", region, rawConfidence: 0.97 }] }; },
    renderPageRegion: async (page) => { calls.push(`render:${page.pageNumber}`); return { artifactReference: `render:${page.documentVersionId}:${page.pageNumber}`, width: 300, height: 60 }; },
    classifyPage: async () => ({ candidates: [{ type: "payslip", rawConfidence: 0.99 }], method: "synthetic-demo-heading", version: "1.0.0" }),
    detectDocumentBoundaries: async (page) => ({ startsNewDocument: page.pageNumber === 1, method: "fake", version: "1.0.0" }),
    extractLocalTable: async () => ({ available: false, rowCount: 0 }),
    extractWithVlm: async (request) => { calls.push(`vlm:${request.page.pageNumber}:${request.fieldSchemaId}`); return { modelLabel: "fake-vlm-gateway", promptVersion: "income-extract-1.0.0", value: { rawValue: "2980.00", normalizedValue: { amount: "2980.00", currency: "EUR" }, region, rawConfidence: 0.91 }, usage: { inputTokens: 10, outputTokens: 5 } }; },
  };
}

function harness(script: keyof typeof FAKE_RECOVERY_SCRIPTS, budget: Partial<typeof DEFAULT_AGENT_BUDGET> = {}) {
  return new PiAdaptiveRecoveryHarness({ model: { route: "fake", script: FAKE_RECOVERY_SCRIPTS[script], scriptLabel: script }, budget: { ...DEFAULT_AGENT_BUDGET, ...budget } });
}

const stepView = (trace: { steps: readonly { toolName: string; outcome: string }[] }) => trace.steps.map((step) => `${step.toolName}:${step.outcome}`);

describe("PiAdaptiveRecoveryHarness", () => {
  it("exposes only the registered document-recovery tools", async () => {
    const outcome = await harness("standard").recover(context(), ports());
    expect(outcome.trace.offeredTools).toEqual([...ADAPTIVE_RECOVERY_TOOL_NAMES]);
    expect(outcome.trace.offeredTools).toHaveLength(10);
    for (const name of ["bash", "read", "edit", "write", "grep", "find", "ls"]) expect(outcome.trace.offeredTools).not.toContain(name);
  });

  it("recovers a gap through inspect, OCR, VLM extraction, and an evidence-backed submission", async () => {
    const calls: string[] = [];
    const outcome = await harness("standard").recover(context(), ports(calls));
    expect(stepView(outcome.trace)).toEqual(["get_extraction_gaps:succeeded", "inspect_page:succeeded", "run_ocr:succeeded", "extract_with_vlm:succeeded", "submit_extraction_candidates:succeeded"]);
    expect(calls).toEqual(["inspect:2", "ocr:2", "vlm:2:income.monthly_net"]);
    expect(outcome.candidates).toEqual([{
      gapId: "gap-income", fieldSchemaId: "income.monthly_net", fieldSchemaVersion: "1.0.0", valueType: "money",
      rawValue: "2980.00", normalizedValue: { amount: "2980.00", currency: "EUR" },
      page: { documentVersionId: DOCUMENT, pageNumber: 2 }, region: { x: 0.55, y: 0.42, width: 0.2, height: 0.04 },
      extractionMethod: "agent_vlm_extraction", processorVersion: "fake-vlm-gateway/income-extract-1.0.0",
    }]);
    expect(outcome.trace).toMatchObject({ mode: "case_review", terminalReason: "report_not_submitted", iterations: 5, toolCalls: 5, boundGapIds: ["gap-income"] });
  });

  it("rejects out-of-scope pages and values without tool evidence, then still recovers", async () => {
    const calls: string[] = [];
    const outcome = await harness("overreaching", { maxConsecutiveNoProgressSteps: 4 }).recover(context(), ports(calls));
    expect(stepView(outcome.trace)).toEqual([
      "get_extraction_gaps:succeeded",
      "get_native_text:authorization_rejected",
      "submit_extraction_candidates:authorization_rejected",
      "inspect_page:succeeded",
      "run_ocr:succeeded",
      "extract_with_vlm:succeeded",
      "submit_extraction_candidates:succeeded",
    ]);
    expect(calls).not.toContain("native:1");
    expect(outcome.candidates.map((candidate) => candidate.rawValue)).toEqual(["2980.00"]);
  });

  it("stops at the VLM-call budget without a submission", async () => {
    const outcome = await harness("standard", { maxVlmCalls: 0 }).recover(context(), ports());
    expect(stepView(outcome.trace).at(-1)).toBe("extract_with_vlm:budget_rejected");
    expect(outcome.trace.terminalReason).toBe("tool_budget_exhausted");
    expect(outcome.candidates).toEqual([]);
  });

  it("stops at the OCR-page budget", async () => {
    const outcome = await harness("standard", { maxOcrPages: 0 }).recover(context(), ports());
    expect(stepView(outcome.trace).at(-1)).toBe("run_ocr:budget_rejected");
    expect(outcome.trace.terminalReason).toBe("tool_budget_exhausted");
  });

  it("stops with no_progress when the model repeats itself or stays silent", async () => {
    const runaway = await harness("runaway").recover(context(), ports());
    expect(runaway.trace.terminalReason).toBe("no_progress");
    const silent = await harness("silent").recover(context(), ports());
    expect(silent.trace).toMatchObject({ terminalReason: "no_progress", toolCalls: 0 });
    expect(silent.candidates).toEqual([]);
  });

  it("stops at the wall-clock budget", async () => {
    const outcome = await harness("stall", { maxWallClockMs: 150 }).recover(context(), ports());
    expect(outcome.trace).toMatchObject({ terminalReason: "timeout", steps: [] });
  });

  it("keeps the recovery user message free of document content and deterministic", () => {
    const message = buildRecoveryUserMessage(context());
    expect(message).toBe(buildRecoveryUserMessage(context()));
    expect(message).not.toContain("2980");
    expect(message).toContain("gap-income");
  });
});

describe("evaluateRecoveryEligibility", () => {
  const registeredToolNames = [...ADAPTIVE_RECOVERY_TOOL_NAMES];

  it("marks a required gap with attempted fixed paths eligible", () => {
    const decision = evaluateRecoveryEligibility({ gaps: context().gaps, pages: context().pages, registeredToolNames, budgetAvailable: true, fatalFailure: false }, "decision-1");
    expect(decision).toMatchObject({ decision: "eligible", reasonCodes: ["eligible_required_gap"], gapIds: ["gap-income"], policyVersion: "recovery-eligibility-1.0.0" });
  });

  it("refuses to start for missing fixed paths, fatal failures, absent budget, or out-of-run scope", () => {
    const base = context();
    const gap = base.gaps[0]!;
    expect(evaluateRecoveryEligibility({ gaps: [{ ...gap, attemptedPaths: [] }], pages: base.pages, registeredToolNames, budgetAvailable: true, fatalFailure: false }, "d").reasonCodes).toContain("fixed_paths_incomplete");
    expect(evaluateRecoveryEligibility({ gaps: base.gaps, pages: base.pages, registeredToolNames, budgetAvailable: true, fatalFailure: true }, "d").reasonCodes).toContain("fatal_processing_failure");
    expect(evaluateRecoveryEligibility({ gaps: base.gaps, pages: base.pages, registeredToolNames, budgetAvailable: false, fatalFailure: false }, "d").reasonCodes).toContain("budget_unavailable");
    expect(evaluateRecoveryEligibility({ gaps: base.gaps, pages: [], registeredToolNames, budgetAvailable: true, fatalFailure: false }, "d").reasonCodes).toContain("gap_scope_outside_run");
    expect(evaluateRecoveryEligibility({ gaps: [], pages: base.pages, registeredToolNames, budgetAvailable: true, fatalFailure: false }, "d")).toMatchObject({ decision: "ineligible", reasonCodes: ["no_open_required_gap"] });
    expect(evaluateRecoveryEligibility({ gaps: base.gaps, pages: base.pages, registeredToolNames: ["list_findings"], budgetAvailable: true, fatalFailure: false }, "d").reasonCodes).toContain("no_relevant_registered_tool");
  });
});
