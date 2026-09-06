import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadFrozenRelease } from "./evaluate.mjs";
import { loadGoldenCase } from "./load-golden.mjs";

export async function captureEvaluationRun(releaseDirectory, runConfiguration, options = {}) {
  const { manifest, cases } = await loadFrozenRelease(releaseDirectory);
  validateConfiguration(runConfiguration, manifest.version, cases.length);
  const fetcher = options.fetcher ?? fetch; const apiBaseUrl = options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  const actualCases = [];
  for (const candidate of cases) {
    const loaded = await loadGoldenCase(candidate.case_id, { ...options, fetcher, apiBaseUrl, candidatePath: join(releaseDirectory, "cases", `${candidate.case_id}.json`), documentRoot: releaseDirectory });
    const runtime = loaded.runtime;
    if (loaded.lifecycle !== "ready_for_review") {
      actualCases.push({ case_id: candidate.case_id, processable: false, issues: [], checked_facts: [], report: { availability: "unavailable", verified: false, failure_reason: loaded.lifecycle, verifier: invalidVerifier() }, operations: {} });
      continue;
    }
    const evidence = await responseJson(await fetcher(`${apiBaseUrl}/api/v1/cases/${loaded.case_id}/evidence`), "Evidence capture");
    const canonical = new Map(evidence.evidence.map((item) => [item.evidence_id, item.evidence_type === "structured_input" ? `application:${item.json_pointer}` : `page:${item.page_number}`]));
    const references = (values) => [...new Set(values.map((value) => canonical.get(value.split("/").at(-1))).filter(Boolean))].sort();
    const report = runtime.report;
    const failure = report.failure_reason;
    const findingEvidence = new Map(runtime.findings.findings.map((finding) => [finding.finding_id, references(finding.references)]));
    const findingsByRule = new Map(runtime.findings.findings.map((finding) => [finding.rule_id, finding]));
    const findingEvidenceByRule = new Map(runtime.findings.findings.map((finding) => [finding.rule_id, references(finding.references)]));
    const issueEvidence = (values) => [...new Set(values.flatMap((value) => findingEvidence.get(value.split("/").at(-1)) ?? references([value])))].sort();
    actualCases.push({
      case_id: candidate.case_id, processable: true,
      issues: runtime.issues.issues.filter((item) => item.origin === "agent").map((item) => ({
        code: item.code,
        evidence: captureIssueEvidence(item, findingsByRule.get(item.code), findingEvidenceByRule.get(item.code) ?? [], issueEvidence),
      })),
      checked_facts: report.checked_facts.map((item) => ({ code: item.rule_id, evidence: references(item.references) })),
      report: { availability: report.availability, verified: report.availability === "ready", ...(failure ? { failure_reason: failure } : {}), verifier: verifierState(failure) },
      operations: {},
    });
  }
  return { schema_version: "1.0.0", run_id: runConfiguration.run_id, executed_at: runConfiguration.executed_at, environment: runConfiguration.environment, source_revision: runConfiguration.source_revision, versions: runConfiguration.versions, cases: actualCases };
}

export function captureIssueEvidence(issue, finding, fallbackEvidence, resolveIssueEvidence) {
  if (!finding) return issue.supporting_references.length ? resolveIssueEvidence(issue.supporting_references) : [];
  if (finding.reason_code === "required_document_missing") return [`finding:${issue.code}`];
  return [...new Set([
    ...(issue.supporting_references.length ? resolveIssueEvidence(issue.supporting_references) : fallbackEvidence),
    `finding:${issue.code}`,
  ])].sort();
}

function verifierState(failure) {
  return { schema_valid: failure !== "schema_rejected", reference_valid: failure !== "reference_rejected", registered_code_valid: failure !== "registered_code_rejected", prohibited_content_valid: !failure?.startsWith("policy_rejected_") };
}
function invalidVerifier() { return { schema_valid: false, reference_valid: false, registered_code_valid: false, prohibited_content_valid: false }; }
function validateConfiguration(configuration, datasetVersion, caseCount) {
  if (!configuration?.run_id || !configuration.executed_at || !configuration.environment || !configuration.source_revision || !configuration.versions) throw new Error("Capture configuration is incomplete");
  if (configuration.versions.dataset !== datasetVersion) throw new Error("Capture dataset version does not match the frozen release");
  if (configuration.cost_budget !== undefined) validateCostBudget(configuration.cost_budget, caseCount);
}

export function validateCostBudget(budget, caseCount) {
  const total = budget?.maximum_total_usd;
  const perCase = budget?.maximum_per_case_usd;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(perCase) || perCase <= 0) {
    throw new Error("Capture cost budget must contain positive maximum_total_usd and maximum_per_case_usd values");
  }
  if (perCase * caseCount > total) {
    throw new Error(`Capture cost budget cannot reserve ${caseCount} cases within the maximum total USD cost`);
  }
}
async function responseJson(response, label) { if (!response.ok) throw new Error(`${label} failed with ${response.status}`); return response.json(); }

async function main() {
  const [releaseArg, configurationArg, outputArg] = process.argv.slice(2).filter((value) => value !== "--");
  if (!releaseArg || !configurationArg || !outputArg) throw new Error("Usage: pnpm evaluate:capture -- RELEASE CONFIGURATION_JSON OUTPUT_JSON");
  const release = resolve(releaseArg); const configuration = JSON.parse(await readFile(resolve(configurationArg), "utf8")); const output = resolve(outputArg);
  const run = await captureEvaluationRun(release, configuration); await mkdir(resolve(output, ".."), { recursive: true }); await writeFile(output, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ run_id: run.run_id, cases: run.cases.length, output }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
