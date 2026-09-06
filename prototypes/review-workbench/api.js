export async function loadCaseBundle(caseId, fetcher = fetch) {
  const base = '/api/v1/cases/' + encodeURIComponent(caseId);
  const paths = ['', '/agent-report', '/findings', '/issues', '/application-data', '/documents', '/evidence', '/agent-log'];
  const responses = await Promise.all(paths.map(function (path) { return fetcher(base + path); }));
  if (responses.some(function (response) { return !response.ok; })) {
    throw new Error('Case data could not be loaded');
  }
  const payloads = await Promise.all(responses.map(function (response) { return response.json(); }));
  const report = payloads[1];
  const findings = payloads[2].findings;
  const evidenceByReference = Object.fromEntries(payloads[6].evidence.map(function (evidence) {
    return [base + '/evidence/' + evidence.evidence_id, evidence];
  }));
  return {
    caseRecord: payloads[0], report, findings,
    issues: payloads[3].issues, applicationData: payloads[4], documents: payloads[5].documents,
    evidenceByReference, agentLog: payloads[7],
  };
}

export async function loadCaseQueue(view = 'review', fetcher = fetch) {
  const response = await fetcher('/api/v1/cases?view=' + encodeURIComponent(view));
  if (!response.ok) throw new Error('Case queue could not be loaded');
  return response.json();
}

export async function loadDemoCase(fetcher = fetch, wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 500); }); }) {
  const documentResponse = await fetcher('/case-package.pdf');
  if (!documentResponse.ok) throw new Error('Demo document could not be loaded');
  const submittedAt = new Date().toISOString();
  const applicationData = {
    applicant_display_name: 'Anna Beispiel', demo_fixture_id: 'anna-example-v1',
    contact: { email: 'anna@example.invalid', phone: '+49 170 1234567' },
    employment: { employer: 'Beispieltechnik GmbH', type: 'permanent', started_on: '2022-01-01' },
    income: { monthly_net: '3480.00', currency: 'EUR', basis: 'net' },
    initial_submitted_at: submittedAt, latest_submitted_at: submittedAt, application_data_updated_at: submittedAt,
  };
  const form = new FormData();
  form.set('application_data', JSON.stringify(applicationData));
  form.set('documents', new Blob([await documentResponse.arrayBuffer()], { type: 'application/pdf' }), 'case-package.pdf');
  const createdResponse = await fetcher('/api/v1/cases', {
    method: 'POST', headers: { 'Idempotency-Key': 'demo-' + crypto.randomUUID() }, body: form,
  });
  if (!createdResponse.ok) throw new Error('Demo case could not be submitted');
  const created = await createdResponse.json();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const statusResponse = await fetcher(created.status_url);
    if (!statusResponse.ok) throw new Error('Demo case status could not be loaded');
    const current = await statusResponse.json();
    if (current.lifecycle === 'ready_for_review') return current;
    if (current.lifecycle !== 'processing') throw new Error('Demo case processing failed');
    await wait();
  }
  throw new Error('Demo case processing timed out');
}

async function sendJson(path, method, body, fetcher = fetch) {
  const response = await fetcher(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.detail || payload.title || 'Review command failed');
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export function resolveIssue(caseId, issueId, action, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues/' + encodeURIComponent(issueId) + '/' + action, 'POST', body, fetcher);
}

export function createIssue(caseId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues', 'POST', body, fetcher);
}

export function editIssue(caseId, issueId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues/' + encodeURIComponent(issueId), 'PATCH', body, fetcher);
}

export function saveRequestedChange(caseId, issueId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/issues/' + encodeURIComponent(issueId) + '/requested-change', 'PUT', body, fetcher);
}

export function submitFinalReview(caseId, body, fetcher = fetch) {
  return sendJson('/api/v1/cases/' + encodeURIComponent(caseId) + '/final-review', 'POST', body, fetcher);
}
