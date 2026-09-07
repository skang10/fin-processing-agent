import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DocumentSandboxClient } from "../packages/document-processing/dist/index.js";

const source = await readFile("datasets/golden/releases/v0.1.2/documents/golden-006-scanned-adaptive-unavailable/golden-006-scanned-adaptive-unavailable.pdf");
const runtimePlatform = process.env.OCR_RUNTIME_PLATFORM ?? "linux-x64";
const runtimeRoot = `native-libs/ocr-runtime/${runtimePlatform}`;
const onnxDirectory = runtimePlatform === "linux-arm64" ? "onnxruntime-linux-aarch64-1.27.0" : "onnxruntime-linux-x64-1.27.0";
const result = await new DocumentSandboxClient().inspectAndRender(source, createHash("sha256").update(source).digest("hex"), {
  timeoutMs: 120_000,
  maximumPages: 3,
  maximumPixelsPerPage: 8_000_000,
  targetDpi: 150,
  ocrMode: "pdf_inspector",
  ocrModelDirectory: resolve(process.env.OCR_MODEL_DIRECTORY ?? "models/pp-ocrv6-small"),
  pdfiumLibraryPath: resolve(process.env.PDFIUM_LIB_PATH ?? `${runtimeRoot}/lib/libpdfium.so`),
  onnxRuntimeLibraryPath: resolve(process.env.ORT_DYLIB_PATH ?? `${runtimeRoot}/${onnxDirectory}/lib/libonnxruntime.so.1.27.0`),
});
const text = result.ocrOutputs.map((output) => output.result.rawText).join("\n");
for (const expected of ["Greta Demofall", "Demowerk GmbH", "2980.00"]) {
  if (!text.includes(expected)) throw new Error(`Real OCR smoke result omitted expected synthetic marker: ${expected}`);
}
console.log(JSON.stringify({
  status: "passed",
  runtime_platform: runtimePlatform,
  fixture: "golden-006-scanned-adaptive-unavailable",
  pages_routed_to_ocr: result.ocrOutputs.map((output) => output.pageNumber),
  engines: [...new Set(result.ocrOutputs.map((output) => output.result.engine))],
  engine_versions: [...new Set(result.ocrOutputs.map((output) => output.result.engineVersion))],
  model_asset_versions: [...new Set(result.ocrOutputs.map((output) => output.result.modelAssetVersion))],
  expected_synthetic_markers_present: true
}));
