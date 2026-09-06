import { describe, expect, it } from "vitest";
import type { ObjectStore } from "@findoc/core";
import { DocumentSizeLimitError, UnsupportedDocumentMediaError, storeNativeTextArtifact, storeSourceArtifact } from "./index.js";

async function* chunks(...values: Uint8Array[]) { yield* values; }

describe("source artifact intake", () => {
  it("detects PDF content and hashes the exact stored stream", async () => {
    let stored = Buffer.alloc(0);
    const store: ObjectStore = {
      async put(_key, content) {
        for await (const chunk of content) stored = Buffer.concat([stored, Buffer.from(chunk)]);
      },
      async remove() {},
      async get() { return chunks(); },
    };
    const input = Buffer.from("%PDF-1.7\nsynthetic");
    const result = await storeSourceArtifact(chunks(input.subarray(0, 3), input.subarray(3)), store, { maximumBytes: 100 });
    expect(result.detectedMediaType).toBe("application/pdf");
    expect(result.byteSize).toBe(input.byteLength);
    expect(stored).toEqual(input);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported magic bytes before object storage", async () => {
    const put = async () => { throw new Error("must not upload"); };
    await expect(storeSourceArtifact(chunks(Buffer.from("not a document")), { put, remove: async () => {}, get: async () => chunks() }, { maximumBytes: 100 }))
      .rejects.toBeInstanceOf(UnsupportedDocumentMediaError);
  });

  it("aborts consumption when the byte limit is exceeded", async () => {
    const store: ObjectStore = {
      async put(_key, content) { for await (const _ of content) void _; },
      async remove() {},
      async get() { return chunks(); },
    };
    await expect(storeSourceArtifact(chunks(Buffer.from("%PDF-123456")), store, { maximumBytes: 6 }))
      .rejects.toBeInstanceOf(DocumentSizeLimitError);
  });
});

describe("derived native-text storage", () => {
  it("stores immutable markdown under a content-addressed key", async () => {
    let storedKey = "";
    let storedMediaType = "";
    let stored = Buffer.alloc(0);
    const store: ObjectStore = {
      async put(key, content, mediaType) {
        storedKey = key;
        storedMediaType = mediaType;
        for await (const chunk of content) stored = Buffer.concat([stored, Buffer.from(chunk)]);
      },
      async remove() {},
      async get() { return chunks(); },
    };

    const result = await storeNativeTextArtifact("# Synthetic page", store, "derived/case-1/page-1");

    expect(result.objectKey).toBe(`derived/case-1/page-1/${result.sha256}`);
    expect(result.mediaType).toBe("text/markdown");
    expect(result.byteSize).toBe(Buffer.byteLength("# Synthetic page"));
    expect(storedKey).toBe(result.objectKey);
    expect(storedMediaType).toBe("text/markdown");
    expect(stored.toString("utf8")).toBe("# Synthetic page");
  });
});
