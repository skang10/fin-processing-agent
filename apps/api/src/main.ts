import { PostgresCaseCommandService, PostgresCaseQueryService, createDatabase } from "@findoc/persistence";
import { createMinioObjectStore, storeSourceArtifact } from "@findoc/storage";
import { buildApp } from "./app.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const minioEndpoint = process.env["MINIO_ENDPOINT"];
const minioAccessKey = process.env["MINIO_ACCESS_KEY"];
const minioSecretKey = process.env["MINIO_SECRET_KEY"];
if (!minioEndpoint || !minioAccessKey || !minioSecretKey) throw new Error("MinIO configuration is required");

const { client, db } = createDatabase(databaseUrl);
const objectStore = createMinioObjectStore({
  endpoint: minioEndpoint, accessKey: minioAccessKey, secretKey: minioSecretKey,
  bucket: process.env["MINIO_BUCKET"] ?? "findoc-artifacts",
});
await objectStore.ensureBucket();
const commandService = new PostgresCaseCommandService(db, "local_demo_reviewer");
const configuredDefaultAgentModel = process.env["AGENT_MODEL"] ?? "fake";
const configuredAgentModels = [...new Set([
  configuredDefaultAgentModel,
  ...(process.env["OPENAI_API_KEY"] ? ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"] : []),
  "fake",
])];
const app = buildApp(
  commandService,
  new PostgresCaseQueryService(db),
  { store: (source) => storeSourceArtifact(source, objectStore, {
    maximumBytes: Number(process.env["MAX_SOURCE_BYTES"] ?? 10_000_000),
  }), discard: (artifact) => objectStore.remove(artifact.objectKey) },
  commandService,
  objectStore,
  {
    defaultModel: configuredDefaultAgentModel,
    models: configuredAgentModels.map((id) => id === "fake"
      ? { id, label: "Deterministic demo Agent", paid: false }
      : { id, label: id, paid: true, maximumCaseCostUsd: "0.25" }),
  },
);
app.addHook("onClose", async () => client.end());

await app.listen({ host: process.env["API_HOST"] ?? "127.0.0.1", port: Number(process.env["API_PORT"] ?? 3000) });
