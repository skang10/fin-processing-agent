# Financial Document AI Agent Observability and Failures Specification

Document ID: `OPS`

Version: 1.0.0

Status: Approved

Last updated: 2026-09-05

## 1. Purpose

This specification defines the minimum operational visibility and failure behavior required for the first V1 vertical slice. It deliberately limits the initial implementation to structured Pino logs, basic OpenTelemetry trace correlation, durable workflow and attempt state, explicit failures, bounded retries, and the reviewer-safe case Agent log.

Prometheus dashboards, Jaeger deployment, alerting, aggregate Agent monitoring, production Service Level Objectives, and incident-management systems are deferred.

## 2. Authority and Dependencies

This document owns operational log, trace, failure-classification, retry, degradation, and diagnostic-projection behavior.

It depends on [`../INDEX.md`](../INDEX.md), [`../SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md), [`../DATA_MODEL.md`](../DATA_MODEL.md), [`../API_CONTRACTS.md`](../API_CONTRACTS.md), [`../SECURITY_AND_LIMITATIONS.md`](../SECURITY_AND_LIMITATIONS.md), [`../components/DOCUMENT_PROCESSING.md`](../components/DOCUMENT_PROCESSING.md), [`../components/ADAPTIVE_EXTRACTION_AGENT.md`](../components/ADAPTIVE_EXTRACTION_AGENT.md), and [`../../LIMITATIONS.md`](../../LIMITATIONS.md).

`OPS-REQ-001` Operational telemetry must not become authoritative case, run, result, finding, disposition, review, or audit state.

`OPS-REQ-002` V1 operational behavior must not imply a production availability, latency, recovery, support, or incident-response commitment.

## 3. Minimal V1 Observability

`OPS-REQ-003` API and worker processes must emit structured Pino logs with stable event names and severity levels.

`OPS-REQ-004` The first vertical slice must propagate basic OpenTelemetry trace context across the API request, accepted workflow work, worker stage, model call, Agent session, and review command when applicable.

`OPS-REQ-005` Each operational event must include only the correlation identifiers needed for diagnosis, such as request, trace, case, run, stage, attempt, job, Agent session, model invocation, or review command identity.

`OPS-REQ-006` Correlation identifiers must be opaque and must not embed applicant names, filenames, document values, identity numbers, IBANs, or other document content.

`OPS-REQ-007` Logs and traces must not contain complete documents, page images, unrestricted extracted text, prompts containing document content, chain-of-thought, credentials, provider payloads, full identity-document numbers, or full IBANs.

`OPS-REQ-008` Logging a failure must use a stable category and safe bounded message; raw exception text may be retained only in a restricted development console when it passes configured redaction and is not persisted as domain data.

`OPS-REQ-009` A telemetry-backend failure must not broaden authority, block already durable core processing, or trigger unrestricted payload logging.

## 4. Failure Record

`OPS-REQ-010` A structured operational failure must identify category, operation, owning component, retryability, occurred time, affected case and run when applicable, stage attempt when applicable, and request or trace correlation.

`OPS-REQ-011` Failure categories must come from the owning component contract; free-form messages must not determine retry, disposition, or review routing.

`OPS-REQ-012` An unexpected exception must map to a stable internal failure category while preserving a safe correlation reference for diagnosis.

`OPS-REQ-013` Public error responses must use `API_CONTRACTS.md` and must not expose internal failure payloads or stack traces.

`OPS-REQ-014` One partition failure must identify the affected document, page, region, or stage partition and must not erase independently committed valid outputs.

## 5. Workflow and Attempt Visibility

`OPS-REQ-015` PostgreSQL processing-run, stage-execution, and attempt records are the authoritative source for workflow progress and retry history.

`OPS-REQ-016` A stage attempt must record start, completion, outcome, processor version, input identity, output or failure reference, and trace identity when available.

`OPS-REQ-017` A worker crash or lost lease must remain distinguishable from a domain processing failure.

`OPS-REQ-018` Redelivery of the same logical job must resolve through stage and output idempotency without creating duplicate authoritative results.

`OPS-REQ-019` The Review Workbench must use polling against authoritative API projections and must not reconstruct workflow state from logs, traces, or worker memory.

## 6. Retry and Recovery

`OPS-REQ-020` Only failures classified by trusted component or adapter policy as retryable may be retried automatically.

`OPS-REQ-021` Every automatic retry policy must have a maximum attempt count and per-attempt timeout; Agent work must also respect its call, token, time, and estimated-cost budgets.

`OPS-REQ-022` A retry with unchanged material input and component versions must create a new attempt within the same run and preserve the prior attempt.

`OPS-REQ-023` A material input, model, prompt, schema, rule-set, disposition-policy, PDF Inspector, OCR asset, or workflow change must create a new run when required by its owning specification and must not be hidden as a retry.

`OPS-REQ-024` Retry exhaustion must create one explicit terminal failure or reviewable degraded outcome according to trusted workflow policy; it must not create an infinite internal loop.

`OPS-REQ-025` A non-idempotent operation whose completion is unknown must not be retried automatically unless its owning contract provides a safe idempotency mechanism.

## 7. Degradation Rules

`OPS-REQ-026` A successful native extraction path must not fail solely because an unused external model provider is unavailable.

`OPS-REQ-027` OCR or model unavailability may use only an approved fallback and must preserve the failed attempt and selected fallback reason.

`OPS-REQ-028` Missing required evidence, invalid required output, object-persistence failure, unresolved security failure, or incomplete deterministic validation must not degrade into an implicit pass or ready result.

`OPS-REQ-029` Agent-report failure, timeout, budget exhaustion, or verifier rejection must leave deterministic results available for human review and expose report status as unavailable.

`OPS-REQ-030` Missing provider usage or pricing data must be represented as unavailable, never as zero.

## 8. Case Agent Log

`OPS-REQ-031` V1 must provide one bounded case Agent-log projection containing timestamp, short allowlisted reviewer-readable event, model label when relevant, tool label when relevant, and estimated cost or explicit unavailability.

`OPS-REQ-032` The case Agent log must summarize completed actions and terminal outcomes; it must not expose chain-of-thought, complete prompts, unrestricted tool arguments, document contents, credentials, provider payloads, or internal stack traces.

`OPS-REQ-033` Case Agent-log entries must derive from persisted safe Agent events and must not be accepted from browser-authored text.

`OPS-REQ-034` The case Agent log is diagnostic context, not an audit trail, workflow state, finding, disposition, or proof that an Agent conclusion is correct.

`OPS-REQ-035` Aggregate Agent monitoring, session explorer, and runtime configuration screens are outside the first V1 vertical slice.

## 9. Initial Measurements

`OPS-REQ-036` Evaluation reports must record per-case duration, model-call count, token usage when available, and estimated cost when available using the version manifest defined by the ML evaluation specification.

`OPS-REQ-037` Initial measurements are descriptive baselines and must not be presented as production Service Level Objectives or guarantees.

`OPS-REQ-038` The first vertical slice need not deploy Prometheus or Jaeger and need not implement aggregate operational dashboards.

`OPS-REQ-039` Any later metric must use bounded-cardinality labels and must not place case identifiers, document values, filenames, prompts, or applicant identity in metric labels.

## 10. Verification and Acceptance

`OPS-REQ-040` Tests must prove trace correlation across one successful native-text path, one bounded adaptive path, and one failed or unavailable Agent-report path.

`OPS-REQ-041` Tests must prove bounded retry, timeout, retry exhaustion, job redelivery idempotency, and preservation of prior attempts.

`OPS-REQ-042` Tests must prove that a telemetry-backend failure does not change authorization, processing result, or safe logging policy.

`OPS-REQ-043` Tests must inspect representative logs, traces, public errors, and Agent-log projections for prohibited sensitive or unrestricted content.

`OPS-REQ-044` Tests must prove that polling returns authoritative current state after stale browser data and a command whose response was lost.

`OPS-REQ-045` The three fixed demonstration paths must expose sufficient safe correlation and failure context to explain their result without a separate monitoring platform.

## 11. Deferred Work

Prometheus-compatible metrics, Jaeger deployment, alerting, aggregate Agent monitoring, production retention, log aggregation, on-call runbooks, Service Level Objectives, capacity planning, incident response, and disaster-recovery observability remain deferred until justified by implementation evidence or production scope.

No unresolved first-slice observability or failure-semantics decision blocks review.

## 12. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-05 | Approved | Approved a minimal forty-five-requirement operational baseline centered on structured logs, basic trace correlation, durable attempts, bounded retries, explicit degradation, polling, and the case Agent log. No unresolved first-slice observability or failure-semantics decision remains. |
