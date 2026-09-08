import { describe, expect, it, vi } from 'vitest';
import { createIssue, editIssue, formatPendingAgentActivity, formatQueueSummary, loadCaseBundle, loadCaseQueue, loadDemoCase, prepareDemoCase, resolveIssue, saveRequestedChange, submitDemoCase, submitFinalReview } from './api.js';

describe('formatPendingAgentActivity', () => {
  it('uses the durable Agent Log activity', () => {
    expect(formatPendingAgentActivity({ activity: 'Inspected document page', tool_label: 'render_page_region' }))
      .toBe('Inspected document page');
  });

  it('uses a safe fallback only when activity is absent', () => {
    expect(formatPendingAgentActivity({})).toBe('Agent activity');
  });
});

describe('formatQueueSummary', () => {
  it('uses concise, grammatical issue counts', () => {
    expect(formatQueueSummary(0, 'ready_for_review')).toBe('No issues require review.');
    expect(formatQueueSummary(1, 'ready_for_review')).toBe('1 issue requires review.');
    expect(formatQueueSummary(2, 'ready_for_review')).toBe('2 issues require review.');
  });

  it('describes active processing instead of an incomplete issue count', () => {
    expect(formatQueueSummary(0, 'processing')).toBe('Document processing is in progress.');
  });
});

describe('loadCaseQueue', () => {
  it('loads the selected authoritative queue', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ view: 'completed', cases: [] }) }));
    await expect(loadCaseQueue('completed', fetcher)).resolves.toEqual({ view: 'completed', cases: [] });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/cases?view=completed');
  });

  it('does not render a failed queue response', async () => {
    const fetcher = vi.fn(async () => ({ ok: false }));
    await expect(loadCaseQueue('review', fetcher)).rejects.toThrow('Case queue could not be loaded');
  });
});

describe('loadCaseBundle', () => {
  it('loads every separately addressable review projection', async () => {
    const payloads = [
      { case_id: 'case-1' }, { availability: 'ready', checked_facts: [] }, { findings: [{ rule_id: 'rule-1', references: [] }] },
      { issues: [{ issue_id: 'issue-1' }] }, { groups: [] }, { documents: [{ document_id: 'document-1' }] }, { evidence: [] },
      { availability: 'ready', events: [] },
    ];
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payloads.shift() }));

    await expect(loadCaseBundle('case/id', fetcher)).resolves.toMatchObject({
      caseRecord: { case_id: 'case-1' }, report: { availability: 'ready' },
      findings: [{ rule_id: 'rule-1' }], issues: [{ issue_id: 'issue-1' }],
      documents: [{ document_id: 'document-1' }],
      agentLog: { availability: 'ready', events: [] },
    });
    expect(fetcher.mock.calls.map(function (call) { return call[0]; })).toEqual([
      '/api/v1/cases/case%2Fid', '/api/v1/cases/case%2Fid/agent-report',
      '/api/v1/cases/case%2Fid/findings', '/api/v1/cases/case%2Fid/issues',
      '/api/v1/cases/case%2Fid/application-data', '/api/v1/cases/case%2Fid/documents',
      '/api/v1/cases/case%2Fid/evidence',
      '/api/v1/cases/case%2Fid/agent-log',
    ]);
  });

  it('hydrates only evidence references scoped to the current case', async () => {
    const evidencePath = '/api/v1/cases/case-1/evidence/evidence-1';
    const payloads = [
      { case_id: 'case-1' },
      { availability: 'ready', checked_facts: [{ references: [evidencePath, 'https://example.invalid/evidence'] }] },
      { findings: [{ rule_id: 'rule-1', references: [evidencePath] }] },
      { issues: [] }, { groups: [] }, { documents: [] },
      { evidence: [{ evidence_id: 'evidence-1', evidence_type: 'page_level', page_number: 1 }] },
      { availability: 'ready', events: [] },
    ];
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payloads.shift() }));

    const bundle = await loadCaseBundle('case-1', fetcher);

    expect(bundle.evidenceByReference[evidencePath]).toMatchObject({ page_number: 1 });
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(fetcher).not.toHaveBeenCalledWith('https://example.invalid/evidence');
  });

  it('does not render a partial bundle as authoritative', async () => {
    const fetcher = vi.fn(async (url) => ({ ok: !String(url).endsWith('/findings'), json: async () => ({}) }));
    await expect(loadCaseBundle('case-1', fetcher)).rejects.toThrow('Case data could not be loaded');
  });
});

describe('loadDemoCase', () => {
  it('prepares a frozen synthetic case without submitting it', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

    await expect(prepareDemoCase(fetcher, function () { return 0; })).resolves.toMatchObject({
      caseId: 'golden-001-native-clear', applicantDisplayName: 'Clara Muster', pageCount: 3,
      applicationData: { demo_fixture_id: 'golden-001-native-clear', synthetic_data: true },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('golden-001-native-clear.pdf');
    expect(fetcher).not.toHaveBeenCalledWith('/api/v1/cases', expect.anything());
  });

  it('submits only after an explicitly prepared preview is triggered', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_url: '/api/v1/cases/case-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ case_id: 'case-1', lifecycle: 'ready_for_review' }) });
    const prepared = {
      caseId: 'golden-001-native-clear', documentBytes: new ArrayBuffer(8),
      applicationData: { demo_fixture_id: 'golden-001-native-clear', synthetic_data: true },
    };

    await expect(submitDemoCase(prepared, 'fake', fetcher, async function () {})).resolves.toMatchObject({ case_id: 'case-1' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/cases');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetcher.mock.calls[0][1].body.get('agent_model')).toBe('fake');
  });

  it('submits the bundled synthetic document and waits for review readiness', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_url: '/api/v1/cases/case-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ case_id: 'case-1', lifecycle: 'processing' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ case_id: 'case-1', lifecycle: 'ready_for_review' }) });
    const wait = vi.fn(async () => {});

    await expect(loadDemoCase(fetcher, wait, function () { return 0; })).resolves.toMatchObject({ case_id: 'case-1', lifecycle: 'ready_for_review' });
    expect(fetcher.mock.calls[0][0]).toContain('golden-001-native-clear.pdf');
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/cases');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(fetcher.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetcher.mock.calls[1][1].body.get('application_data')).toContain('golden-001-native-clear');
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('selects across all six frozen synthetic cases', async () => {
    const selectedDocuments = [];
    for (const random of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      const fetcher = vi.fn()
        .mockImplementationOnce(async (url) => { selectedDocuments.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status_url: '/api/v1/cases/case-1' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ case_id: 'case-1', lifecycle: 'ready_for_review' }) });
      await loadDemoCase(fetcher, async function () {}, function () { return random; });
    }
    expect(new Set(selectedDocuments).size).toBe(6);
    expect(selectedDocuments.every(function (url) { return url.includes('/v0.1.2/documents/golden-'); })).toBe(true);
  });
});

describe('review commands', () => {
  it('sends issue, draft, and final-review mutations as JSON', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ version: 2 }) }));
    await createIssue('case-1', { command_id: 'create' }, fetcher);
    await editIssue('case-1', 'issue-1', { command_id: 'edit' }, fetcher);
    await resolveIssue('case-1', 'issue-1', 'confirm', { command_id: 'one' }, fetcher);
    await saveRequestedChange('case-1', 'issue-1', { command_id: 'two', text: 'Update it', included: true }, fetcher);
    await submitFinalReview('case-1', { command_id: 'three', action: 'request_changes' }, fetcher);
    expect(fetcher.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ['/api/v1/cases/case-1/issues', 'POST'],
      ['/api/v1/cases/case-1/issues/issue-1', 'PATCH'],
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
