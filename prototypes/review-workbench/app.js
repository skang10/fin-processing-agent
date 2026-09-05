import { loadCaseBundle, resolveIssue, saveRequestedChange, submitFinalReview } from './api.js';

let cases = [
  { name: 'Anna Beispiel', id: 'FD-2026-0042', summary: 'Employer information differs', status: 'ready', statusLabel: 'Ready for review', issues: 3, waiting: '18 min' },
  { name: 'Emil Probe', id: 'FD-2026-0038', summary: 'Income document needs confirmation', status: 'in-progress', statusLabel: 'In progress', issues: 1, waiting: '9 min' },
  { name: 'Klara Test', id: 'FD-2026-0035', summary: 'Uploaded documents need separation', status: 'ready', statusLabel: 'Ready for review', issues: 2, waiting: '34 min' }
];

let issues = [
  {
    type: 'Cross-document conflict', tone: 'failed', title: 'Employer mismatch',
    why: 'The declared employer and salary payment counterparty do not resolve to the same organization.',
    recommendation: 'Please confirm your current employer name. The employer in your application differs from the name associated with your salary payment. If your employment has changed, please update the application and provide a current supporting document.',
    doc: 'Bank statement', page: 'Page 4 of 5', pageNumber: 4, paper: 'bank',
    value: 'Beispieltechnik GmbH', valueLabel: 'Correct employer value',
    values: [
      { label: 'Declared employer', role: 'Application field', value: 'Beispieltechnik GmbH', source: 'Employment section: Employer' },
      { label: 'Salary counterparty', role: 'Bank statement field', value: 'Beispiel Tech Services', source: 'Bank statement, page 4: Salary transaction', evidence: true }
    ]
  },
  {
    type: 'Extraction review', tone: 'warning', title: 'Monthly income',
    why: 'The amount was recovered from a low-quality scanned region and requires visual confirmation.',
    recommendation: 'Please provide a clearer copy of your payslip showing the net monthly income. The amount on the current copy cannot be read reliably.',
    doc: 'Payslip', page: 'Page 2 of 5', pageNumber: 2, paper: 'pay',
    value: '3480.00', valueLabel: 'Correct net monthly income',
    values: [
      { label: 'Net monthly income', role: 'Payslip field', value: '€3,480.00', source: 'Payslip, page 2: Net pay', evidence: true },
      { label: 'Declared income', role: 'Application field', value: '€3,480.00', source: 'Income section: Net monthly income' }
    ]
  },
  {
    type: 'Boundary review', tone: 'warning', title: 'Document boundary',
    why: 'The system predicts page 4 starts a new logical document, but its confidence is not calibrated.',
    recommendation: 'Please upload the payslip and bank statement as separate, complete documents so that each document can be reviewed correctly.',
    doc: 'Uploaded package.pdf', page: 'Pages 3–4 of 5', pageNumber: 4, paper: 'boundary',
    value: 'Page 4', valueLabel: 'New document begins on',
    values: [
      { label: 'Previous logical document', role: 'Payslip', value: 'Pages 2–3', source: 'Machine boundary revision 1' },
      { label: 'Next logical document', role: 'Bank statement', value: 'Pages 4–5', source: 'Machine boundary revision 1', evidence: true }
    ]
  }
];

let current = 0;
let editing = false;
let creatingIssue = false;
let confirming = false;
let ignoring = false;
let zoom = 92;
let sourceView = 'document';
let sourceOverride = null;
let activeFilter = 'all';
let decisions = ['pending', 'pending', 'pending'];
let apiApplicationData = null;
let apiDocuments = [];
let apiEvidenceByReference = {};
let apiCaseRecord = null;
let apiReport = null;
let activeApplicationPointer = null;
const reviewNotes = {};
const includedRequests = {};
let internalReviewNote = '';
const correctedValues = {};
const caseList = document.querySelector('#case-list');
const searchInput = document.querySelector('#search');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
  });
}

function renderCases() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = cases.filter(function (item) {
    return (activeFilter === 'all' || item.status === activeFilter) &&
      (item.name + ' ' + item.id + ' ' + item.summary).toLowerCase().includes(query);
  });
  caseList.innerHTML = visible.map(function (item) {
    return '<tr class="case-row" tabindex="0" aria-label="Open ' + item.id + ', ' + item.name + '">' +
      '<td><strong>' + item.id + '</strong></td><td><strong>' + item.name + '</strong></td>' +
      '<td><strong>' + item.summary + '</strong></td><td><span class="issue-number">' + item.issues + '</span></td>' +
      '<td><span class="state-label ' + item.status + '"><i></i>' + item.statusLabel + '</span></td>' +
      '<td class="tabular">' + item.waiting + '</td>' +
      '<td class="row-arrow">→</td></tr>';
  }).join('');
  document.querySelector('#empty-state').hidden = visible.length > 0;
  caseList.querySelectorAll('.case-row').forEach(function (row) {
    row.addEventListener('click', function () { show('workspace'); });
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show('workspace');
      }
    });
  });
}

function show(id) {
  document.querySelectorAll('.screen').forEach(function (screen) { screen.classList.remove('active'); });
  document.querySelector('#' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
  document.querySelector('#queue-nav').classList.add('active');
  document.querySelector('.topbar > div:first-child strong').textContent = 'Document review';
  if (id === 'workspace') render();
  if (id === 'summary') renderSummary();
}

function render() {
  const issue = issues[current];
  const resolved = decisions.filter(function (decision) { return decision !== 'pending'; }).length;
  document.querySelector('#resolved-count').textContent = resolved + ' of ' + issues.length + ' reviewed';
  document.querySelector('[data-case-tab="issues"] span').textContent = String(issues.length);
  document.querySelector('#previous').disabled = current === 0;
  document.querySelector('#next').disabled = current === issues.length - 1;
  document.querySelector('#issue-content').innerHTML = editing ? correctionForm(issue) : confirming ? confirmationForm(issue) : ignoring ? ignoreForm() : issueDetail(issue);
  renderSource(issue);
  renderIssueList();
  renderThumbnails(issue.pageNumber);
  wireIssueActions();
}

function renderSource(issue) {
  const paper = document.querySelector('#paper');
  const application = sourceView === 'application';
  document.querySelector('#document-name').textContent = application ? 'Application data' : sourceOverride ? sourceOverride.name : issue.doc;
  document.querySelector('#page-name').textContent = application ? 'Submitted values' : sourceOverride ? sourceOverride.page : issue.page;
  document.querySelector('#thumbnails').hidden = application;
  document.querySelector('.document-tools').hidden = application;
  document.querySelector('.document-body').classList.toggle('application-mode', application);
  document.querySelectorAll('[data-source-view]').forEach(function (button) { button.classList.toggle('active', button.dataset.sourceView === sourceView); });
  paper.className = application ? 'application-data' : 'paper';
  paper.innerHTML = application ? applicationData(current) : documentPaper(sourceOverride ? sourceOverride.kind : issue.paper);
}

function applicationData(activeIssue) {
  if (apiApplicationData) {
    return '<h2>Application</h2>' + apiApplicationData.groups.map(function (group) {
      return '<section class="application-section"><h3>' + escapeHtml(group.group) + '</h3><div class="application-fields">' +
        group.fields.map(function (field) {
          return '<div class="' + (field.json_pointer === activeApplicationPointer ? 'application-focus' : '') + '"><span>' + escapeHtml(field.key.replaceAll('_', ' ')) + '</span><strong>' + escapeHtml(field.display_value) + '</strong></div>';
        }).join('') + '</div></section>';
    }).join('');
  }
  return '<h2>Application</h2>' +
    '<section class="application-section"><h3>Applicant</h3><div class="application-fields"><div><span>Full name</span><strong>Anna Beispiel</strong></div><div><span>Date of birth</span><strong>14 March 1991</strong></div><div><span>Location</span><strong>Berlin, Germany</strong></div><div><span>Preferred language</span><strong>German</strong></div></div></section>' +
    '<section class="application-section"><h3>Contact</h3><div class="application-fields"><div><span>Email</span><strong>an••••@example.de</strong></div><div><span>Phone</span><strong>+49 •••• 4821</strong></div><div><span>Preferred channel</span><strong>Email</strong></div></div></section>' +
    '<section class="application-section"><h3>Application history</h3><div class="application-fields"><div><span>Application ID</span><strong>FD-2026-0042</strong></div><div><span>Initially submitted</span><strong>3 Sep 2026, 14:22</strong></div><div><span>Last submitted</span><strong>4 Sep 2026, 09:18</strong></div><div><span>Last updated</span><strong>4 Sep 2026, 09:21</strong></div><div><span>Submission version</span><strong>2</strong></div><div><span>Submission channel</span><strong>Web portal</strong></div></div></section>' +
    '<section class="application-section"><h3>Employment</h3><div class="application-fields"><div class="' + (activeIssue === 0 ? 'application-focus' : '') + '"><span>Employer</span><strong>Beispieltechnik GmbH</strong></div><div><span>Employment type</span><strong>Permanent</strong></div><div><span>Employment started</span><strong>1 February 2022</strong></div></div></section>' +
    '<section class="application-section"><h3>Income</h3><div class="application-fields"><div class="' + (activeIssue === 1 ? 'application-focus' : '') + '"><span>Net monthly income</span><strong>3,480.00 EUR</strong></div><div><span>Payment frequency</span><strong>Monthly</strong></div><div><span>Income source</span><strong>Employment</strong></div></div></section>';
}

function renderIssueList() {
  document.querySelector('#issue-list').innerHTML = issues.map(function (issue, index) {
    const decision = decisions[index];
    const state = outcomeLabel(decision);
    const marker = decision === 'pending' ? String(index + 1).padStart(2, '0') : decision === 'dismissed' ? '×' : decision === 'edited' ? '✎' : '✓';
    return '<div class="issue-list-item ' + (index === current ? 'active' : '') + '"><button class="issue-open" data-index="' + index + '">' +
      '<span class="issue-state ' + decision + '">' + marker + '</span><strong>' + issue.title + '</strong><em>' + state + '</em></button>' +
      '<button class="issue-edit" data-edit-index="' + index + '" aria-label="Edit ' + issue.title + '">Edit</button></div>';
  }).join('');
  document.querySelectorAll('.issue-open').forEach(function (button) {
    button.addEventListener('click', function () {
      current = Number(button.dataset.index);
      editing = false;
      confirming = false;
      ignoring = false;
      render();
    });
  });
  document.querySelectorAll('.issue-edit').forEach(function (button) {
    button.addEventListener('click', function () { current = Number(button.dataset.editIndex); editing = true; confirming = false; render(); });
  });
}

function renderThumbnails(activePage) {
  const pageCount = apiDocuments[0] ? apiDocuments[0].page_count : 5;
  document.querySelector('#thumbnails').innerHTML = Array.from({ length: pageCount }, function (_, index) { return index + 1; }).map(function (page) {
    return '<button class="thumbnail ' + (page === activePage ? 'active' : '') + '" aria-label="Page ' + page + '">' +
      '<span><i></i><i></i><i></i><i></i></span><small>' + page + '</small></button>';
  }).join('');
  document.querySelectorAll('.thumbnail').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('.thumbnail').forEach(function (item) { item.classList.remove('active'); });
      button.classList.add('active');
      toast('Page ' + button.querySelector('small').textContent + ' selected');
    });
  });
}

function issueDetail(issue) {
  const outcome = decisions[current];
  const values = issue.values.map(function (item, index) {
    const value = item.value;
    const evidenceControl = item.reference
      ? '<button class="evidence-link active" data-evidence-reference="' + encodeURIComponent(item.reference) + '">' + escapeHtml(item.source) + ' →</button>'
      : '<button class="evidence-link ' + (item.evidence ? 'active' : '') + '" data-legacy-evidence="' + Boolean(item.evidence) + '">View ' + escapeHtml(item.source) + '</button>';
    return '<article class="claim-card"><div class="claim-head"><span>' + escapeHtml(item.role) + '</span></div>' +
      '<small class="field-name">' + escapeHtml(item.label) + '</small><strong>' + escapeHtml(value) + '</strong>' + evidenceControl + '</article>';
  }).join('');
  const outcomeIcon = outcome === 'dismissed' ? '×' : outcome === 'edited' ? '✎' : '✓';
  const outcomeBlock = outcome !== 'pending'
    ? '<div class="recorded-outcome"><span class="outcome-icon">' + outcomeIcon + '</span><div><strong>' + outcomeLabel(outcome) + '</strong>' + (reviewNotes[current] ? '<small>' + escapeHtml(reviewNotes[current]) + '</small>' : '') + '</div><button id="change-outcome"><span aria-hidden="true">↶</span> Undo</button></div>'
    : '<div class="review-actions"><button class="button quiet" id="dismiss">Ignore issue</button><button class="button primary" id="confirm">Confirm issue</button></div>';
  return '<div class="review-prompt"><p>' + issue.why + '</p></div>' +
    '<div class="claim-comparison"><div class="block-label"><span>Evidence reviewed</span></div>' +
    values + '</div>' + outcomeBlock;
}

function confirmationForm(issue) {
  const note = reviewNotes[current] || issue.recommendation || 'Please describe what information or document you need the applicant to provide.';
  return '<div class="issue-heading"><button class="inline-back" id="cancel-confirm">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Confirm issue</span></div></div>' +
    '<form id="confirmation-form" class="correct-form"><label>Requested change<textarea rows="5" required>' + escapeHtml(note) + '</textarea></label>' +
    '<div class="revision-note"><strong>Applicant-facing draft</strong><span>Review and edit this message before confirming the issue. It is used only if you request changes.</span></div>' +
    '<div class="form-actions"><button type="button" class="button quiet" id="cancel-confirm-bottom">Cancel</button><button class="button primary">Save confirmation</button></div></form>';
}

function correctionForm(issue) {
  return '<div class="issue-heading"><button class="inline-back" id="cancel">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Edit issue</span></div></div>' +
    '<form id="inline-form" class="correct-form"><label>Issue title<input value="' + issue.title + '" required></label>' +
    '<label>Issue note<textarea rows="4" required>' + issue.why + '</textarea></label>' +
    '<div class="form-actions"><button type="button" class="button quiet" id="cancel-bottom">Cancel</button><button class="button primary">Save issue</button></div></form>';
}

function ignoreForm() {
  return '<div class="issue-heading"><button class="inline-back" id="cancel-ignore">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Ignore issue</span></div></div>' +
    '<form id="ignore-form" class="correct-form"><label>Reason<textarea rows="4" required placeholder="Explain why this issue does not require action"></textarea></label>' +
    '<div class="revision-note"><strong>Internal review record</strong><span>This reason is not included in the applicant message.</span></div>' +
    '<div class="form-actions"><button type="button" class="button quiet" id="cancel-ignore-bottom">Cancel</button><button class="button primary">Save and ignore</button></div></form>';
}

function documentPaper(kind) {
  if (kind === 'identity') return '<div class="synthetic">SYNTHETIC DEMO</div><div class="doc-title"><span class="doc-logo">ID</span><div><strong>Identity document</strong><small>Demo document</small></div></div><div class="application-fields"><div><span>Name</span><strong>Anna Beispiel</strong></div><div class="application-focus"><span>Expiry date</span><strong>14 May 2031</strong></div></div>';
  if (kind === 'bank') return '<div class="synthetic">SYNTHETIC DEMO</div><div class="doc-title"><span class="doc-logo">NB</span><div><strong>Nordblick Demo Bank</strong><small>Kontoauszug, August 2026</small></div></div>' +
    '<div class="doc-info"><div><small>ACCOUNT HOLDER</small><strong>Anna Beispiel</strong></div><div><small>IBAN</small><strong>DE•• •••• •••• 3042</strong></div></div>' +
    '<table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>01.08.</td><td>Rent transfer<small>Monthly rent</small></td><td>− €1,120.00</td></tr>' +
    '<tr><td>14.08.</td><td>Utility payment<small>Reference 2084</small></td><td>− €124.30</td></tr><tr class="focus-row"><td>28.08.</td><td><strong>Beispiel Tech Services</strong><small>Salary 08/2026</small></td><td><strong>+ €3,480.00</strong></td></tr>' +
    '<tr><td>29.08.</td><td>Insurance<small>Policy payment</small></td><td>− €86.40</td></tr></tbody></table><span class="evidence-label">Salary counterparty</span>';
  if (kind === 'pay') return '<div class="synthetic">SYNTHETIC DEMO</div><div class="doc-title"><span class="doc-logo">BT</span><div><strong>Beispieltechnik GmbH</strong><small>Entgeltabrechnung, August 2026</small></div></div>' +
    '<div class="payslip-grid"><div><small>EMPLOYEE</small><strong>Anna Beispiel</strong></div><div><small>PERIOD</small><strong>08 / 2026</strong></div><div><small>PERSONNEL NO.</small><strong>••• 184</strong></div></div>' +
    '<div class="pay-lines"><span>Gross salary <b>4.920,00 EUR</b></span><span>Tax and contributions <b>− 1.440,00 EUR</b></span></div>' +
    '<div class="field-focus"><small>NET PAY</small><h2>3.480,00 EUR</h2><span>Recovered from scanned region</span></div><span class="evidence-label">Net pay</span>';
  return '<div class="synthetic">SYNTHETIC DEMO</div><div class="boundary-page"><div class="page-fragment"><span>PAGE 3</span><strong>Beispieltechnik GmbH</strong><small>End of payslip</small><div class="line"></div><div class="line short"></div></div>' +
    '<div class="boundary-marker"><i></i><span>Proposed logical-document boundary</span><i></i></div><div class="page-fragment"><span>PAGE 4</span><strong>Nordblick Demo Bank</strong><small>Start of bank statement</small><div class="line"></div><div class="line short"></div></div></div>' +
    '<span class="evidence-label">Proposed boundary on page 4</span>';
}

function wireIssueActions() {
  const confirm = document.querySelector('#confirm');
  const dismiss = document.querySelector('#dismiss');
  const change = document.querySelector('#change-outcome');
  if (confirm) confirm.addEventListener('click', function () { confirming = true; ignoring = false; render(); });
  if (dismiss) dismiss.addEventListener('click', function () { ignoring = true; confirming = false; render(); });
  if (change) change.addEventListener('click', function () { toast('Saved review decisions cannot be undone; edit the issue or refresh its authoritative state.'); });
  ['#cancel', '#cancel-bottom'].forEach(function (selector) {
    const button = document.querySelector(selector);
    if (button) button.addEventListener('click', function () {
      if (creatingIssue) {
        issues.splice(current, 1);
        decisions.splice(current, 1);
        current = Math.max(0, current - 1);
        creatingIssue = false;
      }
      editing = false;
      render();
    });
  });
  ['#cancel-confirm', '#cancel-confirm-bottom'].forEach(function (selector) {
    const button = document.querySelector(selector);
    if (button) button.addEventListener('click', function () { confirming = false; render(); });
  });
  ['#cancel-ignore', '#cancel-ignore-bottom'].forEach(function (selector) {
    const button = document.querySelector(selector);
    if (button) button.addEventListener('click', function () { ignoring = false; render(); });
  });
  const ignoreFormElement = document.querySelector('#ignore-form');
  if (ignoreFormElement) ignoreFormElement.addEventListener('submit', async function (event) {
    event.preventDefault();
    await persistDecision('dismissed', event.currentTarget.querySelector('textarea').value.trim());
  });
  const confirmationFormElement = document.querySelector('#confirmation-form');
  if (confirmationFormElement) confirmationFormElement.addEventListener('submit', async function (event) {
    event.preventDefault();
    await persistDecision('confirmed', event.currentTarget.querySelector('textarea').value.trim());
  });
  const form = document.querySelector('#inline-form');
  if (form) form.addEventListener('submit', function (event) {
    event.preventDefault();
    issue.title = event.currentTarget.querySelector('input').value;
    issue.why = event.currentTarget.querySelector('textarea').value;
    creatingIssue = false;
    decide('edited');
  });
  document.querySelectorAll('.evidence-link').forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.dataset.evidenceReference) {
        openEvidenceReference(decodeURIComponent(button.dataset.evidenceReference));
        return;
      }
      sourceView = button.dataset.legacyEvidence === 'true' ? 'document' : 'application';
      sourceOverride = null;
      renderSource(issues[current]);
      toast(button.dataset.legacyEvidence === 'true' ? 'Evidence highlighted on page' : 'Application field selected');
    });
  });
}

function pagePaperKind(pageNumber) {
  return pageNumber === 1 ? 'identity' : pageNumber === 2 ? 'pay' : pageNumber === 4 ? 'bank' : 'boundary';
}

function openEvidenceReference(reference) {
  const evidence = apiEvidenceByReference[reference];
  if (!evidence) {
    toast('Evidence is unavailable');
    return;
  }
  if (evidence.evidence_type === 'structured_input') {
    sourceView = 'application';
    sourceOverride = null;
    activeApplicationPointer = evidence.json_pointer;
    renderSource(issues[current]);
    toast('Application field selected');
    return;
  }
  const documentRecord = apiDocuments.find(function (item) { return item.document_id === evidence.document_version_id; }) || apiDocuments[0];
  const pageNumber = evidence.page_number;
  sourceView = 'document';
  activeApplicationPointer = null;
  sourceOverride = {
    name: documentRecord ? documentRecord.submitted_filename : 'Submitted document',
    page: 'Page ' + pageNumber + (documentRecord ? ' of ' + documentRecord.page_count : ''),
    kind: pagePaperKind(pageNumber),
  };
  renderSource(issues[current]);
  renderThumbnails(pageNumber);
  const paper = document.querySelector('#paper');
  paper.classList.remove('evidence-pulse');
  requestAnimationFrame(function () { paper.classList.add('evidence-pulse'); });
  toast('Document evidence selected on page ' + pageNumber);
}

function decide(kind) {
  decisions[current] = kind;
  if (kind === 'dismissed') {
    delete reviewNotes[current];
    delete includedRequests[current];
  }
  editing = false;
  confirming = false;
  toast(kind === 'confirmed' ? 'Issue confirmed' : kind === 'dismissed' ? 'Issue ignored' : 'Issue edited and confirmed');
  const next = decisions.findIndex(function (decision, index) { return decision === 'pending' && index > current; });
  if (next >= 0) {
    current = next;
    render();
  } else if (decisions.every(function (decision) { return decision !== 'pending'; })) {
    render();
    setTimeout(function () { activateCaseTab('submit'); }, 220);
  } else {
    current = decisions.findIndex(function (decision) { return decision === 'pending'; });
    render();
  }
}

async function persistDecision(kind, noteOrReason) {
  const issue = issues[current];
  if (!apiCaseRecord || !apiReport?.result_revision || !issue.issueId) {
    if (kind === 'confirmed') { reviewNotes[current] = noteOrReason; includedRequests[current] = false; }
    decide(kind);
    return;
  }
  try {
    const result = await resolveIssue(apiCaseRecord.case_id, issue.issueId, kind === 'confirmed' ? 'confirm' : 'ignore', {
      result_revision_id: apiReport.result_revision.id,
      command_id: crypto.randomUUID(),
      expected_issue_version: issue.version,
      ...(kind === 'dismissed' ? { reason: noteOrReason } : {}),
    });
    issue.version = result.version;
    if (kind === 'confirmed') {
      const draft = await saveRequestedChange(apiCaseRecord.case_id, issue.issueId, {
        result_revision_id: apiReport.result_revision.id,
        command_id: crypto.randomUUID(), text: noteOrReason, included: false,
      });
      issue.requestedChange = { draft_revision_id: draft.draft_revision_id, revision: draft.revision, text: noteOrReason, included: false };
      reviewNotes[current] = noteOrReason;
      includedRequests[current] = false;
    }
    ignoring = false;
    decide(kind);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Review decision could not be saved');
  }
}

function outcomeLabel(value) { return value === 'pending' ? 'Pending' : value === 'dismissed' ? 'Ignored' : value === 'edited' ? 'Edited & confirmed' : 'Confirmed'; }

function renderSummary() {
  document.querySelector('#summary-issues').innerHTML = issues.map(function (issue, index) {
    const canRequest = Boolean(reviewNotes[index]) && (decisions[index] === 'confirmed' || decisions[index] === 'edited');
    const included = includedRequests[index] !== false;
    const marker = decisions[index] === 'pending' ? '!' : decisions[index] === 'dismissed' ? '×' : '✓';
    return '<div class="summary-issue-row ' + (canRequest && !included ? 'excluded' : '') + '"><button data-summary-issue="' + index + '"><span class="summary-state ' + decisions[index] + '">' + marker + '</span><span><strong>' +
      issue.title + '</strong><small>' + outcomeLabel(decisions[index]) + '</small></span><i>→</i></button>' + (canRequest ? '<label><input type="checkbox" data-request-include="' + index + '" ' + (included ? 'checked' : '') + '> Include in message</label>' : '') + '</div>';
  }).join('');
  document.querySelectorAll('[data-summary-issue]').forEach(function (button) {
    button.addEventListener('click', function () {
      current = Number(button.dataset.summaryIssue);
      editing = false;
      confirming = false;
      render();
      activateCaseTab('issues');
    });
  });
  document.querySelectorAll('[data-request-include]').forEach(function (checkbox) {
    checkbox.addEventListener('change', async function () {
      const index = Number(checkbox.dataset.requestInclude);
      includedRequests[index] = checkbox.checked;
      checkbox.closest('.summary-issue-row').classList.toggle('excluded', !checkbox.checked);
      updateApplicantPreview();
      const issue = issues[index];
      if (apiCaseRecord && apiReport?.result_revision && issue.issueId && reviewNotes[index]) {
        try {
          const draft = await saveRequestedChange(apiCaseRecord.case_id, issue.issueId, {
            result_revision_id: apiReport.result_revision.id, command_id: crypto.randomUUID(),
            text: reviewNotes[index], included: checkbox.checked,
          });
          issue.requestedChange = { draft_revision_id: draft.draft_revision_id, revision: draft.revision, text: reviewNotes[index], included: checkbox.checked };
        } catch (error) {
          includedRequests[index] = !checkbox.checked;
          checkbox.checked = !checkbox.checked;
          checkbox.closest('.summary-issue-row').classList.toggle('excluded', !checkbox.checked);
          updateApplicantPreview();
          toast(error instanceof Error ? error.message : 'Requested change could not be saved');
        }
      }
    });
  });
  updateApplicantPreview();
  const internalNote = document.querySelector('#internal-review-note');
  internalNote.value = internalReviewNote;
  internalNote.addEventListener('input', function () { internalReviewNote = internalNote.value; });
  updateSubmissionActions();
}

function hasIncludedApplicantRequest() {
  return issues.some(function (_, index) {
    return (decisions[index] === 'confirmed' || decisions[index] === 'edited') && includedRequests[index] !== false && reviewNotes[index] && reviewNotes[index].trim();
  });
}

function updateApplicantPreview() {
  const included = issues.map(function (_, index) { return index; }).filter(function (index) {
    return (decisions[index] === 'confirmed' || decisions[index] === 'edited') && includedRequests[index] !== false && reviewNotes[index] && reviewNotes[index].trim();
  });
  document.querySelector('#applicant-message-preview').innerHTML = included.length
    ? '<p>Please make the following changes:</p><ol>' + included.map(function (index) { return '<li>' + escapeHtml(reviewNotes[index].trim()) + '</li>'; }).join('') + '</ol>'
    : '<p class="empty-preview">No message will be sent to the applicant.</p>';
  updateSubmissionActions();
}

function updateSubmissionActions() {
  const incomplete = decisions.some(function (value) { return value === 'pending'; });
  const hasRequest = hasIncludedApplicantRequest();
  document.querySelectorAll('.case-action').forEach(function (button) {
    const action = button.dataset.caseAction;
    const primary = (action === 'changes' && hasRequest) || (action === 'clear' && !hasRequest);
    button.classList.toggle('primary', primary);
    button.classList.toggle('quiet', !primary);
    button.disabled = incomplete || (action === 'changes' && !hasRequest) || (action === 'clear' && hasRequest);
    button.title = incomplete ? 'Review every issue before submitting' : action === 'changes' && !hasRequest ? 'Include an applicant request to use this action' : action === 'clear' && hasRequest ? 'Remove or exclude applicant requests to complete the review' : '';
  });
}

searchInput.addEventListener('input', renderCases);
document.querySelectorAll('.filter').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('.filter').forEach(function (item) { item.classList.remove('active'); });
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    renderCases();
  });
});
document.querySelector('#queue-nav').addEventListener('click', function () { show('queue'); });
const caseAgentRun = document.querySelector('#case-agent-run');
document.querySelector('#case-agent-trigger').addEventListener('click', function () { caseAgentRun.showModal(); });
document.querySelector('#close-agent-run').addEventListener('click', function () { caseAgentRun.close(); });
document.querySelector('#back').addEventListener('click', function () { show('queue'); });
document.querySelector('#previous').addEventListener('click', function () { if (current > 0) { current -= 1; editing = false; confirming = false; render(); } });
document.querySelector('#next').addEventListener('click', function () { if (current < issues.length - 1) { current += 1; editing = false; confirming = false; render(); } });
document.querySelector('#issue-list-toggle').addEventListener('click', function (event) {
  const list = document.querySelector('#issue-list');
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  list.hidden = expanded;
  event.currentTarget.querySelector('b').textContent = expanded ? '⌄' : '⌃';
});
document.querySelector('#create-issue').addEventListener('click', function () {
  issues.push({
    type: 'Reviewer-created', tone: 'neutral', title: 'New review issue',
    why: 'Add the issue details and supporting evidence.',
    recommendation: 'Please describe what information or document you need the applicant to provide.',
    doc: 'Uploaded package.pdf', page: 'Page 1 of ' + (apiDocuments[0]?.page_count || 5), pageNumber: 1, paper: 'boundary',
    value: '', valueLabel: '', values: []
  });
  decisions.push('pending');
  current = issues.length - 1;
  creatingIssue = true;
  editing = true;
  confirming = false;
  render();
});
document.querySelector('#zoom-out').addEventListener('click', function () { updateZoom(-8); });
document.querySelector('#zoom-in').addEventListener('click', function () { updateZoom(8); });
document.querySelectorAll('[data-source-view]').forEach(function (button) {
  button.addEventListener('click', function () { sourceView = button.dataset.sourceView; sourceOverride = null; renderSource(issues[current]); });
});
const panelResizer = document.querySelector('#panel-resizer');
const reviewLayout = document.querySelector('.review-layout');
function setReviewWidth(pointerX) {
  const bounds = reviewLayout.getBoundingClientRect();
  const width = Math.max(400, Math.min(720, bounds.right - pointerX));
  reviewLayout.style.setProperty('--review-width', width + 'px');
  panelResizer.setAttribute('aria-valuenow', String(Math.round(width)));
}
panelResizer.addEventListener('pointerdown', function (event) {
  panelResizer.classList.add('dragging');
  panelResizer.setPointerCapture(event.pointerId);
});
panelResizer.addEventListener('pointermove', function (event) {
  if (panelResizer.hasPointerCapture(event.pointerId)) setReviewWidth(event.clientX);
});
panelResizer.addEventListener('pointerup', function (event) {
  panelResizer.classList.remove('dragging');
  panelResizer.releasePointerCapture(event.pointerId);
});
panelResizer.addEventListener('keydown', function (event) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const currentWidth = parseFloat(getComputedStyle(reviewLayout).getPropertyValue('--review-width')) || 540;
  const nextWidth = currentWidth + (event.key === 'ArrowLeft' ? 24 : -24);
  setReviewWidth(reviewLayout.getBoundingClientRect().right - nextWidth);
  event.preventDefault();
});
function updateZoom(delta) {
  zoom = Math.max(68, Math.min(124, zoom + delta));
  document.querySelector('#zoom-label').textContent = zoom + '%';
  document.querySelector('#paper').style.setProperty('--paper-scale', zoom / 92);
}
document.querySelector('#refresh-queue').addEventListener('click', function (event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.innerHTML = '<span class="spin">↻</span> Refreshing';
  setTimeout(function () {
    button.disabled = false;
    button.innerHTML = '<span>↻</span> Refresh';
    toast('Queue refreshed from authoritative state');
  }, 650);
});

const reportContent = document.querySelector('[data-view="report"]');
const submitContent = document.querySelector('#summary .summary-wrap');
reportContent.classList.remove('drawer-view', 'active');
document.querySelector('[data-case-view="report"]').appendChild(reportContent);
document.querySelector('[data-case-view="submit"]').appendChild(submitContent);
document.querySelector('#details').remove();
document.querySelector('#summary').remove();

function activateCaseTab(view) {
  document.querySelectorAll('[data-case-tab]').forEach(function (button) { button.classList.toggle('active', button.dataset.caseTab === view); });
  document.querySelectorAll('[data-case-view]').forEach(function (panel) { panel.classList.toggle('active', panel.dataset.caseView === view); });
  if (view === 'submit') renderSummary();
}
document.querySelectorAll('[data-case-tab]').forEach(function (button) {
  button.addEventListener('click', function () { activateCaseTab(button.dataset.caseTab); });
});
document.querySelectorAll('.case-action').forEach(function (button) {
  button.addEventListener('click', async function () {
    const hasApplicantRequest = hasIncludedApplicantRequest();
    if (button.dataset.caseAction === 'changes' && !hasApplicantRequest) {
      toast('Include at least one request before requesting changes');
      return;
    }
    if (button.dataset.caseAction === 'clear' && hasApplicantRequest) {
      toast('Exclude applicant requests before completing the review');
      return;
    }
    if (apiCaseRecord && apiReport?.result_revision) {
      try {
        const action = button.dataset.caseAction === 'clear' ? 'clear_for_downstream' : button.dataset.caseAction === 'changes' ? 'request_changes' : 'escalate_review';
        const selectedDraftRevisionIds = issues.map(function (issue, index) {
          return includedRequests[index] !== false ? issue.requestedChange?.draft_revision_id : null;
        }).filter(Boolean);
        const result = await submitFinalReview(apiCaseRecord.case_id, {
          result_revision_id: apiReport.result_revision.id, command_id: crypto.randomUUID(),
          expected_case_version: apiCaseRecord.version, action,
          selected_draft_revision_ids: selectedDraftRevisionIds,
          ...(internalReviewNote.trim() ? { internal_note: internalReviewNote.trim() } : {}),
        });
        apiCaseRecord.version = result.case_version;
        apiCaseRecord.lifecycle = 'review_complete';
        apiCaseRecord.final_review_action = result.action;
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Final review could not be saved');
        return;
      }
    }
    document.querySelectorAll('.case-action').forEach(function (item) { item.disabled = true; });
    button.textContent = button.dataset.caseAction === 'clear' ? 'Document review completed' : button.dataset.caseAction === 'changes' ? 'Changes requested' : 'Review escalated';
    applyFinalOutcome(button.dataset.caseAction === 'clear' ? 'clear_for_downstream' : button.dataset.caseAction === 'changes' ? 'request_changes' : 'escalate_review');
    toast(button.textContent);
  });
});

function applyFinalOutcome(action) {
    const humanStep = document.querySelector('.progress-step.active');
    if (humanStep) {
      humanStep.classList.remove('active');
      humanStep.classList.add('complete');
      humanStep.querySelector('i').textContent = '✓';
    }
    const outcomeStep = document.querySelector('#outcome-step');
    outcomeStep.className = 'progress-step ' + (action === 'clear_for_downstream' ? 'outcome-complete' : action === 'request_changes' ? 'outcome-change' : 'outcome-escalate');
    outcomeStep.querySelector('i').textContent = '✓';
    outcomeStep.querySelector('span').textContent = action === 'clear_for_downstream' ? 'Completed' : action === 'request_changes' ? 'Changes requested' : 'Review escalated';
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { element.classList.remove('show'); }, 2400);
}

function issuePresentation(record, finding, index) {
  const presentation = {
    VAL_DOC_COMPLETENESS_001: { title: 'Document boundary', type: 'Document review', tone: 'warning', paper: 'boundary', pageNumber: 3 },
    VAL_EMPLOYER_CONSISTENCY_001: { title: 'Employer mismatch', type: 'Cross-document conflict', tone: 'failed', paper: 'bank', pageNumber: 4 },
    VAL_INCOME_CONSISTENCY_001: { title: 'Monthly income', type: 'Evidence review', tone: 'warning', paper: 'pay', pageNumber: 2 },
  }[record.code] || { title: 'Review issue ' + (index + 1), type: 'Agent finding', tone: 'warning', paper: 'boundary', pageNumber: 1 };
  const references = finding ? finding.references : [];
  return {
    issueId: record.issue_id, version: record.version, requestedChange: record.requested_change,
    code: record.code, type: presentation.type, tone: presentation.tone, title: presentation.title,
    why: record.description, recommendation: record.recommended_action,
    doc: apiDocuments[0] ? apiDocuments[0].submitted_filename : 'Submitted document',
    page: 'Page ' + presentation.pageNumber + (apiDocuments[0] ? ' of ' + apiDocuments[0].page_count : ''),
    pageNumber: presentation.pageNumber, paper: presentation.paper,
    value: '', valueLabel: '',
    values: references.map(function (reference) {
      return evidencePresentation(reference);
    }),
  };
}

function evidencePresentation(reference) {
  const evidence = apiEvidenceByReference[reference];
  if (!evidence) return { label: 'Source unavailable', role: 'Evidence', value: 'Unavailable', source: 'Evidence unavailable', reference: reference };
  if (evidence.evidence_type === 'structured_input') {
    const field = apiApplicationData && apiApplicationData.groups.flatMap(function (group) { return group.fields; })
      .find(function (candidate) { return candidate.json_pointer === evidence.json_pointer; });
    return {
      label: field ? field.key.replaceAll('_', ' ') : 'Application field', role: 'Application data',
      value: field ? field.display_value : 'Submitted value', source: 'Open application field', reference: reference,
    };
  }
  const documentRecord = apiDocuments.find(function (item) { return item.document_id === evidence.document_version_id; }) || apiDocuments[0];
  return {
    label: 'Document evidence', role: documentRecord ? documentRecord.submitted_filename : 'Submitted document',
    value: 'Page ' + evidence.page_number, source: 'Open page ' + evidence.page_number, reference: reference,
  };
}

function renderApiReport(report) {
  document.querySelector('.report-copy').textContent = report.summary || 'Agent report unavailable.';
  document.querySelector('.report-links').innerHTML = issues.map(function (issue, index) {
    return '<button data-report-issue="' + index + '"><b>' + String(index + 1).padStart(2, '0') + '</b><span>' + escapeHtml(issue.title) + '</span><em>→</em></button>';
  }).join('');
  document.querySelector('.checked-facts').innerHTML = report.checked_facts.map(function (fact, index) {
    const reference = fact.references.find(function (candidate) { return apiEvidenceByReference[candidate]; });
    return '<button data-checked-reference="' + encodeURIComponent(reference || '') + '" ' + (reference ? '' : 'disabled') + '><i>✓</i><span><strong>' +
      escapeHtml(fact.statement) + '</strong><small>' + fact.references.length + ' source' + (fact.references.length === 1 ? '' : 's') + ' checked' +
      '</small><em>Checked fact ' + (index + 1) + '</em></span><b>→</b></button>';
  }).join('');
  wireReportNavigation();
}

function wireReportNavigation() {
  document.querySelectorAll('[data-report-issue]').forEach(function (button) {
    button.addEventListener('click', function () {
      current = Number(button.dataset.reportIssue); sourceView = 'document'; sourceOverride = null;
      editing = false; confirming = false; render(); activateCaseTab('issues');
    });
  });
  document.querySelectorAll('[data-checked-reference]').forEach(function (button) {
    button.addEventListener('click', function () {
      openEvidenceReference(decodeURIComponent(button.dataset.checkedReference));
    });
  });
}

async function loadCaseFromApi() {
  const caseId = new URLSearchParams(window.location.search).get('case_id');
  if (!caseId) return;
  try {
    const bundle = await loadCaseBundle(caseId);
    const caseRecord = bundle.caseRecord;
    const report = bundle.report;
    apiCaseRecord = caseRecord;
    apiReport = report;
    const findings = bundle.findings;
    const issueRecords = bundle.issues;
    apiApplicationData = bundle.applicationData;
    apiDocuments = bundle.documents;
    apiEvidenceByReference = bundle.evidenceByReference;
    const completedAction = caseRecord.final_review_action;
    const queueStatus = completedAction === 'request_changes' ? 'changes' : completedAction === 'escalate_review' ? 'escalated' : completedAction === 'clear_for_downstream' ? 'completed' : caseRecord.lifecycle === 'ready_for_review' ? 'ready' : 'in-progress';
    const queueStatusLabel = completedAction === 'request_changes' ? 'Changes requested' : completedAction === 'escalate_review' ? 'Escalated' : completedAction === 'clear_for_downstream' ? 'Ready for handoff' : caseRecord.lifecycle === 'ready_for_review' ? 'Ready for review' : 'In progress';
    cases = [{
      name: caseRecord.applicant_display_name, id: caseRecord.case_id,
      summary: report.summary || 'Agent report unavailable',
      status: queueStatus,
      statusLabel: queueStatusLabel,
      issues: issueRecords.length, waiting: 'Now',
    }];
    issues = issueRecords.map(function (record, index) {
      return issuePresentation(record, findings.find(function (finding) { return finding.rule_id === record.code; }), index);
    });
    decisions = issueRecords.map(function (record) { return record.review_state === 'pending' ? 'pending' : record.review_state === 'ignored' ? 'dismissed' : 'confirmed'; });
    issueRecords.forEach(function (record, index) {
      if (!record.requested_change) return;
      reviewNotes[index] = record.requested_change.text;
      includedRequests[index] = record.requested_change.included;
    });
    current = 0;
    document.querySelectorAll('.case-id').forEach(function (element) { element.textContent = caseRecord.case_id; });
    document.querySelectorAll('.case-identity strong').forEach(function (element) { element.textContent = caseRecord.applicant_display_name; });
    document.querySelector('[data-case-tab="issues"] span').textContent = String(issues.length);
    document.querySelector('#case-agent-trigger strong').textContent = report.availability === 'ready' ? 'Generated review report' : 'Report unavailable';
    renderApiReport(report);
    renderCases();
    if (issues.length) render();
    if (caseRecord.final_review_action) applyFinalOutcome(caseRecord.final_review_action);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Case data could not be loaded');
  }
}

wireReportNavigation();
renderCases();
render();
void loadCaseFromApi();
