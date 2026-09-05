import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { IdempotencyConflictError, type AcceptedCase, type CaseCommandService, type CaseIntakeCommand } from "@findoc/core";
import { cases, idempotencyRecords, outboxEvents, processingRuns } from "./schema.js";

const COMMAND_TYPE = "create_case";
const WORKFLOW_VERSION = "case-processing-v1";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return { client, db: drizzle(client) };
}

export class PostgresCaseCommandService implements CaseCommandService {
  constructor(
    private readonly db: ReturnType<typeof drizzle>,
    private readonly actorId: string,
  ) {}

  async accept(command: CaseIntakeCommand): Promise<AcceptedCase> {
    const requestHash = hashIntake(command);
    return this.db.transaction(async (tx) => {
      const lockIdentity = `${this.actorId}:${COMMAND_TYPE}:${command.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`);

      const [existing] = await tx.select().from(idempotencyRecords).where(and(
        eq(idempotencyRecords.actorId, this.actorId),
        eq(idempotencyRecords.commandType, COMMAND_TYPE),
        eq(idempotencyRecords.key, command.idempotencyKey),
      )).limit(1);

      if (existing) {
        if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
        return existing.result as AcceptedCase;
      }

      const accepted = { caseId: randomUUID(), runId: randomUUID() };
      await tx.insert(cases).values({
        id: accepted.caseId,
        applicantDisplayName: command.applicantDisplayName,
        lifecycle: "processing",
      });
      await tx.insert(processingRuns).values({
        id: accepted.runId,
        caseId: accepted.caseId,
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
      });
      await tx.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: "case_processing_requested",
        aggregateId: accepted.caseId,
        payload: { case_id: accepted.caseId, run_id: accepted.runId },
      });
      await tx.insert(idempotencyRecords).values({
        id: randomUUID(),
        actorId: this.actorId,
        commandType: COMMAND_TYPE,
        key: command.idempotencyKey,
        requestHash,
        responseStatus: 202,
        result: accepted,
      });
      return accepted;
    });
  }
}

export function hashIntake(command: CaseIntakeCommand): string {
  return createHash("sha256")
    .update(JSON.stringify({ applicant_display_name: command.applicantDisplayName }))
    .digest("hex");
}

export interface PendingOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export class PostgresOutboxStore {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async nextBatch(limit = 20): Promise<PendingOutboxEvent[]> {
    return this.db.select({
      id: outboxEvents.id,
      eventType: outboxEvents.eventType,
      payload: outboxEvents.payload,
    }).from(outboxEvents).where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt)).limit(limit);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.db.update(outboxEvents).set({ publishedAt: new Date() }).where(and(
      eq(outboxEvents.id, eventId),
      isNull(outboxEvents.publishedAt),
    ));
  }
}

export * from "./schema.js";
