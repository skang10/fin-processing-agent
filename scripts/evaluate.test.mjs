import { describe, expect, it } from "vitest";
import { evaluateDataset } from "./evaluate.mjs";

const versions = Object.fromEntries(["case_package", "dataset", "generator", "pdf_inspector", "pdfium", "ocr_asset", "extraction", "model", "prompt", "schema", "agent", "tool_registry", "rule_set", "disposition_policy", "evaluator"].map((key) => [key, "v1"]));
const golden = [{ case_id: "golden-1", truth_candidate: { expected_issues: [{ code: "ISSUE_A", acceptable_evidence: ["page:2"] }], expected_checked_facts: [{ code: "FACT_A", acceptable_evidence: ["page:1"] }], report_availability: "ready" } }];
const base = { schema_version: "1.0.0", run_id: "run-1", executed_at: "2026-09-06T00:00:00Z", environment: "offline-test", source_revision: "abc", versions };

describe("offline evaluator", () => {
  it("reports the three primary dimensions separately with auditable counts", () => {
    const report = evaluateDataset(golden, { ...base, cases: [{ case_id: "golden-1", processable: true, issues: [{ code: "ISSUE_A", evidence: ["page:2"] }], checked_facts: [{ code: "FACT_A", evidence: ["page:1"] }], report: { availability: "ready", verified: true, verifier: { schema_valid: true, reference_valid: true, registered_code_valid: true, prohibited_content_valid: true } }, operations: { latency_ms: 12, model_calls: 1, tokens: null, estimated_cost: 0 } }] });
    expect(report.metrics.issue_detection).toMatchObject({ true_positive: 1, false_positive: 0, false_negative: 0 });
    expect(report.metrics.evidence_grounding).toMatchObject({ correct: 2, total: 2, unsupported: 0 });
    expect(report.metrics.report_validity).toMatchObject({ verified: 1, processable: 1 });
    expect(report.operations.tokens).toBe("unavailable");
  });

  it("does not count a semantically matching issue with wrong evidence as correct", () => {
    const report = evaluateDataset(golden, { ...base, cases: [{ case_id: "golden-1", processable: true, issues: [{ code: "ISSUE_A", evidence: ["page:3"] }], checked_facts: [], report: { availability: "unavailable", verified: false, failure_reason: "reference_rejected", verifier: { schema_valid: true, reference_valid: false, registered_code_valid: true, prohibited_content_valid: true } }, operations: { latency_ms: 5, model_calls: 1 } }] });
    expect(report.metrics.issue_detection).toMatchObject({ true_positive: 0, false_positive: 1, false_negative: 1 });
    expect(report.metrics.evidence_grounding.unsupported).toBe(1);
    expect(report.metrics.report_validity.failure_categories).toEqual({ reference_rejected: 1 });
  });

  it("requires a complete component-version manifest", () => {
    expect(() => evaluateDataset(golden, { ...base, versions: {}, cases: [] })).toThrow("case_package");
  });

  it("retains the explicit whole-run cost budget in the report", () => {
    const cost_budget = { maximum_total_usd: 0.5, maximum_per_case_usd: 0.25 };
    expect(evaluateDataset(golden, { ...base, cost_budget, cases: [] }).cost_budget).toEqual(cost_budget);
  });

  it("retains structured reasons for cases skipped by the run budget", () => {
    const actual = { ...base, cases: [{ case_id: "golden-1", processable: false, issues: [], checked_facts: [], report: { availability: "unavailable", verified: false, failure_reason: "whole_run_cost_budget_exhausted", verifier: { schema_valid: false, reference_valid: false, registered_code_valid: false, prohibited_content_valid: false } }, operations: {} }] };
    const report = evaluateDataset(golden, actual);
    expect(report.metrics.case_completion).toEqual({ total: 1, completed: 0, excluded: 1, excluded_case_reasons: { whole_run_cost_budget_exhausted: 1 } });
    expect(report.cases[0]).toMatchObject({ outcome: "excluded", reason: "whole_run_cost_budget_exhausted" });
  });

  it("scores only the explicitly captured frozen subset", () => {
    const second = { case_id: "golden-2", truth_candidate: { expected_issues: [{ code: "ISSUE_B", acceptable_evidence: ["page:1"] }], expected_checked_facts: [], report_availability: "ready" } };
    const actual = { ...base, case_ids: ["golden-1"], cases: [{ case_id: "golden-1", processable: true, issues: [{ code: "ISSUE_A", evidence: ["page:2"] }], checked_facts: [], report: { availability: "ready", verified: true, verifier: { schema_valid: true, reference_valid: true, registered_code_valid: true, prohibited_content_valid: true } }, operations: {} }] };
    const report = evaluateDataset([...golden, second], actual);
    expect(report.metrics.issue_detection).toMatchObject({ true_positive: 1, false_negative: 0 });
    expect(report.metrics.case_completion.total).toBe(1);
    expect(report.case_ids).toEqual(["golden-1"]);
  });
});
