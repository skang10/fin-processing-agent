import { createServer } from "node:http";
import pino from "pino";
import { PgBoss } from "pg-boss";
import { isCaseProcessingJob, type CaseProcessingJob } from "@findoc/contracts";
import { DocumentSandboxClient, classifySyntheticDemoPages, groupLogicalDocuments } from "@findoc/document-processing";
import type { AgentLedCaseReviewHarness } from "@findoc/agent";
import { PiAgentLedCaseReviewHarness, PiPageVlmExtractor, policyViolationCaseReviewScript, standardCaseReviewScript } from "@findoc/agent-pi";
import { PostgresAgentSessionLifecycle, PostgresOutboxStore, PostgresWorkflowCoordinator, createDatabase } from "@findoc/persistence";
import { createMinioObjectStore, readObjectBytes, storeNativeTextArtifact, storeOcrArtifact, storePageRenderArtifact } from "@findoc/storage";
import { findFixtureScannedPageAdapter } from "@findoc/offline";
import { processAgentLedCaseReview } from "./case-review.js";
import { CASE_PROCESSING_QUEUE, OutboxRelay } from "./outbox.js";

const logger = pino({ name: "worker" });
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const minioEndpoint = process.env["MINIO_ENDPOINT"];
const minioAccessKey = process.env["MINIO_ACCESS_KEY"];
const minioSecretKey = process.env["MINIO_SECRET_KEY"];
if (!minioEndpoint || !minioAccessKey || !minioSecretKey) throw new Error("MinIO configuration is required");
const maximumSourceBytes = Number(process.env["MAX_SOURCE_BYTES"] ?? 10_000_000);
const ocrMode = process.env["OCR_MODE"] === "fake" ? "fake" : "pdf_inspector";
const ocrModelDirectory = process.env["OCR_MODEL_DIRECTORY"];
const agentModel = process.env["AGENT_MODEL"] ?? "fake";
const vlmMode = process.env["VLM_MODE"] ?? "fixture";
if (vlmMode !== "fixture" && vlmMode !== "live") throw new Error("VLM_MODE must be 'fixture' or 'live'");
const vlmModel = process.env["VLM_MODEL"] ?? agentModel;
if (vlmMode === "live" && !/^[a-z0-9-]+\/.+$/.test(vlmModel)) throw new Error("VLM_MODEL must be '<provider>/<model-id>' in live mode");
const vlmSeparator = vlmModel.indexOf("/");
const vlmProvider = vlmMode === "live" ? vlmModel.slice(0, vlmSeparator) : undefined;
const vlmApiKey = vlmProvider === "openai"
  ? process.env["OPENAI_API_KEY"] ?? process.env["VLM_MODEL_API_KEY"]
  : process.env["VLM_MODEL_API_KEY"];
if (vlmMode === "live" && !vlmApiKey) throw new Error(vlmProvider === "openai" ? "OPENAI_API_KEY is required for the OpenAI VLM" : "VLM_MODEL_API_KEY is required for a live VLM");
const agentProvider = agentModel === "fake" ? undefined : agentModel.slice(0, agentModel.indexOf("/"));
const agentModelApiKey = agentProvider === "openai"
  ? process.env["OPENAI_API_KEY"] ?? process.env["AGENT_MODEL_API_KEY"]
  : process.env["AGENT_MODEL_API_KEY"];
if (agentModel !== "fake") {
  if (!/^[a-z0-9-]+\/.+$/.test(agentModel)) throw new Error("AGENT_MODEL must be 'fake' or '<provider>/<model-id>'");
  if (!agentModelApiKey) throw new Error(agentProvider === "openai" ? "OPENAI_API_KEY is required for the OpenAI Agent model" : "AGENT_MODEL_API_KEY is required for a live Agent model");
} else {
  if (vlmMode !== "live") process.env["PI_OFFLINE"] ??= "1";
}

function liveModelRoute(): { route: "live"; provider: string; modelId: string; apiKey: string } | undefined {
  if (agentModel === "fake") return undefined;
  const separator = agentModel.indexOf("/");
  return { route: "live", provider: agentModel.slice(0, separator), modelId: agentModel.slice(separator + 1), apiKey: agentModelApiKey ?? "" };
}

/** Select the bounded Case Review Agent harness for one case (ADR-001). Only the demo fixture that must exercise report rejection gets the policy-violation script. */
function selectAgentHarness(fixtureId: unknown): AgentLedCaseReviewHarness {
  const lifecycle = agentLifecycle ?? (agentLifecycle = new PostgresAgentSessionLifecycle(db));
  const live = liveModelRoute();
  if (live) {
    const existing = piHarnesses.get("live");
    if (existing) return existing;
    const harness = new PiAgentLedCaseReviewHarness({ model: live, lifecycle });
    piHarnesses.set("live", harness);
    return harness;
  }
  const scriptLabel = fixtureId === "golden-006-scanned-adaptive-unavailable" ? "policy_violation" : "standard";
  const existing = piHarnesses.get(scriptLabel);
  if (existing) return existing;
  const harness = new PiAgentLedCaseReviewHarness({
    model: { route: "fake", script: scriptLabel === "policy_violation" ? policyViolationCaseReviewScript : standardCaseReviewScript, scriptLabel },
    lifecycle,
  });
  piHarnesses.set(scriptLabel, harness);
  return harness;
}

const { client, db } = createDatabase(databaseUrl);

const piHarnesses = new Map<string, PiAgentLedCaseReviewHarness>();
let agentLifecycle: PostgresAgentSessionLifecycle | undefined;
const vlmExtractor = vlmMode === "live"
  ? new PiPageVlmExtractor({ provider: vlmProvider ?? "", modelId: vlmModel.slice(vlmSeparator + 1), apiKey: vlmApiKey ?? "" })
  : undefined;
const objectStore = createMinioObjectStore({
  endpoint: minioEndpoint, accessKey: minioAccessKey, secretKey: minioSecretKey,
  bucket: process.env["MINIO_BUCKET"] ?? "findoc-artifacts",
});
await objectStore.ensureBucket();
const documentSandbox = new DocumentSandboxClient();
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
  try {
  if (!isCaseProcessingJob(job.data)) throw new Error("Invalid case-processing job payload");
  logger.info({ case_id: job.data.case_id, run_id: job.data.run_id }, "case processing claimed");
  await coordinator.markRunRunning(job.data.case_id, job.data.run_id);
  if (!await coordinator.hasInputDocuments(job.data.case_id, job.data.run_id)) {
    await coordinator.failRun(job.data.case_id, job.data.run_id, "required_documents_missing");
    logger.warn({ case_id: job.data.case_id, run_id: job.data.run_id }, "case routed to processing exception");
    return;
  }
  const applicationData = await coordinator.loadApplicationData(job.data.case_id, job.data.run_id);
  const fixtureScannedPages = findFixtureScannedPageAdapter(applicationData["demo_fixture_id"], applicationData);
  const documents = await coordinator.loadUninspectedDocuments(job.data.case_id, job.data.run_id);
  for (const document of documents) {
    if (document.mediaType === "application/pdf") {
      const source = await readObjectBytes(objectStore, document.objectKey, maximumSourceBytes);
      const sandboxResult = await documentSandbox.inspectAndRender(source, document.sha256, {
        timeoutMs: 60_000, maximumPages: 50, maximumPixelsPerPage: 8_000_000, targetDpi: 110,
        ocrMode, ...(ocrModelDirectory ? { ocrModelDirectory } : {}),
      });
      const inspection = sandboxResult.inspection;
      const demoAnalysis = process.env["FINDOC_SYNTHETIC_DEMO"] === "true"
        ? classifySyntheticDemoPages(inspection.pages, {
          // An image-only synthetic page carries no text the fixture OCR adapter can recover, so a
          // registered demo fixture declares its page type. It is recorded with its own method
          // identity so a reviewer can see the type came from a fixture, not from the page.
          ...(fixtureScannedPages ? { fixturePageType: (pageNumber: number) => fixtureScannedPages.pageType(pageNumber) } : {}),
        })
        : undefined;
      const pages = [];
      for (const page of inspection.pages) {
        const rendered = sandboxResult.renders.find((candidate) => candidate.pageNumber === page.pageNumber);
        if (!rendered) throw new Error("Document sandbox omitted a page render");
        const ocrOutput = sandboxResult.ocrOutputs.find((candidate) => candidate.pageNumber === page.pageNumber);
        if (page.needsOcr !== Boolean(ocrOutput)) throw new Error("Document sandbox OCR routing output is inconsistent");
        pages.push({
          ...page,
          nativeCharacterCount: page.nativeMarkdown.length,
          ...(page.nativeMarkdown.length > 0 ? { nativeTextArtifact: {
            ...await storeNativeTextArtifact(page.nativeMarkdown, objectStore,
              `derived/${job.data.case_id}/${document.documentVersionId}/native-text/page-${page.pageNumber}`),
            caseId: job.data.case_id,
          } } : {}),
          renderArtifact: {
            ...await storePageRenderArtifact(rendered.bytes, rendered, objectStore,
              `derived/${job.data.case_id}/${document.documentVersionId}/render/page-${page.pageNumber}`),
            caseId: job.data.case_id,
          },
          ...(ocrOutput ? { ocrArtifact: {
            ...await storeOcrArtifact(ocrOutput.result, {
              engine: ocrOutput.result.engine, engineVersion: ocrOutput.result.engineVersion,
              modelAssetVersion: ocrOutput.result.modelAssetVersion, languages: ocrOutput.result.languages,
            }, objectStore, `derived/${job.data.case_id}/${document.documentVersionId}/ocr/page-${page.pageNumber}`),
            caseId: job.data.case_id, coordinateSpace: ocrOutput.result.coordinateSpace,
          } } : {}),
        });
      }
      await coordinator.persistInspection(job.data.run_id, document, {
        ...inspection,
        pages,
        ...(demoAnalysis ? {
          ...demoAnalysis,
          logicalDocuments: groupLogicalDocuments(demoAnalysis.classifications, demoAnalysis.boundaries),
        } : {}),
      });
    } else {
      await coordinator.persistInspection(job.data.run_id, document, {
        processor: "image-intake-router", processorVersion: "1.0.0",
        pdfType: "image", routingSignal: 1, isComplex: false,
        pages: [{ pageNumber: 1, needsOcr: true, ocrReason: "image_input", hasTable: false, hasColumns: false, nativeCharacterCount: 0 }],
      });
    }
  }
  const stage = await processAgentLedCaseReview({
    coordinator, selectHarness: selectAgentHarness, logger,
    readArtifact: (objectKey, maximumBytes) => readObjectBytes(objectStore, objectKey, maximumBytes),
    ...(vlmExtractor ? { vlmExtractor } : {}),
  }, job.data);
  if (stage === "processing_exception") return;
  logger.info({ case_id: job.data.case_id, run_id: job.data.run_id }, "offline case processing completed");
  } catch (error) {
    logger.error({ error, job_id: job.id }, "case processing attempt failed");
    throw error;
  }
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

logger.info({ mode: "offline", queue: CASE_PROCESSING_QUEUE, agent_harness: "pi", agent_model: agentModel === "fake" ? "fake" : agentModel, vlm_mode: vlmMode, ...(vlmMode === "live" ? { vlm_model: vlmModel } : {}) }, "worker ready");
