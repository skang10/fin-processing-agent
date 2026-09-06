import { describe, expect, it, vi } from "vitest";
import { captureEvaluationRun, captureIssueEvidence, validateCostBudget } from "./capture-evaluation.mjs";
import * as evaluator from "./evaluate.mjs";

describe("evaluation run capture", () => {
  it("refuses configuration for a different frozen dataset", async () => {
    vi.spyOn(evaluator, "loadFrozenRelease").mockResolvedValue({ manifest: { version: "v1.0.0" }, cases: [] });
    await expect(captureEvaluationRun("release", { run_id: "run", executed_at: "2026-09-06T00:00:00Z", environment: "test", source_revision: "abc", versions: { dataset: "v2.0.0" } })).rejects.toThrow("does not match");
    vi.restoreAllMocks();
  });

  it("represents a missing document with its deterministic finding, not present pages", () => {
    const issue = { code: "VAL_DOC_COMPLETENESS_001", supporting_references: ["finding-reference"] };
    const finding = { reason_code: "required_document_missing" };
    expect(captureIssueEvidence(issue, finding, ["page:1", "page:2"], () => ["page:1", "page:2"]))
      .toEqual(["finding:VAL_DOC_COMPLETENESS_001"]);
  });

  it("refuses a full run whose per-case reservations exceed its total cost cap", () => {
    expect(() => validateCostBudget({ maximum_total_usd: 1, maximum_per_case_usd: 0.25 }, 6))
      .toThrow("cannot reserve 6 cases");
    expect(() => validateCostBudget({ maximum_total_usd: 1.5, maximum_per_case_usd: 0.25 }, 6))
      .not.toThrow();
  });

  it("requires finite positive cost limits", () => {
    expect(() => validateCostBudget({ maximum_total_usd: 2, maximum_per_case_usd: 0 }, 6))
      .toThrow("positive");
  });
});
