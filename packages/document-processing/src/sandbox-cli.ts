import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { FakeOcrEngine, PdfInspectorAdapter, PdfInspectorOcrAdapter, PdfiumPageRenderer, prepareImageDocument, runSelectiveOcr } from "./index.js";

const raw = await readStdin(64_000);
const request = parseRequest(raw);
if (dirname(await realpath(request.source_path)) !== await realpath(resolve(process.cwd()))) throw new Error("Sandbox source path is outside the task directory");
const source = await readFile(request.source_path);
if (createHash("sha256").update(source).digest("hex") !== request.source_sha256) throw new Error("Sandbox source checksum mismatch");
const preparedImage = request.media_type === "application/pdf" ? undefined : await prepareImageDocument(
  source, request.source_sha256, request.media_type, request.limits.target_dpi, request.limits.maximum_pixels_per_page,
);
const inspection = preparedImage?.inspection ?? await new PdfInspectorAdapter().inspect(source);
if (inspection.pageCount > request.limits.maximum_pages) throw new Error("Sandbox page limit exceeded");
const renderer = new PdfiumPageRenderer();
const renders = [];
const renderedPages = [];
for (const page of inspection.pages) {
  const rendered = preparedImage?.render ?? await renderer.render(source, {
    sourceSha256: request.source_sha256, pageNumber: page.pageNumber, targetDpi: request.limits.target_dpi,
    colorMode: "color", outputFormat: "png", maximumPixels: request.limits.maximum_pixels_per_page,
  });
  const path = `page-${page.pageNumber}.png`;
  await writeFile(path, rendered.bytes, { mode: 0o600 });
  renders.push({ page_number: page.pageNumber, path, width: rendered.width, height: rendered.height,
    target_dpi: rendered.targetDpi, renderer_version: rendered.rendererVersion });
  renderedPages.push({
    pageNumber: page.pageNumber, bytes: rendered.bytes, width: rendered.width, height: rendered.height,
    targetDpi: rendered.targetDpi,
  });
}
const recognized = request.limits.ocr_mode === "fake"
  ? await runSelectiveOcr(inspection.pages, renderedPages, new FakeOcrEngine())
  : await new PdfInspectorOcrAdapter().recognize(preparedImage?.ocrPdf ?? source, inspection.pages.filter((page) => page.needsOcr).map((page) => page.pageNumber), {
    targetDpi: request.limits.target_dpi, modelDirectory: request.limits.ocr_model_directory!,
  });
const ocrOutputs = [];
for (const output of recognized) {
  const ocrPath = `page-${output.pageNumber}-ocr.json`;
  await writeFile(ocrPath, JSON.stringify(output.result), { mode: 0o600 });
  ocrOutputs.push({ page_number: output.pageNumber, path: ocrPath });
}
process.stdout.write(JSON.stringify({ schema_version: "1.0.0", inspection, renders, ocr_outputs: ocrOutputs }));

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
  source_path: string; source_sha256: string; media_type: "application/pdf" | "image/jpeg" | "image/png";
  limits: { maximum_pages: number; maximum_pixels_per_page: number; target_dpi: number; ocr_mode: "fake" | "pdf_inspector"; ocr_model_directory?: string; pdfium_library_path?: string; onnx_runtime_library_path?: string };
} {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed) || parsed.schema_version !== "1.0.0" ||
      !("operation" in parsed) || parsed.operation !== "inspect_and_render_document" || !("source_path" in parsed) ||
      typeof parsed.source_path !== "string" || basename(parsed.source_path) !== "source.bin" ||
      !("media_type" in parsed) || (parsed.media_type !== "application/pdf" && parsed.media_type !== "image/jpeg" && parsed.media_type !== "image/png") ||
      !("source_sha256" in parsed) || typeof parsed.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.source_sha256) ||
      !("limits" in parsed) || !parsed.limits || typeof parsed.limits !== "object") throw new Error("Invalid sandbox request");
  const request = parsed as { source_path: string; source_sha256: string; media_type: "application/pdf" | "image/jpeg" | "image/png"; limits: Record<string, unknown> };
  if (!Number.isSafeInteger(request.limits.maximum_pages) || Number(request.limits.maximum_pages) < 1 ||
      !Number.isSafeInteger(request.limits.maximum_pixels_per_page) || Number(request.limits.maximum_pixels_per_page) < 1 ||
      typeof request.limits.target_dpi !== "number" || request.limits.target_dpi < 72 || request.limits.target_dpi > 300 ||
      (request.limits.ocr_mode !== "fake" && request.limits.ocr_mode !== "pdf_inspector") ||
      (request.limits.ocr_mode === "pdf_inspector" &&
        (typeof request.limits.ocr_model_directory !== "string" || !isAbsolute(request.limits.ocr_model_directory) ||
         typeof request.limits.pdfium_library_path !== "string" || !isAbsolute(request.limits.pdfium_library_path) ||
         typeof request.limits.onnx_runtime_library_path !== "string" || !isAbsolute(request.limits.onnx_runtime_library_path)))) {
    throw new Error("Invalid sandbox limits");
  }
  return request as { source_path: string; source_sha256: string; media_type: "application/pdf" | "image/jpeg" | "image/png"; limits: { maximum_pages: number; maximum_pixels_per_page: number; target_dpi: number; ocr_mode: "fake" | "pdf_inspector"; ocr_model_directory?: string; pdfium_library_path?: string; onnx_runtime_library_path?: string } };
}
