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

export function formatQueueSummary(issueCount, workflowStatus) {
  if (workflowStatus === 'processing') return 'Document processing is in progress.';
  if (issueCount === 0) return 'No issues require review.';
  if (issueCount === 1) return '1 issue requires review.';
  return issueCount + ' issues require review.';
}

export async function prepareDemoCase(fetcher = fetch, random = Math.random) {
  const selected = demoCases[Math.min(demoCases.length - 1, Math.floor(Math.max(0, random()) * demoCases.length))];
  const documentResponse = await fetcher(selected.documentUrl);
  if (!documentResponse.ok) throw new Error('Demo document could not be loaded');
  return { ...selected, documentBytes: await documentResponse.arrayBuffer() };
}

export async function loadDemoAgentModels(fetcher = fetch) {
  const response = await fetcher('/api/v1/demo/agent-models');
  if (!response.ok) throw new Error('Agent models could not be loaded');
  return response.json();
}

export async function startDemoCase(prepared, agentModel, fetcher = fetch) {
  const form = new FormData();
  form.set('application_data', JSON.stringify(prepared.applicationData));
  form.set('agent_model', agentModel);
  form.set('documents', new Blob([prepared.documentBytes], { type: 'application/pdf' }), prepared.caseId + '.pdf');
  const createdResponse = await fetcher('/api/v1/cases', {
    method: 'POST', headers: { 'Idempotency-Key': 'demo-' + crypto.randomUUID() }, body: form,
  });
  if (!createdResponse.ok) throw new Error('Demo case could not be submitted');
  return createdResponse.json();
}

export async function submitDemoCase(prepared, agentModel = 'fake', fetcher = fetch, wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 500); }); }) {
  const created = await startDemoCase(prepared, agentModel, fetcher);
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

export async function loadDemoCase(fetcher = fetch, wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 500); }); }, random = Math.random) {
  return submitDemoCase(await prepareDemoCase(fetcher, random), 'fake', fetcher, wait);
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
const demoCases = [
  {
    caseId: 'golden-001-native-clear', applicantDisplayName: 'Clara Muster', employer: 'Mustertechnik GmbH', monthlyNet: '3200.00', pageCount: 3,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-001-native-clear/golden-001-native-clear.pdf', import.meta.url).href,
  },
  {
    caseId: 'golden-002-employer-conflict', applicantDisplayName: 'David Beispiel', employer: 'Nordwerk Demo GmbH', monthlyNet: '2900.00', pageCount: 3,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-002-employer-conflict/golden-002-employer-conflict.pdf', import.meta.url).href,
  },
  {
    caseId: 'golden-003-multiple-review-issues', applicantDisplayName: 'Anna Beispiel', employer: 'Beispieltechnik GmbH', monthlyNet: '3480.00', pageCount: 4,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-003-multiple-review-issues/golden-003-multiple-review-issues.pdf', import.meta.url).href,
  },
  {
    caseId: 'golden-004-missing-bank-evidence', applicantDisplayName: 'Eva Sample', employer: 'Sample Works Ltd', monthlyNet: '3100.00', pageCount: 2,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-004-missing-bank-evidence/golden-004-missing-bank-evidence.pdf', import.meta.url).href,
  },
  {
    caseId: 'golden-005-instruction-inert', applicantDisplayName: 'Felix Test', employer: 'Testbetrieb GmbH', monthlyNet: '2750.00', pageCount: 3,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-005-instruction-inert/golden-005-instruction-inert.pdf', import.meta.url).href,
  },
  {
    caseId: 'golden-006-scanned-adaptive-unavailable', applicantDisplayName: 'Greta Demofall', employer: 'Demowerk GmbH', monthlyNet: '3050.00', pageCount: 3,
    documentUrl: new URL('../../datasets/golden/releases/v0.1.2/documents/golden-006-scanned-adaptive-unavailable/golden-006-scanned-adaptive-unavailable.pdf', import.meta.url).href,
  },
].map(function (candidate) {
  return {
    caseId: candidate.caseId,
    applicationData: {
      applicant_display_name: candidate.applicantDisplayName,
      demo_fixture_id: candidate.caseId,
      employment: { employer: candidate.employer },
      income: { currency: 'EUR', monthly_net: candidate.monthlyNet },
      synthetic_data: true,
    },
    applicantDisplayName: candidate.applicantDisplayName,
    pageCount: candidate.pageCount,
    documentUrl: candidate.documentUrl,
  };
});
