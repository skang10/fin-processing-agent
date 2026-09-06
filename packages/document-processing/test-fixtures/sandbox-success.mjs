import { writeFile } from "node:fs/promises";

if (process.env.FINDOC_SANDBOX_SECRET_TEST) process.exit(2);
for await (const _ of process.stdin) void _;
await writeFile("page-1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
process.stdout.write(JSON.stringify({
  schema_version: "1.0.0",
  inspection: {
    processor: "firecrawl/pdf-inspector", processorVersion: "fixture", pageCount: 1,
    pdfType: "text_based", routingSignal: 1, isComplex: false,
    pages: [{ pageNumber: 1, nativeMarkdown: "fixture", needsOcr: false, hasTable: false, hasColumns: false }],
  },
  renders: [{ page_number: 1, path: "page-1.png", width: 10, height: 20, target_dpi: 110, renderer_version: "fixture" }],
}));
