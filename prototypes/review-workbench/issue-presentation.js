export function presentIssue(record, finding, index, documents, evidenceByReference) {
  const requiredDocumentMissing = finding?.reason_code === 'required_document_missing';
  const defaults = {
    VAL_DOC_COMPLETENESS_001: { title: requiredDocumentMissing ? 'Bank statement missing' : 'Document completeness', type: 'Document review', tone: 'warning' },
    VAL_EMPLOYER_CONSISTENCY_001: { title: 'Employer mismatch', type: 'Cross-document conflict', tone: 'failed' },
    VAL_INCOME_CONSISTENCY_001: { title: 'Monthly income', type: 'Evidence review', tone: 'warning' },
  }[record.code] || { title: 'Review issue ' + (index + 1), type: 'Agent finding', tone: 'warning' };
  const suppliedReferences = record.supporting_references?.length ? record.supporting_references : (finding?.references || []);
  const references = requiredDocumentMissing ? [] : suppliedReferences;
  const pageSources = references.map(function (reference) {
    return { reference, evidence: evidenceByReference[reference] };
  }).filter(function (item) { return item.evidence?.evidence_type === 'page_level'; });
  const primary = pageSources.at(-1);
  const sourceDocument = primary
    ? documents.find(function (document) { return document.document_id === primary.evidence.document_version_id; }) || documents[0]
    : undefined;
  const pageNumber = primary && sourceDocument
    ? Math.min(Math.max(primary.evidence.page_number, 1), sourceDocument.page_count)
    : undefined;

  return {
    title: record.title || defaults.title,
    type: defaults.type,
    tone: defaults.tone,
    references,
    sourceDocument,
    pageNumber,
    pageLabel: pageNumber ? 'Page ' + pageNumber + ' of ' + sourceDocument.page_count : 'No page evidence',
    sourceLabel: sourceDocument ? sourceDocument.submitted_filename : 'Deterministic document check',
    noReferenceReason: requiredDocumentMissing
      ? (record.no_reference_reason || 'A required bank statement was not submitted. This issue comes from the deterministic completeness check, not from an existing page.')
      : record.no_reference_reason,
  };
}
