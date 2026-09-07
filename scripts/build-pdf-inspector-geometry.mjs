import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const args = process.argv.slice(2).filter((value) => value !== "--");
const platform = args[0] ?? `${process.platform}-${process.arch}`;
if (!new Set(["darwin-arm64", "linux-arm64", "linux-x64"]).has(platform)) throw new Error(`Unsupported geometry build platform: ${platform}`);

const manifest = JSON.parse(await readFile("config/ocr-runtime-assets.json", "utf8"));
const source = manifest.pdf_inspector_geometry_source;
const output = resolve("native-libs/ocr-runtime", platform, source.library_name);
if (existsSync(output)) {
  console.log(JSON.stringify({ status: "present", platform, output: source.library_name, source_commit: source.commit }));
  process.exit(0);
}

const staging = await mkdtemp(join(tmpdir(), "findoc-pdf-inspector-geometry-"));
try {
  const archive = join(staging, "source.tar.gz");
  const sourceRoot = join(staging, "source");
  await mkdir(sourceRoot);
  await download(source.url, archive, source.sha256);
  run("tar", ["-xzf", archive, "--strip-components=1", "-C", sourceRoot]);
  run("patch", ["-p1", "-d", sourceRoot, "-i", resolve(source.patch)]);

  const outputDirectory = resolve("native-libs/ocr-runtime", platform);
  const cacheRoot = resolve(".cache/pdf-inspector-geometry", platform);
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(join(cacheRoot, "cargo"), { recursive: true });
  await mkdir(join(cacheRoot, "target"), { recursive: true });

  if (platform === `${process.platform}-${process.arch}`) {
    run("cargo", ["build", "--release", "--manifest-path", join(sourceRoot, "napi/Cargo.toml")], {
      CARGO_HOME: join(cacheRoot, "cargo"), CARGO_TARGET_DIR: join(cacheRoot, "target"),
    });
    const extension = process.platform === "darwin" ? "dylib" : "so";
    await copyFile(join(cacheRoot, "target/release", `libpdf_inspector_napi.${extension}`), output);
  } else if (platform.startsWith("linux-")) {
    const dockerPlatform = platform === "linux-arm64" ? "linux/arm64" : "linux/amd64";
    run("docker", ["run", "--rm", "--platform", dockerPlatform,
      "-v", `${sourceRoot}:/source:ro`, "-v", `${join(cacheRoot, "cargo")}:/cargo-cache`,
      "-v", `${join(cacheRoot, "target")}:/target`, "-v", `${outputDirectory}:/output`,
      source.rust_image, "bash", "-c",
      `CARGO_HOME=/cargo-cache CARGO_TARGET_DIR=/target cargo build --release --manifest-path /source/napi/Cargo.toml && cp -f /target/release/libpdf_inspector_napi.so /output/${source.library_name}`,
    ]);
  } else throw new Error(`Cross-building ${platform} is unsupported`);
  await chmod(output, 0o755);
  console.log(JSON.stringify({ status: "built", platform, output: source.library_name, source_commit: source.commit }));
} finally {
  await rm(staging, { recursive: true, force: true });
}

function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function download(url, target, expectedDigest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${basename(target)}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(target, { mode: 0o644 }));
  const actual = createHash("sha256").update(await readFile(target)).digest("hex");
  if (actual !== expectedDigest) throw new Error(`Source checksum mismatch for ${basename(target)}`);
}
