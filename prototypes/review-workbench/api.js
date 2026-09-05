export async function loadCaseBundle(caseId, fetcher = fetch) {
  const base = '/api/v1/cases/' + encodeURIComponent(caseId);
  const paths = ['', '/agent-report', '/findings', '/issues', '/application-data', '/documents'];
  const responses = await Promise.all(paths.map(function (path) { return fetcher(base + path); }));
  if (responses.some(function (response) { return !response.ok; })) {
    throw new Error('Case data could not be loaded');
  }
  const payloads = await Promise.all(responses.map(function (response) { return response.json(); }));
  return {
    caseRecord: payloads[0], report: payloads[1], findings: payloads[2].findings,
    issues: payloads[3].issues, applicationData: payloads[4], documents: payloads[5].documents,
  };
}
