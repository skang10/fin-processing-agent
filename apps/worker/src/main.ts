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
const pdfiumLibraryPath = process.env["PDFIUM_LIB_PATH"];
const onnxRuntimeLibraryPath = process.env["ORT_DYLIB_PATH"];
const pdfInspectorNativeLibraryPath = process.env["NAPI_RS_NATIVE_LIBRARY_PATH"];
if (ocrMode === "pdf_inspector" && (!ocrModelDirectory || !pdfiumLibraryPath || !onnxRuntimeLibraryPath)) {
  throw new Error("OCR_MODEL_DIRECTORY, PDFIUM_LIB_PATH, and ORT_DYLIB_PATH are required when OCR_MODE=pdf_inspector");
}
const defaultAgentModel = process.env["AGENT_MODEL"] ?? "fake";
const fakeAgentScript = process.env["AGENT_FAKE_SCRIPT"] ?? "auto";
if (fakeAgentScript !== "auto" && fakeAgentScript !== "standard" && fakeAgentScript !== "policy_violation") {
  throw new Error("AGENT_FAKE_SCRIPT must be 'auto', 'standard', or 'policy_violation'");
}
const vlmMode = process.env["VLM_MODE"] ?? "fixture";
if (vlmMode !== "fixture" && vlmMode !== "live") throw new Error("VLM_MODE must be 'fixture' or 'live'");
const vlmModel = process.env["VLM_MODEL"] ?? defaultAgentModel;
if (vlmMode === "live" && !/^[a-z0-9-]+\/.+$/.test(vlmModel)) throw new Error("VLM_MODEL must be '<provider>/<model-id>' in live mode");
const vlmSeparator = vlmModel.indexOf("/");
const vlmProvider = vlmMode === "live" ? vlmModel.slice(0, vlmSeparator) : undefined;
const vlmApiKey = vlmProvider === "openai"
  ? process.env["OPENAI_API_KEY"] ?? process.env["VLM_MODEL_API_KEY"]
  : process.env["VLM_MODEL_API_KEY"];
if (vlmMode === "live" && !vlmApiKey) throw new Error(vlmProvider === "openai" ? "OPENAI_API_KEY is required for the OpenAI VLM" : "VLM_MODEL_API_KEY is required for a live VLM");
const allowedAgentModels = new Set([
  defaultAgentModel,
  ...(process.env["OPENAI_API_KEY"] ? ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"] : []),
  "fake",
]);
if (defaultAgentModel !== "fake") {
  if (!/^[a-z0-9-]+\/.+$/.test(defaultAgentModel)) throw new Error("AGENT_MODEL must be 'fake' or '<provider>/<model-id>'");
  if (!process.env["OPENAI_API_KEY"] && !process.env["AGENT_MODEL_API_KEY"]) throw new Error("An Agent model API key is required for a live Agent model");
} else {
  if (vlmMode !== "live") process.env["PI_OFFLINE"] ??= "1";
}

function liveModelRoute(agentModel: string): { route: "live"; provider: string; modelId: string; apiKey: string } | undefined {
  if (agentModel === "fake") return undefined;
  const separator = agentModel.indexOf("/");
  const provider = agentModel.slice(0, separator);
  const apiKey = provider === "openai" ? process.env["OPENAI_API_KEY"] ?? process.env["AGENT_MODEL_API_KEY"] : process.env["AGENT_MODEL_API_KEY"];
  if (!apiKey) throw new Error(`No credential is configured for Agent model ${agentModel}`);
  return { route: "live", provider, modelId: agentModel.slice(separator + 1), apiKey };
}

/** Select the bounded Case Review Agent harness for one case (ADR-001). Only the demo fixture that must exercise report rejection gets the policy-violation script. */
function selectAgentHarness(fixtureId: unknown, agentModel: string): AgentLedCaseReviewHarness {
  const lifecycle = agentLifecycle ?? (agentLifecycle = new PostgresAgentSessionLifecycle(db));
  if (!allowedAgentModels.has(agentModel)) throw new Error(`Persisted Agent model is not allowed: ${agentModel}`);
  const live = liveModelRoute(agentModel);
  if (live) {
    const existing = piHarnesses.get(agentModel);
    if (existing) return existing;
    const harness = new PiAgentLedCaseReviewHarness({ model: live, lifecycle });
    piHarnesses.set(agentModel, harness);
    return harness;
  }
  const scriptLabel = fakeAgentScript === "auto"
    ? (fixtureId === "golden-006-scanned-adaptive-unavailable" ? "policy_violation" : "standard")
    : fakeAgentScript;
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
  const selectedAgentModel = await coordinator.loadAgentModel(job.data.case_id, job.data.run_id);
  const manualPreparation = await coordinator.isManualPreparation(job.data.case_id, job.data.run_id);
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
    if (document.mediaType !== "application/pdf" && document.mediaType !== "image/jpeg" && document.mediaType !== "image/png") {
      throw new Error("Persisted document media type is unsupported");
    }
    const source = await readObjectBytes(objectStore, document.objectKey, maximumSourceBytes);
    const sandboxResult = await documentSandbox.inspectAndRender(source, document.sha256, {
        timeoutMs: 60_000, maximumPages: 50, maximumPixelsPerPage: 8_000_000, targetDpi: 110,
        ocrMode, ...(ocrModelDirectory ? { ocrModelDirectory } : {}),
        ...(pdfiumLibraryPath ? { pdfiumLibraryPath } : {}),
        ...(onnxRuntimeLibraryPath ? { onnxRuntimeLibraryPath } : {}),
        ...(pdfInspectorNativeLibraryPath ? { pdfInspectorNativeLibraryPath } : {}),
      }, document.mediaType);
    const inspection = sandboxResult.inspection;
    const demoAnalysis = process.env["FINDOC_SYNTHETIC_DEMO"] === "true"
      ? classifySyntheticDemoPages(inspection.pages.map((page) => ({
        ...page,
        ocrMarkdown: sandboxResult.ocrOutputs.find((output) => output.pageNumber === page.pageNumber)?.result.rawText,
      })), {
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
          ...await storeNativeTextArtifact({ rawText: page.nativeMarkdown, spans: page.nativeSpans }, objectStore,
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
  }
  if (manualPreparation) {
    await coordinator.completeManualPreparation(job.data.case_id, job.data.run_id);
    logger.info({ case_id: job.data.case_id, run_id: job.data.run_id }, "manual review case prepared");
    return;
  }
  const stage = await processAgentLedCaseReview({
    coordinator, selectHarness: (fixtureId) => selectAgentHarness(fixtureId, selectedAgentModel), logger,
    readArtifact: (objectKey, maximumBytes) => readObjectBytes(objectStore, objectKey, maximumBytes),
    ...(selectedAgentModel !== "fake" && vlmExtractor ? { vlmExtractor } : {}),
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

logger.info({ mode: "offline", queue: CASE_PROCESSING_QUEUE, agent_harness: "pi", agent_model: defaultAgentModel, selectable_agent_models: [...allowedAgentModels], ocr_mode: ocrMode, ...(ocrMode === "pdf_inspector" ? { ocr_model: "PP-OCRv6-small@oar-ocr-v0.7.0" } : {}), vlm_mode: vlmMode, ...(vlmMode === "live" ? { vlm_model: vlmModel } : {}) }, "worker ready");
