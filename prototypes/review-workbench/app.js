import { createIssue, editIssue, formatPendingAgentActivity, loadCaseBundle, loadCaseQueue, loadDemoAgentModels, prepareDemoCase, resolveIssue, restartAgentReview, saveRequestedChange, startDemoCase, startPersistedAgentReview, stopAgentReview, submitFinalReview } from './api.js';
import { presentIssue } from './issue-presentation.js';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

let cases = [
  { name: 'Anna Beispiel', id: 'FD-2026-0042', summary: 'Employer information differs', status: 'ready', statusLabel: 'Ready for review', issues: 3, waiting: '18 min' },
  { name: 'Emil Probe', id: 'FD-2026-0038', summary: 'Income document needs confirmation', status: 'in-progress', statusLabel: 'In progress', issues: 1, waiting: '9 min' },
  { name: 'Klara Test', id: 'FD-2026-0035', summary: 'Uploaded documents need separation', status: 'ready', statusLabel: 'Ready for review', issues: 2, waiting: '34 min' }
];
let apiAgentLog = null;
let demoStopRequested = false;

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
const queuePageSize = 10;
let currentQueuePage = 1;
const initialQueueView = new URLSearchParams(window.location.search).get('queue_view');
let activeQueueView = ['review', 'changes_requested', 'completed'].includes(initialQueueView) ? initialQueueView : 'review';
let decisions = ['pending', 'pending', 'pending'];
let apiApplicationData = null;
let apiDocuments = [];
let apiEvidenceByReference = {};
let apiCaseRecord = null;
let apiReport = null;
let activeApplicationPointer = null;
let activeEvidenceRegion = null;
let caseReadOnly = false;
let preparedDemoCase = null;
let demoAgentModels = null;
const pdfDocuments = new Map();
const expandedCheckedFacts = new Set();
let documentRenderSequence = 0;
let thumbnailRenderSequence = 0;
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
      (item.name + ' ' + item.id + ' ' + item.methodTitle + ' ' + item.methodDetail).toLowerCase().includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / queuePageSize));
  currentQueuePage = Math.min(currentQueuePage, pageCount);
  const pageStart = (currentQueuePage - 1) * queuePageSize;
  const pageCases = visible.slice(pageStart, pageStart + queuePageSize);
  caseList.innerHTML = pageCases.map(function (item) {
    return '<tr class="case-row" data-route-id="' + escapeHtml(item.routeId || item.id) + '" tabindex="0" aria-label="Open ' + item.id + ', ' + item.name + '">' +
      '<td><strong>' + item.id + '</strong></td><td><strong>' + item.name + '</strong></td>' +
      '<td class="review-method"><strong>' + escapeHtml(item.methodTitle) + '</strong><small>' + escapeHtml(item.methodDetail) + '</small></td><td><span class="issue-number">' + item.issues + '</span></td>' +
      '<td><span class="state-label ' + item.status + '"><i></i>' + item.statusLabel + '</span></td>' +
      '<td class="tabular">' + item.waiting + '</td>' +
      '<td class="row-arrow">→</td></tr>';
  }).join('');
  document.querySelector('#empty-state').hidden = visible.length > 0;
  const pagination = document.querySelector('#queue-pagination');
  pagination.hidden = visible.length <= queuePageSize;
  document.querySelector('#queue-page-summary').textContent = visible.length === 0 ? ''
    : (pageStart + 1) + '–' + Math.min(pageStart + queuePageSize, visible.length) + ' of ' + visible.length + ' cases';
  document.querySelector('#queue-page-position').textContent = 'Page ' + currentQueuePage + ' of ' + pageCount;
  document.querySelector('#queue-page-previous').disabled = currentQueuePage === 1;
  document.querySelector('#queue-page-next').disabled = currentQueuePage === pageCount;
  caseList.querySelectorAll('.case-row').forEach(function (row) {
    row.addEventListener('click', function () { openQueueCase(row.dataset.routeId); });
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openQueueCase(row.dataset.routeId);
      }
    });
  });
}

function openQueueCase(caseId) {
  if (apiCaseRecord?.case_id === caseId) {
    show('workspace');
    activateCaseTab('report');
    return;
  }
  window.location.search = '?case_id=' + encodeURIComponent(caseId) + '&queue_view=' + encodeURIComponent(activeQueueView);
}

function waitingLabel(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + ' hr' : Math.floor(hours / 24) + ' d';
}

async function refreshQueue(view = activeQueueView, updateLocation = true) {
  try {
    const payload = await loadCaseQueue(view);
    activeQueueView = view;
    cases = payload.cases.map(function (record) {
      const status = record.workflow_status === 'ready_for_review' ? 'ready' : record.workflow_status === 'processing' ? 'in-progress' : record.workflow_status.replaceAll('_', '-');
      const labels = { processing: 'In progress', ready_for_review: 'Ready for review', escalated: 'Escalated', changes_requested: 'Changes requested', ready_for_handoff: 'Ready for handoff' };
      const methodTitle = record.review_method === 'manual' ? 'Human review'
        : record.review_method === 'deterministic' ? 'Deterministic workflow'
        : record.review_method === 'agent_vlm' ? 'Agent + VLM' : 'Agent';
      const methodDetail = record.review_method === 'manual' ? 'Agent not run'
        : record.review_method === 'deterministic' ? 'Demo only'
        : [record.agent_model_label, record.vlm_model_label].filter(function (label) { return label; }).join(' · ') || 'Model unavailable';
      return { name: record.applicant_display_name, id: record.case_code, routeId: record.case_id, methodTitle, methodDetail,
        status, statusLabel: labels[record.workflow_status], issues: record.issue_count, waiting: waitingLabel(record.waiting_since) };
    });
    document.querySelector('.page-heading h1').textContent = view === 'changes_requested' ? 'Changes requested' : view === 'completed' ? 'Completed' : 'Review queue';
    document.querySelector('.queue-panel').setAttribute('aria-label', document.querySelector('.page-heading h1').textContent);
    document.querySelector('.filter-group').hidden = view !== 'review';
    document.querySelector('#load-demo-case').hidden = view !== 'review';
    document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
    document.querySelector(view === 'changes_requested' ? '#changes-nav' : view === 'completed' ? '#completed-nav' : '#queue-nav').classList.add('active');
    activeFilter = 'all';
    currentQueuePage = 1;
    document.querySelectorAll('.filter').forEach(function (item) { item.classList.toggle('active', item.dataset.filter === 'all'); });
    updateQueueCounts();
    renderCases();
    show('queue');
    if (updateLocation) window.history.replaceState(null, '', '?queue_view=' + encodeURIComponent(view));
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Case queue could not be loaded');
  }
}

async function updateAllQueueCounts() {
  const views = ['review', 'changes_requested', 'completed'];
  const payloads = await Promise.all(views.map(function (view) { return loadCaseQueue(view); }));
  document.querySelector('#queue-nav b').textContent = payloads[0].cases.length;
  document.querySelector('#changes-nav b').textContent = payloads[1].cases.length;
  document.querySelector('#completed-nav b').textContent = payloads[2].cases.length;
}

function updateQueueCounts() {
  const counts = {
    all: cases.length,
    ready: cases.filter(function (item) { return item.status === 'ready'; }).length,
    'in-progress': cases.filter(function (item) { return item.status === 'in-progress'; }).length,
    escalated: cases.filter(function (item) { return item.status === 'escalated'; }).length,
  };
  document.querySelectorAll('.filter').forEach(function (button) { button.querySelector('span').textContent = counts[button.dataset.filter] || 0; });
}

function show(id) {
  document.querySelectorAll('.screen').forEach(function (screen) { screen.classList.remove('active'); });
  document.querySelector('#' + id).classList.add('active');
  document.querySelector('.topbar > div:first-child strong').textContent = 'Document review';
  if (id === 'workspace') render();
  if (id === 'summary') renderSummary();
}

function previewApplicationData(applicationData) {
  return {
    groups: [
      { group: 'Applicant', fields: [
        { json_pointer: '/applicant_display_name', key: 'applicant_display_name', display_value: applicationData.applicant_display_name },
      ] },
      { group: 'Employment', fields: [
        { json_pointer: '/employment/employer', key: 'employer', display_value: applicationData.employment.employer },
      ] },
      { group: 'Income', fields: [
        { json_pointer: '/income/monthly_net', key: 'monthly_net', display_value: 'EUR ' + applicationData.income.monthly_net },
        { json_pointer: '/income/currency', key: 'currency', display_value: applicationData.income.currency },
      ] },
    ],
  };
}

function setDemoPreview(prepared) {
  const previewDocumentId = 'preview-' + prepared.caseId;
  preparedDemoCase = prepared;
  demoStopRequested = false;
  apiCaseRecord = null; apiReport = null; apiAgentLog = null;
  apiApplicationData = previewApplicationData(prepared.applicationData);
  apiDocuments = [{
    document_id: previewDocumentId,
    submitted_filename: prepared.caseId + '.pdf',
    media_type: 'application/pdf', page_count: prepared.pageCount, content_url: prepared.documentUrl,
  }];
  apiEvidenceByReference = {}; issues = []; decisions = []; current = 0;
  sourceView = 'document'; sourceOverride = null; activeApplicationPointer = null; activeEvidenceRegion = null;
  pdfDocuments.clear(); expandedCheckedFacts.clear();
  pdfDocuments.set(previewDocumentId, getDocument({ data: new Uint8Array(prepared.documentBytes.slice(0)) }).promise);
  document.querySelectorAll('.case-id').forEach(function (element) { element.textContent = 'DEMO CASE'; });
  document.querySelectorAll('.case-identity strong').forEach(function (element) { element.textContent = prepared.applicantDisplayName; });
  document.querySelector('.status-badge').textContent = 'Not reviewed';
  document.querySelector('.case-progress').hidden = false;
  document.querySelector('#demo-launch').hidden = false;
  document.querySelector('#persisted-agent-log').hidden = true;
  document.querySelector('#demo-preview').classList.remove('running', 'completed');
  document.querySelector('#demo-preview').classList.remove('persisted-log');
  document.querySelector('.agent-model-field').hidden = false;
  document.querySelector('#pending-agent-log').hidden = true;
  const runAgentButton = document.querySelector('#run-agent-review');
  runAgentButton.hidden = false;
  runAgentButton.disabled = false;
  runAgentButton.textContent = 'Run agent review';
  document.querySelector('#agent-model').disabled = false;
  setCaseTabsAvailability(false);
  updateWorkflowProgress('generated');
  show('workspace');
  activateCaseTab('agent-log');
}

function setCaseTabsAvailability(reportAvailable, humanReviewAvailable = reportAvailable) {
  document.querySelectorAll('[data-case-tab]').forEach(function (button) {
    if (button.dataset.caseTab === 'agent-log') return;
    button.disabled = button.dataset.caseTab === 'report' ? !reportAvailable : !humanReviewAvailable;
  });
}

function updateWorkflowProgress(stage) {
  const order = ['submitted', 'prepared', 'agent', 'human', 'outcome'];
  const activeIndex = { generated: 0, preparing: 1, processing: 2, stopped: 3, manual_review: 3, review: 3, outcome: 4, stopped_outcome: 4 }[stage] ?? 3;
  order.forEach(function (name, index) {
    const step = document.querySelector('[data-progress-step="' + name + '"]') || (name === 'outcome' ? document.querySelector('#outcome-step') : null);
    if (!step) return;
    const agentSkipped = (stage === 'stopped' || stage === 'stopped_outcome' || stage === 'manual_review') && name === 'agent';
    step.className = 'progress-step ' + (agentSkipped ? 'skipped' : index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending');
    step.querySelector('i').textContent = agentSkipped ? '–' : index < activeIndex ? '✓' : '';
  });
}

function renderDemoAgentModels(configuration) {
  demoAgentModels = configuration;
  const select = document.querySelector('#agent-model');
  select.innerHTML = configuration.models.map(function (model) {
    return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.label) + '</option>';
  }).join('');
  select.value = configuration.default_model;
  document.querySelector('#runtime-model-label').textContent = configuration.default_model === 'fake'
    ? 'Default · Demo Agent' : 'Default · ' + configuration.default_model.split('/').at(-1);
}

function selectedDemoAgentModel() {
  return demoAgentModels?.models.find(function (model) { return model.id === document.querySelector('#agent-model').value; });
}

function confirmPaidAgentRun(model) {
  const dialog = document.querySelector('#paid-run-confirmation');
  document.querySelector('#paid-run-model').textContent = model.label;
  document.querySelector('#paid-run-cost').textContent = 'USD ' + model.maximum_case_cost_usd;
  return new Promise(function (resolve) {
    const confirm = document.querySelector('#confirm-paid-run');
    const cancel = document.querySelector('#cancel-paid-run');
    const finish = function (accepted) {
      confirm.removeEventListener('click', accept);
      cancel.removeEventListener('click', decline);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      resolve(accepted);
    };
    const accept = function () { finish(true); };
    const decline = function () { finish(false); };
    const escape = function (event) { event.preventDefault(); finish(false); };
    confirm.addEventListener('click', accept);
    cancel.addEventListener('click', decline);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
  });
}

function confirmAgentStop() {
  const dialog = document.querySelector('#stop-agent-confirmation');
  return new Promise(function (resolve) {
    const confirm = document.querySelector('#confirm-agent-stop');
    const cancel = document.querySelector('#cancel-agent-stop');
    const finish = function (accepted) {
      confirm.removeEventListener('click', accept);
      cancel.removeEventListener('click', decline);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      resolve(accepted);
    };
    const accept = function () { finish(true); };
    const decline = function () { finish(false); };
    const escape = function (event) { event.preventDefault(); finish(false); };
    confirm.addEventListener('click', accept);
    cancel.addEventListener('click', decline);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
  });
}

function confirmAgentRestart() {
  const dialog = document.querySelector('#restart-agent-confirmation');
  return new Promise(function (resolve) {
    const confirm = document.querySelector('#confirm-agent-restart');
    const cancel = document.querySelector('#cancel-agent-restart');
    const finish = function (accepted) {
      confirm.removeEventListener('click', accept);
      cancel.removeEventListener('click', decline);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      resolve(accepted);
    };
    const accept = function () { finish(true); };
    const decline = function () { finish(false); };
    const escape = function (event) { event.preventDefault(); finish(false); };
    confirm.addEventListener('click', accept);
    cancel.addEventListener('click', decline);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
  });
}

function openCompletedAgentReport(created) {
  window.location.search = '?case_id=' + encodeURIComponent(created.case_id) + '&queue_view=review';
}

async function requestAgentStop(caseId, button, onStopped) {
  if (!await confirmAgentStop()) return;
  button.disabled = true;
  button.textContent = 'Stopping…';
  try {
    const result = await stopAgentReview(caseId);
    if (result.stopped) await onStopped(result);
    else button.textContent = 'Run already finished';
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Stop Agent review';
    toast(error instanceof Error ? error.message : 'Agent review could not be stopped');
  }
}

async function requestAgentRestart(caseId, button) {
  if (!await confirmAgentRestart()) return;
  button.disabled = true;
  button.textContent = 'Restarting…';
  try {
    const result = await restartAgentReview(caseId);
    if (!result.restarted) throw new Error('Agent review cannot be restarted from its current state');
    window.location.search = '?case_id=' + encodeURIComponent(result.case_id) + '&queue_view=review';
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Restart Agent review';
    toast(error instanceof Error ? error.message : 'Agent review could not be restarted');
  }
}

function agentRunMarkup(log, modelLabel, state, costLabel, includeRequested = true) {
  const events = log?.events || [];
  const acceptedEvent = includeRequested
    ? '<div class="agent-run-event' + (!events.length && state === 'Running' ? ' current' : '') + '"><i></i><div><strong>Agent review requested</strong><small>Case accepted and persisted</small></div></div>'
    : '';
  return '<header class="agent-run-header"><div class="agent-run-identity"><span class="agent-run-state"><i></i>' + escapeHtml(state) + '</span><strong>Agent review</strong>' +
    (state === 'Not run' ? '<small class="agent-run-hint">Optional · Run Agent or review manually</small>' : '') + '</div>' +
    '<div class="agent-run-summary"><div><span>Model</span><strong title="' + escapeHtml(modelLabel) + '">' + escapeHtml(modelLabel) + '</strong></div>' +
    '<div><span>Cost</span><strong>' + escapeHtml(costLabel || 'Calculating') + '</strong></div></div></header>' +
    '<div class="agent-run-timeline">' + acceptedEvent + (events.length ? events.map(function (event, index) {
      const latest = index === events.length - 1 && state === 'Running';
      return '<div class="agent-run-event' + (latest ? ' current' : '') + '"><i></i><div><strong>' + escapeHtml(formatPendingAgentActivity(event)) + '</strong>' +
        (event.tool_label ? '<small>' + escapeHtml(event.tool_label) + '</small>' : '') + '</div></div>';
    }).join('') : '') + '</div>';
}

function replaceAgentRunMarkup(host, markup) {
  const previous = host.querySelector('.agent-run-timeline');
  const previousScrollTop = previous ? previous.scrollTop : 0;
  const followLatest = !previous
    ? host.dataset.followLatest !== 'false'
    : previous.scrollHeight - previous.clientHeight - previous.scrollTop <= 32;
  host.dataset.followLatest = String(followLatest);
  host.innerHTML = markup;
  const timeline = host.querySelector('.agent-run-timeline');
  if (!timeline) return;
  timeline.addEventListener('scroll', function () {
    host.dataset.followLatest = String(timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop <= 32);
  }, { passive: true });
  requestAnimationFrame(function () {
    timeline.scrollTop = followLatest
      ? timeline.scrollHeight
      : Math.min(previousScrollTop, Math.max(0, timeline.scrollHeight - timeline.clientHeight));
  });
}

function renderPendingAgentLog(log, modelLabel, completedCase, runningCase) {
  const panel = document.querySelector('#pending-agent-log');
  panel.hidden = false;
  const cost = log?.estimated_cost ? log.estimated_cost.currency + ' ' + log.estimated_cost.amount : '';
  replaceAgentRunMarkup(panel, agentRunMarkup(log, modelLabel, completedCase ? 'Completed' : 'Running', completedCase ? cost : '') +
    (completedCase ? '<div class="agent-run-complete"><i>✓</i><strong>Report ready</strong></div>' : '') +
    (runningCase ? '<button class="button quiet agent-stop" id="stop-agent-review">Stop Agent review</button>' : ''));
  if (runningCase) document.querySelector('#stop-agent-review').addEventListener('click', async function (event) {
    await requestAgentStop(runningCase.case_id, event.currentTarget, function () { demoStopRequested = true; });
  });
}

function renderStoppedAgentActions(caseId) {
  const host = document.querySelector('#persisted-agent-log');
  const actions = document.createElement('div');
  actions.className = 'stopped-agent-actions';
  actions.innerHTML = '<div><strong>Agent review stopped</strong><span>You can restart the Agent as a new run, or continue the human review now.</span></div><button class="button primary" id="restart-agent-review">Restart Agent review</button>';
  host.prepend(actions);
  document.querySelector('#restart-agent-review').addEventListener('click', function (event) { void requestAgentRestart(caseId, event.currentTarget); });
}

async function followAgentRun(created, modelLabel) {
  let latestLog = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const [caseResponse, logResponse] = await Promise.all([fetch(created.status_url), fetch(created.status_url + '/agent-log')]);
    if (!caseResponse.ok) throw new Error('Agent run status could not be loaded');
    const status = await caseResponse.json();
    if (logResponse.ok) {
      latestLog = await logResponse.json();
      updateWorkflowProgress(latestLog.session ? 'processing' : 'preparing');
      renderPendingAgentLog(latestLog, modelLabel, null, demoStopRequested ? null : created);
    }
    if (status.lifecycle !== 'processing') {
      if (demoStopRequested) {
        window.location.search = '?case_id=' + encodeURIComponent(created.case_id) + '&queue_view=review';
        return;
      }
      if (status.lifecycle !== 'ready_for_review') {
        if (!demoStopRequested) throw new Error('Agent review did not produce a review report');
        document.querySelector('#demo-preview').classList.remove('running');
        updateWorkflowProgress('stopped');
        renderPendingAgentLog(latestLog, modelLabel);
        return;
      }
      document.querySelector('#demo-preview').classList.remove('running');
      document.querySelector('#demo-preview').classList.add('completed');
      setCaseTabsAvailability(true);
      updateWorkflowProgress('review');
      renderPendingAgentLog(latestLog, modelLabel, created);
      window.history.replaceState({}, '', '?case_id=' + encodeURIComponent(created.case_id) + '&queue_view=review');
      await loadCaseFromApi();
      return;
    }
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
  }
  throw new Error('Agent review timed out');
}

function leaveDemoPreview() {
  preparedDemoCase = null;
  document.querySelector('.case-progress').hidden = false;
  document.querySelector('#demo-launch').hidden = true;
  document.querySelector('#pending-agent-log').innerHTML = '';
  document.querySelector('#persisted-agent-log').hidden = false;
  document.querySelector('#demo-preview').classList.add('persisted-log');
  setCaseTabsAvailability(true);
}

/**
 * The issue the review panel is showing. A case can have no Agent-raised issue, and its document
 * panel must still show that case's own pages rather than the prototype's built-in sample.
 */
function currentIssue() {
  const issue = issues[current];
  if (issue) return issue;
  const documentRecord = apiDocuments[0];
  return {
    doc: documentRecord ? documentRecord.submitted_filename : 'Submitted document',
    page: 'Page 1' + (documentRecord ? ' of ' + documentRecord.page_count : ''),
    pageNumber: 1, paper: 'boundary',
  };
}

function render() {
  const issue = currentIssue();
  const resolved = decisions.filter(function (decision) { return decision !== 'pending'; }).length;
  document.querySelector('#resolved-count').textContent = resolved + ' of ' + issues.length + ' reviewed';
  document.querySelector('[data-case-tab="issues"] span').textContent = String(issues.length);
  document.querySelector('#previous').disabled = current === 0 || issues.length === 0;
  document.querySelector('#next').disabled = current >= issues.length - 1;
  document.querySelector('#issue-content').innerHTML = issues.length === 0
    ? '<p class="empty-state">' + (apiReport?.failure_reason === 'agent_not_run'
      ? 'No issues have been recorded. Create an issue if human review identifies one.'
      : 'No Agent-raised issues for this case. Its deterministic checked facts stay in the Agent report.') + '</p>'
    : editing ? correctionForm(issue) : confirming ? confirmationForm(issue) : ignoring ? ignoreForm() : issueDetail(issue);
  renderIssueFooter();
  renderSource(issue);
  renderIssueList();
  renderThumbnails(issue.pageNumber);
  if (issues.length) wireIssueActions();
}

function renderIssueFooter() {
  const footer = document.querySelector('#issue-footer-actions');
  if (issues.length === 0) {
    footer.innerHTML = '<div class="footer-outcome">No issues to review</div>';
    return;
  }
  if (editing || confirming || ignoring) {
    footer.innerHTML = '<div class="footer-outcome">' + (editing ? 'Editing issue' : confirming ? 'Confirming issue' : 'Ignoring issue') + '</div>';
    return;
  }
  const outcome = decisions[current];
  if (outcome === 'pending' && !caseReadOnly) {
    footer.innerHTML = '<div class="review-actions"><button class="button quiet" id="dismiss">Ignore issue</button><button class="button primary" id="confirm">Confirm issue</button></div>';
    return;
  }
  footer.innerHTML = '<div class="footer-outcome">' + (caseReadOnly && outcome === 'pending' ? 'Not reviewed' : outcomeLabel(outcome)) + '</div>';
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
  if (application) {
    paper.innerHTML = applicationData(current);
    return;
  }
  if (!sourceOverride && !issue.pageNumber) {
    paper.innerHTML = '<div class="document-loading"><strong>No page evidence</strong><span>This issue was produced by a deterministic check of the submitted document set.</span></div>';
    return;
  }
  const source = selectedDocumentSource(issue);
  if (!source.document || !source.document.content_url) {
    paper.innerHTML = documentPaper(sourceOverride ? sourceOverride.kind : issue.paper);
    return;
  }
  paper.style.setProperty('--paper-scale', '1');
  paper.innerHTML = '<div class="document-loading">Loading page…</div>';
  void renderDocumentPage(source.document, source.pageNumber, ++documentRenderSequence);
}

function selectedDocumentSource(issue) {
  const documentRecord = sourceOverride?.document || issue.sourceDocument || apiDocuments[0];
  return { document: documentRecord, pageNumber: sourceOverride?.pageNumber || issue.pageNumber || 1 };
}

async function loadPdf(documentRecord) {
  if (!pdfDocuments.has(documentRecord.document_id)) {
    pdfDocuments.set(documentRecord.document_id, (async function () {
      const response = await fetch(documentRecord.content_url);
      if (!response.ok) throw new Error('Document could not be loaded');
      return getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
    })());
  }
  return pdfDocuments.get(documentRecord.document_id);
}

async function renderDocumentPage(documentRecord, pageNumber, sequence) {
  const paper = document.querySelector('#paper');
  try {
    if (documentRecord.media_type !== 'application/pdf') {
      if (sequence === documentRenderSequence) paper.innerHTML = '<div class="document-page-layer"><img class="source-image" src="' + escapeHtml(documentRecord.content_url) + '" alt="Submitted document">' + evidenceRegionMarkup(documentRecord, pageNumber) + '</div>';
      return;
    }
    const pdf = await loadPdf(documentRecord);
    const page = await pdf.getPage(Math.min(Math.max(pageNumber, 1), pdf.numPages));
    const viewport = page.getViewport({ scale: zoom / 100 });
    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    await page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }).promise;
    if (sequence !== documentRenderSequence) return;
    const layer = document.createElement('div');
    layer.className = 'document-page-layer';
    layer.append(canvas);
    const overlay = evidenceRegionElement(documentRecord, pageNumber);
    if (overlay) layer.append(overlay);
    paper.replaceChildren(layer);
  } catch {
    if (sequence === documentRenderSequence) paper.innerHTML = '<div class="document-loading error">Document preview unavailable</div>';
  }
}

function selectedRegion(documentRecord, pageNumber) {
  if (!activeEvidenceRegion || activeEvidenceRegion.evidence_type !== 'page_region') return null;
  if (activeEvidenceRegion.document_version_id !== documentRecord.document_id || activeEvidenceRegion.page_number !== pageNumber) return null;
  return activeEvidenceRegion.normalized_region;
}

function evidenceRegionElement(documentRecord, pageNumber) {
  const region = selectedRegion(documentRecord, pageNumber);
  if (!region) return null;
  const overlay = document.createElement('div');
  overlay.className = 'evidence-region-overlay';
  overlay.setAttribute('aria-label', 'Highlighted evidence region');
  overlay.style.left = (region.x * 100) + '%'; overlay.style.top = (region.y * 100) + '%';
  overlay.style.width = (region.width * 100) + '%'; overlay.style.height = (region.height * 100) + '%';
  return overlay;
}

function evidenceRegionMarkup(documentRecord, pageNumber) {
  const region = selectedRegion(documentRecord, pageNumber);
  if (!region) return '';
  return '<div class="evidence-region-overlay" aria-label="Highlighted evidence region" style="left:' + (region.x * 100) + '%;top:' + (region.y * 100) + '%;width:' + (region.width * 100) + '%;height:' + (region.height * 100) + '%"></div>';
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
      '<span class="issue-state ' + decision + '">' + marker + '</span><span class="issue-list-title"><strong>' + escapeHtml(issue.title) + '</strong><small>' +
      (issue.origin === 'human' ? 'Human created' : 'System generated') + '</small></span><em>' + state + '</em></button>' +
      (caseReadOnly || decision === 'dismissed' ? '' : '<button class="issue-edit" data-edit-index="' + index + '" aria-label="' + (decision === 'confirmed' ? 'Edit requested change for ' : 'Edit ') + escapeHtml(issue.title) + '">' + (decision === 'confirmed' ? 'Edit request' : 'Edit') + '</button>') + '</div>';
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
    button.addEventListener('click', function () {
      current = Number(button.dataset.editIndex);
      confirming = decisions[current] === 'confirmed';
      editing = !confirming;
      render();
    });
  });
}

function renderThumbnails(activePage) {
  const documentRecord = sourceOverride?.document || currentIssue().sourceDocument || apiDocuments[0];
  const pageCount = documentRecord ? documentRecord.page_count : 5;
  const sequence = ++thumbnailRenderSequence;
  document.querySelector('#thumbnails').innerHTML = Array.from({ length: pageCount }, function (_, index) { return index + 1; }).map(function (page) {
    return '<button class="thumbnail ' + (page === activePage ? 'active' : '') + '" data-page-number="' + page + '" aria-label="Page ' + page + '">' +
      '<span class="thumbnail-preview" data-thumbnail-page="' + page + '"><span class="thumbnail-placeholder"></span></span><small>' + page + '</small></button>';
  }).join('');
  if (documentRecord?.content_url) {
    Array.from({ length: pageCount }, function (_, index) { return index + 1; }).forEach(function (page) {
      void renderThumbnailPreview(documentRecord, page, sequence);
    });
  }
  document.querySelectorAll('.thumbnail').forEach(function (button) {
    button.addEventListener('click', function () {
      const pageNumber = Number(button.dataset.pageNumber);
      const selectedDocument = sourceOverride?.document || currentIssue().sourceDocument || apiDocuments[0];
      sourceOverride = {
        name: selectedDocument ? selectedDocument.submitted_filename : currentIssue().doc,
        page: 'Page ' + pageNumber + (selectedDocument ? ' of ' + selectedDocument.page_count : ''),
        pageNumber, document: selectedDocument, kind: pagePaperKind(pageNumber),
      };
      renderSource(currentIssue());
      renderThumbnails(pageNumber);
    });
  });
}

async function renderThumbnailPreview(documentRecord, pageNumber, sequence) {
  const target = document.querySelector('[data-thumbnail-page="' + pageNumber + '"]');
  if (!target) return;
  try {
    if (documentRecord.media_type !== 'application/pdf') {
      if (sequence === thumbnailRenderSequence) target.innerHTML = '<img src="' + escapeHtml(documentRecord.content_url) + '" alt="">';
      return;
    }
    const pdf = await loadPdf(documentRecord);
    const page = await pdf.getPage(Math.min(Math.max(pageNumber, 1), pdf.numPages));
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 76 / baseViewport.width });
    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    await page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }).promise;
    if (sequence === thumbnailRenderSequence && target.isConnected) target.replaceChildren(canvas);
  } catch {
    // Keep the neutral placeholder when a source preview cannot be rendered.
  }
}

function issueDetail(issue) {
  const values = issue.values.map(function (item, index) {
    const value = item.value;
    const evidenceControl = item.reference
      ? '<button class="evidence-link active" data-evidence-reference="' + encodeURIComponent(item.reference) + '">' + escapeHtml(item.source) + ' →</button>'
      : '<button class="evidence-link ' + (item.evidence ? 'active' : '') + '" data-legacy-evidence="' + Boolean(item.evidence) + '">View ' + escapeHtml(item.source) + '</button>';
    return '<article class="claim-card"><div class="claim-head"><span>' + escapeHtml(item.role) + '</span></div>' +
      '<small class="field-name">' + escapeHtml(item.label) + '</small><strong>' + escapeHtml(value) + '</strong>' + evidenceControl + '</article>';
  }).join('');
  const reviewedEvidence = values || '<article class="claim-card"><div class="claim-head"><span>Reviewer evidence note</span></div>' +
    '<strong>' + escapeHtml(issue.noReferenceReason || 'No supporting source was provided.') + '</strong></article>';
  return '<div class="review-prompt"><p>' + escapeHtml(issue.why) + '</p></div>' +
    '<div class="claim-comparison"><div class="block-label"><span>Evidence reviewed</span></div>' +
    reviewedEvidence + '</div>';
}

function confirmationForm(issue) {
  const note = reviewNotes[current] || issue.recommendation || 'Please describe what information or document you need the applicant to provide.';
  return '<div class="issue-heading"><button class="inline-back" id="cancel-confirm">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Confirm issue</span></div></div>' +
    '<form id="confirmation-form" class="correct-form"><label>Requested change<textarea rows="5" required>' + escapeHtml(note) + '</textarea></label>' +
    '<div class="revision-note"><strong>Applicant-facing draft</strong><span>Review and edit this message before confirming the issue. It is used only if you request changes.</span></div>' +
    '<div class="form-actions"><button type="button" class="button quiet" id="cancel-confirm-bottom">Cancel</button><button class="button primary">' + (decisions[current] === 'confirmed' ? 'Save requested change' : 'Save confirmation') + '</button></div></form>';
}

function evidencePickerLabel(reference) {
  const evidence = apiEvidenceByReference[reference];
  if (!evidence) return 'Unavailable source';
  if (evidence.evidence_type === 'structured_input') {
    const group = apiApplicationData?.groups.find(function (candidate) {
      return candidate.fields.some(function (field) { return field.json_pointer === evidence.json_pointer; });
    });
    const field = group?.fields.find(function (candidate) { return candidate.json_pointer === evidence.json_pointer; });
    return 'Application data — ' + (group ? group.group + ' / ' : '') + (field ? field.key.replaceAll('_', ' ') : evidence.json_pointer);
  }
  const documentRecord = apiDocuments.find(function (candidate) { return candidate.document_id === evidence.document_version_id; });
  return (documentRecord?.submitted_filename || 'Document') + ' — page ' + evidence.page_number;
}

function selectedEvidenceMarkup(references) {
  if (!references.length) return '<p class="evidence-picker-empty">No evidence selected</p>';
  return references.map(function (reference) {
    return '<div class="selected-evidence" data-selected-reference="' + escapeHtml(reference) + '"><span>' +
      escapeHtml(evidencePickerLabel(reference)) + '</span><button type="button" aria-label="Remove evidence">×</button></div>';
  }).join('');
}

function evidencePicker(issue) {
  const applicationOptions = [];
  const documentOptions = [];
  Object.keys(apiEvidenceByReference).forEach(function (reference) {
    const option = '<option value="' + escapeHtml(reference) + '">' + escapeHtml(evidencePickerLabel(reference)) + '</option>';
    if (apiEvidenceByReference[reference].evidence_type === 'structured_input') applicationOptions.push(option);
    else documentOptions.push(option);
  });
  return '<fieldset class="evidence-picker"><legend>Supporting evidence</legend><div class="evidence-picker-add"><select id="evidence-reference">' +
    '<option value="">Select a source</option>' +
    (applicationOptions.length ? '<optgroup label="Application data">' + applicationOptions.join('') + '</optgroup>' : '') +
    (documentOptions.length ? '<optgroup label="Documents">' + documentOptions.join('') + '</optgroup>' : '') +
    '<option value="__none__">No source available</option></select><button type="button" class="button quiet" id="add-evidence">Add</button></div>' +
    '<div id="selected-evidence">' + selectedEvidenceMarkup(issue.supportingReferences || []) + '</div>' +
    '<label id="no-source-reason"' + (issue.noReferenceReason ? '' : ' hidden') + '>Why no source is available' +
    '<textarea rows="3" placeholder="Explain why this issue has no supporting source">' + escapeHtml(issue.noReferenceReason || '') + '</textarea></label></fieldset>';
}

function correctionForm(issue) {
  return '<div class="issue-heading"><button class="inline-back" id="cancel">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Edit issue</span></div></div>' +
    '<form id="inline-form" class="correct-form"><label>Issue title<input value="' + escapeHtml(issue.title) + '" required></label>' +
    '<label>Issue description<textarea rows="4" required>' + escapeHtml(issue.why) + '</textarea></label>' +
    '<label>Requested change<textarea rows="4" required>' + escapeHtml(issue.recommendation || '') + '</textarea></label>' + evidencePicker(issue) +
    '<div class="form-actions"><button type="button" class="button quiet" id="cancel-bottom">Cancel</button><button class="button primary">Save issue</button></div></form>';
}

function ignoreForm() {
  return '<div class="issue-heading"><button class="inline-back" id="cancel-ignore">← Back to issue</button>' +
    '<div class="issue-kicker"><span class="finding-tone neutral">Ignore issue</span></div></div>' +
    '<form id="ignore-form" class="correct-form"><label>Note <span class="optional-label">Optional</span><textarea rows="4" placeholder="Add context for other reviewers"></textarea></label>' +
    '<div class="revision-note"><strong>Internal review record</strong><span>This note is not included in the applicant message.</span></div>' +
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
  const issue = issues[current];
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
  const selectedEvidence = document.querySelector('#selected-evidence');
  const noSourceReason = document.querySelector('#no-source-reason');
  function wireEvidenceRemoval() {
    selectedEvidence?.querySelectorAll('.selected-evidence button').forEach(function (button) {
      button.addEventListener('click', function () {
        button.closest('.selected-evidence').remove();
        if (!selectedEvidence.querySelector('.selected-evidence')) selectedEvidence.innerHTML = '<p class="evidence-picker-empty">No evidence selected</p>';
      });
    });
  }
  wireEvidenceRemoval();
  const addEvidence = document.querySelector('#add-evidence');
  if (addEvidence) addEvidence.addEventListener('click', function () {
    const select = document.querySelector('#evidence-reference');
    if (!select.value) return;
    if (select.value === '__none__') {
      selectedEvidence.innerHTML = '<p class="evidence-picker-empty">No evidence selected</p>';
      noSourceReason.hidden = false;
      noSourceReason.querySelector('textarea').required = true;
      return;
    }
    noSourceReason.hidden = true;
    noSourceReason.querySelector('textarea').required = false;
    noSourceReason.querySelector('textarea').value = '';
    const existing = [...selectedEvidence.querySelectorAll('[data-selected-reference]')].some(function (item) { return item.dataset.selectedReference === select.value; });
    if (existing) return;
    selectedEvidence.querySelector('.evidence-picker-empty')?.remove();
    selectedEvidence.insertAdjacentHTML('beforeend', selectedEvidenceMarkup([select.value]));
    wireEvidenceRemoval();
  });
  if (form) form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const textareas = event.currentTarget.querySelectorAll('textarea');
    const title = event.currentTarget.querySelector('input').value.trim();
    const description = textareas[0].value.trim();
    const recommendation = textareas[1].value.trim();
    const supportingReferences = [...event.currentTarget.querySelectorAll('[data-selected-reference]')].map(function (item) { return item.dataset.selectedReference; });
    const noReferenceReason = noSourceReason?.querySelector('textarea').value.trim() || '';
    if (!supportingReferences.length && !noReferenceReason) {
      toast('Select supporting evidence or explain why no source is available');
      return;
    }
    if (!apiCaseRecord || !apiReport?.result_revision) return;
    try {
      if (creatingIssue) {
        const result = await createIssue(apiCaseRecord.case_id, {
          result_revision_id: apiReport.result_revision.id, command_id: crypto.randomUUID(),
          expected_case_version: apiCaseRecord.version, title, description,
          recommended_action: recommendation, supporting_references: supportingReferences,
          ...(supportingReferences.length ? {} : { no_reference_reason: noReferenceReason }),
        });
        apiCaseRecord.version = result.case_version;
        document.querySelector('#demo-launch').hidden = true;
        issue.issueId = result.issue_id;
        issue.version = result.version;
        issue.origin = 'human';
      } else {
        const result = await editIssue(apiCaseRecord.case_id, issue.issueId, {
          result_revision_id: apiReport.result_revision.id, command_id: crypto.randomUUID(),
          expected_issue_version: issue.version, title, description, recommended_action: recommendation,
          supporting_references: supportingReferences,
          ...(supportingReferences.length ? {} : { no_reference_reason: noReferenceReason }),
        });
        issue.version = result.version;
      }
      issue.title = title;
      issue.why = description;
      issue.recommendation = recommendation;
      issue.supportingReferences = supportingReferences;
      issue.noReferenceReason = noReferenceReason;
      creatingIssue = false;
      editing = false;
      render();
      toast('Issue saved');
    } catch (error) {
      showReviewError(error, 'Issue could not be saved');
    }
  });
  document.querySelectorAll('.evidence-link').forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.dataset.evidenceReference) {
        openEvidenceReference(decodeURIComponent(button.dataset.evidenceReference));
        return;
      }
      sourceView = button.dataset.legacyEvidence === 'true' ? 'document' : 'application';
      sourceOverride = null;
      renderSource(currentIssue());
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
    activeEvidenceRegion = null;
    renderSource(currentIssue());
    toast('Application field selected');
    return;
  }
  const documentRecord = apiDocuments.find(function (item) { return item.document_id === evidence.document_version_id; }) || apiDocuments[0];
  const pageNumber = evidence.page_number;
  sourceView = 'document';
  activeApplicationPointer = null;
  activeEvidenceRegion = evidence.evidence_type === 'page_region' ? evidence : null;
  sourceOverride = {
    name: documentRecord ? documentRecord.submitted_filename : 'Submitted document',
    page: 'Page ' + pageNumber + (documentRecord ? ' of ' + documentRecord.page_count : ''),
    pageNumber, document: documentRecord, kind: pagePaperKind(pageNumber),
  };
  renderSource(currentIssue());
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
    if (kind === 'confirmed') { reviewNotes[current] = noteOrReason; includedRequests[current] = true; }
    decide(kind);
    return;
  }
  try {
    if (kind === 'confirmed' && decisions[current] === 'confirmed') {
      const draft = await saveRequestedChange(apiCaseRecord.case_id, issue.issueId, {
        result_revision_id: apiReport.result_revision.id,
        command_id: crypto.randomUUID(), text: noteOrReason, included: includedRequests[current] === true,
      });
      issue.requestedChange = { draft_revision_id: draft.draft_revision_id, revision: draft.revision, text: noteOrReason, included: includedRequests[current] === true };
      reviewNotes[current] = noteOrReason;
      confirming = false;
      render();
      toast('Requested change saved');
      return;
    }
    const result = await resolveIssue(apiCaseRecord.case_id, issue.issueId, kind === 'confirmed' ? 'confirm' : 'ignore', {
      result_revision_id: apiReport.result_revision.id,
      command_id: crypto.randomUUID(),
      expected_issue_version: issue.version,
      ...(kind === 'dismissed' && noteOrReason ? { reason: noteOrReason } : {}),
    });
    issue.version = result.version;
    if (kind === 'confirmed') {
      const draft = await saveRequestedChange(apiCaseRecord.case_id, issue.issueId, {
        result_revision_id: apiReport.result_revision.id,
        command_id: crypto.randomUUID(), text: noteOrReason, included: true,
      });
      issue.requestedChange = { draft_revision_id: draft.draft_revision_id, revision: draft.revision, text: noteOrReason, included: true };
      reviewNotes[current] = noteOrReason;
      includedRequests[current] = true;
    }
    ignoring = false;
    decide(kind);
  } catch (error) {
    showReviewError(error, 'Review decision could not be saved');
  }
}

function outcomeLabel(value) { return value === 'pending' ? 'Pending' : value === 'dismissed' ? 'Ignored' : value === 'edited' ? 'Edited & confirmed' : 'Confirmed'; }

function renderSummary() {
  document.querySelector('#summary-issues').innerHTML = issues.map(function (issue, index) {
    const canRequest = Boolean(reviewNotes[index]) && (decisions[index] === 'confirmed' || decisions[index] === 'edited');
    const included = includedRequests[index] !== false;
    const marker = decisions[index] === 'pending' ? '!' : decisions[index] === 'dismissed' ? '×' : '✓';
    return '<div class="summary-issue-row ' + (canRequest && !included ? 'excluded' : '') + '"><button data-summary-issue="' + index + '"><span class="summary-state ' + decisions[index] + '">' + marker + '</span><span><strong>' +
      escapeHtml(issue.title) + '</strong><small>' + outcomeLabel(decisions[index]) + '</small></span><i>→</i></button>' + (canRequest ? '<label><input type="checkbox" data-request-include="' + index + '" ' + (included ? 'checked' : '') + (caseReadOnly ? ' disabled' : '') + '> Include in message</label>' : '') + '</div>';
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
          showReviewError(error, 'Requested change could not be saved');
        }
      }
    });
  });
  updateApplicantPreview();
  const internalNote = document.querySelector('#internal-review-note');
  internalNote.value = internalReviewNote;
  internalNote.disabled = caseReadOnly;
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
    button.disabled = caseReadOnly || incomplete || (action === 'changes' && !hasRequest) || (action === 'clear' && hasRequest);
    button.title = incomplete ? 'Review every issue before submitting' : action === 'changes' && !hasRequest ? 'Include an applicant request to use this action' : action === 'clear' && hasRequest ? 'Remove or exclude applicant requests to complete the review' : '';
  });
}

searchInput.addEventListener('input', function () { currentQueuePage = 1; renderCases(); });
document.querySelectorAll('.filter').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('.filter').forEach(function (item) { item.classList.remove('active'); });
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    currentQueuePage = 1;
    renderCases();
  });
});
document.querySelector('#queue-page-previous').addEventListener('click', function () {
  if (currentQueuePage > 1) { currentQueuePage -= 1; renderCases(); }
});
document.querySelector('#queue-page-next').addEventListener('click', function () {
  currentQueuePage += 1;
  renderCases();
});
document.querySelector('#queue-nav').addEventListener('click', function () { void refreshQueue('review'); });
document.querySelector('#changes-nav').addEventListener('click', function () { void refreshQueue('changes_requested'); });
document.querySelector('#completed-nav').addEventListener('click', function () { void refreshQueue('completed'); });
document.querySelector('#back').addEventListener('click', function () { void refreshQueue(activeQueueView); });
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
  if (caseReadOnly) return;
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
  button.addEventListener('click', function () { sourceView = button.dataset.sourceView; sourceOverride = null; renderSource(currentIssue()); });
});
const panelResizer = document.querySelector('#panel-resizer');
const reviewLayout = document.querySelector('.review-layout');
function setReviewWidth(pointerX) {
  const bounds = reviewLayout.getBoundingClientRect();
  const minimumWidth = Math.min(400, Math.max(320, bounds.width - 426));
  const maximumWidth = Math.max(minimumWidth, Math.min(720, bounds.width - 426));
  const width = Math.max(minimumWidth, Math.min(maximumWidth, bounds.right - pointerX));
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
  const currentWidth = document.querySelector('.review-panel').getBoundingClientRect().width;
  const nextWidth = currentWidth + (event.key === 'ArrowLeft' ? 24 : -24);
  setReviewWidth(reviewLayout.getBoundingClientRect().right - nextWidth);
  event.preventDefault();
});
window.addEventListener('resize', function () {
  if (!reviewLayout.style.getPropertyValue('--review-width')) return;
  const currentWidth = document.querySelector('.review-panel').getBoundingClientRect().width;
  setReviewWidth(reviewLayout.getBoundingClientRect().right - currentWidth);
});
function updateZoom(delta) {
  zoom = Math.max(68, Math.min(124, zoom + delta));
  document.querySelector('#zoom-label').textContent = zoom + '%';
  const source = selectedDocumentSource(currentIssue());
  if (sourceView === 'document' && source.document?.content_url) {
    void renderDocumentPage(source.document, source.pageNumber, ++documentRenderSequence);
  } else {
    document.querySelector('#paper').style.setProperty('--paper-scale', zoom / 92);
  }
}
document.querySelector('#refresh-queue').addEventListener('click', async function (event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.innerHTML = '<span class="spin">↻</span> Refreshing';
  try {
    await Promise.all([refreshQueue(activeQueueView), updateAllQueueCounts()]);
    toast('Queue refreshed');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Queue could not be refreshed');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>↻</span> Refresh';
  }
});

document.querySelector('#load-demo-case').addEventListener('click', async function (event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Generating case…';
  try {
    const [prepared, models] = await Promise.all([prepareDemoCase(), loadDemoAgentModels()]);
    renderDemoAgentModels(models);
    setDemoPreview(prepared);
    document.querySelector('#run-agent-review').hidden = true;
    const created = await startDemoCase(prepared, models.default_model, fetch, false);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(created.status_url);
      if (!response.ok) throw new Error('Generated case status could not be loaded');
      const status = await response.json();
      if (status.lifecycle === 'ready_for_review') break;
      if (status.lifecycle !== 'processing') throw new Error('Generated case preparation failed');
      if (attempt === 119) throw new Error('Generated case preparation timed out');
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
    }
    preparedDemoCase = null;
    window.history.replaceState({}, '', '?case_id=' + encodeURIComponent(created.case_id) + '&queue_view=review');
    await loadCaseFromApi();
    button.disabled = false;
    button.textContent = 'Generate demo case';
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Demo case could not be generated');
    button.disabled = false;
    button.textContent = 'Generate demo case';
  }
});

document.querySelector('#run-agent-review').addEventListener('click', async function (event) {
  const button = event.currentTarget;
  const persistedManualCase = apiReport?.failure_reason === 'agent_not_run' ? apiCaseRecord : null;
  if (!preparedDemoCase && !persistedManualCase) return;
  const model = selectedDemoAgentModel();
  if (!model) return;
  if (model.paid && !await confirmPaidAgentRun(model)) return;
  let createdCase = null;
  button.disabled = true;
  button.textContent = 'Agent review in progress…';
  document.querySelector('#agent-model').disabled = true;
  document.querySelector('.agent-model-field').hidden = true;
  document.querySelector('#persisted-agent-log').hidden = true;
  document.querySelector('#demo-preview').classList.add('running');
  updateWorkflowProgress('preparing');
  try {
    createdCase = persistedManualCase
      ? await startPersistedAgentReview(persistedManualCase.case_id, model.id)
      : await startDemoCase(preparedDemoCase, model.id);
    if (persistedManualCase && !createdCase.started) throw new Error('Agent review cannot be started after human review activity');
    button.hidden = true;
    renderPendingAgentLog(null, model.label, null, createdCase);
    await followAgentRun(createdCase, model.label);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Agent review could not be started');
    if (createdCase) {
      document.querySelector('#demo-preview').classList.remove('running');
      window.history.replaceState({}, '', '?case_id=' + encodeURIComponent(createdCase.case_id) + '&queue_view=review');
      await loadCaseFromApi();
    } else {
      document.querySelector('#demo-preview').classList.remove('running');
      document.querySelector('.agent-model-field').hidden = false;
      button.disabled = false;
      button.hidden = false;
      button.textContent = 'Run agent review';
      document.querySelector('#agent-model').disabled = false;
    }
  }
});


const reportContent = document.querySelector('[data-view="report"]');
const submitContent = document.querySelector('#summary .summary-wrap');
reportContent.classList.remove('drawer-view', 'active');
document.querySelector('[data-case-view="report"]').appendChild(reportContent);
document.querySelector('[data-case-view="submit"]').appendChild(submitContent);
document.querySelector('#details').remove();
document.querySelector('#summary').remove();

function activateCaseTab(view) {
  const requested = document.querySelector('[data-case-tab="' + view + '"]');
  if (requested?.disabled) return;
  document.querySelectorAll('[data-case-tab]').forEach(function (button) { button.classList.toggle('active', button.dataset.caseTab === view); });
  document.querySelectorAll('[data-case-view]').forEach(function (panel) { panel.classList.toggle('active', panel.dataset.caseView === view); });
  if (view === 'agent-log') requestAnimationFrame(function () {
    document.querySelectorAll('[data-case-view="agent-log"].active .pending-agent-log, [data-case-view="agent-log"].active .agent-run-events').forEach(function (host) {
      const timeline = host.querySelector('.agent-run-timeline');
      if (timeline && host.dataset.followLatest !== 'false') timeline.scrollTop = timeline.scrollHeight;
    });
  });
  if (view === 'submit') renderSummary();
}
document.querySelectorAll('[data-case-tab]').forEach(function (button) {
  button.addEventListener('click', function () { if (!button.disabled) activateCaseTab(button.dataset.caseTab); });
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
    let savedAction = null;
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
        savedAction = result.action;
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Final review could not be saved');
        return;
      }
    }
    document.querySelectorAll('.case-action').forEach(function (item) { item.disabled = true; });
    button.textContent = button.dataset.caseAction === 'clear' ? 'Document review completed' : button.dataset.caseAction === 'changes' ? 'Changes requested' : 'Review escalated';
    applyFinalOutcome(button.dataset.caseAction === 'clear' ? 'clear_for_downstream' : button.dataset.caseAction === 'changes' ? 'request_changes' : 'escalate_review');
    toast(button.textContent);
    if (savedAction) {
      const targetView = savedAction === 'clear_for_downstream' ? 'completed' : savedAction === 'request_changes' ? 'changes_requested' : 'review';
      await Promise.all([refreshQueue(targetView), updateAllQueueCounts()]);
    }
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

function showReviewError(error, fallback) {
  if (error instanceof Error && error.code === 'stale_review') {
    toast('This issue has changed. Refresh to review the latest version.', 'Refresh issue', async function () {
      await loadCaseFromApi();
      activateCaseTab('issues');
    });
    return;
  }
  toast(error instanceof Error ? error.message : fallback);
}

function toast(message, actionLabel, action) {
  const element = document.querySelector('#toast');
  element.replaceChildren(document.createTextNode(message));
  if (actionLabel && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', async function () {
      clearTimeout(toast.timer);
      element.classList.remove('show');
      await action();
    });
    element.appendChild(button);
  }
  element.classList.toggle('actionable', Boolean(action));
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { element.classList.remove('show'); }, action ? 8000 : 2400);
}

function issuePresentation(record, finding, index) {
  const presentation = presentIssue(record, finding, index, apiDocuments, apiEvidenceByReference);
  const references = presentation.references;
  return {
    issueId: record.issue_id, version: record.version, requestedChange: record.requested_change,
    origin: record.origin,
    supportingReferences: references,
    noReferenceReason: presentation.noReferenceReason,
    code: record.code, type: presentation.type, tone: presentation.tone, title: presentation.title,
    why: record.description, recommendation: record.recommended_action,
    doc: presentation.sourceLabel,
    page: presentation.pageLabel,
    sourceDocument: presentation.sourceDocument,
    pageNumber: presentation.pageNumber, paper: presentation.pageNumber ? pagePaperKind(presentation.pageNumber) : 'boundary',
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

function reportFailureMessage(reason) {
  const messages = {
    policy_rejected_loan_approval: 'The Agent recommended approving the loan, which violates the policy that final lending decisions require an authorized reviewer. Please contact the developer.',
    policy_rejected_loan_rejection: 'The Agent recommended declining or rejecting the loan, which violates the policy that final lending decisions require an authorized reviewer. Please contact the developer.',
    policy_rejected_creditworthiness: 'The Agent made a creditworthiness judgment, which is outside its document-review authority. Please contact the developer.',
    policy_rejected_aml_kyc_decision: 'The Agent made a final AML or KYC decision, which requires an authorized reviewer. Please contact the developer.',
    policy_rejected_account_or_disbursement: 'The Agent proposed opening an account or disbursing funds, which is outside its authority. Please contact the developer.',
    policy_rejected_customer_contact: 'The Agent stated that the applicant or customer was contacted, which is outside its authority. Please contact the developer.',
    schema_rejected: 'The submitted report did not match the required format.',
    reference_rejected: 'The submitted report contained invalid evidence references.',
    timeout: 'Report generation timed out.', unavailable: 'Report generation was unavailable.',
  };
  return messages[reason] || 'Report verification failed.';
}

function renderApiReport(report) {
  document.querySelector('.report-copy').textContent = report.availability === 'unavailable'
    ? 'Agent report unavailable. Reason: ' + reportFailureMessage(report.failure_reason) + ' System-generated review issues remain available for manual review.'
    : (report.summary || 'Agent report unavailable.');
  document.querySelector('.report-links').innerHTML = issues.map(function (issue, index) { return { issue, index }; })
    .filter(function (entry) {
      return report.availability === 'unavailable' ? entry.issue.origin === 'system' : entry.issue.origin === 'agent';
    }).map(function (entry) {
    const issue = entry.issue;
    const index = entry.index;
    const originLabel = report.availability === 'unavailable' ? '<small>System detected</small>' : '';
    return '<button data-report-issue="' + index + '"><b>' + String(index + 1).padStart(2, '0') + '</b><span><strong>' + escapeHtml(issue.title) + '</strong>' + originLabel + '</span><em>→</em></button>';
  }).join('');
  document.querySelector('.checked-facts').innerHTML = report.checked_facts.map(function (fact, index) {
    const availableReferences = fact.references.filter(function (reference) { return apiEvidenceByReference[reference]; });
    const expanded = expandedCheckedFacts.has(index);
    const directReference = availableReferences.length === 1 ? availableReferences[0] : '';
    const canExpand = fact.references.length > 1;
    const sourceRows = fact.references.map(function (reference) {
      const source = evidencePresentation(reference);
      const available = Boolean(apiEvidenceByReference[reference]);
      return '<button class="checked-source" data-checked-reference="' + encodeURIComponent(reference) + '" ' + (available ? '' : 'disabled') + '>' +
        '<span><strong>' + escapeHtml(source.role) + '</strong><small>' + escapeHtml(source.label + ': ' + source.value) + '</small></span><b>' + (available ? '→' : 'Unavailable') + '</b></button>';
    }).join('');
    return '<article class="checked-fact ' + (expanded ? 'expanded' : '') + '"><button class="checked-fact-summary" ' +
      (fact.references.length === 1 && directReference ? 'data-checked-reference="' + encodeURIComponent(directReference) + '"' : canExpand ? 'data-checked-fact-toggle="' + index + '" aria-expanded="' + expanded + '"' : 'disabled') + '>' +
      '<i>✓</i><span><strong>' + escapeHtml(fact.statement) + '</strong><small>' + fact.references.length + ' source' + (fact.references.length === 1 ? '' : 's') + ' checked</small></span>' +
      '<b>' + (fact.references.length === 1 && directReference ? '→' : canExpand ? expanded ? '⌃' : '⌄' : 'Unavailable') + '</b></button>' +
      (canExpand && expanded ? '<div class="checked-sources">' + sourceRows + '</div>' : '') + '</article>';
  }).join('');
  wireReportNavigation();
}

function renderAgentLog() {
  if (!apiAgentLog) return;
  const modelLabel = apiAgentLog.model_label && apiAgentLog.model_label.startsWith('findoc-fake/')
    ? 'Deterministic demo model'
    : (apiAgentLog.model_label || 'Unavailable');
  const stopped = apiReport?.failure_reason === 'reviewer_stopped_agent' || apiAgentLog.session?.terminal_reason === 'cancelled_by_workflow';
  const notRun = apiReport?.failure_reason === 'agent_not_run';
  const completed = apiReport?.availability === 'ready';
  const state = notRun ? 'Not run' : stopped ? 'Stopped' : completed ? 'Completed' : 'Running';
  const cost = apiAgentLog.estimated_cost
    ? apiAgentLog.estimated_cost.currency + ' ' + apiAgentLog.estimated_cost.amount
    : notRun ? '—' : completed || stopped ? 'Cost unavailable' : '';
  const persisted = document.querySelector('#persisted-agent-log');
  persisted.classList.toggle('completed', completed);
  document.querySelectorAll('.agent-log-meta').forEach(function (element) { element.hidden = true; });
  const reportOutcome = stopped
    ? '<div class="agent-log-outcome stopped"><span>Agent stopped by reviewer</span><small>Human review remains available</small></div>'
    : !notRun && apiReport && apiReport.availability === 'unavailable'
    ? '<div class="agent-log-outcome rejected"><span>Report rejected by verifier</span><small>' +
      escapeHtml(reportFailureMessage(apiReport.failure_reason)) + '</small></div>'
    : apiReport && apiReport.availability === 'ready'
      ? '<div class="agent-log-outcome ready"><span>Report ready</span></div>' : '';
  const eventMarkup = agentRunMarkup(apiAgentLog, modelLabel, state, cost, !notRun) + reportOutcome +
    (apiCaseRecord?.lifecycle === 'processing' ? '<button class="button quiet agent-stop inline-agent-stop">Stop Agent review</button>' : '');
  document.querySelectorAll('.agent-run-events').forEach(function (element) { replaceAgentRunMarkup(element, eventMarkup); });
  document.querySelectorAll('.inline-agent-stop').forEach(function (button) {
    button.addEventListener('click', async function () {
      await requestAgentStop(apiCaseRecord.case_id, button, async function () { await loadCaseFromApi(); });
    });
  });
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
  document.querySelectorAll('[data-checked-fact-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      const index = Number(button.dataset.checkedFactToggle);
      if (expandedCheckedFacts.has(index)) expandedCheckedFacts.delete(index);
      else expandedCheckedFacts.add(index);
      renderApiReport(apiReport);
    });
  });
}

async function loadCaseFromApi() {
  const caseId = new URLSearchParams(window.location.search).get('case_id');
  if (!caseId) return;
  try {
    leaveDemoPreview();
    const bundle = await loadCaseBundle(caseId);
    const caseRecord = bundle.caseRecord;
    const report = bundle.report;
    apiCaseRecord = caseRecord;
    apiReport = report;
    expandedCheckedFacts.clear();
    caseReadOnly = Boolean(caseRecord.final_review_action);
    const findings = bundle.findings;
    const issueRecords = bundle.issues;
    apiApplicationData = bundle.applicationData;
    apiDocuments = bundle.documents;
    apiEvidenceByReference = bundle.evidenceByReference;
    apiAgentLog = bundle.agentLog;
    if (sourceView === 'document' && apiDocuments[0]) {
      const documentRecord = apiDocuments[0];
      const pageNumber = Math.min(Math.max(sourceOverride?.pageNumber || 1, 1), documentRecord.page_count);
      sourceOverride = {
        name: documentRecord.submitted_filename,
        page: 'Page ' + pageNumber + ' of ' + documentRecord.page_count,
        pageNumber, document: documentRecord, kind: pagePaperKind(pageNumber),
      };
      activeEvidenceRegion = null;
    }
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
    document.querySelectorAll('.case-id').forEach(function (element) { element.textContent = caseRecord.case_code; });
    document.querySelectorAll('.case-identity strong').forEach(function (element) { element.textContent = caseRecord.applicant_display_name; });
    const statusBadge = document.querySelector('.status-badge');
    statusBadge.textContent = caseRecord.final_review_action === 'clear_for_downstream' ? 'Ready for handoff'
      : caseRecord.final_review_action === 'request_changes' ? 'Changes requested'
        : caseRecord.final_review_action === 'escalate_review' ? 'Review escalated' : 'Review required';
    document.querySelector('[data-case-tab="issues"] span').textContent = String(issues.length);
    document.querySelector('#create-issue').hidden = caseReadOnly;
    document.querySelectorAll('.case-action').forEach(function (button) { button.hidden = caseReadOnly; });
    renderApiReport(report);
    renderAgentLog();
    render();
    const agentStopped = apiAgentLog.session?.terminal_reason === 'cancelled_by_workflow' || report.failure_reason === 'reviewer_stopped_agent';
    const agentNotRun = report.failure_reason === 'agent_not_run';
    setCaseTabsAvailability(report.availability === 'ready', agentStopped || caseRecord.lifecycle === 'ready_for_review' || caseRecord.lifecycle === 'review_complete');
    if (agentStopped && !caseRecord.final_review_action) renderStoppedAgentActions(caseId);
    if (agentNotRun && !caseRecord.final_review_action) {
      document.querySelector('#demo-launch').hidden = false;
      document.querySelector('.agent-model-field').hidden = false;
      document.querySelector('#agent-model').disabled = false;
      const runButton = document.querySelector('#run-agent-review');
      runButton.hidden = false; runButton.disabled = false; runButton.textContent = 'Run agent review';
    }
    updateWorkflowProgress(caseRecord.lifecycle === 'processing' ? (apiAgentLog.session ? 'processing' : 'preparing')
      : agentNotRun ? 'manual_review' : agentStopped ? 'stopped' : 'review');
    if (caseRecord.final_review_action) {
      applyFinalOutcome(caseRecord.final_review_action);
    }
    show('workspace');
    activateCaseTab(caseRecord.lifecycle === 'processing' || report.availability !== 'ready' ? 'agent-log' : 'report');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Case data could not be loaded');
  }
}

wireReportNavigation();
renderCases();
render();
void refreshQueue(activeQueueView, false);
void updateAllQueueCounts();
void loadDemoAgentModels().then(renderDemoAgentModels).catch(function () {
  document.querySelector('#runtime-model-label').textContent = 'Agent model unavailable';
});
void loadCaseFromApi();
