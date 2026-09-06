import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Client } from "minio";
import type { ArtifactMediaType, ObjectStore, StoredDerivedArtifact, StoredSourceArtifact, SupportedMediaType } from "@findoc/core";

export class UnsupportedDocumentMediaError extends Error {}
export class DocumentSizeLimitError extends Error {}
export class StoredObjectSizeLimitError extends Error {}
export class EmptyDocumentError extends Error {}

export interface SourceIntakeOptions {
  readonly maximumBytes: number;
  readonly keyPrefix?: string;
}

export async function storeSourceArtifact(
  source: AsyncIterable<Uint8Array>,
  store: ObjectStore,
  options: SourceIntakeOptions,
): Promise<StoredSourceArtifact> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) {
    throw new Error("maximumBytes must be a positive safe integer");
  }

  const iterator = source[Symbol.asyncIterator]();
  const buffered: Uint8Array[] = [];
  let prefix = Buffer.alloc(0);
  while (prefix.length < 8) {
    const next = await iterator.next();
    if (next.done) break;
    if (next.value.byteLength === 0) continue;
    buffered.push(next.value);
    prefix = Buffer.concat([prefix, Buffer.from(next.value.subarray(0, 8 - prefix.length))]);
  }
  if (buffered.length === 0) throw new EmptyDocumentError("Document is empty");

  const detectedMediaType = detectMediaType(prefix);
  const hash = createHash("sha256");
  let byteSize = 0;
  const checked = (chunk: Uint8Array) => {
    byteSize += chunk.byteLength;
    if (byteSize > options.maximumBytes) {
      throw new DocumentSizeLimitError(`Document exceeds ${options.maximumBytes} bytes`);
    }
    hash.update(chunk);
    return chunk;
  };
  const checkedContent = (async function* () {
    for (const chunk of buffered) yield checked(chunk);
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.byteLength > 0) yield checked(next.value);
    }
  })();

  const objectKey = `${options.keyPrefix ?? "source"}/${randomUUID()}`;
  await store.put(objectKey, checkedContent, detectedMediaType);
  return { objectKey, sha256: hash.digest("hex"), byteSize, detectedMediaType };
}

function detectMediaType(prefix: Uint8Array): SupportedMediaType {
  const bytes = Buffer.from(prefix);
  if (bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  throw new UnsupportedDocumentMediaError("Only PDF, JPEG, and PNG content is supported");
}

export interface MinioObjectStoreOptions {
  readonly client: Client;
  readonly bucket: string;
}

export interface MinioConnectionOptions {
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

export function createMinioObjectStore(options: MinioConnectionOptions): MinioObjectStore {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("MINIO_ENDPOINT must use http or https");
  }
  return new MinioObjectStore({
    client: new Client({
      endPoint: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
      useSSL: endpoint.protocol === "https:",
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    }),
    bucket: options.bucket,
  });
}

export class MinioObjectStore implements ObjectStore {
  constructor(private readonly options: MinioObjectStoreOptions) {}

  async ensureBucket(): Promise<void> {
    if (!(await this.options.client.bucketExists(this.options.bucket))) {
      await this.options.client.makeBucket(this.options.bucket);
    }
  }

  async put(objectKey: string, content: AsyncIterable<Uint8Array>, mediaType: ArtifactMediaType): Promise<void> {
    await this.options.client.putObject(
      this.options.bucket,
      objectKey,
      Readable.from(content),
      undefined,
      { "Content-Type": mediaType },
    );
  }

  async remove(objectKey: string): Promise<void> {
    await this.options.client.removeObject(this.options.bucket, objectKey);
  }

  async get(objectKey: string): Promise<AsyncIterable<Uint8Array>> {
    return this.options.client.getObject(this.options.bucket, objectKey);
  }
}

export async function storeNativeTextArtifact(
  content: string,
  store: ObjectStore,
  keyPrefix: string,
): Promise<StoredDerivedArtifact> {
  const bytes = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `${keyPrefix}/${sha256}`;
  await store.put(objectKey, (async function* () { yield bytes; })(), "text/markdown");
  return { objectKey, sha256, byteSize: bytes.byteLength, mediaType: "text/markdown" };
}

export async function readObjectBytes(store: ObjectStore, objectKey: string, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of await store.get(objectKey)) {
    byteSize += chunk.byteLength;
    if (byteSize > maximumBytes) throw new StoredObjectSizeLimitError("Stored object exceeds processing limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
