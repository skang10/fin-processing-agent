import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { OcrResult, PdfInspection } from "./index.js";

export interface DocumentSandboxResult {
  readonly inspection: PdfInspection;
  readonly renders: readonly { pageNumber: number; bytes: Buffer; width: number; height: number; targetDpi: number; rendererVersion: string }[];
  readonly ocrOutputs: readonly { pageNumber: number; result: OcrResult }[];
}

export interface DocumentSandboxLimits {
  readonly timeoutMs: number;
  readonly maximumPages: number;
  readonly maximumPixelsPerPage: number;
  readonly targetDpi: number;
  readonly ocrMode?: "fake" | "pdf_inspector";
  readonly ocrModelDirectory?: string;
  readonly pdfiumLibraryPath?: string;
  readonly onnxRuntimeLibraryPath?: string;
}

export class DocumentSandboxError extends Error {
  constructor(
    readonly category: "timeout" | "process_failure" | "invalid_response",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DocumentSandboxError";
  }
}

interface SandboxResponse {
  readonly inspection: PdfInspection;
  readonly renders: { page_number: number; path: string; width: number; height: number; target_dpi: number; renderer_version: string }[];
  readonly ocr_outputs: { page_number: number; path: string }[];
}

export class DocumentSandboxClient {
  constructor(private readonly entrypoint = fileURLToPath(new URL("./sandbox-cli.js", import.meta.url))) {}

  async inspectAndRender(source: Buffer, sourceSha256: string, limits: DocumentSandboxLimits): Promise<DocumentSandboxResult> {
    validateLimits(limits);
    const taskDirectory = await mkdtemp(join(tmpdir(), "findoc-sandbox-"));
    try {
      const sourcePath = join(taskDirectory, "source.pdf");
      await writeFile(sourcePath, source, { mode: 0o600 });
      const response = await runTask(this.entrypoint, taskDirectory, {
        schema_version: "1.0.0", operation: "inspect_and_render_pdf", source_path: sourcePath,
        source_sha256: sourceSha256, limits: {
          maximum_pages: limits.maximumPages, maximum_pixels_per_page: limits.maximumPixelsPerPage,
          target_dpi: limits.targetDpi,
          ocr_mode: limits.ocrMode ?? "pdf_inspector",
          ...(limits.ocrModelDirectory ? { ocr_model_directory: limits.ocrModelDirectory } : {}),
          ...(limits.pdfiumLibraryPath ? { pdfium_library_path: limits.pdfiumLibraryPath } : {}),
          ...(limits.onnxRuntimeLibraryPath ? { onnx_runtime_library_path: limits.onnxRuntimeLibraryPath } : {}),
        },
      }, limits.timeoutMs);
      const parsed = parseResponse(response, limits.maximumPages);
      const renders = await Promise.all(parsed.renders.map(async (render) => ({
        pageNumber: render.page_number, bytes: await readFile(resolveTaskPath(taskDirectory, render.path)),
        width: render.width, height: render.height, targetDpi: render.target_dpi, rendererVersion: render.renderer_version,
      })));
      const ocrOutputs = await Promise.all(parsed.ocr_outputs.map(async (output) => ({
        pageNumber: output.page_number,
        result: parseOcrResult(await readFile(resolveOcrPath(taskDirectory, output.path), "utf8")),
      })));
      return { inspection: parsed.inspection, renders, ocrOutputs };
    } catch (error) {
      if (error instanceof DocumentSandboxError) throw error;
      throw new DocumentSandboxError("invalid_response", false, "Document sandbox returned invalid output");
    } finally {
      await rm(taskDirectory, { recursive: true, force: true });
    }
  }
}

function parseOcrResult(value: string): OcrResult {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("rawText" in parsed) || typeof parsed.rawText !== "string" ||
      !("spans" in parsed) || !Array.isArray(parsed.spans) || !("languages" in parsed) || !Array.isArray(parsed.languages) ||
      !("engine" in parsed) || typeof parsed.engine !== "string" || !("engineVersion" in parsed) || typeof parsed.engineVersion !== "string" ||
      !("modelAssetVersion" in parsed) || typeof parsed.modelAssetVersion !== "string" ||
      !("coordinateSpace" in parsed) || parsed.coordinateSpace !== "render_pixels_top_left" ||
      !("sourceTransform" in parsed) || !parsed.sourceTransform || typeof parsed.sourceTransform !== "object") {
    throw new Error("Sandbox returned an invalid OCR result");
  }
  const result = parsed as OcrResult;
  const transform = result.sourceTransform;
  if ((result.pageConfidence !== undefined && (!Number.isFinite(result.pageConfidence.value) || result.pageConfidence.value < 0 ||
      result.pageConfidence.value > 1 || result.pageConfidence.scale !== "zero_to_one" || !result.pageConfidence.producer)) ||
      transform.sourceCoordinateSpace !== "pdf_points_top_left" || !Number.isFinite(transform.scaleX) || transform.scaleX <= 0 ||
      !Number.isFinite(transform.scaleY) || transform.scaleY <= 0 || transform.translateX !== 0 || transform.translateY !== 0 ||
      result.languages.some((language) => language !== "de" && language !== "en") || result.spans.some((span) =>
    typeof span.text !== "string" || !Array.isArray(span.bbox) || span.bbox.length !== 4 || span.bbox.some((coordinate) => !Number.isFinite(coordinate)) ||
    !span.confidence || span.confidence.scale !== "zero_to_one" || !Number.isFinite(span.confidence.value) ||
    span.confidence.value < 0 || span.confidence.value > 1 || typeof span.confidence.producer !== "string")) {
    throw new Error("Sandbox returned invalid OCR spans");
  }
  return result;
}

function validateLimits(limits: DocumentSandboxLimits): void {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 100 || limits.timeoutMs > 120_000) throw new Error("Sandbox timeout is invalid");
  if (!Number.isSafeInteger(limits.maximumPages) || limits.maximumPages < 1 || limits.maximumPages > 100) throw new Error("Sandbox page limit is invalid");
  if (!Number.isSafeInteger(limits.maximumPixelsPerPage) || limits.maximumPixelsPerPage < 1) throw new Error("Sandbox pixel limit is invalid");
  if (!Number.isFinite(limits.targetDpi) || limits.targetDpi < 72 || limits.targetDpi > 300) throw new Error("Sandbox DPI is invalid");
  if (limits.ocrMode === "fake" && process.env["NODE_ENV"] !== "test" && process.env["FINDOC_SYNTHETIC_DEMO"] !== "true") {
    throw new Error("Fake OCR is restricted to tests and the synthetic demo");
  }
  if ((limits.ocrMode ?? "pdf_inspector") === "pdf_inspector" &&
      (!limits.ocrModelDirectory || !limits.pdfiumLibraryPath || !limits.onnxRuntimeLibraryPath)) {
    throw new Error("OCR_MODEL_DIRECTORY, PDFIUM_LIB_PATH, and ORT_DYLIB_PATH are required for offline PDF Inspector OCR");
  }
}

async function runTask(entrypoint: string, taskDirectory: string, request: unknown, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const limits = (request as { limits?: Record<string, unknown> }).limits ?? {};
    const child = spawn(process.execPath, [entrypoint], {
      cwd: taskDirectory, env: {
        NODE_ENV: "production",
        ...(typeof limits.pdfium_library_path === "string" ? { PDFIUM_LIB_PATH: limits.pdfium_library_path } : {}),
        ...(typeof limits.onnx_runtime_library_path === "string" ? { ORT_DYLIB_PATH: limits.onnx_runtime_library_path } : {}),
      }, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new DocumentSandboxError("timeout", true, "Document sandbox timed out")); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > 1_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; if (stderr.length > 16_384) child.kill("SIGKILL"); });
    child.on("error", () => { clearTimeout(timer); reject(new DocumentSandboxError("process_failure", true, "Document sandbox could not start")); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new DocumentSandboxError("process_failure", true, `Document sandbox failed with code ${String(code)}`));
      else resolve(stdout);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function resolveTaskPath(taskDirectory: string, relativePath: string): string {
  if (!/^page-[1-9][0-9]*\.png$/.test(relativePath)) throw new Error("Sandbox returned an invalid artifact path");
  return join(taskDirectory, relativePath);
}

function resolveOcrPath(taskDirectory: string, relativePath: string): string {
  if (!/^page-[1-9][0-9]*-ocr\.json$/.test(relativePath)) throw new Error("Sandbox returned an invalid OCR path");
  return join(taskDirectory, relativePath);
}

function parseResponse(value: string, maximumPages: number): SandboxResponse {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed) || parsed.schema_version !== "1.0.0" ||
      !("inspection" in parsed) || !("renders" in parsed) || !Array.isArray(parsed.renders) || parsed.renders.length > maximumPages ||
      !("ocr_outputs" in parsed) || !Array.isArray(parsed.ocr_outputs)) {
    throw new Error("Document sandbox returned an invalid response");
  }
  const response = parsed as SandboxResponse;
  if (!response.inspection || !Number.isSafeInteger(response.inspection.pageCount) || response.inspection.pageCount < 1 ||
      !Array.isArray(response.inspection.pages) || response.inspection.pages.length !== response.inspection.pageCount ||
      response.renders.length !== response.inspection.pageCount || response.renders.some((render, index) =>
        render.page_number !== index + 1 || !/^page-[1-9][0-9]*\.png$/.test(render.path) ||
        !Number.isSafeInteger(render.width) || render.width < 1 || !Number.isSafeInteger(render.height) || render.height < 1 ||
        typeof render.target_dpi !== "number" || typeof render.renderer_version !== "string" || !render.renderer_version) ||
      response.ocr_outputs.length > response.inspection.pages.filter((page) => page.needsOcr).length ||
      response.ocr_outputs.some((output) => !response.inspection.pages.some((page) => page.pageNumber === output.page_number && page.needsOcr) ||
        !/^page-[1-9][0-9]*-ocr\.json$/.test(output.path))) {
    throw new Error("Document sandbox returned invalid page output");
  }
  return response;
}
