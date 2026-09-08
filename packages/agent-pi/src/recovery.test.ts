import { describe, expect, it } from "vitest";
import { InMemoryAgentSessionLifecycle, type CaseReviewProcessingPorts } from "@findoc/agent";
import {
  AgentSessionIncompatibleError,
  type AgentSessionLifecyclePort, type BeginAgentSessionInput, type CommitAgentStepInput, type TerminalizeAgentSessionInput,
} from "@findoc/core";
import { PiAgentLedCaseReviewHarness } from "./harness.js";
import { standardCaseReviewScript } from "./fake-model.js";
import { reviewContext, reviewPorts } from "./durable-session.test.js";
import { createRecoveryToolState, resolveEvidenceSource } from "./recovery-tools.js";

const RUN_ID = "11111111-2222-4333-8444-555555555555";

/**
 * Simulates Worker loss after a chosen number of durable commits: every later durable write fails,
 * so the session stays running with exactly the steps it had already committed.
 */
class WorkerLossLifecycle implements AgentSessionLifecyclePort {
  private committed = 0;
  private lost = false;
  constructor(private readonly inner: AgentSessionLifecyclePort, private readonly loseAfterSteps: number) {}

  async beginSession(input: BeginAgentSessionInput) { return this.inner.beginSession(input); }

  async commitStep(input: CommitAgentStepInput) {
    if (this.lost) throw new Error("worker terminated");
    const result = await this.inner.commitStep(input);
    this.committed += 1;
    if (this.committed >= this.loseAfterSteps) this.lost = true;
    return result;
  }

  async terminalizeSession(input: TerminalizeAgentSessionInput) {
    if (this.lost) throw new Error("worker terminated");
    return this.inner.terminalizeSession(input);
  }

  async loadSnapshot(runId: string) { return this.inner.loadSnapshot(runId); }
}

async function reviewOnce(lifecycle: AgentSessionLifecyclePort, ports: CaseReviewProcessingPorts, withGap = true) {
  return new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, lifecycle })
    .review(reviewContext(withGap), ports);
}

/** Run one session that loses the Worker after `loseAfterSteps` durable commits, then resume it. */
async function crashThenResume(loseAfterSteps: number, ports: CaseReviewProcessingPorts) {
  const durable = new InMemoryAgentSessionLifecycle();
  await expect(reviewOnce(new WorkerLossLifecycle(durable, loseAfterSteps), ports)).rejects.toThrow("worker terminated");
  const interrupted = await durable.loadSnapshot(RUN_ID);
  expect(interrupted?.status).toBe("running");
  const outcome = await reviewOnce(durable, ports);
  return { durable, interrupted, outcome, resumed: await durable.loadSnapshot(RUN_ID) };
}

const toolNames = (steps: readonly { toolName: string }[]) => steps.map((step) => step.toolName);
const calls = (ports: CaseReviewProcessingPorts, name: keyof CaseReviewProcessingPorts) =>
  (ports[name] as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

describe("native-text evidence geometry", () => {
  it("attaches the same-pass native span when the submitted value appears verbatim", () => {
    const state = createRecoveryToolState();
    const region = { x: 0.2, y: 0.3, width: 0.15, height: 0.04 };
    state.nativeTextByPage.set("document-1:1", {
      text: "Monthly net EUR 2980.00",
      lines: [{ text: "EUR 2980.00", region }],
    });

    expect(resolveEvidenceSource(
      state,
      { documentVersionId: "document-1", pageNumber: 1 },
      "gap-1",
      "EUR 2980.00",
    )).toEqual({
      extractionMethod: "agent_native_text_reading",
      processorVersion: "agent-native-text-reading-1.2.0",
      region,
    });
  });
});

describe("durable re-entry after Worker loss", () => {
  it("continues after a committed inspection step without repeating it", async () => {
    const ports = reviewPorts();
    const { interrupted, outcome, resumed } = await crashThenResume(2, ports);
    expect(toolNames(interrupted?.steps ?? [])).toEqual(["get_case_manifest", "inspect_page"]);
    expect(calls(ports, "inspectPage")).toBe(1);
    expect(outcome).toMatchObject({ resumed: true, attemptNumber: 2 });
    expect(resumed).toMatchObject({ status: "terminal", terminalReason: "report_submitted", attempts: 2 });
    expect(toolNames(resumed?.steps ?? [])).toEqual([
      "get_case_manifest", "inspect_page", "render_page_region", "run_ocr", "extract_with_vlm", "submit_extraction_candidates",
      "request_reconciliation", "request_validation", "get_current_result", "submit_case_review_brief",
    ]);
  });

  it("reuses committed OCR and model extraction without charging their budgets twice", async () => {
    const ports = reviewPorts();
    const { outcome, resumed } = await crashThenResume(5, ports);
    expect(calls(ports, "extractWithVlm")).toBe(1);
    expect(resumed?.consumed).toMatchObject({ ocrPages: 1, vlmCalls: 1 });
    const reused = resumed?.steps.filter((step) => step.summary.startsWith("Reused the committed")) ?? [];
    expect(toolNames(reused)).toEqual(["render_page_region", "run_ocr"]);
    expect(outcome.trace.terminalReason).toBe("report_submitted");
    expect(resumed?.committedToolResults.filter((result) => result.toolName === "run_ocr")).toHaveLength(1);
  });

  it("does not submit a second extraction candidate after re-entry", async () => {
    const ports = reviewPorts();
    const { outcome, resumed } = await crashThenResume(6, ports);
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]).toMatchObject({ gapId: "gap-1", rawValue: "2980.00", extractionMethod: "agent_vlm_extraction" });
    expect(resumed?.committedToolResults.filter((result) => result.toolName === "submit_extraction_candidates")).toHaveLength(1);
    // The Worker was lost between executing reconciliation and committing its step, so that request
    // may repeat. Every request still carries exactly the one committed candidate, and the
    // deterministic component is idempotent for the run (AGT-REQ-133, DAT-REQ-203).
    const reconciled = (ports.requestReconciliation as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(reconciled.every((call) => (call[0] as unknown[]).length === 1)).toBe(true);
  });

  it("does not request deterministic reconciliation or validation twice", async () => {
    const reconciliationPorts = reviewPorts();
    await crashThenResume(7, reconciliationPorts);
    expect(calls(reconciliationPorts, "requestReconciliation")).toBe(1);

    const validationPorts = reviewPorts();
    const { outcome, resumed } = await crashThenResume(8, validationPorts);
    expect(calls(validationPorts, "requestReconciliation")).toBe(1);
    expect(calls(validationPorts, "requestValidation")).toBe(1);
    expect(outcome.result).toMatchObject({ resultRevisionId: "result-1", recommendedDisposition: "human_review_required" });
    expect(resumed?.committedToolResults.filter((result) => result.toolName === "request_validation")).toHaveLength(1);
  });

  it("does not resubmit a report that was already committed, and starts no model turn", async () => {
    const ports = reviewPorts();
    const { outcome, resumed } = await crashThenResume(10, ports);
    expect(outcome).toMatchObject({ resumed: true, attemptNumber: 2 });
    expect(outcome.submission).toMatchObject({ schema_version: "1.0.0", result_revision_id: "result-1" });
    expect(calls(ports, "requestValidation")).toBe(1);
    expect(resumed?.committedToolResults.filter((result) => result.toolName === "submit_case_review_brief")).toHaveLength(1);
    expect(toolNames(resumed?.steps ?? [])).toHaveLength(10);
    expect(resumed?.terminalReason).toBe("report_submitted");
  });

  it("refuses to resume a session whose bound context changed", async () => {
    const durable = new InMemoryAgentSessionLifecycle();
    const ports = reviewPorts();
    await expect(reviewOnce(new WorkerLossLifecycle(durable, 2), ports)).rejects.toThrow("worker terminated");
    const changed = { ...reviewContext(true), pages: [] };
    await expect(new PiAgentLedCaseReviewHarness({ model: { route: "fake", script: standardCaseReviewScript }, lifecycle: durable }).review(changed, ports))
      .rejects.toBeInstanceOf(AgentSessionIncompatibleError);
    expect((await durable.loadSnapshot(RUN_ID))?.status).toBe("running");
  });

  it("stops re-entry when the attempt budget is exhausted", async () => {
    const durable = new InMemoryAgentSessionLifecycle();
    const ports = reviewPorts();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(reviewOnce(new WorkerLossLifecycle(durable, 1), ports)).rejects.toThrow("worker terminated");
    }
    const outcome = await reviewOnce(durable, ports);
    expect(outcome.trace.terminalReason).toBe("cancelled_by_workflow");
    expect(outcome.attemptNumber).toBe(4);
    expect((await durable.loadSnapshot(RUN_ID))).toMatchObject({ status: "terminal", terminalReason: "cancelled_by_workflow" });
  });

  it("keeps one authoritative session when the same stage is delivered twice at once", async () => {
    const durable = new InMemoryAgentSessionLifecycle();
    const outcomes = await Promise.allSettled([
      reviewOnce(durable, reviewPorts()),
      reviewOnce(durable, reviewPorts()),
    ]);
    const snapshot = await durable.loadSnapshot(RUN_ID);
    expect(snapshot?.attempts).toBe(2);
    expect(snapshot?.status).toBe("terminal");
    const sessionIds = outcomes.flatMap((result) => result.status === "fulfilled" ? [result.value.trace.sessionId] : []);
    expect(new Set(sessionIds).size).toBe(1);
    expect(sessionIds[0]).toBe(snapshot?.sessionId);
  });
});
