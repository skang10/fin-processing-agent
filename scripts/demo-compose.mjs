import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const action = process.argv[2];
const allowed = new Set(["up", "load", "down", "reset", "acceptance"]);
if (!allowed.has(action)) throw new Error("Expected up, load, down, reset, or acceptance");
const environmentPath = ".data/demo.env";
const localEnvironmentPath = ".env";
const agentEnvironmentKeys = new Set([
  "OCR_MODE",
  "OCR_MODEL_DIRECTORY",
  "PDFIUM_LIB_PATH",
  "ORT_DYLIB_PATH",
  "NAPI_RS_NATIVE_LIBRARY_PATH",
  "AGENT_MODEL",
  "VLM_MODE",
  "VLM_MODEL",
  "OPENAI_API_KEY",
  "AGENT_MODEL_API_KEY",
  "VLM_MODEL_API_KEY",
  "PI_OFFLINE",
]);

if (action !== "reset" && !exists(environmentPath)) {
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(environmentPath, [
    `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    `MINIO_SECRET_KEY=${randomBytes(24).toString("hex")}`,
    "",
  ].join("\n"), { mode: 0o600 });
}

if (action === "up") run(["up", "--build", "--detach", "--wait"]);
if (action === "load") run(["--profile", "tools", "run", "--rm", "demo-loader"]);
if (action === "down") run(["down", "--remove-orphans"]);
if (action === "reset") {
  console.log("Deleting FinDoc demo containers, database volume, object-store volume, and generated local credentials. This cannot be recovered.");
  if (exists(environmentPath)) run(["down", "--volumes", "--remove-orphans"]);
  rmSync(environmentPath, { force: true });
}
if (action === "acceptance") {
  try {
    run(["up", "--build", "--detach", "--wait"]);
    run(["--profile", "tools", "run", "--rm", "demo-loader"]);
  } finally {
    run(["down", "--volumes", "--remove-orphans"], false);
    rmSync(environmentPath, { force: true });
  }
}

function run(arguments_, required = true) {
  const acceptanceEnvironment = action === "acceptance" ? {
    OCR_MODE: "fake",
    OCR_MODEL_DIRECTORY: "",
    PDFIUM_LIB_PATH: "",
    ORT_DYLIB_PATH: "",
    NAPI_RS_NATIVE_LIBRARY_PATH: "",
    AGENT_MODEL: "fake",
    VLM_MODE: "fixture",
    VLM_MODEL: "",
    AGENT_MODEL_API_KEY: "",
    VLM_MODEL_API_KEY: "",
    OPENAI_API_KEY: "",
    PI_OFFLINE: "1",
  } : {};
  const result = spawnSync("docker", ["compose", "--env-file", environmentPath, ...arguments_], {
    stdio: "inherit",
    env: { ...process.env, ...readAllowlistedEnvironment(localEnvironmentPath), ...acceptanceEnvironment },
  });
  if (required && result.status !== 0) throw new Error(`Docker Compose failed with ${result.status ?? "no exit status"}`);
}

function readAllowlistedEnvironment(path) {
  if (!exists(path)) return {};
  const selected = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match || !agentEnvironmentKeys.has(match[1])) continue;
    selected[match[1]] = match[2];
  }
  return selected;
}

function exists(path) {
  try { readFileSync(path); return true; } catch { return false; }
}
