import { describe, expect, it } from "vitest";
import { ANNA_EXAMPLE_FIXTURE_ID, OfflineFixtureUnavailableError, runOfflineFixture } from "./index.js";

describe("offline fixture", () => {
  it("reproduces the Anna Beispiel review result", () => {
    const result = runOfflineFixture(ANNA_EXAMPLE_FIXTURE_ID);
    expect(result.modelLabel).toBe("fake-pi-harness-v1");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001",
      "VAL_DOC_COMPLETENESS_001",
    ]);
  });

  it("does not infer a successful fixture from applicant identity", () => {
    expect(() => runOfflineFixture("Anna Beispiel")).toThrow(OfflineFixtureUnavailableError);
  });
});
