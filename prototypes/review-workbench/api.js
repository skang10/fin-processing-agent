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
