import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { DocumentSandboxClient, PdfiumPageRenderer } from "../packages/document-processing/dist/index.js";
const runtimePlatform = process.env.OCR_RUNTIME_PLATFORM ?? "linux-x64";
const runtimeRoot = `native-libs/ocr-runtime/${runtimePlatform}`;
const onnxDirectory = runtimePlatform === "linux-arm64" ? "onnxruntime-linux-aarch64-1.27.0" : "onnxruntime-linux-x64-1.27.0";
const pdf = await readFile("datasets/golden/releases/v0.1.2/documents/golden-006-scanned-adaptive-unavailable/golden-006-scanned-adaptive-unavailable.pdf");
const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
const page = await new PdfiumPageRenderer().render(pdf, {
  sourceSha256: pdfSha256, pageNumber: 2, targetDpi: 150, colorMode: "color", outputFormat: "png", maximumPixels: 8_000_000,
});
const results = [];
for (const mediaType of ["image/jpeg", "image/png"]) {
  const pipeline = sharp(page.bytes);
  const source = await (mediaType === "image/jpeg" ? pipeline.jpeg({ quality: 95 }) : pipeline.png()).toBuffer();
  const result = await new DocumentSandboxClient().inspectAndRender(source, createHash("sha256").update(source).digest("hex"), {
    timeoutMs: 120_000, maximumPages: 1, maximumPixelsPerPage: 3_000_000, targetDpi: 150,
    ocrMode: "pdf_inspector",
    ocrModelDirectory: resolve(process.env.OCR_MODEL_DIRECTORY ?? "models/pp-ocrv6-small"),
    pdfiumLibraryPath: resolve(process.env.PDFIUM_LIB_PATH ?? `${runtimeRoot}/lib/libpdfium.so`),
    onnxRuntimeLibraryPath: resolve(process.env.ORT_DYLIB_PATH ?? `${runtimeRoot}/${onnxDirectory}/lib/libonnxruntime.so.1.27.0`),
  }, mediaType);
  const text = result.ocrOutputs[0]?.result.rawText ?? "";
  for (const marker of ["Greta Demofall", "Demowerk GmbH", "2980.00"]) {
    if (!text.includes(marker)) throw new Error(`${mediaType} OCR omitted expected synthetic marker: ${marker}`);
  }
  results.push({ media_type: mediaType, page_count: result.inspection.pageCount, render_count: result.renders.length,
    ocr_count: result.ocrOutputs.length, engine: result.ocrOutputs[0]?.result.engine,
    model_asset_version: result.ocrOutputs[0]?.result.modelAssetVersion, expected_synthetic_markers_present: true });
}
console.log(JSON.stringify({ status: "passed", runtime_platform: runtimePlatform, results }));
