import { describe, expect, it } from 'vitest';
import { presentIssue } from './issue-presentation.js';

describe('presentIssue', function () {
  it('gives an unresolved applicant-name finding a meaningful title', function () {
    const presentation = presentIssue(
      { code: 'VAL_NAME_CONSISTENCY_001', supporting_references: [] },
      { reason_code: 'person_name_unresolved', references: [] },
      1,
      [],
      {},
    );

    expect(presentation.title).toBe('Applicant name could not be fully verified');
    expect(presentation.type).toBe('Identity review');
    expect(presentation.title).not.toBe('Review issue 2');
  });
});
