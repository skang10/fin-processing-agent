import { describe, expect, it } from "vitest";
import { ANNA_EXAMPLE_FIXTURE_ID, OfflineFixtureUnavailableError, runOfflineFixture } from "./index.js";

describe("offline fixture", () => {
  const context = { inputSnapshotId: "input-1", resultRevisionId: "result-1", referenceDate: "2026-09-05" };

  it("reproduces the Anna Beispiel review result", () => {
    const result = runOfflineFixture(ANNA_EXAMPLE_FIXTURE_ID, context);
    expect(result.modelLabel).toBe("fake-pi-harness-v1");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "VAL_DOC_COMPLETENESS_001",
      "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001",
    ]);
    expect(result.findings).toHaveLength(5);
    expect(result.recommendedDisposition).toBe("human_review_required");
  });

  it("does not infer a successful fixture from applicant identity", () => {
    expect(() => runOfflineFixture("Anna Beispiel", context)).toThrow(OfflineFixtureUnavailableError);
  });
});
