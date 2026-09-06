import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { PdfInspectorAdapter, PdfiumPageRenderer } from "./index.js";

const raw = await readStdin(64_000);
const request = parseRequest(raw);
if (dirname(await realpath(request.source_path)) !== await realpath(resolve(process.cwd()))) throw new Error("Sandbox source path is outside the task directory");
const source = await readFile(request.source_path);
if (createHash("sha256").update(source).digest("hex") !== request.source_sha256) throw new Error("Sandbox source checksum mismatch");
const inspection = await new PdfInspectorAdapter().inspect(source);
if (inspection.pageCount > request.limits.maximum_pages) throw new Error("Sandbox page limit exceeded");
const renderer = new PdfiumPageRenderer();
const renders = [];
for (const page of inspection.pages) {
  const rendered = await renderer.render(source, {
    sourceSha256: request.source_sha256, pageNumber: page.pageNumber, targetDpi: request.limits.target_dpi,
    colorMode: "color", outputFormat: "png", maximumPixels: request.limits.maximum_pixels_per_page,
  });
  const path = `page-${page.pageNumber}.png`;
  await writeFile(path, rendered.bytes, { mode: 0o600 });
  renders.push({ page_number: page.pageNumber, path, width: rendered.width, height: rendered.height,
    target_dpi: rendered.targetDpi, renderer_version: rendered.rendererVersion });
}
process.stdout.write(JSON.stringify({ schema_version: "1.0.0", inspection, renders }));

async function readStdin(maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBytes) throw new Error("Sandbox request is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequest(value: string): {
  source_path: string; source_sha256: string;
  limits: { maximum_pages: number; maximum_pixels_per_page: number; target_dpi: number };
} {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed) || parsed.schema_version !== "1.0.0" ||
      !("operation" in parsed) || parsed.operation !== "inspect_and_render_pdf" || !("source_path" in parsed) ||
      typeof parsed.source_path !== "string" || basename(parsed.source_path) !== "source.pdf" ||
      !("source_sha256" in parsed) || typeof parsed.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.source_sha256) ||
      !("limits" in parsed) || !parsed.limits || typeof parsed.limits !== "object") throw new Error("Invalid sandbox request");
  const request = parsed as { source_path: string; source_sha256: string; limits: Record<string, unknown> };
  if (!Number.isSafeInteger(request.limits.maximum_pages) || Number(request.limits.maximum_pages) < 1 ||
      !Number.isSafeInteger(request.limits.maximum_pixels_per_page) || Number(request.limits.maximum_pixels_per_page) < 1 ||
      typeof request.limits.target_dpi !== "number" || request.limits.target_dpi < 72 || request.limits.target_dpi > 300) {
    throw new Error("Invalid sandbox limits");
  }
  return request as { source_path: string; source_sha256: string; limits: { maximum_pages: number; maximum_pixels_per_page: number; target_dpi: number } };
}
