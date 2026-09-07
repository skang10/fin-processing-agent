import { describe, expect, it } from 'vitest';
import { presentIssue } from '../prototypes/review-workbench/issue-presentation.js';

const document = { document_id: 'document-1', submitted_filename: 'case.pdf', page_count: 3 };

describe('issue presentation', () => {
  it('derives the employer issue page from real evidence', () => {
    const finding = { reason_code: 'value_mismatch', references: ['application', 'payslip', 'bank'] };
    const evidence = {
      application: { evidence_type: 'structured_input' },
      payslip: { evidence_type: 'page_level', document_version_id: 'document-1', page_number: 2 },
      bank: { evidence_type: 'page_level', document_version_id: 'document-1', page_number: 3 },
    };
    expect(presentIssue({ code: 'VAL_EMPLOYER_CONSISTENCY_001', supporting_references: [] }, finding, 0, [document], evidence))
      .toMatchObject({ title: 'Employer mismatch', pageNumber: 3, pageLabel: 'Page 3 of 3', references: ['application', 'payslip', 'bank'] });
  });

  it('does not attach an existing page to a missing-document finding', () => {
    const finding = { reason_code: 'required_document_missing', references: ['identity', 'payslip'] };
    const evidence = {
      identity: { evidence_type: 'page_level', document_version_id: 'document-1', page_number: 1 },
      payslip: { evidence_type: 'page_level', document_version_id: 'document-1', page_number: 2 },
    };
    expect(presentIssue({ code: 'VAL_DOC_COMPLETENESS_001', supporting_references: [] }, finding, 0, [document], evidence))
      .toMatchObject({ title: 'Bank statement missing', pageNumber: undefined, pageLabel: 'No page evidence', references: [], sourceLabel: 'Deterministic document check' });
  });

  it('uses precise page-region evidence as the issue default page', () => {
    const evidence = {
      application: { evidence_type: 'structured_input' },
      payslip: {
        evidence_type: 'page_region', document_version_id: 'document-1', page_number: 2,
        normalized_region: { x: 0.05, y: 0.24, width: 0.28, height: 0.02 },
      },
    };
    expect(presentIssue(
      { code: 'VAL_INCOME_CONSISTENCY_001', supporting_references: ['application', 'payslip'] },
      undefined, 0, [document], evidence,
    )).toMatchObject({
      title: 'Monthly income', pageNumber: 2, pageLabel: 'Page 2 of 3', sourceDocument: document,
    });
  });
});
