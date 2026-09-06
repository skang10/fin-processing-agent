import { readFile } from "node:fs/promises";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const reviewWebUrl = process.env.REVIEW_WEB_URL ?? "http://localhost:5173";
const pdf = await readFile(new URL("../output/pdf/case-package.pdf", import.meta.url));
const applicationData = {
  applicant_display_name: "Anna Beispiel",
  demo_fixture_id: "anna-example-v1",
  contact: { email: "anna@example.invalid", phone: "+49 170 1234567" },
  employment: { employer: "Beispieltechnik GmbH", type: "permanent", started_on: "2022-01-01" },
  income: { monthly_net: "3480.00", currency: "EUR", basis: "net" },
  initial_submitted_at: "2026-09-05T18:00:00.000Z",
  latest_submitted_at: "2026-09-05T18:00:00.000Z",
  application_data_updated_at: "2026-09-05T18:00:00.000Z",
};
const form = new FormData();
form.set("application_data", JSON.stringify(applicationData));
form.set("documents", new Blob([pdf], { type: "application/pdf" }), "case-package.pdf");
const created = await fetch(`${apiBaseUrl}/api/v1/cases`, {
  method: "POST",
  headers: { "Idempotency-Key": `demo-${Date.now()}` },
  body: form,
});
if (!created.ok) throw new Error(`Demo intake failed with ${created.status}`);
const accepted = await created.json();
let current;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const response = await fetch(`${apiBaseUrl}${accepted.status_url}`);
  if (!response.ok) throw new Error(`Demo polling failed with ${response.status}`);
  current = await response.json();
  if (current.lifecycle !== "processing") break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (current?.lifecycle !== "ready_for_review") {
  throw new Error(`Demo case did not become ready: ${current?.lifecycle ?? "timeout"}`);
}
const [report, findings, issues, documents] = await Promise.all([
  fetch(`${apiBaseUrl}${current.links.agent_report}`).then(requireOk),
  fetch(`${apiBaseUrl}${current.links.findings}`).then(requireOk),
  fetch(`${apiBaseUrl}${current.links.issues}`).then(requireOk),
  fetch(`${apiBaseUrl}${current.links.documents}`).then(requireOk),
]);
if (report.availability !== "ready" || findings.findings.length !== 5 || issues.issues.length !== 3) {
  throw new Error("Demo result did not match the registered offline acceptance fixture");
}
const firstDocument = documents.documents[0];
if (!firstDocument) throw new Error("Demo result did not expose its processed document");
const firstPageUrl = `${apiBaseUrl}/api/v1/cases/${accepted.case_id}/documents/${firstDocument.document_id}/pages/1`;
const firstPage = await fetch(firstPageUrl).then(requireOk);
if (!firstPage.native_text_available) throw new Error("Demo result did not retain page native text");
const nativeTextResponse = await fetch(`${firstPageUrl}/native-text`);
if (!nativeTextResponse.ok || !(await nativeTextResponse.text()).trim()) {
  throw new Error("Demo native-text stream was unavailable or empty");
}
console.log(JSON.stringify({
  case_id: accepted.case_id,
  lifecycle: current.lifecycle,
  findings: findings.findings.length,
  issues: issues.issues.length,
  review_url: `${reviewWebUrl}/?case_id=${accepted.case_id}`,
}, null, 2));

async function requireOk(response) {
  if (!response.ok) throw new Error(`Demo projection failed with ${response.status}`);
  return response.json();
}
