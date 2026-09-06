import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PdfInspection } from "./index.js";

export interface DocumentSandboxResult {
  readonly inspection: PdfInspection;
  readonly renders: readonly { pageNumber: number; bytes: Buffer; width: number; height: number; targetDpi: number; rendererVersion: string }[];
}

export interface DocumentSandboxLimits {
  readonly timeoutMs: number;
  readonly maximumPages: number;
  readonly maximumPixelsPerPage: number;
  readonly targetDpi: number;
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
        },
      }, limits.timeoutMs);
      const parsed = parseResponse(response, limits.maximumPages);
      const renders = await Promise.all(parsed.renders.map(async (render) => ({
        pageNumber: render.page_number, bytes: await readFile(resolveTaskPath(taskDirectory, render.path)),
        width: render.width, height: render.height, targetDpi: render.target_dpi, rendererVersion: render.renderer_version,
      })));
      return { inspection: parsed.inspection, renders };
    } catch (error) {
      if (error instanceof DocumentSandboxError) throw error;
      throw new DocumentSandboxError("invalid_response", false, "Document sandbox returned invalid output");
    } finally {
      await rm(taskDirectory, { recursive: true, force: true });
    }
  }
}

function validateLimits(limits: DocumentSandboxLimits): void {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 100 || limits.timeoutMs > 120_000) throw new Error("Sandbox timeout is invalid");
  if (!Number.isSafeInteger(limits.maximumPages) || limits.maximumPages < 1 || limits.maximumPages > 100) throw new Error("Sandbox page limit is invalid");
  if (!Number.isSafeInteger(limits.maximumPixelsPerPage) || limits.maximumPixelsPerPage < 1) throw new Error("Sandbox pixel limit is invalid");
  if (!Number.isFinite(limits.targetDpi) || limits.targetDpi < 72 || limits.targetDpi > 300) throw new Error("Sandbox DPI is invalid");
}

async function runTask(entrypoint: string, taskDirectory: string, request: unknown, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd: taskDirectory, env: { NODE_ENV: "production" }, shell: false, stdio: ["pipe", "pipe", "pipe"],
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

function parseResponse(value: string, maximumPages: number): SandboxResponse {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed) || parsed.schema_version !== "1.0.0" ||
      !("inspection" in parsed) || !("renders" in parsed) || !Array.isArray(parsed.renders) || parsed.renders.length > maximumPages) {
    throw new Error("Document sandbox returned an invalid response");
  }
  const response = parsed as SandboxResponse;
  if (!response.inspection || !Number.isSafeInteger(response.inspection.pageCount) || response.inspection.pageCount < 1 ||
      !Array.isArray(response.inspection.pages) || response.inspection.pages.length !== response.inspection.pageCount ||
      response.renders.length !== response.inspection.pageCount || response.renders.some((render, index) =>
        render.page_number !== index + 1 || !/^page-[1-9][0-9]*\.png$/.test(render.path) ||
        !Number.isSafeInteger(render.width) || render.width < 1 || !Number.isSafeInteger(render.height) || render.height < 1 ||
        typeof render.target_dpi !== "number" || typeof render.renderer_version !== "string" || !render.renderer_version)) {
    throw new Error("Document sandbox returned invalid page output");
  }
  return response;
}
