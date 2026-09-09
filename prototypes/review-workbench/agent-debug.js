const host = document.querySelector('#trace');
const form = document.querySelector('#case-form');
const input = document.querySelector('#case-id');
const params = new URLSearchParams(window.location.search);
input.value = params.get('case_id') || '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character];
  });
}

function shortHash(value) {
  return value ? value.slice(0, 14) + (value.length > 14 ? '…' : '') : '—';
}

function metric(label, value, detail = '') {
  return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong>' + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</div>';
}

function render(trace) {
  if (trace.availability !== 'available' || !trace.session) {
    host.innerHTML = '<p class="empty">No Agent session has been persisted for this case yet.</p>';
    return;
  }
  const session = trace.session;
  const usage = session.usage || {};
  const steps = trace.steps.map(function (step) {
    const output = step.output
      ? metric('Output digest', shortHash(step.output.hash), step.output.retention === 'hash_only' ? 'Payload not retained' : 'Bounded safe result retained') : '';
    const preview = step.output?.preview && Object.keys(step.output.preview).length
      ? '<details class="result-preview"><summary>Safe result preview</summary><pre>' + escapeHtml(JSON.stringify(step.output.preview, null, 2)) + '</pre></details>' : '';
    const references = step.produced_references.length
      ? '<div class="references"><span>Produced references</span>' + step.produced_references.map(function (reference) {
          return '<code title="' + escapeHtml(reference.id) + '">' + escapeHtml(reference.kind) + ':' + escapeHtml(shortHash(reference.id)) + '</code>';
        }).join('') + '</div>' : '';
    return '<article class="step"><header><b>' + String(step.sequence).padStart(2, '0') + '</b><div><h3>' + escapeHtml(step.tool_name) + '</h3><span>' +
      escapeHtml(step.phase.replaceAll('_', ' ')) + ' · ' + escapeHtml(step.outcome.replaceAll('_', ' ')) + (step.reused ? ' · reused' : '') + '</span></div></header>' +
      '<p>' + escapeHtml(step.summary) + '</p><div class="step-meta">' +
      metric('Input digest', shortHash(step.argument_hash), step.tool_version || '') + output +
      metric('Budget after call', step.budget_state.tool_calls_used + ' tools', step.budget_state.iterations_used + ' iterations') +
      '</div>' + preview + references + '</article>';
  }).join('');
  const attempts = trace.attempts.map(function (attempt) {
    return '<span class="attempt"><strong>Attempt ' + attempt.attempt_number + '</strong>' + escapeHtml(attempt.start_reason) + ' · ' + escapeHtml(attempt.status) + '</span>';
  }).join('');
  const returned = trace.final_submission
    ? '<section><h2>Agent return</h2><div class="return"><strong>' + escapeHtml(trace.final_submission.summary) + '</strong><span>' +
      trace.final_submission.issue_count + ' issues · ' + trace.final_submission.checked_fact_count + ' checked facts · ' +
      escapeHtml(trace.final_submission.verification_status || 'not verified') + '</span></div></section>' : '';
  host.innerHTML = '<aside class="notice"><strong>Safe developer trace</strong><span>Raw provider messages, chain-of-thought, document text, and page images are intentionally not retained.</span></aside>' +
    '<section><h2>Prompt and run</h2><div class="metrics">' +
      metric('Prompt received', session.prompt.version, shortHash(session.prompt.hash)) +
      metric('Control input', session.context_manifest_version || 'Not recorded', 'Trusted identifiers; no document text') +
      metric('Model', session.model_label, session.model_route) +
      metric('Model turns', usage.modelCalls || 0, (usage.inputTokens || 0) + ' input · ' + (usage.outputTokens || 0) + ' output tokens') +
      metric('Tool registry', session.tool_registry_version, session.offered_tools.length + ' tools') +
      metric('Session', shortHash(session.session_id), session.terminal_reason || 'running') +
    '</div><details><summary>Tools available to the Agent</summary><p class="tool-list">' + session.offered_tools.map(escapeHtml).join(' · ') + '</p></details>' +
    '<div class="attempts">' + attempts + '</div></section>' +
    '<section><h2>Tool calls</h2><div class="steps">' + (steps || '<p class="empty">No tool calls are committed yet.</p>') + '</div></section>' + returned;
}

async function load(caseId) {
  host.innerHTML = '<p class="empty">Loading durable trace…</p>';
  try {
    const response = await fetch('/api/internal/dev/cases/' + encodeURIComponent(caseId) + '/agent-trace');
    if (response.status === 404) throw new Error('Developer diagnostics are disabled, or the case does not exist.');
    if (!response.ok) throw new Error('The Agent trace could not be loaded.');
    render(await response.json());
  } catch (error) {
    host.innerHTML = '<p class="empty error">' + escapeHtml(error.message) + '</p>';
  }
}

form.addEventListener('submit', function (event) {
  event.preventDefault();
  const caseId = input.value.trim();
  if (!caseId) return;
  window.history.replaceState({}, '', '?case_id=' + encodeURIComponent(caseId));
  void load(caseId);
});

if (input.value) void load(input.value);
