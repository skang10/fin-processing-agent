import { pathToFileURL } from "node:url";

export async function fetchFullAgentTrace(caseId, options = {}) {
  const baseUrl = options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  const fetcher = options.fetcher ?? fetch;
  let resolvedCaseId = caseId;
  if (!resolvedCaseId) {
    const latest = await fetcher(`${baseUrl}/api/internal/dev/agent-trace/latest`);
    if (!latest.ok) throw new Error("No synthetic Agent run is available, or Agent diagnostics are disabled");
    resolvedCaseId = (await latest.json()).case_id;
  }
  const response = await fetcher(`${baseUrl}/api/internal/dev/cases/${encodeURIComponent(resolvedCaseId)}/agent-trace/full`);
  if (response.ok) return response.json();
  if (response.status === 404) throw new Error("Agent diagnostics are disabled, the case is not synthetic, or the case does not exist");
  throw new Error(`Agent diagnostic export failed with HTTP ${response.status}`);
}

async function main() {
  const caseId = process.argv.slice(2).find((value) => value !== "--");
  console.log(JSON.stringify(await fetchFullAgentTrace(caseId), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
