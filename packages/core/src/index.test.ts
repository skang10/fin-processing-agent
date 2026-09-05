import { describe, expect, it, vi } from "vitest";
import { processCase, type CasePipelinePorts } from "./index.js";

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
