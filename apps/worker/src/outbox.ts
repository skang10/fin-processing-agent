import type { PendingOutboxEvent } from "@findoc/persistence";

export const CASE_PROCESSING_QUEUE = "case-processing-v1";

export interface OutboxStore {
  nextBatch(limit?: number): Promise<PendingOutboxEvent[]>;
  markPublished(eventId: string): Promise<void>;
}

export interface JobQueue {
  send(queue: string, payload: object, options: { id: string }): Promise<string | null>;
}

export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly queue: JobQueue,
  ) {}

  async publishBatch(): Promise<number> {
    const events = await this.store.nextBatch();
    let published = 0;
    for (const event of events) {
      if (event.eventType !== "case_processing_requested" || !isRecord(event.payload)) {
        continue;
      }
      await this.queue.send(CASE_PROCESSING_QUEUE, event.payload, {
        id: event.id,
      });
      // pg-boss uses ON CONFLICT DO NOTHING for an existing explicit job id.
      // Both a new id and null therefore mean this outbox identity is durable.
      await this.store.markPublished(event.id);
      published += 1;
    }
    return published;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
