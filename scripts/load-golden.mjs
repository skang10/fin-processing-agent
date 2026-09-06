import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");

export async function loadGoldenCase(caseId, options = {}) {
  if (!caseId) throw new Error("A golden case ID is required");
  const apiBaseUrl = options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  const reviewWebUrl = options.reviewWebUrl ?? process.env.REVIEW_WEB_URL ?? "http://localhost:5173";
  const fetcher = options.fetcher ?? fetch;
  const candidatePath = resolve(repositoryRoot, "datasets/golden/candidates", `${caseId}.json`);
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  if (candidate.case_id !== caseId || candidate.synthetic_data !== true) throw new Error("Golden candidate identity is invalid");
  const form = new FormData();
  form.set("application_data", JSON.stringify(candidate.application_data));
  for (const document of candidate.documents) {
    const path = resolve(dirname(candidatePath), document.path);
    form.append("documents", new Blob([await readFile(path)], { type: document.media_type }), basename(path));
  }
  const created = await fetcher(`${apiBaseUrl}/api/v1/cases`, { method: "POST", headers: { "Idempotency-Key": `golden-${caseId}-${Date.now()}` }, body: form });
  const accepted = await jsonResponse(created, "Golden intake");
  let status;
  for (let attempt = 0; attempt < (options.pollAttempts ?? 120); attempt += 1) {
    status = await jsonResponse(await fetcher(`${apiBaseUrl}${accepted.status_url}`), "Golden polling");
    if (status.lifecycle !== "processing") break;
    await (options.wait ?? ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))))(options.pollIntervalMs ?? 500);
  }
  if (!status || status.lifecycle === "processing") throw new Error(`Golden case ${caseId} timed out`);
  const projections = {};
  if (status.lifecycle === "ready_for_review") {
    for (const [name, link] of Object.entries({ report: status.links.agent_report, findings: status.links.findings, issues: status.links.issues, documents: status.links.documents })) {
      projections[name] = await jsonResponse(await fetcher(`${apiBaseUrl}${link}`), `Golden ${name}`);
    }
  }
  return { case_id: accepted.case_id, golden_case_id: caseId, lifecycle: status.lifecycle, report_availability: projections.report?.availability ?? "unavailable", issue_codes: projections.issues?.issues?.map((issue) => issue.code) ?? [], finding_count: projections.findings?.findings?.length ?? 0, review_url: `${reviewWebUrl}/?case_id=${accepted.case_id}` };
}

async function jsonResponse(response, label) { if (!response.ok) throw new Error(`${label} failed with ${response.status}`); return response.json(); }

async function main() {
  const caseId = process.argv.slice(2).find((value) => value !== "--");
  console.log(JSON.stringify(await loadGoldenCase(caseId), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
