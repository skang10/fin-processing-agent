import { describe, expect, it, vi } from "vitest";
import { processCase, reconcileSingleAcceptedCandidate, type CasePipelinePorts, type ExtractionCandidate } from "./index.js";

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
