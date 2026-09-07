import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
const action = arguments_[0] ?? "verify";
if (action !== "setup" && action !== "verify") throw new Error("Expected setup or verify");
const platform = arguments_[1] ?? `${process.platform}-${process.arch}`;
const manifest = JSON.parse(readFileSync("config/ocr-runtime-assets.json", "utf8"));
const selected = manifest.platforms[platform];
if (!selected) throw new Error(`Unsupported OCR runtime platform: ${platform}; use linux-x64 for the delivered container path`);

const runtimeRoot = resolve("native-libs/ocr-runtime", platform);
const modelRoot = resolve("models/pp-ocrv6-small");
if (action === "setup") {
  await setup();
  buildGeometry();
}
verify();
console.log(JSON.stringify({
  status: "verified",
  runtime_version: manifest.runtime_version,
  platform,
  pdfium_library: selected.pdfium.library_path,
  onnx_runtime_library: selected.onnx_runtime.library_path,
  model: manifest.ocr_model,
}));

async function setup() {
  if (existsSync(runtimeRoot) && existsSync(modelRoot)) {
    return;
  }
  mkdirSync(resolve("native-libs/ocr-runtime"), { recursive: true, mode: 0o755 });
  mkdirSync(resolve("models"), { recursive: true, mode: 0o755 });
  const staging = await mkdtemp(join(tmpdir(), "findoc-ocr-runtime-"));
  try {
    const stagedRuntime = join(staging, platform);
    const stagedModels = join(staging, "pp-ocrv6-small");
    mkdirSync(stagedRuntime, { recursive: true, mode: 0o755 });
    mkdirSync(stagedModels, { recursive: true, mode: 0o755 });
    if (!existsSync(runtimeRoot)) {
      for (const [name, asset] of [["pdfium", selected.pdfium], ["onnx-runtime", selected.onnx_runtime]]) {
        const archive = join(staging, `${name}.tgz`);
        await download(asset.url, archive, asset.sha256);
        const result = spawnSync("tar", ["-xzf", archive, "-C", stagedRuntime], { stdio: "inherit" });
        if (result.status !== 0) throw new Error(`Could not extract ${name}`);
      }
    }
    if (!existsSync(modelRoot)) {
      for (const model of manifest.models) await download(model.url, join(stagedModels, model.name), model.sha256);
    }
    if (!existsSync(runtimeRoot)) renameSync(stagedRuntime, runtimeRoot);
    if (!existsSync(modelRoot)) renameSync(stagedModels, modelRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function verify() {
  assertDigest(join(runtimeRoot, selected.pdfium.library_path), selected.pdfium.library_sha256);
  assertDigest(join(runtimeRoot, selected.onnx_runtime.library_path), selected.onnx_runtime.library_sha256);
  for (const model of manifest.models) assertDigest(join(modelRoot, model.name), model.sha256);
  if (!existsSync(join(runtimeRoot, manifest.pdf_inspector_geometry_source.library_name))) {
    throw new Error("PDF Inspector geometry binding is missing; run pnpm ocr:setup for this platform");
  }
}

function buildGeometry() {
  const result = spawnSync(process.execPath, ["scripts/build-pdf-inspector-geometry.mjs", platform], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Could not build PDF Inspector geometry binding");
}

async function download(url, target, expectedDigest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${basename(target)}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(target, { mode: 0o644 }));
  assertDigest(target, expectedDigest);
  chmodSync(target, 0o644);
}

function assertDigest(path, expected) {
  if (!existsSync(path)) throw new Error(`OCR runtime asset is missing: ${path}`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) throw new Error(`OCR runtime asset checksum mismatch: ${path}`);
}
