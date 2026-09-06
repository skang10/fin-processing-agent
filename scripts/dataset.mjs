import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultCandidateDirectory = join(repositoryRoot, "datasets/golden/candidates");
const defaultReleaseDirectory = join(repositoryRoot, "datasets/golden/releases");
const defaultBlueprintPath = join(repositoryRoot, "datasets/golden/blueprints.json");
const registeredRuleCodes = new Set(["VAL_DOC_COMPLETENESS_001", "VAL_NAME_CONSISTENCY_001", "VAL_EMPLOYER_CONSISTENCY_001", "VAL_INCOME_CONSISTENCY_001", "VAL_ID_EXPIRY_001"]);

export async function generateCandidates(blueprintPath = defaultBlueprintPath, directory = defaultCandidateDirectory) {
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  if (blueprint.schema_version !== "1.0.0" || !Array.isArray(blueprint.cases)) throw new Error("Invalid golden dataset blueprint");
  await mkdir(directory, { recursive: true });
  for (const item of blueprint.cases) {
    const documents = await Promise.all(item.documents.map(async (document) => {
      const artifactPath = resolve(dirname(blueprintPath), document.path);
      if (Array.isArray(document.pages)) {
        await mkdir(dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, createSyntheticPdf(document.pages));
      }
      const bytes = await readFile(artifactPath);
      const { pages: _pages, ...metadata } = document;
      return { ...metadata, page_count: document.pages?.length ?? document.page_count, path: relative(directory, artifactPath), sha256: sha256(bytes) };
    }));
    const candidate = { ...item, schema_version: "1.0.0", synthetic_data: true, documents };
    const candidatePath = join(directory, `${item.case_id}.json`);
    try {
      const existing = JSON.parse(await readFile(candidatePath, "utf8"));
      const withoutVerification = ({ verification: _verification, ...value }) => value;
      if (existing.verification?.status === "confirmed" && canonicalJson(withoutVerification(existing)) === canonicalJson(withoutVerification(candidate))) {
        candidate.verification = existing.verification;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await writeFile(candidatePath, canonicalJson(candidate));
  }
  return validateCandidates(directory, dirname(blueprintPath));
}

export async function validateCandidates(directory = defaultCandidateDirectory, allowedRoot = repositoryRoot) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error("No golden dataset candidates found");
  const ids = new Set();
  const seeds = new Set();
  const cases = [];
  for (const file of files) {
    const path = join(directory, file);
    const candidate = JSON.parse(await readFile(path, "utf8"));
    validateCandidateShape(candidate, file);
    if (ids.has(candidate.case_id)) throw new Error(`Duplicate case_id ${candidate.case_id}`);
    ids.add(candidate.case_id);
    if (seeds.has(candidate.seed)) throw new Error(`Duplicate deterministic seed ${candidate.seed}`);
    seeds.add(candidate.seed);
    for (const document of candidate.documents) {
      const artifactPath = resolve(directory, document.path);
      if (!artifactPath.startsWith(resolve(allowedRoot) + "/")) throw new Error(`${file}: document escapes dataset root`);
      const bytes = await readFile(artifactPath);
      if (sha256(bytes) !== document.sha256) throw new Error(`${file}: checksum mismatch for ${document.path}`);
      if (!bytes.includes(Buffer.from("SYNTHETIC DEMO"))) throw new Error(`${file}: document lacks visible synthetic marker`);
    }
    validateTruthReferences(candidate, file);
    cases.push({ file, path, candidate });
  }
  return cases;
}

export async function inspectCandidates(directory = defaultCandidateDirectory, allowedRoot = repositoryRoot) {
  return (await validateCandidates(directory, allowedRoot)).map(({ candidate }) => ({
    case_id: candidate.case_id,
    verification: candidate.verification.status,
    expected_report: candidate.truth_candidate.report_availability,
    expected_issues: candidate.truth_candidate.expected_issues.map((item) => item.code),
    coverage: candidate.coverage,
  }));
}

export async function confirmCandidate(caseId, reviewer, directory = defaultCandidateDirectory, allowedRoot = repositoryRoot) {
  if (!caseId || !reviewer?.trim()) throw new Error("Case ID and human reviewer identity are required");
  const path = join(directory, `${caseId}.json`);
  const candidate = JSON.parse(await readFile(path, "utf8"));
  if (candidate.case_id !== caseId) throw new Error("Candidate identity does not match its filename");
  if (candidate.coverage.includes("runtime_support_pending")) throw new Error("Candidate cannot be confirmed while its runtime path is pending");
  candidate.verification = { status: "confirmed", verified_by: reviewer.trim(), verified_at: new Date().toISOString() };
  await writeFile(path, canonicalJson(candidate));
  await validateCandidates(directory, allowedRoot);
  return candidate.verification;
}

export async function buildRelease(version, candidateDirectory = defaultCandidateDirectory, releaseRoot = defaultReleaseDirectory, allowedRoot = repositoryRoot) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error("Release version must look like v1.0.0");
  const cases = await validateCandidates(candidateDirectory, allowedRoot);
  const pending = cases.filter(({ candidate }) => candidate.verification.status !== "confirmed");
  if (pending.length) throw new Error(`Cannot freeze release: ${pending.length} candidate(s) await human confirmation`);
  const target = join(releaseRoot, version);
  try { await stat(target); throw new Error(`Release ${version} already exists`); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(join(target, "cases"), { recursive: true });
  await mkdir(join(target, "documents"), { recursive: true });
  const sums = [];
  const manifestCases = [];
  for (const { candidate } of cases) {
    const releaseCandidate = { ...candidate, documents: [] };
    for (const document of candidate.documents) {
      const name = basename(document.path);
      const releasePath = `documents/${candidate.case_id}/${name}`;
      await mkdir(join(target, "documents", candidate.case_id), { recursive: true });
      await copyFile(resolve(candidateDirectory, document.path), join(target, releasePath));
      releaseCandidate.documents.push({ ...document, path: releasePath });
      sums.push(`${document.sha256}  ${releasePath}`);
    }
    const candidateFile = `cases/${candidate.case_id}.json`;
    const candidateContent = canonicalJson(releaseCandidate);
    await writeFile(join(target, candidateFile), candidateContent);
    const candidateChecksum = sha256(Buffer.from(candidateContent));
    sums.push(`${candidateChecksum}  ${candidateFile}`);
    manifestCases.push({ case_id: candidate.case_id, candidate_file: candidateFile, candidate_sha256: candidateChecksum,
      document_sha256: releaseCandidate.documents.map((document) => ({ path: document.path, sha256: document.sha256 })),
      verified_by: candidate.verification.verified_by, verified_at: candidate.verification.verified_at });
  }
  const manifest = {
    schema_version: "1.0.0", dataset_id: "findoc-synthetic-golden", version,
    limitation: "Synthetic demonstration and regression data; not representative of production performance.",
    case_count: manifestCases.length, cases: manifestCases,
  };
  const content = canonicalJson(manifest);
  await writeFile(join(target, "manifest.json"), content);
  sums.push(`${sha256(Buffer.from(content))}  manifest.json`);
  await writeFile(join(target, "SHA256SUMS"), `${sums.sort().join("\n")}\n`);
  return manifest;
}

function validateCandidateShape(value, file) {
  if (!value || value.schema_version !== "1.0.0" || typeof value.case_id !== "string") throw new Error(`${file}: invalid candidate identity`);
  if (value.synthetic_data !== true || !Number.isInteger(value.seed)) throw new Error(`${file}: synthetic marker and deterministic seed are required`);
  if (!value.generator?.version || !value.generator?.template_version) throw new Error(`${file}: generator versions are required`);
  if (!Array.isArray(value.documents) || value.documents.length === 0) throw new Error(`${file}: documents are required`);
  if (!value.verification || !["pending_human_review", "confirmed"].includes(value.verification.status)) throw new Error(`${file}: invalid verification status`);
  if (value.verification.status === "confirmed" && (!value.verification.verified_by || !value.verification.verified_at)) throw new Error(`${file}: confirmed truth requires verifier and time`);
  const truth = value.truth_candidate;
  if (!truth || !Array.isArray(truth.expected_issues) || !Array.isArray(truth.expected_checked_facts)) throw new Error(`${file}: incomplete truth candidate`);
  if (!Array.isArray(truth.required_report_content) || !Array.isArray(truth.prohibited_report_content)) throw new Error(`${file}: report constraints are required`);
  if (!truth.report_availability) throw new Error(`${file}: report outcome is required`);
  for (const item of [...truth.expected_issues, ...truth.expected_checked_facts]) {
    if (!registeredRuleCodes.has(item.code) || !Array.isArray(item.acceptable_evidence) || item.acceptable_evidence.length === 0) throw new Error(`${file}: truth requires a registered rule code and evidence`);
  }
}

function validateTruthReferences(candidate, file) {
  const maximumPage = candidate.documents.reduce((count, document) => count + (document.page_count ?? 1), 0);
  for (const item of [...candidate.truth_candidate.expected_issues, ...candidate.truth_candidate.expected_checked_facts]) {
    for (const reference of item.acceptable_evidence) {
      if (reference.startsWith("page:")) {
        const page = Number(reference.slice(5));
        if (!Number.isInteger(page) || page < 1 || page > maximumPage) throw new Error(`${file}: evidence page does not exist: ${reference}`);
      } else if (reference.startsWith("application:/")) {
        if (!jsonPointerExists(candidate.application_data, reference.slice("application:".length))) throw new Error(`${file}: application evidence does not exist: ${reference}`);
      } else if (reference.startsWith("document:")) {
        if (!candidate.documents.some((document) => basename(document.path) === reference.slice(9))) throw new Error(`${file}: document evidence does not exist: ${reference}`);
      } else throw new Error(`${file}: unsupported evidence reference ${reference}`);
    }
  }
}

function jsonPointerExists(value, pointer) {
  let current = value;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !(key in current)) return false;
    current = current[key];
  }
  return true;
}

function canonicalJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function createSyntheticPdf(pages) {
  if (pages.length === 0 || pages.some((page) => !Array.isArray(page) || !page.some((line) => line.includes("SYNTHETIC DEMO")))) {
    throw new Error("Every generated PDF page requires a visible SYNTHETIC DEMO line");
  }
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((lines, index) => {
    const stream = ["BT", "/F1 14 Tf", "72 770 Td", ...lines.flatMap((line, lineIndex) => [
      ...(lineIndex === 0 ? [] : ["0 -24 Td"]), `(${escapePdfText(line)}) Tj`,
    ]), "ET"].join("\n");
    const pageId = 4 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

function escapePdfText(value) { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }

async function main() {
  const [command, argument, secondArgument] = process.argv.slice(2).filter((value) => value !== "--");
  if (command === "generate") console.log(JSON.stringify({ generated: (await generateCandidates()).length }, null, 2));
  else if (command === "validate") console.log(JSON.stringify({ valid: true, cases: (await validateCandidates()).length }, null, 2));
  else if (command === "inspect") console.log(JSON.stringify(await inspectCandidates(), null, 2));
  else if (command === "confirm" && argument && secondArgument) console.log(JSON.stringify(await confirmCandidate(argument, secondArgument), null, 2));
  else if (command === "build" && argument) console.log(JSON.stringify(await buildRelease(argument), null, 2));
  else throw new Error("Usage: dataset <generate|validate|inspect|confirm CASE_ID REVIEWER|build VERSION>");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
