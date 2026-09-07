import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { PdfiumPageRenderer } from "../packages/document-processing/dist/index.js";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const caseId = "golden-006-scanned-adaptive-unavailable";
const releaseRoot = "datasets/golden/releases/v0.1.2";
const existingCaseId = process.argv.slice(2).find((value) => value !== "--");
let accepted;
if (existingCaseId) {
  accepted = { case_id: existingCaseId, status_url: `/api/v1/cases/${existingCaseId}` };
} else {
  const candidate = JSON.parse(await readFile(`${releaseRoot}/cases/${caseId}.json`, "utf8"));
  const pdf = await readFile(`${releaseRoot}/documents/${caseId}/${caseId}.pdf`);
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const renderer = new PdfiumPageRenderer();
  const form = new FormData();
  form.set("application_data", JSON.stringify(candidate.application_data));
  for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
    const rendered = await renderer.render(pdf, { sourceSha256: sha256, pageNumber, targetDpi: 150,
      colorMode: "color", outputFormat: "png", maximumPixels: 8_000_000 });
    const mediaType = pageNumber === 2 ? "image/png" : "image/jpeg";
    const bytes = mediaType === "image/png" ? rendered.bytes : await sharp(rendered.bytes).jpeg({ quality: 95 }).toBuffer();
    form.append("documents", new Blob([bytes], { type: mediaType }), `synthetic-page-${pageNumber}.${mediaType === "image/png" ? "png" : "jpg"}`);
  }
  const created = await fetch(`${apiBaseUrl}/api/v1/cases`, { method: "POST", headers: { "Idempotency-Key": `image-ocr-acceptance-${Date.now()}` }, body: form });
  if (!created.ok) throw new Error(`Image OCR intake failed: ${created.status}`);
  accepted = await created.json();
}
let status;
for (let attempt = 0; attempt < 240; attempt += 1) {
  const response = await fetch(`${apiBaseUrl}${accepted.status_url}`);
  if (!response.ok) throw new Error(`Image OCR polling failed: ${response.status}`);
  status = await response.json();
  if (status.lifecycle !== "processing") break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}
if (status?.lifecycle !== "ready_for_review") throw new Error(`Image OCR case did not reach review: ${status?.lifecycle ?? "timeout"}`);
const [report, findings, agentLog, documents] = await Promise.all(
  ["agent-report", "findings", "agent-log", "documents"].map(async (endpoint) => {
    const response = await fetch(`${apiBaseUrl}/api/v1/cases/${accepted.case_id}/${endpoint}`);
    if (!response.ok) throw new Error(`Image OCR ${endpoint} failed: ${response.status}`);
    return response.json();
  }),
);
const nonPassing = findings.findings.filter((finding) => finding.status !== "passed");
if (report.availability !== "ready" || nonPassing.length !== 1 || nonPassing[0]?.rule_id !== "VAL_INCOME_CONSISTENCY_001" || nonPassing[0]?.reason_code !== "income_conflict") {
  throw new Error("Image OCR acceptance result does not match the expected deterministic finding");
}
const pageMetadata = await Promise.all(documents.documents.map(async (document) => {
  const response = await fetch(`${apiBaseUrl}/api/v1/cases/${accepted.case_id}/documents/${document.document_id}/pages/1`);
  if (!response.ok) throw new Error(`Image OCR page metadata failed: ${response.status}`);
  return response.json();
}));
const ocrEvents = agentLog.events.filter((event) => event.tool_label === "run_ocr");
if (documents.documents.length !== 3 || documents.documents.some((document) => document.page_count !== 1) ||
    pageMetadata.some((page) => page.needs_ocr !== true || page.render_available !== true) || ocrEvents.length !== 3) {
  throw new Error("Image OCR acceptance did not persist one OCR-backed page per image document");
}
console.log(JSON.stringify({ status: "passed", synthetic_fixture: caseId, runtime_case_id: accepted.case_id,
  result_revision_id: report.result_revision.id, report_availability: report.availability,
  non_passing_findings: nonPassing.map((finding) => ({ rule_id: finding.rule_id, status: finding.status, reason_code: finding.reason_code })),
  document_media_types: documents.documents.map((document) => document.media_type),
  session: agentLog.session, estimated_cost: agentLog.estimated_cost }));
