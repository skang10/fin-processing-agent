import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCandidateSet, loadFrozenRelease } from "./evaluate.mjs";
import { loadGoldenCase } from "./load-golden.mjs";

const DELIVERED_CASE_COST_LIMIT_USD = 0.25;

export async function captureEvaluationRun(releaseDirectory, runConfiguration, options = {}) {
  const { manifest, cases } = options.candidateMode ? await loadCandidateSet(releaseDirectory) : await loadFrozenRelease(releaseDirectory);
  validateConfiguration(runConfiguration, manifest.version, cases.length);
  const fetcher = options.fetcher ?? fetch; const apiBaseUrl = options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  const actualCases = [];
  const costBudget = runConfiguration.cost_budget;
  let reconciledCostUsd = 0;
  let blockedReason;
  for (const candidate of cases) {
    if (!blockedReason && costBudget && !canReserveCase(costBudget, reconciledCostUsd)) blockedReason = "whole_run_cost_budget_exhausted";
    if (blockedReason) {
      actualCases.push(skippedCase(candidate.case_id, blockedReason));
      continue;
    }
    const loaded = await loadGoldenCase(candidate.case_id, {
      ...options, fetcher, apiBaseUrl,
      candidatePath: candidateMode(options) ? join(releaseDirectory, `${candidate.case_id}.json`) : join(releaseDirectory, "cases", `${candidate.case_id}.json`),
      documentRoot: releaseDirectory,
    });
    const runtime = loaded.runtime;
    const agentLog = costBudget
      ? await responseJson(await fetcher(`${apiBaseUrl}/api/v1/cases/${loaded.case_id}/agent-log`), "Agent cost capture")
      : undefined;
    const caseCostUsd = agentLog ? capturedUsdCost(agentLog) : undefined;
    if (costBudget) {
      const reconciliation = reconcileCaseCost(costBudget, reconciledCostUsd, caseCostUsd);
      reconciledCostUsd = reconciliation.reconciledCostUsd;
      blockedReason = reconciliation.blockedReason;
    }
    if (loaded.lifecycle !== "ready_for_review") {
      actualCases.push({ case_id: candidate.case_id, processable: false, issues: [], checked_facts: [], report: { availability: "unavailable", verified: false, failure_reason: loaded.lifecycle, verifier: invalidVerifier() }, operations: capturedCostOperations(caseCostUsd) });
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
      })).sort(byCode),
      checked_facts: report.checked_facts.map((item) => ({ code: item.rule_id, evidence: references(item.references) })).sort(byCode),
      report: { availability: report.availability, verified: report.availability === "ready", ...(failure ? { failure_reason: failure } : {}), verifier: verifierState(failure) },
      operations: capturedCostOperations(caseCostUsd),
    });
  }
  return { schema_version: "1.0.0", run_id: runConfiguration.run_id, executed_at: runConfiguration.executed_at, environment: runConfiguration.environment, source_revision: runConfiguration.source_revision, versions: runConfiguration.versions, ...(costBudget ? { cost_budget: costBudget } : {}), cases: actualCases };
}

function candidateMode(options) { return options.candidateMode === true; }
function byCode(left, right) { return left.code.localeCompare(right.code); }

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
function skippedCase(caseId, reason) {
  return { case_id: caseId, processable: false, issues: [], checked_facts: [], report: { availability: "unavailable", verified: false, failure_reason: reason, verifier: invalidVerifier() }, operations: {} };
}
function capturedCostOperations(costUsd) { return costUsd === undefined ? {} : { estimated_cost: costUsd }; }
export function capturedUsdCost(agentLog) {
  if (!agentLog?.estimated_cost || agentLog.estimated_cost.currency !== "USD") return undefined;
  const amount = Number(agentLog.estimated_cost.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}
export function canReserveCase(budget, reconciledCostUsd) {
  return reconciledCostUsd + budget.maximum_per_case_usd <= budget.maximum_total_usd + Number.EPSILON;
}
export function reconcileCaseCost(budget, reconciledCostUsd, caseCostUsd) {
  if (caseCostUsd === undefined) return { reconciledCostUsd, blockedReason: "whole_run_cost_unavailable" };
  const nextCostUsd = reconciledCostUsd + caseCostUsd;
  if (caseCostUsd > budget.maximum_per_case_usd + Number.EPSILON || nextCostUsd > budget.maximum_total_usd + Number.EPSILON) {
    throw new Error("Captured Agent cost exceeded the configured evaluation budget");
  }
  return { reconciledCostUsd: nextCostUsd, blockedReason: undefined };
}
function validateConfiguration(configuration, datasetVersion, caseCount) {
  if (!configuration?.run_id || !configuration.executed_at || !configuration.environment || !configuration.source_revision || !configuration.versions) throw new Error("Capture configuration is incomplete");
  if (configuration.versions.dataset !== datasetVersion) throw new Error("Capture dataset version does not match the frozen release");
  if (isLiveModel(configuration.versions.model) && configuration.cost_budget === undefined) throw new Error("Live evaluation capture requires an explicit whole-run cost budget");
  if (configuration.cost_budget !== undefined) validateCostBudget(configuration.cost_budget, caseCount);
}

function isLiveModel(model) { return typeof model === "string" && model !== "fake" && !model.startsWith("findoc-fake/"); }

export function validateCostBudget(budget, caseCount) {
  const total = budget?.maximum_total_usd;
  const perCase = budget?.maximum_per_case_usd;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(perCase) || perCase <= 0) {
    throw new Error("Capture cost budget must contain positive maximum_total_usd and maximum_per_case_usd values");
  }
  if (perCase < DELIVERED_CASE_COST_LIMIT_USD) {
    throw new Error(`Capture maximum_per_case_usd must cover the delivered Agent limit of USD ${DELIVERED_CASE_COST_LIMIT_USD}`);
  }
  if (!Number.isInteger(caseCount) || caseCount < 0) throw new Error("Capture case count must be a non-negative integer");
}
async function responseJson(response, label) { if (!response.ok) throw new Error(`${label} failed with ${response.status}`); return response.json(); }

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const candidateMode = args[0] === "--candidates";
  const [releaseArg, configurationArg, outputArg] = candidateMode ? args.slice(1) : args;
  if (!releaseArg || !configurationArg || !outputArg) throw new Error("Usage: pnpm evaluate:capture -- [--candidates] DATASET CONFIGURATION_JSON OUTPUT_JSON");
  const release = resolve(releaseArg); const configuration = JSON.parse(await readFile(resolve(configurationArg), "utf8")); const output = resolve(outputArg);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schema_version: "1.0.0", run_id: configuration.run_id, status: "capture_in_progress" }, null, 2)}\n`, { flag: "wx" });
  const run = await captureEvaluationRun(release, configuration, { candidateMode });
  await writeFile(output, `${JSON.stringify(run, null, 2)}\n`);
  console.log(JSON.stringify({ run_id: run.run_id, cases: run.cases.length, output }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
