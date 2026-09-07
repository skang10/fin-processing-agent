import { describe, expect, it, vi } from "vitest";
import { canReserveCase, captureEvaluationRun, captureIssueEvidence, capturedUsdCost, reconcileCaseCost, validateCostBudget } from "./capture-evaluation.mjs";
import * as evaluator from "./evaluate.mjs";

describe("evaluation run capture", () => {
  it("refuses configuration for a different frozen dataset", async () => {
    vi.spyOn(evaluator, "loadFrozenRelease").mockResolvedValue({ manifest: { version: "v1.0.0" }, cases: [] });
    await expect(captureEvaluationRun("release", { run_id: "run", executed_at: "2026-09-06T00:00:00Z", environment: "test", source_revision: "abc", versions: { dataset: "v2.0.0" } })).rejects.toThrow("does not match");
    vi.restoreAllMocks();
  });

  it("loads pending candidates only through explicit candidate mode", async () => {
    vi.spyOn(evaluator, "loadCandidateSet").mockResolvedValue({ manifest: { version: "candidate-pending" }, cases: [] });
    await expect(captureEvaluationRun("candidates", { run_id: "run", executed_at: "2026-09-07T00:00:00Z", environment: "test", source_revision: "abc", versions: { dataset: "candidate-pending" } }, { candidateMode: true }))
      .resolves.toMatchObject({ cases: [] });
    expect(evaluator.loadCandidateSet).toHaveBeenCalledWith("candidates");
    vi.restoreAllMocks();
  });

  it("represents a missing document with its deterministic finding, not present pages", () => {
    const issue = { code: "VAL_DOC_COMPLETENESS_001", supporting_references: ["finding-reference"] };
    const finding = { reason_code: "required_document_missing" };
    expect(captureIssueEvidence(issue, finding, ["page:1", "page:2"], () => ["page:1", "page:2"]))
      .toEqual(["finding:VAL_DOC_COMPLETENESS_001"]);
  });

  it("accepts a total cap that intentionally admits only part of the corpus", () => {
    expect(() => validateCostBudget({ maximum_total_usd: 0.5, maximum_per_case_usd: 0.25 }, 6))
      .not.toThrow();
  });

  it("requires finite positive cost limits", () => {
    expect(() => validateCostBudget({ maximum_total_usd: 2, maximum_per_case_usd: 0 }, 6))
      .toThrow("positive");
    expect(() => validateCostBudget({ maximum_total_usd: 2, maximum_per_case_usd: 0.1 }, 6))
      .toThrow("delivered Agent limit");
  });

  it("requires an explicit whole-run budget for a live model", async () => {
    vi.spyOn(evaluator, "loadFrozenRelease").mockResolvedValue({ manifest: { version: "v1.0.0" }, cases: [] });
    await expect(captureEvaluationRun("release", { run_id: "run", executed_at: "2026-09-07T00:00:00Z", environment: "test", source_revision: "abc", versions: { dataset: "v1.0.0", model: "openai/gpt-5.6-terra" } }))
      .rejects.toThrow("whole-run cost budget");
    vi.restoreAllMocks();
  });

  it("accepts only finite non-negative persisted USD cost", () => {
    expect(capturedUsdCost({ estimated_cost: { amount: "0.104453", currency: "USD" } })).toBe(0.104453);
    expect(capturedUsdCost({ estimated_cost: { amount: "unknown", currency: "USD" } })).toBeUndefined();
    expect(capturedUsdCost({ estimated_cost: { amount: "0.10", currency: "EUR" } })).toBeUndefined();
  });

  it("reserves the per-case ceiling before another paid case starts", () => {
    const budget = { maximum_total_usd: 0.5, maximum_per_case_usd: 0.25 };
    expect(canReserveCase(budget, 0.24)).toBe(true);
    expect(canReserveCase(budget, 0.26)).toBe(false);
  });

  it("stops after unavailable cost and rejects breached limits", () => {
    const budget = { maximum_total_usd: 0.5, maximum_per_case_usd: 0.25 };
    expect(reconcileCaseCost(budget, 0.1, undefined)).toEqual({ reconciledCostUsd: 0.1, blockedReason: "whole_run_cost_unavailable" });
    expect(() => reconcileCaseCost(budget, 0.1, 0.26)).toThrow("exceeded");
    expect(() => reconcileCaseCost(budget, 0.4, 0.11)).toThrow("exceeded");
  });
});
