import { describe, expect, it } from "vitest";
import { runOfflineFixture } from "./index.js";

describe("offline fixture", () => {
  it("reproduces the Anna Beispiel review result", () => {
    const result = runOfflineFixture("Anna Beispiel");
    expect(result.modelLabel).toBe("fake-pi-agent-v1");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "VAL_EMPLOYER_CONSISTENCY_001",
      "VAL_INCOME_CONSISTENCY_001",
      "VAL_DOC_COMPLETENESS_001",
    ]);
  });
});
