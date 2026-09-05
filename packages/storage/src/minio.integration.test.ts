import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import { Client } from "minio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MinioObjectStore, storeSourceArtifact } from "./index.js";

describe("MinioObjectStore", () => {
  let container: StartedMinioContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new MinioContainer("minio/minio:RELEASE.2024-10-13T13-34-11Z").start();
    client = new Client({
      endPoint: container.getHost(),
      port: container.getPort(),
      useSSL: false,
      accessKey: container.getUsername(),
      secretKey: container.getPassword(),
    });
  });

  afterAll(async () => container.stop());

  it("stores immutable source bytes under an opaque key", async () => {
    const store = new MinioObjectStore({ client, bucket: "findoc-artifacts" });
    await store.ensureBucket();
    const bytes = Buffer.from("%PDF-1.7\nSYNTHETIC DEMO");
    const artifact = await storeSourceArtifact((async function* () { yield bytes; })(), store, {
      maximumBytes: 1_024,
      keyPrefix: "case-test/source",
    });

    const stat = await client.statObject("findoc-artifacts", artifact.objectKey);
    expect(stat.size).toBe(bytes.byteLength);
    expect(stat.metaData["content-type"]).toBe("application/pdf");
    expect(artifact.objectKey).toMatch(/^case-test\/source\/[0-9a-f-]+$/);
    await store.remove(artifact.objectKey);
    await expect(client.statObject("findoc-artifacts", artifact.objectKey)).rejects.toBeDefined();
  });
});
