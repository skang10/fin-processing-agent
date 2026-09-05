import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Client } from "minio";
import type { ObjectStore, StoredSourceArtifact, SupportedMediaType } from "@findoc/core";

export class UnsupportedDocumentMediaError extends Error {}
export class DocumentSizeLimitError extends Error {}
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

export class MinioObjectStore implements ObjectStore {
  constructor(private readonly options: MinioObjectStoreOptions) {}

  async ensureBucket(): Promise<void> {
    if (!(await this.options.client.bucketExists(this.options.bucket))) {
      await this.options.client.makeBucket(this.options.bucket);
    }
  }

  async put(objectKey: string, content: AsyncIterable<Uint8Array>, mediaType: SupportedMediaType): Promise<void> {
    await this.options.client.putObject(
      this.options.bucket,
      objectKey,
      Readable.from(content),
      undefined,
      { "Content-Type": mediaType },
    );
  }
}
