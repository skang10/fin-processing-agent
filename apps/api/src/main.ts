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
const app = buildApp(
  new PostgresCaseCommandService(db, "local_demo_submitter"),
  new PostgresCaseQueryService(db),
  { store: (source) => storeSourceArtifact(source, objectStore, {
    maximumBytes: Number(process.env["MAX_SOURCE_BYTES"] ?? 10_000_000),
  }), discard: (artifact) => objectStore.remove(artifact.objectKey) },
);
app.addHook("onClose", async () => client.end());

await app.listen({ host: process.env["API_HOST"] ?? "127.0.0.1", port: Number(process.env["API_PORT"] ?? 3000) });
