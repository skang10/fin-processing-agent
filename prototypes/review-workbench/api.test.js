import { describe, expect, it, vi } from 'vitest';
import { loadCaseBundle, resolveIssue, saveRequestedChange, submitFinalReview } from './api.js';

describe('loadCaseBundle', () => {
  it('loads every separately addressable review projection', async () => {
    const payloads = [
      { case_id: 'case-1' }, { availability: 'ready', checked_facts: [] }, { findings: [{ rule_id: 'rule-1', references: [] }] },
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

  it('hydrates only evidence references scoped to the current case', async () => {
    const evidencePath = '/api/v1/cases/case-1/evidence/evidence-1';
    const payloads = [
      { case_id: 'case-1' },
      { availability: 'ready', checked_facts: [{ references: [evidencePath, 'https://example.invalid/evidence'] }] },
      { findings: [{ rule_id: 'rule-1', references: [evidencePath] }] },
      { issues: [] }, { groups: [] }, { documents: [] },
      { evidence_id: 'evidence-1', evidence_type: 'page_level', page_number: 1 },
    ];
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payloads.shift() }));

    const bundle = await loadCaseBundle('case-1', fetcher);

    expect(bundle.evidenceByReference[evidencePath]).toMatchObject({ page_number: 1 });
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(fetcher).not.toHaveBeenCalledWith('https://example.invalid/evidence');
  });

  it('does not render a partial bundle as authoritative', async () => {
    const fetcher = vi.fn(async (url) => ({ ok: !String(url).endsWith('/findings'), json: async () => ({}) }));
    await expect(loadCaseBundle('case-1', fetcher)).rejects.toThrow('Case data could not be loaded');
  });
});

describe('review commands', () => {
  it('sends issue, draft, and final-review mutations as JSON', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ version: 2 }) }));
    await resolveIssue('case-1', 'issue-1', 'confirm', { command_id: 'one' }, fetcher);
    await saveRequestedChange('case-1', 'issue-1', { command_id: 'two', text: 'Update it', included: true }, fetcher);
    await submitFinalReview('case-1', { command_id: 'three', action: 'request_changes' }, fetcher);
    expect(fetcher.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ['/api/v1/cases/case-1/issues/issue-1/confirm', 'POST'],
      ['/api/v1/cases/case-1/issues/issue-1/requested-change', 'PUT'],
      ['/api/v1/cases/case-1/final-review', 'POST'],
    ]);
  });

  it('surfaces safe command errors', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ detail: 'Review state changed' }) }));
    await expect(submitFinalReview('case-1', {}, fetcher)).rejects.toThrow('Review state changed');
  });
});
