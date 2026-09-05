import { describe, expect, it, vi } from "vitest";
import { CASE_PROCESSING_QUEUE, OutboxRelay } from "./outbox.js";

describe("OutboxRelay", () => {
  it("publishes typed references and marks the event only after queue acceptance", async () => {
    const markPublished = vi.fn(async () => undefined);
    const send = vi.fn(async () => "job_1");
    const relay = new OutboxRelay({
      nextBatch: async () => [{
        id: "event_1",
        eventType: "case_processing_requested",
        payload: { case_id: "case_1", run_id: "run_1" },
      }],
      markPublished,
    }, { send });

    await expect(relay.publishBatch()).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(CASE_PROCESSING_QUEUE, {
      case_id: "case_1",
      run_id: "run_1",
    }, { id: "event_1" });
    expect(markPublished).toHaveBeenCalledWith("event_1");
  });

  it("marks an already-published event after pg-boss deduplicates its job id", async () => {
    const markPublished = vi.fn(async () => undefined);
    const relay = new OutboxRelay({
      nextBatch: async () => [{ id: "event_1", eventType: "case_processing_requested", payload: {} }],
      markPublished,
    }, { send: async () => null });

    await expect(relay.publishBatch()).resolves.toBe(1);
    expect(markPublished).toHaveBeenCalledWith("event_1");
  });
});
