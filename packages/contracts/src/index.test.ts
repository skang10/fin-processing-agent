import { describe, expect, it } from "vitest";
import { isCaseProcessingJob } from "./index.js";

describe("isCaseProcessingJob", () => {
  const valid = {
    case_id: "124da1c1-7ab3-42fa-a1c5-cd8f88d41ed1",
    run_id: "279286ef-33a0-4228-a488-86354cc61756",
  };

  it("accepts the UUID payload persisted by the outbox", () => {
    expect(isCaseProcessingJob(valid)).toBe(true);
  });

  it("rejects malformed or expanded payloads", () => {
    expect(isCaseProcessingJob({ ...valid, run_id: "run_1" })).toBe(false);
    expect(isCaseProcessingJob({ ...valid, document: "untrusted" })).toBe(false);
  });
});
