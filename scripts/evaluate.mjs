import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredVersions = ["case_package", "dataset", "generator", "pdf_inspector", "pdfium", "ocr_asset", "extraction", "model", "prompt", "schema", "agent", "tool_registry", "rule_set", "disposition_policy", "evaluator"];

export function evaluateDataset(goldenCases, actualRun) {
  validateRun(actualRun);
  const actualById = new Map(actualRun.cases.map((item) => [item.case_id, item]));
  let tp = 0; let fp = 0; let fn = 0; let grounded = 0; let groundingTotal = 0; let unsupported = 0; let processable = 0; let verified = 0;
  const cases = goldenCases.map((golden) => {
    const actual = actualById.get(golden.case_id);
    if (!actual) return { case_id: golden.case_id, outcome: "missing", missed_issues: golden.truth_candidate.expected_issues.map((item) => item.code), additional_issues: [], grounding: { correct: 0, total: 0 }, report: "missing" };
    const expectedIssues = new Map(golden.truth_candidate.expected_issues.map((item) => [item.code, item]));
    const actualIssues = new Map(actual.issues.map((item) => [item.code, item]));
    const missed = []; const additional = [];
    for (const [code, expected] of expectedIssues) {
      const item = actualIssues.get(code);
      if (item && intersects(item.evidence, expected.acceptable_evidence)) tp += 1; else { fn += 1; missed.push(code); }
    }
    for (const [code, item] of actualIssues) if (!expectedIssues.has(code) || !intersects(item.evidence, expectedIssues.get(code).acceptable_evidence)) { fp += 1; additional.push(code); }
    let caseCorrect = 0; let caseTotal = 0;
    for (const item of [...actual.issues, ...actual.checked_facts]) {
      const expected = [...golden.truth_candidate.expected_issues, ...golden.truth_candidate.expected_checked_facts].find((candidate) => candidate.code === item.code);
      caseTotal += 1; groundingTotal += 1;
      if (expected && intersects(item.evidence, expected.acceptable_evidence)) { caseCorrect += 1; grounded += 1; } else unsupported += 1;
    }
    if (actual.processable) { processable += 1; if (actual.report.verified) verified += 1; }
    const expectedAvailability = golden.truth_candidate.report_availability === "ready" ? "ready" : "unavailable";
    return { case_id: golden.case_id, outcome: "evaluated", missed_issues: missed, additional_issues: additional, grounding: { correct: caseCorrect, total: caseTotal }, report: actual.report.availability, expected_report: expectedAvailability, verifier: actual.report.verifier, operations: actual.operations };
  });
  for (const extra of actualRun.cases.filter((item) => !goldenCases.some((golden) => golden.case_id === item.case_id))) cases.push({ case_id: extra.case_id, outcome: "excluded", reason: "not_in_dataset_release" });
  return {
    schema_version: "1.0.0", evaluation_id: digest({ dataset: actualRun.versions.dataset, run: actualRun.run_id, cases }), limitation: "Synthetic demonstration and regression data; not representative of production performance.",
    executed_at: actualRun.executed_at, environment: actualRun.environment, source_revision: actualRun.source_revision, versions: actualRun.versions,
    metrics: {
      issue_detection: { true_positive: tp, false_positive: fp, false_negative: fn, micro_precision: ratio(tp, tp + fp), micro_recall: ratio(tp, tp + fn) },
      evidence_grounding: { correct: grounded, total: groundingTotal, unsupported, correct_grounding_rate: ratio(grounded, groundingTotal), unsupported_claim_rate: ratio(unsupported, groundingTotal) },
      report_validity: { verified, processable, verified_report_completion_rate: ratio(verified, processable), failure_categories: countFailures(actualRun.cases) },
    },
    operations: summarizeOperations(actualRun.cases), cases,
  };
}

export async function loadFrozenRelease(releaseDirectory) {
  const manifest = JSON.parse(await readFile(join(releaseDirectory, "manifest.json"), "utf8"));
  if (!manifest.version || !Array.isArray(manifest.cases)) throw new Error("Invalid frozen dataset manifest");
  const cases = [];
  for (const entry of manifest.cases) {
    const bytes = await readFile(join(releaseDirectory, entry.candidate_file));
    if (digestBytes(bytes) !== entry.candidate_sha256) throw new Error(`Frozen case checksum mismatch: ${entry.case_id}`);
    const candidate = JSON.parse(bytes);
    if (candidate.verification?.status !== "confirmed") throw new Error(`Frozen case is not confirmed: ${entry.case_id}`);
    cases.push(candidate);
  }
  return { manifest, cases };
}

function validateRun(run) {
  if (!run || run.schema_version !== "1.0.0" || !run.run_id || !run.executed_at || !run.environment || !run.source_revision || !Array.isArray(run.cases)) throw new Error("Invalid evaluation run");
  for (const key of requiredVersions) if (!run.versions?.[key]) throw new Error(`Evaluation run is missing version: ${key}`);
  for (const item of run.cases) {
    if (!item.case_id || typeof item.processable !== "boolean" || !Array.isArray(item.issues) || !Array.isArray(item.checked_facts) || !item.report?.availability || typeof item.report.verified !== "boolean") throw new Error(`Invalid actual case: ${item.case_id ?? "unknown"}`);
    for (const fact of [...item.issues, ...item.checked_facts]) if (!fact.code || !Array.isArray(fact.evidence)) throw new Error(`Invalid grounded item in ${item.case_id}`);
  }
}

function intersects(left, right) { return left.some((value) => right.includes(value)); }
function ratio(numerator, denominator) { return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator }; }
function countFailures(cases) { const counts = {}; for (const item of cases) if (item.processable && !item.report.verified) { const reason = item.report.failure_reason ?? "unavailable"; counts[reason] = (counts[reason] ?? 0) + 1; } return counts; }
function summarizeOperations(cases) {
  const values = (key) => cases.map((item) => item.operations?.[key]).filter((value) => typeof value === "number");
  const sum = (items) => items.reduce((total, value) => total + value, 0);
  const total = (key) => values(key).length === cases.length ? sum(values(key)) : "unavailable";
  return { cases: cases.length, latency_ms: total("latency_ms"), model_calls: total("model_calls"), tokens: total("tokens"), estimated_cost: total("estimated_cost") };
}
function digest(value) { return digestBytes(Buffer.from(JSON.stringify(value))); }
function digestBytes(value) { return createHash("sha256").update(value).digest("hex"); }

async function main() {
  const [releaseArg, actualArg, outputRootArg] = process.argv.slice(2).filter((value) => value !== "--");
  if (!releaseArg || !actualArg) throw new Error("Usage: pnpm evaluate:offline -- RELEASE_DIRECTORY ACTUAL_RUN_JSON [OUTPUT_ROOT]");
  const releaseDirectory = resolve(releaseArg); const { cases } = await loadFrozenRelease(releaseDirectory); const actual = JSON.parse(await readFile(resolve(actualArg), "utf8"));
  const report = evaluateDataset(cases, actual); const outputRoot = resolve(outputRootArg ?? "output/evaluations"); const target = join(outputRoot, report.evaluation_id);
  await mkdir(outputRoot, { recursive: true });
  try { await mkdir(target, { recursive: false }); } catch (error) { if (error?.code === "EEXIST") throw new Error(`Evaluation output already exists: ${basename(target)}`); throw error; }
  await writeFile(join(target, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ evaluation_id: report.evaluation_id, report: join(target, "report.json"), metrics: report.metrics }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
