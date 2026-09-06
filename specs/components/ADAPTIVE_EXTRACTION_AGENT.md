# Financial Document AI Agent Case Review Agent Specification

Document ID: `AGT`

Version: 3.4.0

Status: Approved

Last updated: 2026-09-07

## 1. Purpose

This specification defines the bounded Pi-based Case Review Agent that pre-screens every processable case and leads document extraction within it. Within one durable case-review session, the Agent may select registered PDF Inspector and extraction tools, submit evidence-linked extraction candidates, request deterministic reconciliation and validation, and submit a Case Review Brief.

Deterministic processing currently inspects, renders, and selectively recognizes pages before the session, but V1 has no deterministic field parser. The Agent can visually inspect an authorized uploaded-document page or region through `render_page_region`; it never receives a source path, object-store credential, or unrestricted file capability. Every document-derived value therefore reaches the deterministic pipeline as an Agent candidate produced through a registered, scoped tool. Normalization, reconciliation, claims, entity matching, validation findings, dispositions, report verification, and workflow state remain deterministic and are never produced by the model.

The Agent acts like a junior document-review employee: it assembles evidence-grounded observations and suggests registered reviewer actions. It is not the workflow engine, a general coding agent, a validator, a disposition authority, or a banking decision-maker.

## 2. Authority and Dependencies

This document owns:

1. Per-case Agent scheduling, context, lifecycle, durable re-entry, stopping, and escalation.
2. Agent tool registration, authorization, validation, and execution semantics.
3. Execution budgets and no-progress controls.
4. Pi harness restrictions and isolation.
5. Agent-specific prompt-injection defenses, persistence, observability, and acceptance tests.

Normative dependencies are:

1. [`../INDEX.md`](../INDEX.md) for shared terminology.
2. [`../PRODUCT_AND_SCOPE.md`](../PRODUCT_AND_SCOPE.md) for the bounded-Agent product outcome.
3. [`../SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md) for workflow, model, trust, and deployable boundaries.
4. [`../DATA_MODEL.md`](../DATA_MODEL.md) for gaps, sessions, steps, invocations, candidates, evidence, and run provenance.
5. [`DOCUMENT_PROCESSING.md`](DOCUMENT_PROCESSING.md) for document inspection, rendering, native extraction, and OCR operations.

`AGT-REQ-001` The initial implementation must embed `pi-coding-agent` through its SDK behind a project-owned `CaseReviewAgentHarness` interface.

`AGT-REQ-002` Pi-specific session, message, tool, and provider types must not enter domain contracts.

`AGT-REQ-003` The Pi dependency and harness configuration must be pinned and recorded in the processing-run version manifest.

`AGT-REQ-004` Replacement of Pi must not change Agent authority, tool contracts, budgets, candidate validation, or durable workflow semantics without an approved specification change.

## 3. Placement in the Processing Flow

```mermaid
flowchart LR
    A[Deterministic intake, preflight, inspection, rendering, selective OCR] --> B[Workflow derives declared field requirements and starts one bounded case-review session]
    B --> C[Agent selects registered inspection and extraction tools]
    C --> D[Agent submits evidence-linked candidates]
    D --> E[Agent requests deterministic reconciliation and validation]
    E --> F[Agent consumes committed result]
    F --> G[Agent submits Case Review Brief]
    G --> H[Deterministic Report Verifier]
    H --> I[Human review]
```

`AGT-REQ-005` The Workflow Coordinator, not the Agent, must decide whether and when an Agent session is scheduled.

`AGT-REQ-006` One `case_review` Agent session must cover the bounded pre-screening lifecycle for one processing run. `adaptive_recovery` and `case_review_report` are deprecated as independently scheduled session modes; their work becomes phases within the case-review session.

`AGT-REQ-007` Deterministic intake, immutable source persistence, file-type and safety checks, page-count discovery, and the minimum prerequisites declared by the tool policy must complete before the Agent starts. Native extraction, OCR, local-table extraction, and VLM extraction are Agent-selectable tool operations and need not run as a fixed sequence.

`AGT-REQ-008` Case-review scheduling and tool eligibility must be determined by versioned workflow and tool policy over trusted state, not by free-form model judgment.

`AGT-REQ-168` The extraction work bound to a session must be derived by trusted code from a versioned declared field-requirement set, the structured application input, and the committed document and page inventory of the run. It must not be derived from evaluation truth, golden datasets, or any precomputed expected value.

`AGT-REQ-169` A declared field requirement must become an explicit extraction gap only when the run contains a grouped logical document of the required type. A required document type the run does not contain remains a document-completeness concern and must not produce a gap.

`AGT-REQ-170` An extraction gap must be scoped to one logical document of the bound run. Its recorded page anchors the gap on that document's first page, and any authorized page of that same logical document is a valid source for its value.

`AGT-REQ-180` Each declared extraction requirement exposed to the Agent must include its stable requirement identifier, semantic target role, and bounded extraction guidance. A bank-statement payment-counterparty requirement targets the sender of the salary-credit transaction and must explicitly exclude the account-holding bank, its logo, and page-header institution names.

`AGT-REQ-009` The Agent must not operate on a case, run, document, page, region, field, candidate, or result outside its configured session scope.

`AGT-REQ-010` Agent completion must return structured session outcome to the Workflow Coordinator; it must not transition workflow or case state directly.

### 3.1 Agent-in-the-Loop contract

The Case Review Agent is an Agent-in-the-Loop scheduled once by the Workflow Coordinator for each processable run. It does not continuously observe cases or decide independently to join a workflow. The Agent chooses a bounded review path; the control plane authorizes every operation and durable deterministic components commit domain results.

```mermaid
sequenceDiagram
    participant W as Workflow Coordinator
    participant C as Agent Control Plane
    participant P as Pi Harness
    participant T as Tool Executor
    participant H as Human Review

    W->>C: Start case review after preflight
    C->>C: Build bounded context and tool view
    C->>P: Start or re-enter scoped session
    loop until brief submitted or terminal stop
        P->>C: Request registered tool
        C->>T: Authorize, reserve budget, execute or reuse
        T-->>C: Persisted schema-validated result
        C-->>P: Bounded result reference
    end
    C-->>W: Structured session outcome
    W->>H: Present verified report or explicit unavailable state
```

`AGT-REQ-104` Agent-in-the-Loop eligibility must require all of the following: a processable current case and run; completed deterministic intake and minimum file preflight; an enabled workflow-policy rule; at least one relevant registered tool; available budgets; and no fatal intake or security failure.

`AGT-REQ-105` Eligibility evaluation must produce a persisted decision containing policy version, evaluated preflight and run state, decision, and stable reason codes.

`AGT-REQ-106` The Agent must not start for unsupported or corrupt input, a prohibited business action, an already completed equivalent case-review attempt without new material inputs, or unavailable required budget. Cross-document conflicts and sufficient accepted candidates remain valid review inputs and must not independently suppress the required case-review attempt.

`AGT-REQ-107` A newly created gap must not schedule a separate Agent session merely because it exists; it becomes trusted state available to the active case-review session or deterministic fallback routing.

`AGT-REQ-108` A change to case inputs, document revision, applicable tool version, or case-review policy may permit a new eligibility decision; elapsed time alone must not.

`AGT-REQ-109` A non-start decision must preserve available processing state and return control to deterministic workflow routing, which must expose a reviewable failure or terminal technical failure according to owning policy.

## 4. Session Scope and Context

### 4.1 Context management architecture

```mermaid
flowchart LR
    A[Persisted case and run state] --> B[Context Selector]
    C[Field schemas and policy] --> B
    D[Authorized evidence index] --> B
    B --> E[Context Validator]
    E --> F[Immutable Session Context Manifest]
    F --> G[Pi Harness]
    H[Validated tool result] --> I[Context Update Builder]
    I --> J[Step Context Delta]
    J --> G
```

The trusted Agent Control Plane owns context selection. Pi consumes the resulting view but cannot query arbitrary case state or mutate the context manifest.

`AGT-REQ-011` A session must bind exactly one case, one processing run, one stage attempt, the `case_review` mode, one harness configuration version, one tool-registry version, and one budget envelope.

`AGT-REQ-012` The session may inspect multiple documents in its bound case, but each content-bearing tool call must target one authorized document, page, bounded contiguous page window, or region as declared by that tool contract.

`AGT-REQ-013` A session must initially receive only the minimum inventory and trusted control context required to plan its review; document content must be retrieved incrementally through scoped tools.

`AGT-REQ-014` Allowed context may include field schemas, gap descriptions, the grouped logical-document inventory of the bound run, selected page metadata, structured application input, bounded native or OCR text, existing candidate summaries, evidence metadata, and safe processing diagnostics.

`AGT-REQ-171` Structured application input supplied as context must be labeled as declared applicant input. It is never document evidence and must not satisfy a document extraction requirement.

`AGT-REQ-015` A session must not receive complete document bytes, unrestricted application data, disposition-policy internals, credentials, or internal system configuration. It may receive bounded persisted claim, evidence-index, gap, finding, and recommended-disposition projections produced during its bound run.

`AGT-REQ-016` Full document bytes and page images must be accessed only through scoped tools; they must not be embedded wholesale in the Agent instruction context.

`AGT-REQ-017` Existing candidates supplied as context must remain labeled as candidates and must include source and confidence semantics.

`AGT-REQ-018` Document text in context must be delimited and represented as untrusted data.

`AGT-REQ-019` Session construction must be deterministic for the same committed case inputs, configuration, and context-selection version, excluding trace and time metadata.

### 4.2 Context manifests and updates

`AGT-REQ-110` The Context Selector must resolve data through allowlisted repositories or application queries scoped by case, run, gap, logical document, page or region, and field schema.

`AGT-REQ-111` The initial session context must be represented by an immutable manifest containing included record and artifact references, versions, safe content hashes, scope, selection reasons, and context limits.

`AGT-REQ-112` Context limits must bound text length, image count and pixels, page count, candidate count, and prior-step summary size independently of the model token budget.

`AGT-REQ-113` Context selection must prefer referenced evidence regions and gap-relevant spans over whole-page content when the smaller context is sufficient.

`AGT-REQ-114` A context item must carry a provenance label and trust classification such as trusted control metadata, untrusted document content, untrusted model output, or validated tool result.

`AGT-REQ-115` Subsequent steps must receive an immutable context delta containing only validated new results and the references needed to relate them to the initial manifest.

`AGT-REQ-116` Context compaction or summarization must preserve gap identity, tool outcomes, evidence references, unresolved constraints, budget state, and trust labels.

`AGT-REQ-117` A model-generated summary must remain untrusted and must not replace authoritative tool results or persisted state.

`AGT-REQ-118` Context overflow must produce a structured selection failure or deterministic reduction; it must not silently drop required constraints, authority boundaries, or gap identity.

`AGT-REQ-119` Pi conversation history may be rebuilt from manifests and step records for diagnostics or recovery, but it must not become the sole source of context provenance.

## 5. Harness Capability Restrictions

`AGT-REQ-020` The Agent must be instantiated without Pi default coding tools.

`AGT-REQ-021` The Agent must have no Shell or process-execution tool.

`AGT-REQ-022` The Agent must have no arbitrary filesystem read or write capability.

`AGT-REQ-023` The Agent must have no generic HTTP, browser, URL-fetch, or unrestricted network tool.

`AGT-REQ-024` The Agent must not install packages, load runtime plugins, activate dynamic extensions, or discover tools or resources automatically.

`AGT-REQ-025` Unreviewed Pi packages, skills, extensions, prompt files, and tool definitions must not be loaded into a production-shaped session.

`AGT-REQ-026` The Agent must not receive database, object-store, model-provider, business-system, or telemetry credentials.

`AGT-REQ-027` Tool execution wrappers may hold scoped service capability, but the model must receive neither the credential nor an operation broader than the registered tool contract.

`AGT-REQ-028` No Agent tool may approve or reject a loan, calculate creditworthiness, open an account, disburse funds, contact a customer, or complete AML or KYC.

## 6. Tool Registry

The V1 registered tool catalog is:

```text
inspect_page
get_native_text
render_page_region
run_ocr
classify_page
detect_document_boundaries
extract_local_table
extract_with_vlm
get_case_manifest
submit_extraction_candidates
request_reconciliation
request_validation
get_current_result
submit_case_review_brief
```

The list is a capability ceiling, not a prescribed sequence. A session tool view may omit tools whose prerequisites or case scope are not satisfied.

`AGT-REQ-029` The tool registry must be a finite, immutable, versioned set assembled by trusted application code before the session starts.

`AGT-REQ-030` Every tool must have a stable name, purpose, input schema, output schema, authorization policy, resource-cost classification, timeout, and implementation version.

`AGT-REQ-031` Tool input and output schemas must be allowlisted TypeBox or JSON Schema artifacts.

`AGT-REQ-032` A tool request must pass registry lookup, schema validation, session-scope authorization, resource-limit validation, and budget reservation outside the model before execution.

`AGT-REQ-033` An unknown, inactive, differently versioned, or malformed tool request must be rejected without best-effort interpretation.

`AGT-REQ-034` Tool names or arguments found in document content, OCR text, native text, model output data, or error messages must not be interpreted as authorized tool calls.

`AGT-REQ-035` The model must not create, modify, alias, compose, or activate a tool at runtime.

`AGT-REQ-036` Tool results must be validated before entering subsequent Agent context or candidate submission.

`AGT-REQ-037` A tool failure must return a structured, bounded, non-authoritative result and must not expose raw credentials, stack traces, or unrestricted file paths.

### 6.1 Tool management architecture

```mermaid
flowchart LR
    A[Immutable Tool Catalog] --> B[Session Tool View]
    C[Session scope] --> B
    D[Eligibility policy] --> B
    B --> E[Pi tool schemas]
    E --> F[Tool request]
    F --> G[Schema Validator]
    G --> H[Scope Authorizer]
    H --> I[Budget Reservation]
    I --> J[Idempotency Guard]
    J --> K[Tool Adapter]
    K --> L[Output Validator]
    L --> M[Persisted Tool Result]
    M --> N[Bounded context delta]
```

`AGT-REQ-120` The immutable Tool Catalog must be assembled at application startup from explicitly registered implementations and reviewed schema artifacts; it must not scan the filesystem, installed packages, prompts, or model output for tools.

`AGT-REQ-121` Each session must receive a Session Tool View containing only the subset permitted for its current committed state, source scope, workflow policy, prerequisites, and remaining budgets.

`AGT-REQ-122` Removing a tool from a Session Tool View must not require changing the global catalog or expose the existence of unrelated tools to the model.

`AGT-REQ-123` Tool authorization and execution must occur in the ordered control chain shown in section 6.1; successful schema validation alone is not authorization.

`AGT-REQ-124` A tool-call idempotency key must derive from session, step, tool version, canonical validated arguments, authorized source versions, and relevant operation configuration.

`AGT-REQ-125` Tool results must be immutable and must distinguish success, retryable failure, non-retryable failure, budget rejection, authorization rejection, schema rejection, and duplicate resolution.

`AGT-REQ-126` A duplicate tool request must resolve to the committed compatible result when safe, or be rejected explicitly; it must not repeat an untracked side effect.

`AGT-REQ-127` Updating a tool implementation, input or output schema, authorization policy, or material configuration must create a new tool version.

`AGT-REQ-128` A session must retain the resolved tool versions it was offered, not only the current global catalog version.

## 7. Tool Semantics

`AGT-REQ-158` `inspect_page`, `get_native_text`, `render_page_region`, `run_ocr`, `classify_page`, `detect_document_boundaries`, and `extract_local_table` must be project-owned wrappers over the approved Document Processing interfaces. The Agent must not receive the PDF Inspector SDK object, filesystem path, command-line interface, or unrestricted operation options.

`AGT-REQ-038` `inspect_page` must return bounded page structure and technical metadata for an authorized page without returning unrelated case content.

`AGT-REQ-039` `get_native_text` must return bounded native spans and evidence coordinates already committed for authorized pages or regions.

`AGT-REQ-040` `run_ocr` must invoke the approved OCR boundary for an authorized page or region and must retain OCR provenance and raw confidence semantics.

`AGT-REQ-041` `render_page_region` must require an authorized page and validated bounded region, return the rendered image as transient multimodal tool content to the Agent, and return an immutable derived-artifact reference as its durable result.

`AGT-REQ-178` Page-image bytes returned to the Agent must not be persisted in Agent steps, invocation safe output, logs, traces, or resumed-progress context. Durable state retains the authorized source parameters, integrity hash, safe artifact reference, and reviewer-readable summary instead.

`AGT-REQ-042` `classify_page` must invoke only the configured classifier operation and must return constrained classification candidates, not workflow commands.

`AGT-REQ-159` `detect_document_boundaries` must return bounded boundary candidates for authorized pages. It must not commit a logical-document revision directly; accepted boundaries remain subject to the deterministic document-processing contract.

`AGT-REQ-160` `extract_local_table` must return schema-valid table candidates and evidence coordinates from an authorized page or bounded page window. It must not infer unrelated business fields or authoritative claims.

`AGT-REQ-043` `extract_with_vlm` must invoke one configured task-specific Model Gateway operation over selected pages, a bounded consecutive-page window, or regions.

`AGT-REQ-044` `extract_with_vlm` must not expose tools to the extraction-model invocation.

`AGT-REQ-045` `get_case_manifest` must return the bounded case manifest of the session: the grouped logical documents of the bound run, the pages the session may touch, the declared extraction requirements visible under current tool policy together with their persisted resolution state, the approved field schemas, and the structured application input. It must carry no document content; document text and images remain reachable only through the page tools.

`AGT-REQ-046` `submit_extraction_candidates` must accept only candidates matching the session gaps, approved field schemas, source scope, and evidence requirements.

`AGT-REQ-172` A submitted document-derived value must appear verbatim in output an authorized tool returned for the same page within the candidate's own logical document. Exact model-extraction values, returned recognition lines, and committed native text are the permitted sources; anything else must be rejected outside the model.

`AGT-REQ-173` A submitted candidate must carry the raw value the Agent read and the tool boundary it came from. The model must not supply a normalized value, a confidence value used as system confidence, or an evidence region the source tool did not return.

`AGT-REQ-047` Candidate submission must not write directly to authoritative Claim, Finding, Disposition, Rule, Prompt, or Workflow records.

`AGT-REQ-048` Submitted Agent candidates must enter the same structural validation, evidence validation, normalization, and reconciliation path as non-Agent candidates.

`AGT-REQ-161` `request_reconciliation` must invoke the deterministic reconciliation component over committed candidates for the bound run and return references to its committed claims, gaps, and lineage. The Agent may not supply a preferred winning value outside the registered reconciliation input contract.

`AGT-REQ-162` `request_validation` must invoke the versioned deterministic rule manifest only after reconciliation prerequisites are committed and must return references to committed findings and recommended disposition. The Agent may not add, remove, rewrite, or selectively suppress rules.

`AGT-REQ-163` `get_current_result` must return a bounded projection of the latest committed claims, gaps, findings, recommended disposition, and evidence availability for the bound run. It must not treat uncommitted Agent narrative as result state.

`AGT-REQ-164` `submit_case_review_brief` must accept one schema-valid report candidate bound to the current committed result revision and send it to the deterministic Report Verifier; it must not mark the report verified or transition the case.

`AGT-REQ-181` The `submit_case_review_brief` tool boundary and deterministic Report Verifier must validate the same versioned report-candidate schema, including the closed signal and suggested-action vocabularies. A value outside that vocabulary must be rejected as a repairable tool-call schema error before session termination.

`AGT-REQ-183` Before report submission terminates the session, the tool boundary must reject any attention-item reference that is not the returned reference key of a non-passing deterministic finding. Passed or not-applicable results produce no allowed attention references; document, page, artifact, and raw evidence identifiers are not report-attention references.

`AGT-REQ-165` The control plane must enforce tool prerequisites. In particular, OCR requires an authorized renderable page or region; VLM extraction requires an unresolved structured need after approved local paths are insufficient or explicitly failed; reconciliation requires committed candidates; validation requires a committed reconciliation projection; and report submission requires a current result revision.

`AGT-REQ-166` Native text must be attempted or its inapplicability established before OCR for the same target, and approved local extraction must be attempted or its insufficiency established before VLM extraction. The Agent chooses targets and whether further eligible work is useful, but it cannot bypass these ordering constraints.

`AGT-REQ-167` Every cacheable document tool invocation must resolve an idempotency key before execution and reuse an integrity-valid compatible committed result. Agent-selected repetition must not create duplicate artifacts or untracked native work.

## 8. Model Gateway and Prompt Boundary

`AGT-REQ-049` The Agent must use only the model and provider route resolved for its configured operation; it must not select an arbitrary provider or model identifier.

`AGT-REQ-050` Each Agent and nested VLM invocation must resolve immutable model, prompt, input-schema, and output-schema versions before execution.

`AGT-REQ-051` A mutable prompt alias must not be the sole prompt identity stored in run provenance.

`AGT-REQ-052` Agent system instructions must define role, task, untrusted-data boundary, registered tools, output constraints, budgets, and prohibited actions.

`AGT-REQ-053` Document content must be placed only in a data-bearing channel or field and must not be concatenated into authority-bearing instructions.

`AGT-REQ-054` Model output must be treated as untrusted until envelope and operation-specific schema validation succeed.

`AGT-REQ-055` A schema-invalid response must not be repaired by executing instructions contained in that response.

`AGT-REQ-056` A model fallback may occur only according to configured Model Gateway policy and must preserve task and output-contract semantics.

## 9. Budgets

Every session budget envelope must contain finite limits for:

1. Agent iterations.
2. Total tool calls.
3. VLM calls.
4. Input and output tokens when reported or enforceable.
5. Wall-clock duration.
6. Estimated model cost.
7. Rendered pixels or equivalent image workload.
8. OCR pages or regions.

`AGT-REQ-057` Budget values must be positive, finite, configuration-controlled, and fixed for a started session.

`AGT-REQ-058` The trusted harness must reserve and check the applicable budget before starting a tool or model operation.

`AGT-REQ-059` A result that completes after its reserved budget or session deadline is exceeded may be retained for diagnostics but must not be accepted automatically as an authoritative candidate submission.

`AGT-REQ-060` Reported usage and estimated cost must be reconciled after each model operation without allowing the model to define its own budget consumption.

`AGT-REQ-061` Missing provider usage or pricing data must remain explicitly unavailable and must not be treated as zero cost.

`AGT-REQ-062` Exhausting any hard budget must prevent further affected operations and terminate or constrain the session according to configured policy.

`AGT-REQ-063` Budget changes must create a new configuration version and must not alter an active session.

## 10. Progress and Stopping

Agent session terminal reasons are:

```text
report_submitted
report_not_submitted
no_progress
conflicting_candidates
iteration_budget_exhausted
tool_budget_exhausted
model_budget_exhausted
token_budget_exhausted
cost_budget_exhausted
timeout
tool_failure
model_unavailable
schema_failure
cancelled_by_workflow
internal_error
```

`report_submitted` means the Agent submitted a brief for verification. `report_not_submitted` means it ended without doing so. Both describe only the Agent session; report availability is decided by the Report Verifier in section 14. Gap resolution is progress state, not a successful terminal reason, because the same session must continue through deterministic validation and report submission.

`AGT-REQ-064` A successful session must terminate only after it has consumed a current committed result revision and submitted one Case Review Brief candidate for verification.

`AGT-REQ-065` A session must terminate when a hard budget is exhausted, the deadline passes, workflow cancellation is observed, or no permitted next action remains.

`AGT-REQ-066` Progress must be measured from trusted persisted state, including new valid evidence, a new schema-valid candidate, a resolved gap, a newly committed reconciliation or validation result, or a submitted brief; model narrative alone is not progress.

`AGT-REQ-067` Repeating an equivalent tool call over the same material inputs without new valid output must increment a no-progress counter.

`AGT-REQ-068` The session must stop with `no_progress` when the configured consecutive no-progress limit is reached.

`AGT-REQ-069` Conflicting candidates that cannot be reconciled within configured policy must remain preserved. The Agent may request deterministic validation and report the conflict for human review; it must not choose by model preference alone. `conflicting_candidates` is terminal only when the conflict prevents creation of a reviewable deterministic result.

`AGT-REQ-070` Exactly one terminal reason must be recorded for a terminal Agent session.

`AGT-REQ-071` A non-success terminal reason must preserve all committed artifacts, candidates, gaps, claims, findings, and results for deterministic routing to retry, fallback, human review, or technical exception handling.

## 11. Persistence and Recovery

`AGT-REQ-072` PostgreSQL stage, session, step, invocation, artifact, candidate, gap, result, report-submission, and budget records must be the durable record of Agent work.

`AGT-REQ-073` Pi conversation memory and in-process session state must not be authoritative workflow state.

`AGT-REQ-074` Each completed Agent step must persist tool identity, validated argument hash or safe arguments, outcome, usage, budget state, trace identity, and produced record references.

`AGT-REQ-075` Persisted Agent records must not contain complete documents, page images, unrestricted extracted text, credentials, or unrestricted prompts and responses.

`AGT-REQ-076` Loss of the Agent process must not lose previously committed candidates, artifacts, gap state, budget consumption, or workflow ownership.

`AGT-REQ-077` Durable re-entry may start a linked session attempt or resume through an explicitly supported harness mechanism, but it must first reconstruct authority, committed results, completed tool calls, and remaining budgets from trusted persisted state.

`AGT-REQ-078` Recovery must not replay a completed non-idempotent tool operation solely because conversational context was lost.

`AGT-REQ-079` Duplicate delivery of the same Agent stage job must not create two active authoritative sessions for the same session identity.

## 12. Retry and Recovery Matrix

Retries operate at different layers. A lower layer must not conceal repeated work from the durable layer that owns its budget and attempt history.

| Layer | Typical trigger | Owner | Same identity? | Budget effect | Maximum outcome |
|---|---|---|---|---|---|
| Adapter transport retry | Connection reset before a confirmed response | Tool or Model Gateway adapter | Same tool/model invocation | Counts according to configured attempt policy | One invocation result |
| Tool-call retry | Retryable structured tool failure | Agent Control Plane | Same logical tool call; new execution attempt | Reserves additional operation budget | Validated tool result or terminal tool failure |
| Model-call retry | Retryable provider failure or declared schema-repair attempt | Model Gateway policy | Same task identity; new invocation attempt | Counts tokens, calls, time, and cost | Schema-valid response or terminal model failure |
| Agent-step continuation | Valid result leaves useful review work | Pi harness under control plane | New step identity | Counts iteration and relevant tool budgets | New persisted evidence, candidate, deterministic result, brief, or stop |
| Session retry | Process loss or retryable session infrastructure failure | Workflow Coordinator | New session attempt linked to prior session | Uses persisted remaining or newly authorized budget | Terminal session outcome |
| Stage retry | Agent stage fails or is redelivered | Workflow Coordinator and pg-boss | New stage attempt in same run | New configured stage budget envelope | Committed session outcome |
| New run | Inputs or material versions change | Workflow Coordinator | New processing-run identity | Fresh explicitly configured budgets | New immutable machine result |

`AGT-REQ-129` Only failures classified by trusted adapter or control-plane policy as retryable may be retried automatically.

`AGT-REQ-130` Retry classification must use stable reason codes and operation state, not free-form exception text or a model request to retry.

`AGT-REQ-131` A retry policy must define maximum attempts, backoff class, retryable categories, timeout, idempotency behavior, and budget accounting.

`AGT-REQ-132` Backoff waiting must not occupy a worker process when durable workflow scheduling can represent the delay.

`AGT-REQ-133` A transport retry must be prohibited when the adapter cannot determine whether a non-idempotent operation completed and no idempotency mechanism exists.

`AGT-REQ-134` A schema-repair model attempt must use an approved bounded repair prompt, count as a model call, and must not introduce document instructions into an authority-bearing channel.

`AGT-REQ-135` Repeating OCR, rendering, classification, or VLM extraction with unchanged inputs and versions must reuse compatible committed output when the operation contract declares it cacheable and integrity checks pass.

`AGT-REQ-136` A session retry must reconstruct remaining budgets from persisted reservations and reconciled usage; it must not reset consumed budgets automatically.

`AGT-REQ-137` A stage retry may authorize a new session budget only through versioned workflow policy and must retain the prior session and budget history.

`AGT-REQ-138` A material input, prompt, model route, tool implementation, schema, or case-review-policy change must not be hidden as a retry when reproducibility requires a new processing run.

`AGT-REQ-139` Retry exhaustion must yield one structured terminal outcome and return control to workflow fallback or human review without an internal infinite retry cycle.

## 13. Instruction-Injection Resistance

`AGT-REQ-080` Text or imagery instructing the Agent to ignore policy, reveal secrets, call tools, change rules, select a disposition, or perform a banking action must remain inert document data.

`AGT-REQ-081` Tool authorization must depend on trusted session scope and registry state, never on a model explanation of why an operation is allowed.

`AGT-REQ-082` A document cannot expand page, region, logical-document, case, run, field-schema, model, or tool scope.

`AGT-REQ-083` A tool result containing instruction-like text must retain the same untrusted-data treatment as source document text.

`AGT-REQ-084` The Agent must not reveal system instructions, prompt artifacts, registry internals, credentials, or unrelated processing data in a candidate or tool argument.

`AGT-REQ-085` Rejected policy-violating requests must be recorded using safe reason codes without persisting the sensitive requested content unnecessarily.

## 14. Case Review Brief

`AGT-REQ-144` The Workflow Coordinator must make exactly one current case-review attempt for every processable run. That session must be able to submit one brief for its current result revision before human review; a materially changed result requires a new linked report attempt or new case-review attempt according to workflow policy, never silent mutation of the prior brief.

`AGT-REQ-145` Before report submission, the Agent must obtain a deterministic `CaseReviewContext` containing document inventory, material claim references, evidence availability, extraction gaps, deterministic findings, recommended disposition, and safe processing diagnostics for one result revision.

`AGT-REQ-146` After the Agent consumes the `CaseReviewContext`, the report-submission phase must be read-only except for `submit_case_review_brief`; it must not submit new extraction candidates, mutate claims, rerun rules, change findings or disposition, or transition workflow state. Discovery of a material missing prerequisite must end the attempt with a structured reason rather than silently revising the sealed result.

`AGT-REQ-147` A `CaseReviewBrief` must contain schema version, bound result revision, report status, concise case summary, zero or more registered review signals, zero or more registered suggested actions, ordered reviewer-attention items, and supporting record references.

The initial review-signal vocabulary is `document_missing`, `document_type_uncertain`, `document_boundary_uncertain`, `field_missing`, `field_low_confidence`, `evidence_missing`, `evidence_ambiguous`, `conflicting_candidates`, `validation_finding_requires_attention`, `instruction_like_content_observed`, `processing_failure`, `agent_budget_exhausted`, and `agent_report_unavailable`.

The initial suggested-action vocabulary is `inspect_evidence`, `compare_claims`, `verify_extracted_value`, `review_document_boundary`, `review_missing_document`, `review_conflicting_candidates`, `review_agent_recovery`, `rerun_bounded_extraction`, `edit_issue`, `request_changes`, and `escalate_review`. The Agent must not suggest `accept_signal`, `dismiss_signal`, or `clear_for_downstream` for its own output.

`AGT-REQ-148` Every review signal and suggested action must cite at least one current persisted claim, evidence item, gap, finding, processing failure, or Agent-session outcome; free-standing speculation is invalid.

`AGT-REQ-149` The Agent may order reviewer-attention items within its brief but must not change deterministic finding severity, rule outcome, disposition precedence, or workflow priority.

`AGT-REQ-150` A deterministic Report Verifier must reject a brief whose schema is invalid, references are absent or outside the bound result revision, vocabulary is unregistered, displayed values conflict with referenced records, or content expresses a prohibited lending, creditworthiness, AML, KYC, account, pricing, disbursement, or customer-contact decision.

`AGT-REQ-151` Only a verified brief may be displayed as the current Agent report. Original submitted output and rejection reasons must remain immutable safe diagnostic provenance.

`AGT-REQ-152` Agent failure after a reviewable deterministic result exists, report timeout, budget exhaustion, or verification rejection must produce an explicit unavailable status and route that result to human review without fabricating a brief or blocking access to claims, evidence, findings, and disposition. Failure before a reviewable deterministic result exists must route through the owning workflow failure policy and must not fabricate a reviewable result.

`AGT-REQ-153` A human reviewer must confirm or supersede the document-processing result through registered review actions; an Agent suggestion never constitutes that action.

`AGT-REQ-154` Default continuous integration must cover verified, schema-rejected, reference-rejected, policy-rejected, timeout, and unavailable report fixtures with a fake Agent adapter.

## 15. Observability

`AGT-REQ-086` Agent telemetry must correlate case, run, gap, session, step, stage attempt, model invocation, tool call, and trace identifiers as applicable.

`AGT-REQ-087` Metrics must include session outcomes, terminal reasons, iterations, tool calls by name and outcome, VLM calls, token usage when available, estimated cost when available, duration, schema failures, no-progress stops, and candidate acceptance outcome.

`AGT-REQ-088` The Review Workbench must be able to query a safe ordered case Agent log containing selected actions, tool names, outcomes, evidence or result references, current step, model identity, usage, latency, and estimated cost availability.

`AGT-REQ-089` Logs and traces must not contain unrestricted model context, chain-of-thought, complete documents, page images, full identity numbers, full IBANs, or credentials.

`AGT-REQ-090` The system must report measured Agent behavior without claiming unsupported autonomy, accuracy, cost, latency, or production safety.

## 16. Acceptance Criteria

The Agent component is acceptable for implementation when automated tests demonstrate that:

`AGT-REQ-091` Each processable golden case starts one scoped case-review session after deterministic intake and minimum file preflight, and the fake-model path selects the expected registered tool sequence without relying on a fixed extraction pipeline.

`AGT-REQ-092` A schema-valid, evidence-linked Agent candidate enters ordinary reconciliation and can resolve its bound gap without becoming a finding directly.

`AGT-REQ-174` A value the Agent read from any authorized page of a gap's own logical document resolves that gap, including a continuation page, while a value cited from a page outside that document is rejected outside the model.

`AGT-REQ-175` A value no authorized tool returned for the cited page is rejected outside the model, and a candidate that cites committed native text, a returned recognition line, or a model-extraction value is recorded with that boundary as its extraction method.

`AGT-REQ-176` The ordering constraint of `AGT-REQ-166` is exercised end to end: a case whose recognition output already contains the required values resolves without any model-extraction call, and a partially readable case escalates only the requirements local processing did not resolve.

`AGT-REQ-179` A multimodal harness test must prove that an authorized page render reaches the model as image content while the corresponding durable session snapshot contains no image bytes.

`AGT-REQ-182` Acceptance tests must reject an invented report signal or suggested action at the tool boundary and must show the semantic role and extraction guidance in the bounded manifest.

`AGT-REQ-093` An unresolved or exhausted session preserves committed state and routes control back to durable workflow for human review, configured fallback, or technical exception handling according to whether a reviewable result exists.

`AGT-REQ-094` Every registered tool rejects cross-case, cross-run, cross-document, cross-page, cross-region, and unsupported-field access.

`AGT-REQ-095` Unknown tools, malformed arguments, runtime extensions, Shell requests, arbitrary file requests, and unrestricted network requests cannot execute.

`AGT-REQ-096` Extraction-model calls made by `extract_with_vlm` expose no tools and reject schema-invalid output.

`AGT-REQ-097` Iteration, tool-call, VLM-call, token, timeout, cost, pixel, and OCR budgets stop further affected work at their configured limits.

`AGT-REQ-098` Repeated equivalent actions terminate through the no-progress policy rather than loop indefinitely.

`AGT-REQ-099` Worker termination after a committed step permits recovery from PostgreSQL and pg-boss state without relying on Pi conversation memory.

`AGT-REQ-100` Duplicate stage-job delivery does not create duplicate authoritative sessions, candidates, or tool side effects.

`AGT-REQ-101` Prompt-injection fixtures cannot modify tools, schemas, prompts, budgets, rules, dispositions, workflow state, or banking capabilities.

`AGT-REQ-102` Fake harness, fake model, and fake tool adapters support deterministic default continuous-integration tests without paid or external model calls.

`AGT-REQ-103` The Agent-led demo path exposes selected document-review tools, resulting candidates and evidence, deterministic result requests, terminal outcome, latency, model usage, and estimated cost availability.

`AGT-REQ-177` The reviewer-facing Agent log distinguishes deterministic preprocessing performed by the system from document tools the Agent itself called, and names the model or adapter identity of a model-extraction step so a fixture stand-in cannot be read as a recognition result.

`AGT-REQ-155` Every primary demo path attempts report generation, exposes verification status and supporting references, and proceeds to human review even when the report is unavailable.

`AGT-REQ-156` A Case Review Brief may attach one applicant-readable requested-change draft to a review signal when the registered suggested action is `request_changes`; the draft must use plain language, remain evidence-grounded, and must not contain internal processing detail or imply customer-contact authority or a banking decision.

`AGT-REQ-157` The Report Verifier must validate requested-change draft structure, signal binding, references, and prohibited content. A verified draft remains non-authoritative and cannot be included in a final review message without an explicit human action.

`AGT-REQ-140` Eligibility tests prove that processable cases trigger Agent-in-the-Loop only after intake and minimum preflight, while fatal inputs, duplicate attempts, and insufficient budgets do not. Validation conflicts must remain reviewable inputs rather than suppressing the Agent attempt.

`AGT-REQ-141` Context tests prove that manifests are scoped, size-bounded, trust-labeled, reproducible, and preserve required control metadata during compaction.

`AGT-REQ-142` Tool-management tests prove the catalog is static, each session receives only an eligible subset, and every request traverses schema, authorization, budget, idempotency, execution, and output-validation controls.

`AGT-REQ-143` Retry tests distinguish transport, tool, model, step, session, stage, and new-run behavior and prove that usage and attempts are not reset or hidden across layers.

## 17. Assumptions and Deferred Evidence

1. Only synthetic or explicitly demo-safe documents enter the initial demonstration.
2. Exact budget values, no-progress limits, default model, fallback model, and scheduling thresholds require golden-set evidence and remain in [`../../BACKLOG.md`](../../BACKLOG.md).
3. Pi SDK integration details and hardening configuration require an implementation proof and `ADR_001_PI_AGENT_HARNESS.md` before the Agent vertical slice is considered complete.
4. Detailed field schemas and reconciliation behavior belong to the extraction and validation specifications or executable contract artifacts.
5. The initial Agent is single-purpose and does not provide a general user-facing chat interface.
6. The declared field-requirement set of `AGT-REQ-168` is owned by the extraction and validation specifications; its V1 content covers the fields the registered demonstration rule set needs and expands with document coverage.
7. The exact minimum preflight set and tool-view transition table require alignment with the data-model, workflow, and document-processing owners before implementation of version 3.0.0. The durable re-entry protocol is implemented: one authoritative session per run, linked attempts, committed tool results reused by canonical idempotency key, and remaining budgets reconstructed from persisted consumption. See `../decisions/ADR_001_PI_AGENT_HARNESS.md`.

Version 3.0.0 resolves Agent authority but creates dependent specification work for the session data model, workflow stage contract, and PDF Inspector tool adapters. Those approved owners remain authoritative until updated; implementation must not silently reinterpret their conflicting requirements.

## 18. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 3.4.0 | 2026-09-07 | Approved | Moved dynamic attention-reference authorization to the report tool boundary and limited report attention references to non-passing deterministic findings, allowing a live model to repair an invalid reference before session termination. |
| 3.3.0 | 2026-09-07 | Approved | Unified the report-submission tool and Report Verifier on the same closed schema, and exposed stable semantic roles and extraction guidance for declared requirements so a salary-payment counterparty cannot be confused with the account-holding bank. |
| 3.2.0 | 2026-09-07 | Approved | Made an authorized page render visible to the multimodal Pi model as transient tool content while persisting only its safe artifact reference, integrity metadata, and step summary. Source paths, object-store credentials, arbitrary files, and image bytes remain outside durable Agent state. |
| 3.1.0 | 2026-09-07 | Approved | Made the Agent the source of document-derived values: replaced `get_extraction_gaps` with `get_case_manifest`, required session work to be derived from a versioned declared field-requirement set and the committed document inventory rather than evaluation truth, scoped a gap to its logical document rather than a single page, required verbatim tool evidence and deterministic normalization for every submitted value, and added acceptance criteria for local-first routing and reviewer-facing actor attribution. No authority, budget, or workflow-ownership semantics changed. |
| 3.0.0 | 2026-09-06 | Approved | Replaced separate adaptive-recovery and report sessions with one bounded Agent-led case review, exposed PDF Inspector and deterministic processing through an exact registered tool ceiling, and defined prerequisites, durable re-entry, failure routing, and report finalization. |
| 2.1.1 | 2026-09-06 | Approved | Registered the report-mode terminal reasons `report_submitted` and `report_not_submitted` used by the implemented Pi harness; no authority or budget semantics changed. |
| 2.1.0 | 2026-09-04 | Approved | Added optional verified applicant-readable requested-change drafts without delivery or decision authority for the V1 review workflow. |
| 2.0.0 | 2026-09-04 | Approved | Expanded Pi into a per-case pre-screening Agent with a verified Case Review Brief while retaining optional bounded adaptive extraction. |
| 1.0 | 2026-09-03 | Approved | Approved the bounded Pi harness, Agent-in-the-Loop trigger, context, tool, retry, budget, stopping, persistence, and safety baseline. |
