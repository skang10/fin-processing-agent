# Financial Document AI Agent API Contracts Specification

Document ID: `API`

Version: 1.9.0

Status: Approved

Last updated: 2026-09-08

## 1. Purpose

This specification defines the V1 HTTP contracts exposed by the API Service. It owns transport representations, routes, authentication context, bounded idempotency, optimistic concurrency, errors, bounded collections, artifact access, and OpenAPI generation. V1 uses polling; Server-Sent Events (SSE) are deferred.

The API supports document processing and human document review only. It does not expose lending approval or rejection, creditworthiness, account opening, disbursement, customer contact, final Anti-Money Laundering (AML), or final Know Your Customer (KYC) operations.

## 2. Authority and Dependencies

This document owns:

1. Public HTTP resources, commands, query projections, and status codes.
2. Request and response envelope conventions.
3. Bounded command idempotency and optimistic-concurrency behavior.
4. Polling and recovery behavior.
5. Public error representation and generated OpenAPI ownership.

Normative dependencies are:

1. [`INDEX.md`](INDEX.md) for controlled vocabularies, terminology, and lifecycle.
2. [`PRODUCT_AND_SCOPE.md`](PRODUCT_AND_SCOPE.md) for product authority and prohibited actions.
3. [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) for API, worker, storage, and trust boundaries.
4. [`DATA_MODEL.md`](DATA_MODEL.md) for domain identity, revision, lineage, and immutability.
5. [`components/REVIEW_WORKBENCH.md`](components/REVIEW_WORKBENCH.md) for reviewer workflows and presentation needs.
6. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](components/ADAPTIVE_EXTRACTION_AGENT.md) for verified Agent Report and safe activity semantics.
7. [`components/VALIDATION_AND_DISPOSITION.md`](components/VALIDATION_AND_DISPOSITION.md) for findings and recommended dispositions.
8. [`LIMITATIONS.md`](../LIMITATIONS.md) for public fitness and production-readiness boundaries.

`API-REQ-001` Public API routes must use the `/api/v1` prefix.

`API-REQ-002` Executable request, response, parameter, and event schemas must be authored with TypeBox, expose JSON Schema, and generate OpenAPI from the same route contracts.

`API-REQ-003` A transport projection must not redefine domain identity, lifecycle, revision, finding, disposition, evidence, or review semantics owned by another specification.

## 3. Representation Conventions

`API-REQ-004` JSON property names, enum values, reason codes, and API documentation must use English `lower_snake_case` identifiers; opaque identifiers must be strings.

`API-REQ-005` Timestamps must be RFC 3339 strings in UTC with an explicit `Z` offset; durations must use integer milliseconds.

`API-REQ-006` Money must use an exact decimal string plus ISO 4217 currency and must never use a binary floating-point JSON number as the authoritative amount.

`API-REQ-007` Every response must include an `X-Request-Id` header. A client-supplied request identifier may be accepted only after format validation and must not replace server trace identity.

`API-REQ-008` Resource responses must expose an opaque `version` or equivalent revision token wherever a concurrent command may update the resource.

`API-REQ-009` Optional unavailable data must be omitted or represented by an explicit availability status according to its schema; unavailable usage, cost, or evidence must not be represented as zero or an empty successful artifact.

`API-REQ-010` Full identity-document numbers, full International Bank Account Numbers (IBANs), object-store keys, storage credentials, provider credentials, unrestricted extracted text, complete prompts, chain-of-thought, and raw provider payloads must not appear in public projections.

## 4. Authentication and Authorization Context

`API-REQ-011` Every non-health route must resolve one unified authentication context containing actor identity, actor type, roles, authentication method, and request correlation identity.

`API-REQ-012` V1 development authentication must be enabled only by explicit development configuration and must fail closed in every other environment.

`API-REQ-013` Authorization must be enforced server-side for every case, artifact, review command, and monitoring query; omission or hiding of a browser control is not authorization.

`API-REQ-014` The initial role vocabulary must distinguish `submitter`, `reviewer`, `evaluator`, and `administrator`; exact production role mapping remains owned by the future security specification.

`API-REQ-015` A caller must receive `404 Not Found` instead of resource-existence disclosure when the authorization policy requires concealment.

## 5. Errors

The public error media type is `application/problem+json` with this minimum shape:

```json
{
  "type": "https://example.invalid/problems/concurrency_conflict",
  "title": "The case changed before this action was saved",
  "status": 409,
  "code": "concurrency_conflict",
  "request_id": "req_...",
  "detail": "Refresh the case and review the current result before trying again."
}
```

`API-REQ-016` Every non-success response must use one stable Problem Details-style schema with `type`, `title`, `status`, stable `code`, and `request_id`; `detail`, field-level `errors`, `retryable`, and `retry_after_seconds` may be included when safe and applicable.

`API-REQ-017` Validation errors must identify schema-safe field paths and stable error codes without echoing unrestricted document content or sensitive submitted values.

`API-REQ-018` Public errors must not expose stack traces, SQL, object keys, internal hostnames, prompts, provider payloads, credentials, or unrestricted model output.

`API-REQ-019` The API must distinguish at least malformed input (`400`), unauthenticated (`401`), unauthorized (`403`), absent or concealed (`404`), concurrency conflict (`409`), unsupported media or scenario (`415` or schema-defined `422`), semantic validation failure (`422`), rate limit (`429`), and unexpected service failure (`500`).

`API-REQ-020` A command whose outcome is unknown after a client timeout must be recoverable through its idempotency identity or authoritative resource query; the API must not require blind resubmission.

## 6. Collections, Filtering, and Ordering

`API-REQ-021` The first vertical slice may return one bounded Review Queue collection with a deterministic maximum and ordering; cursor pagination is deferred until dataset size requires it.

`API-REQ-022` Deprecated in V1.1.0 with cursor pagination.

`API-REQ-023` Filter and sort parameters must be allowlisted by each route contract. Unknown parameters must be rejected rather than ignored.

`API-REQ-024` Review Queue ordering must prioritize reviewer workflow state and waiting time using one documented deterministic ordering; it must not invent an unsupported risk-priority score.

## 7. Idempotency and Concurrency

`API-REQ-025` Case creation and final-review submission must require an `Idempotency-Key` header. Other V1 reviewer mutations require optimistic concurrency but need not use a persistent idempotency ledger.

`API-REQ-026` An idempotency record must bind actor scope, route or command type, target resource when present, canonical request hash, response status, and created result identity.

`API-REQ-027` Reusing a key with an equivalent canonical request must return the original authoritative result; reusing it with different material input must return `409 idempotency_conflict`.

`API-REQ-028` Idempotency processing must be transactional with the command result or durable command acceptance and must remain safe across client retry and API-process loss.

`API-REQ-029` A mutation of review state must include the predecessor result-revision identity and expected resource version. A superseded result or version mismatch must return `409 concurrency_conflict` with a safe current-resource reference.

`API-REQ-030` An idempotent replay must not create a duplicate case, final review, associated audit event, or required asynchronous work.

## 8. Case Intake and Processing Routes

V1 exposes these intake and processing routes:

```text
GET  /api/v1/demo/agent-models
POST /api/v1/cases
GET  /api/v1/cases
GET  /api/v1/cases/{case_id}
POST /api/v1/cases/{case_id}/runs
GET  /api/v1/cases/{case_id}/events
```

`API-REQ-031` `POST /cases` must accept either the documented multipart demonstration intake or an approved object-store reference contract; it must reject arbitrary public URLs.

`API-REQ-032` Multipart intake must stream files to the object-store write path, determine media type from content, enforce configured limits, and accept only supported PDF, JPEG, and PNG documents.

`API-REQ-033` Case creation must return `202 Accepted` with `case_id`, initial `run_id`, case lifecycle, status URL, and request identity without waiting for semantic processing.

`API-REQ-034` Structured application data must be schema validated and versioned independently from document bytes; reviewer projections may expose masked contact preferences and initial-submission, latest-submission, and latest-update times when present.

`API-REQ-035` `GET /cases` must provide the Review Queue projection: technical case identifier, immutable reviewer-facing `case_code`, applicant display name, concise review summary, issue count, reviewer workflow status, waiting-since time, lifecycle, and version.

`API-REQ-036` `GET /cases/{case_id}` must return the current authorized case projection containing the technical case identifier, immutable reviewer-facing `case_code`, applicant display data, lifecycle, compact progress, current result availability, and links to separately loadable report, issues, application data, documents, final review, case Agent log, and downstream handoff. Routes continue to use the technical case identifier.

`API-REQ-037` `POST /cases/{case_id}/runs` must create a new immutable processing run only when its declared input and version preconditions are valid, and must return `202 Accepted` without executing long-running work in the request handler.

`API-REQ-038` The public V1 API must not provide a general case deletion route until retention, authorization, object deletion, audit preservation, and legal-hold semantics are approved by the security and deployment specifications.

`API-REQ-101` The synthetic demo configuration route must return only configuration-allowlisted Agent model identifiers, reviewer-readable labels, paid-operation status, the configured default, and the fixed per-case cost ceiling when applicable; it must not expose credentials or provider configuration internals.

`API-REQ-102` Synthetic multipart intake may bind one allowlisted Agent model to the created processing run. The selected model must participate in the idempotency request hash and immutable run configuration, and an unknown model must be rejected before durable acceptance. Model selection must not grant arbitrary provider or model routing authority.

## 9. Case Review Query Routes

V1 exposes these case-review projections:

```text
GET /api/v1/cases/{case_id}/agent-report
GET /api/v1/cases/{case_id}/application-data
GET /api/v1/cases/{case_id}/documents
GET /api/v1/cases/{case_id}/documents/{document_id}/content
GET /api/v1/cases/{case_id}/documents/{document_id}/pages/{page_number}
GET /api/v1/cases/{case_id}/documents/{document_id}/pages/{page_number}/render
GET /api/v1/cases/{case_id}/documents/{document_id}/pages/{page_number}/native-text
GET /api/v1/cases/{case_id}/evidence
GET /api/v1/cases/{case_id}/evidence/{evidence_id}
GET /api/v1/cases/{case_id}/findings
GET /api/v1/cases/{case_id}/issues
GET /api/v1/cases/{case_id}/issues/{issue_id}
GET /api/v1/cases/{case_id}/final-review
GET /api/v1/cases/{case_id}/agent-log
GET /api/v1/cases/{case_id}/downstream-handoff
```

`API-REQ-039` `GET /agent-report` must identify report availability as `ready`, `pending`, or `unavailable` and, when ready, return the verified presentation only: concise summary, ordered issue links, checked facts, registered suggested actions, safe references, and bound result revision metadata.

`API-REQ-040` A rejected or unavailable Agent submission must not expose unverified prose as the current report and must not prevent access to deterministic results, issues, or evidence.

`API-REQ-041` Checked facts must identify their reviewer-readable statement, deterministic source type, status, and one or more authorized navigable references; the API must not represent Agent narrative alone as a checked fact.

`API-REQ-042` `GET /application-data` must return grouped, masked reviewer data with JSON Pointer evidence locations and submission-history timestamps; it must not expose a contact-customer command.

`API-REQ-043` Document queries must preserve immutable physical-document version, page order, logical-document range, type, and uncertainty needed by the approved workbench without implying cross-file merging or non-contiguous grouping.

`API-REQ-044` Evidence queries must distinguish page-region, page-level, and structured-input evidence and include the coordinate, rotation, source-dimension, semantic-order, provenance, and availability fields required by the evidence viewer.

`API-REQ-096` `GET /evidence` must list only evidence belonging to the case's current run so that a reviewer can select structured-input fields or document pages as supporting references without discovering evidence from another case or superseded run.

`API-REQ-095` `GET /findings` must return the current result revision's deterministic finding identifiers, registered rule and version, status, reason code, and authorized evidence references so that human review remains possible when the Agent report is unavailable.

`API-REQ-045` Page bytes or rendered artifacts must be returned through an authorized API-mediated stream or short-lived scoped capability. Permanent object-store credentials and internal object keys must never be returned.

`API-REQ-098` `GET /documents/{document_id}/pages/{page_number}/native-text` must return the immutable native-text representation for a page in the case's current run as `text/markdown`, return not found when that representation is unavailable or outside the case scope, and never expose its internal object key.

`API-REQ-099` `GET /documents/{document_id}/content` must return the immutable source document selected by the case's current run through an API-mediated, case-scoped stream, use its detected allowlisted media type, disable shared caching, and never expose its internal object key.

`API-REQ-100` `GET /documents/{document_id}/pages/{page_number}/render` must return the immutable PNG render selected for that page in the case's current run through an API-mediated, case-scoped stream, disable shared caching, and never expose its internal object key.

`API-REQ-046` Issue collections and details must distinguish Agent-raised and human-raised origin, immutable source references, current human-review state, append-only edit history, requested-change draft state, predecessor result revision, and resource version.

`API-REQ-047` Issue detail observations must identify source role, field label, safely represented value, and navigable source reference without inventing a canonical corrected value.

`API-REQ-048` `GET /final-review` must project each issue outcome, requested-change inclusion state, generated message preview, optional internal note, command availability, and blocking reasons without duplicating requested-change text in the issue summary.

`API-REQ-049` `GET /agent-log` must return only the bounded session identity and status, model label, iterations, tool and model call counts, duration when complete, token usage when provider usage is available, estimated cost or explicit unavailability, timestamps, and short allowlisted reviewer-readable activity events including bounded tool-call labels when relevant. It must not expose prompts, model input or output, document content, page images, credentials, or unrestricted traces.

`API-REQ-097` `GET /downstream-handoff` must return a read-only, versioned projection only after `clear_for_downstream`, containing the reviewed result revision, final review identity, reviewer and completion time, recommended document-processing disposition and policy version, normalized claims with authorized evidence references, and deterministic findings. It must return `409 handoff_unavailable` for every other reviewer workflow outcome and must not create a delivery event or claim downstream consumption.

## 10. Review Command Routes

V1 exposes these review commands:

```text
POST  /api/v1/cases/{case_id}/issues
PATCH /api/v1/cases/{case_id}/issues/{issue_id}
POST  /api/v1/cases/{case_id}/issues/{issue_id}/confirm
POST  /api/v1/cases/{case_id}/issues/{issue_id}/ignore
PUT   /api/v1/cases/{case_id}/issues/{issue_id}/requested-change
POST  /api/v1/cases/{case_id}/final-review
```

`API-REQ-050` Creating a human issue must require reviewer-readable issue text, supporting reference or explicit no-reference reason, predecessor result revision, and expected case-review version; the server must record human origin and actor identity.

`API-REQ-051` Editing an issue must append a human edit revision and must not mutate the original Agent signal, deterministic finding, or earlier human revision.

`API-REQ-052` Confirming an Agent-raised issue must persist action `accept_signal`; ignoring it must persist `dismiss_signal`. Transport responses may additionally provide the approved user-facing labels `Confirm issue` and `Ignore issue` but must not change stored semantics.

`API-REQ-053` Ignoring an issue may include an optional reviewer note. Confirming, ignoring, editing, or creating an issue must record reviewer, time, predecessor result revision, command identity, and resulting resource version.

`API-REQ-054` A confirm response may create or expose a verified Agent-proposed requested-change draft for human editing. The Review Workbench must select that draft for the message by default and let the reviewer exclude it before final submission.

`API-REQ-055` Updating a requested-change draft must preserve Agent-proposed text separately from the current human-edited text, bind exactly one issue, and persist its current message-inclusion state.

`API-REQ-056` Requested-change text must be non-empty when included, applicant-readable, and free of prohibited banking decisions, internal processing instructions, unsafe document content, or claims of customer delivery.

`API-REQ-057` The final-review command must accept exactly one action: `request_changes`, `escalate_review`, or `clear_for_downstream`, plus the reviewed predecessor result revision, expected review version, selected requested-change draft revisions, and optional internal note.

`API-REQ-058` `request_changes` must require at least one explicitly included non-empty requested-change draft; `clear_for_downstream` must require none; `escalate_review` may preserve either inclusion state for context.

`API-REQ-059` Final-review submission must fail with `409 review_incomplete` while an issue lacks a recorded resolution or explicit further-review outcome.

`API-REQ-060` A successful final-review command must atomically persist the immutable final review, referenced draft revisions, actor and time, audit event, and resulting reviewer workflow state.

`API-REQ-061` `request_changes` records a draft outcome only. No API route, event, outbox message, webhook, or hidden command may send or deliver it to an applicant.

`API-REQ-062` `clear_for_downstream` records completion of document review only and must not represent or authorize application approval, loan approval, account opening, disbursement, customer contact, final AML, or final KYC.

## 11. Polling

`API-REQ-063` Polling authoritative query routes must be the V1 progress and refresh mechanism.

`API-REQ-064` Deprecated in V1.1.0. The case SSE stream is deferred.

`API-REQ-065` Deprecated in V1.1.0 with SSE delivery.

`API-REQ-066` Deprecated in V1.1.0 with SSE delivery.

`API-REQ-067` Deprecated in V1.1.0 with SSE delivery.

`API-REQ-068` Deprecated in V1.1.0 with SSE delivery.

`API-REQ-069` `GET /cases/{case_id}/events` may provide a bounded authorized event projection for diagnostic polling but is not required for ordinary V1 case refresh.

`API-REQ-070` External callbacks and webhooks are outside V1.

## 12. Deferred Aggregate Agent Monitoring

The following aggregate monitoring routes are deferred beyond the first V1 implementation slice:

```text
GET /api/v1/agent-monitoring/overview
GET /api/v1/agent-monitoring/sessions
GET /api/v1/agent-monitoring/sessions/{session_id}
GET /api/v1/agent-monitoring/configuration
```

`API-REQ-071` Deprecated in V1.1.0. Aggregate Agent-monitoring routes are deferred; the case-level `GET /agent-log` projection remains in scope.

`API-REQ-072` Deprecated in V1.1.0 with aggregate Agent monitoring.

`API-REQ-073` Deprecated in V1.1.0 with aggregate Agent monitoring.

`API-REQ-074` Deprecated in V1.1.0 with aggregate Agent monitoring.

`API-REQ-075` V1 must expose no monitoring mutation route for prompts, models, rules, thresholds, tool registries, Agent budgets, or disposition policy.

## 13. Caching and Sensitive Browser State

`API-REQ-076` Case, evidence, artifact, issue, requested-change, final-review, and Agent-log responses must use cache controls appropriate to authenticated sensitive data and must not be publicly cacheable.

`API-REQ-077` Short-lived artifact capabilities must be scoped to one authorized artifact or page representation, expire, and be unsuitable as permanent storage references.

`API-REQ-078` Responses containing review or Agent-log data must not require the browser to persist access tokens, artifact capabilities, full identifiers, or document content in local storage.

## 14. OpenAPI and Compatibility

`API-REQ-079` Generated OpenAPI must be reproducible from executable route schemas and must identify API contract version and source specification version.

`API-REQ-080` Generated OpenAPI is an artifact and must not be hand-edited.

`API-REQ-081` A backward-incompatible change to a public route, required property, enum meaning, error code, event envelope, or command precondition requires a new API version or an explicitly approved compatibility transition.

`API-REQ-082` Additive optional fields must not change existing field semantics, authorization, command effects, or controlled-vocabulary meanings.

`API-REQ-083` Contract tests must compare the generated OpenAPI and JSON Schemas with approved fixtures and detect unreviewed breaking changes.

## 15. Acceptance Criteria

The API contracts are acceptable for implementation when automated contract and integration tests demonstrate that:

`API-REQ-084` Case creation validates supported multipart input, rejects arbitrary URLs and unsupported media, is idempotent, and returns `202 Accepted` without synchronous semantic processing.

`API-REQ-085` Queue and case projections contain the approved V1 workbench information without exposing prohibited actions, full protected identifiers, object keys, or unrestricted technical detail.

`API-REQ-086` Agent Report ready, pending, rejected, and unavailable fixtures preserve deterministic review access and never promote unverified Agent prose.

`API-REQ-087` Evidence fixtures distinguish page-region, page-level, structured-input, missing, purged, and unauthorized states and enforce scoped artifact access.

`API-REQ-088` Issue create, edit, confirm, ignore, and requested-change commands preserve immutable Agent sources, append review state, enforce optimistic concurrency, and reject stale result revisions.

`API-REQ-089` Final-review tests enforce issue completion and the action-specific requested-change inclusion rules atomically.

`API-REQ-090` No final-review response or side effect sends a requested-change draft or performs a lending, account, customer-contact, AML, or KYC action.

`API-REQ-091` Polling fixtures converge to current authoritative state after stale responses, command timeouts, and browser refresh.

`API-REQ-092` The case Agent-log fixture enforces safe event, model, cost-unavailable, and disclosure boundaries.

`API-REQ-093` Error fixtures use the stable public problem schema and contain neither internal stack traces nor sensitive payloads.

`API-REQ-094` Generated OpenAPI and executable schemas remain reproducible and pass compatibility checks.

## 16. Assumptions and Deferred Decisions

1. V1 uses synthetic or explicitly demo-safe cases and development-only authentication.
2. Exact production identity, role mapping, case-level authorization, retention, and sensitive-value reveal policies remain owned by `SECURITY_AND_LIMITATIONS.md` and are not invented here.
3. Aggregate Agent monitoring is deferred; case-log cost calculation and incomplete-provider-usage semantics require `operations/OBSERVABILITY_AND_FAILURES.md`.
4. Physical database table and index design remains an implementation concern constrained by `DATA_MODEL.md`.
5. TypeBox schemas and generated OpenAPI will be created after the Stage Two repository skeleton exists.
6. Direct extracted-value correction, interactive boundary correction, customer-message delivery, external webhooks, and general case deletion are outside V1.

No unresolved transport-authority or V1 review-command decision blocks review of this document. Security and observability details are explicit downstream dependencies.

## 17. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.9.0 | 2026-09-08 | Approved | Added bounded synthetic-demo Agent-model discovery and immutable allowlisted model selection at case intake. |
| 1.8.0 | 2026-09-07 | Approved | Added the immutable reviewer-facing `case_code` to queue and case projections while retaining UUID-based routes. |
| 1.7.0 | 2026-09-07 | Approved | Added bounded session duration, model-call count, and available token totals to the case Agent-log projection so evaluation capture can satisfy operational reporting without exposing model or document payloads. |
| 1.6.0 | 2026-09-06 | Approved | Added case-scoped delivery of immutable PDFium page-render artifacts. |
| 1.5.0 | 2026-09-06 | Approved | Added case-scoped source-document streaming for the PDF.js and image review viewers. |
| 1.4.0 | 2026-09-06 | Approved | Added case-scoped API-mediated delivery of immutable page native text. |
| 1.3.0 | 2026-09-06 | Approved | Added the case Agent-log link to the case resource projection. |
| 1.2.0 | 2026-09-06 | Approved | Added the read-only downstream handoff projection for cases cleared after document review. |
| 1.1.4 | 2026-09-06 | Approved | Selected confirmed issues for the applicant message by default while preserving reviewer opt-out. |
| 1.1.3 | 2026-09-06 | Approved | Made the internal reviewer note optional when ignoring an issue. |
| 1.1.2 | 2026-09-06 | Approved | Added the current-run evidence collection used by the reviewer supporting-evidence picker. |
| 1.1.1 | 2026-09-05 | Approved | Added the current deterministic-findings projection required for human review when the Agent report is unavailable. |
| 1.1.0 | 2026-09-04 | Approved | Reduced V1 to polling, case-creation and final-review idempotency, optimistic concurrency for issue edits, and a bounded case Agent log; deferred SSE and aggregate Agent monitoring. |
| 1.0.0 | 2026-09-04 | Approved | Approved the V1 HTTP, review-command, evidence, SSE, idempotency, error, Agent-monitoring, and generated-contract baseline aligned with the approved Review Workbench. No unresolved transport-authority or V1 review-command decision remains. |
