import { describe, expect, it, vi } from 'vitest';
import { loadCaseBundle } from './api.js';

describe('loadCaseBundle', () => {
  it('loads every separately addressable review projection', async () => {
    const payloads = [
      { case_id: 'case-1' }, { availability: 'ready' }, { findings: [{ rule_id: 'rule-1' }] },
      { issues: [{ issue_id: 'issue-1' }] }, { groups: [] }, { documents: [{ document_id: 'document-1' }] },
    ];
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payloads.shift() }));

    await expect(loadCaseBundle('case/id', fetcher)).resolves.toMatchObject({
      caseRecord: { case_id: 'case-1' }, report: { availability: 'ready' },
      findings: [{ rule_id: 'rule-1' }], issues: [{ issue_id: 'issue-1' }],
      documents: [{ document_id: 'document-1' }],
    });
    expect(fetcher.mock.calls.map(function (call) { return call[0]; })).toEqual([
      '/api/v1/cases/case%2Fid', '/api/v1/cases/case%2Fid/agent-report',
      '/api/v1/cases/case%2Fid/findings', '/api/v1/cases/case%2Fid/issues',
      '/api/v1/cases/case%2Fid/application-data', '/api/v1/cases/case%2Fid/documents',
    ]);
  });

  it('does not render a partial bundle as authoritative', async () => {
    const fetcher = vi.fn(async (url) => ({ ok: !String(url).endsWith('/findings'), json: async () => ({}) }));
    await expect(loadCaseBundle('case-1', fetcher)).rejects.toThrow('Case data could not be loaded');
  });
});
