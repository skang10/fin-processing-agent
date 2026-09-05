export async function loadCaseBundle(caseId, fetcher = fetch) {
  const base = '/api/v1/cases/' + encodeURIComponent(caseId);
  const paths = ['', '/agent-report', '/findings', '/issues', '/application-data', '/documents'];
  const responses = await Promise.all(paths.map(function (path) { return fetcher(base + path); }));
  if (responses.some(function (response) { return !response.ok; })) {
    throw new Error('Case data could not be loaded');
  }
  const payloads = await Promise.all(responses.map(function (response) { return response.json(); }));
  const report = payloads[1];
  const findings = payloads[2].findings;
  const references = [...new Set([
    ...findings.flatMap(function (finding) { return finding.references || []; }),
    ...(report.checked_facts || []).flatMap(function (fact) { return fact.references || []; }),
  ].filter(function (reference) { return typeof reference === 'string' && reference.startsWith(base + '/evidence/'); }))];
  const evidenceResponses = await Promise.all(references.map(function (reference) { return fetcher(reference); }));
  if (evidenceResponses.some(function (response) { return !response.ok; })) {
    throw new Error('Case evidence could not be loaded');
  }
  const evidencePayloads = await Promise.all(evidenceResponses.map(function (response) { return response.json(); }));
  const evidenceByReference = Object.fromEntries(references.map(function (reference, index) {
    return [reference, evidencePayloads[index]];
  }));
  return {
    caseRecord: payloads[0], report, findings,
    issues: payloads[3].issues, applicationData: payloads[4], documents: payloads[5].documents,
    evidenceByReference,
  };
}

export async function loadCaseQueue(view = 'review', fetcher = fetch) {
  const response = await fetcher('/api/v1/cases?view=' + encodeURIComponent(view));
  if (!response.ok) throw new Error('Case queue could not be loaded');
  return response.json();
}

async function sendJson(path, method, body, fetcher = fetch) {
  const response = await fetcher(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.title || 'Review command failed');
  return payload;
}

export function resolveIssue(caseId, issueId, action, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues/' + encodeURIComponent(issueId) + '/' + action, 'POST', body, fetcher);
}

export function saveRequestedChange(caseId, issueId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues/' + encodeURIComponent(issueId) + '/requested-change', 'PUT', body, fetcher);
}

export function submitFinalReview(caseId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/final-review', 'POST', body, fetcher);
}
