import { createServer } from "node:http";
import pino from "pino";
import { PgBoss } from "pg-boss";
import { isCaseProcessingJob, type CaseProcessingJob } from "@findoc/contracts";
import { PdfInspectorAdapter } from "@findoc/document-processing";
import { buildOfflineFixture, OfflineFixtureUnavailableError, runOfflineReport } from "@findoc/offline";
import { PostgresOutboxStore, PostgresWorkflowCoordinator, createDatabase } from "@findoc/persistence";
import { createMinioObjectStore, readObjectBytes, storeNativeTextArtifact } from "@findoc/storage";
import { CASE_PROCESSING_QUEUE, OutboxRelay } from "./outbox.js";

const logger = pino({ name: "worker" });
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const minioEndpoint = process.env["MINIO_ENDPOINT"];
const minioAccessKey = process.env["MINIO_ACCESS_KEY"];
const minioSecretKey = process.env["MINIO_SECRET_KEY"];
if (!minioEndpoint || !minioAccessKey || !minioSecretKey) throw new Error("MinIO configuration is required");
const maximumSourceBytes = Number(process.env["MAX_SOURCE_BYTES"] ?? 10_000_000);

const { client, db } = createDatabase(databaseUrl);
const objectStore = createMinioObjectStore({
  endpoint: minioEndpoint, accessKey: minioAccessKey, secretKey: minioSecretKey,
  bucket: process.env["MINIO_BUCKET"] ?? "findoc-artifacts",
});
await objectStore.ensureBucket();
const pdfInspector = new PdfInspectorAdapter();
const boss = new PgBoss(databaseUrl);
boss.on("error", (error) => logger.error({ error }, "pg-boss error"));
await boss.start();
await boss.createQueue(CASE_PROCESSING_QUEUE);

const relay = new OutboxRelay(new PostgresOutboxStore(db), boss);
const coordinator = new PostgresWorkflowCoordinator(db);
await relay.publishBatch();
const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
});
await new Promise<void>((resolve) => healthServer.listen(
  Number(process.env["WORKER_HEALTH_PORT"] ?? 3001),
  process.env["WORKER_HEALTH_HOST"] ?? "127.0.0.1",
  resolve,
));

await boss.work<CaseProcessingJob>(CASE_PROCESSING_QUEUE, async ([job]) => {
  if (!job) return;
  if (!isCaseProcessingJob(job.data)) throw new Error("Invalid case-processing job payload");
  logger.info({ case_id: job.data.case_id, run_id: job.data.run_id }, "case processing claimed");
  await coordinator.markRunRunning(job.data.case_id, job.data.run_id);
  if (!await coordinator.hasInputDocuments(job.data.case_id, job.data.run_id)) {
    await coordinator.failRun(job.data.case_id, job.data.run_id, "required_documents_missing");
    logger.warn({ case_id: job.data.case_id, run_id: job.data.run_id }, "case routed to processing exception");
    return;
  }
  const documents = await coordinator.loadUninspectedDocuments(job.data.case_id, job.data.run_id);
  for (const document of documents) {
    if (document.mediaType === "application/pdf") {
      const source = await readObjectBytes(objectStore, document.objectKey, maximumSourceBytes);
      const inspection = await pdfInspector.inspect(source);
      const pages = await Promise.all(inspection.pages.map(async (page) => ({
        ...page,
        nativeCharacterCount: page.nativeMarkdown.length,
        nativeTextArtifact: {
          ...await storeNativeTextArtifact(page.nativeMarkdown, objectStore,
            `derived/${job.data.case_id}/${document.documentVersionId}/native-text/page-${page.pageNumber}`),
          caseId: job.data.case_id,
        },
      })));
      await coordinator.persistInspection(job.data.run_id, document, {
        ...inspection,
        pages,
      });
    } else {
      await coordinator.persistInspection(job.data.run_id, document, {
        processor: "image-intake-router", processorVersion: "1.0.0",
        pdfType: "image", routingSignal: 1, isComplex: false,
        pages: [{ pageNumber: 1, needsOcr: true, ocrReason: "image_input", hasTable: false, hasColumns: false, nativeCharacterCount: 0 }],
      });
    }
  }
  const applicationData = await coordinator.loadApplicationData(job.data.case_id, job.data.run_id);
  try {
    const sourceContext = await coordinator.loadOfflineSourceContext(job.data.case_id, job.data.run_id);
    const deterministic = buildOfflineFixture(applicationData["demo_fixture_id"], {
      inputSnapshotId: sourceContext.inputRevisionId,
      resultRevisionId: job.data.run_id,
      referenceDate: "2026-09-05",
      applicationSnapshotId: sourceContext.applicationSnapshotId,
      applicationData,
      pages: sourceContext.pages,
    });
    await coordinator.persistOfflineDeterministic(job.data.case_id, job.data.run_id, deterministic);
    const persistedResult = await coordinator.loadOfflineReportInput(job.data.case_id, job.data.run_id);
    const report = await runOfflineReport(persistedResult);
    await coordinator.completeOfflineReport(job.data.case_id, job.data.run_id, persistedResult.resultRevisionId, report);
  } catch (error) {
    if (!(error instanceof OfflineFixtureUnavailableError)) throw error;
    await coordinator.failRun(job.data.case_id, job.data.run_id, "offline_fixture_unavailable");
    logger.warn({ case_id: job.data.case_id, run_id: job.data.run_id }, "case routed to processing exception");
    return;
  }
  logger.info({ case_id: job.data.case_id, run_id: job.data.run_id }, "offline case processing completed");
});

const relayTimer = setInterval(() => {
  void relay.publishBatch().catch((error: unknown) => logger.error({ error }, "outbox relay failed"));
}, 1_000);

async function shutdown() {
  clearInterval(relayTimer);
  await new Promise<void>((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
  await boss.stop({ graceful: true });
  await client.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

logger.info({ mode: "offline", queue: CASE_PROCESSING_QUEUE }, "worker ready");
