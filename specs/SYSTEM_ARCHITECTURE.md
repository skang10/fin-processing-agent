# Financial Document AI Agent System Architecture Specification

Document ID: `ARC`

Version: 3.1.0

Status: Approved

Last updated: 2026-09-07

## 1. Purpose

This specification defines the system context, architectural principles, component boundaries, trust boundaries, processing topology, durable workflow, model and Agent isolation, persistence responsibilities, and cloud-compatibility constraints for Financial Document AI Agent.

The architecture supports the product requirements in [`PRODUCT_AND_SCOPE.md`](PRODUCT_AND_SCOPE.md). It does not redefine product scope, detailed domain schemas, component algorithms, API payloads, evaluation methodology, or deployment procedures.

## 2. Authority and Related Documents

This document owns:

1. System and external-actor boundaries.
2. Logical component responsibilities and prohibited responsibilities.
3. Trust zones and cross-zone data flow.
4. End-to-end processing topology.
5. Durable workflow and asynchronous coordination architecture.
6. Model-gateway and Case Review Agent placement.
7. Persistence-system responsibilities at an architectural level.
8. Runtime isolation and cloud-portability constraints.

Related authorities are:

1. [`INDEX.md`](INDEX.md) for terminology, controlled vocabularies, identifiers, and document ownership.
2. [`PRODUCT_AND_SCOPE.md`](PRODUCT_AND_SCOPE.md) for approved product behavior and exclusions.
3. [`LIMITATIONS.md`](../LIMITATIONS.md) for production-readiness and fitness limitations.
4. `DATA_MODEL.md`, when created and approved, for entity semantics, relationships, lifecycle, and immutability.
5. Component specifications, when created and approved, for detailed internal behavior.
6. ADRs, when accepted, for their declared technical decisions.

The [migration source specification](../Intelligent_Document_Processing_Agent_Specification.md) is non-authoritative for architecture concerns after this document is approved.

## 3. Architectural Goals

`ARC-REQ-001` The architecture must support the end-to-end product paths required by `PRD-REQ-001`, `PRD-REQ-124`, `PRD-REQ-125`, and `PRD-REQ-127` through `PRD-REQ-130`.

`ARC-REQ-002` The architecture must separate document ingestion, document processing, model interaction, deterministic validation, disposition mapping, and human review into explicit responsibilities.

`ARC-REQ-003` The architecture must preserve evidence and provenance across every processing boundary used to create a material claim or finding.

`ARC-REQ-004` The architecture must allow local extraction, OCR, VLM, and human review paths to produce interoperable outputs without treating their confidence semantics as interchangeable.

`ARC-REQ-005` The architecture must keep models outside the authority boundary for durable workflow state, validation semantics, recommended disposition, and core banking actions.

`ARC-REQ-006` The architecture must permit external-model adapters to be replaced by private-cloud or local adapters without changing domain contracts.

`ARC-REQ-007` The architecture must support reproducible reprocessing as an immutable processing run rather than overwriting a historical result.

`ARC-REQ-008` The architecture must be runnable as a local Docker Compose demonstration and remain compatible with a future container-based cloud deployment.

## 4. System Context

```text
                     +----------------------+
                     | Developer / Evaluator|
                     +----------+-----------+
                                |
                                | dataset and evaluation commands
                                v
+-----------+          +--------+---------+          +------------------+
| Submitter |--------->| Financial        |<---------| Human Reviewer   |
+-----------+  cases   | Document AI Agent|  review  +------------------+
                       +---+----------+----+
                           |          |
                     model |          | telemetry
                     calls |          v
                           v     +----+-------------+
                    +------+---+ | Observability    |
                    | External | | backend          |
                    | VLM/LLM  | +------------------+
                    +----------+
```

`ARC-REQ-009` The system boundary must include the Review Workbench, API, durable workflow, processing workers, model gateway, validation and disposition components, persistence adapters, and application audit capability.

`ARC-REQ-010` An external VLM or LLM endpoint must remain outside the trusted application boundary even when accessed through an approved adapter.

`ARC-REQ-011` A future upstream business system must remain outside the system boundary and may consume document-processing results only through an approved API contract.

`ARC-REQ-012` No component inside the system boundary may be granted a capability to approve or reject a loan, open an account, disburse funds, or contact a customer.

## 5. Runtime Topology

The initial release uses three application deployables and shared infrastructure:

```text
+-------------------+       +---------------------+
| Review Web        |------>| API Service         |
| static application| HTTPS |                     |
+-------------------+       | intake and queries  |
                            | review commands     |
                            +----+-----------+----+
                                 |           |
                         SQL/outbox           | object operations
                                 v           v
                         +-------+----+  +---+-------------+
                         | PostgreSQL |  | Object Storage  |
                         | + pg-boss  |  | S3-compatible   |
                         +------+-----+  +--------+---------+
                                |                 ^
                                | jobs            |
                                v                 | artifacts
                         +------+-----------------+--+
                         | Worker Service            |
                         | workflow stages           |
                         | document sandbox control  |
                         | model and Agent adapters   |
                         | validation and disposition|
                         +------+--------------+-----+
                                |              |
                                v              v
                       +--------+------+  +----+---------+
                       | Isolated      |  | External     |
                       | document task |  | VLM / LLM    |
                       +---------------+  +--------------+
```

`ARC-REQ-013` The initial runtime must separate the browser application, API process, and asynchronous worker process.

`ARC-REQ-014` The initial architecture must not require each logical component to be a separately deployed microservice.

`ARC-REQ-015` Logical components inside one deployable must communicate through typed interfaces so that a later process boundary does not change domain behavior.

`ARC-REQ-016` The API and worker deployables must be stateless with respect to durable case and processing-run state.

`ARC-REQ-017` Temporary local files may exist only within a bounded task workspace and must not be the authoritative source of an artifact or processing result.

### 5.1 Deployment style

The initial release is a modular monolith deployed as a small set of processes. It is not a microservice architecture. Logical modules share a repository and a PostgreSQL database while preserving explicit code, data-ownership, and dependency boundaries.

`ARC-REQ-140` The initial architecture must use a modular-monolith style with separate Review Web, API Service, and Worker Service deployables plus a restricted Document Sandbox execution boundary.

`ARC-REQ-141` A logical component must not be described as a separately deployed service unless it has an independent runtime process and operational lifecycle.

`ARC-REQ-142` PostgreSQL, object storage, the job queue, and the observability backend must be described as infrastructure dependencies rather than domain services.

`ARC-REQ-143` The initial release must not require service discovery, an internal service mesh, distributed sagas, or independently deployed domain microservices.

### 5.2 Service catalog

| Runtime unit | Kind | Responsibilities | Explicit exclusions |
|---|---|---|---|
| Review Web | Static browser application | Review Queue, Agent Report, document and structured-data inspection, issue review, requested-change draft recording, final review actions, and bounded case Agent log | Database access, durable state, document processing, customer-message delivery, model credentials, dataset authoring, golden-truth mutation, or aggregate Agent monitoring |
| API Service | Long-running Node.js process | HTTP edge, authentication context, contract validation, commands, polling queries, uploads, and review operations | Long-running PDF, OCR, VLM, Agent, and validation execution |
| Worker Service | Long-running Node.js process; horizontally repeatable | Job consumption, workflow-stage execution, bounded Pi session control, Agent-tool dispatch, document task control, reconciliation, validation, disposition, and Agent report verification | Public browser API, core banking actions, model-defined workflow authority, authoritative state outside persistence |
| Document Sandbox | Restricted subprocess or isolated task container | PDF parsing, PDFium rendering, image processing, and OCR for one bounded task | Direct database access, business credentials, model-provider credentials, unrestricted network access |
| Dataset CLI | Offline command process | Synthetic generation, truth validation, dataset build and load, evaluation, and reporting | Online case orchestration and mutation of released golden truth |

`ARC-REQ-144` Each runtime unit must have an explicit entry point, configuration surface, health behavior where long running, and least-privilege credential set.

`ARC-REQ-145` The Worker Service may host multiple logical modules in one process, but those modules must retain project-owned interfaces and data ownership.

`ARC-REQ-146` Horizontal Worker Service instances must coordinate through durable job claims and idempotent stage handlers rather than process-local locks.

### 5.3 Communication matrix

| Caller | Callee | Mechanism | Purpose | Payload boundary |
|---|---|---|---|---|
| Review Web | API Service | HTTP request/response | Commands, queries, uploads, and review actions | Versioned API contracts |
| API Service | PostgreSQL | SQL transaction | Case commands, query projections, review records, idempotency, and outbox | Typed repositories and transactions |
| API Service | Object storage | S3-compatible API | Streaming source upload and authorized artifact access | Bytes plus immutable object metadata |
| Outbox Dispatcher | pg-boss | PostgreSQL transaction and job enqueue | Publish committed workflow work | Versioned job reference, never document bytes |
| Worker Service | PostgreSQL and pg-boss | SQL and durable job protocol | Claim work, read state, and persist stage output | Typed repositories, jobs, and transactions |
| Worker Service | Object storage | S3-compatible API | Read source objects and write derived artifacts | Object reference plus integrity metadata |
| Worker Service | Document Sandbox | Restricted local IPC or bounded task protocol | Parse, render, OCR, and image processing | One authorized task and referenced artifacts |
| Worker Service | External VLM/LLM | HTTPS through Model Gateway | Approved classification, extraction, recovery, or matching operation | Minimal task context and constrained schema |
| Application deployables | Observability backend | OpenTelemetry Protocol | Logs, traces, and metrics | Allowlisted telemetry attributes |
| Dataset CLI | Application adapters or local infrastructure | Explicit command invocation | Load demo data and run evaluation | Versioned dataset and evaluation contracts |

`ARC-REQ-147` The API Service must not synchronously call the Worker Service to complete a long-running processing stage.

`ARC-REQ-148` The API Service and Worker Service must not require an internal HTTP API between them in V1; asynchronous commands use pg-boss and authoritative status uses PostgreSQL.

`ARC-REQ-149` A queue or event payload must contain typed identifiers, versions, and object references rather than complete files, page images, or unrestricted extracted text.

`ARC-REQ-150` Communication with the Document Sandbox must use a bounded request and response contract and must terminate with the task boundary.

`ARC-REQ-151` All external model communication must pass through the Model Gateway; a domain module must not call a provider endpoint directly.

### 5.4 Database ownership

The modular monolith shares one PostgreSQL database in V1. Logical ownership is assigned by module rather than by deployable, because both the API and Worker may participate in application use cases.

| Owning module | Owned data |
|---|---|
| Case | Cases, structured application data, case-level idempotency records |
| Workflow | Processing runs, stage executions, attempts, workflow state, outbox events |
| Document | Physical documents, pages, logical documents, artifact metadata |
| Extraction | Extraction candidates, claims, evidence metadata, extraction gaps |
| Entity Resolution and Validation | Entity links, matching opinions, validation findings, recommended dispositions |
| Review | Corrections, boundary corrections, review records, dataset-candidate flags |
| Audit | Application audit events |
| pg-boss | Queue-internal tables managed through the queue library |

`ARC-REQ-152` Each application table must have one owning logical module even when several deployables use the same database.

`ARC-REQ-153` A module must write its owned data through its own repository or application interface and must not update another module's tables through ad hoc SQL.

`ARC-REQ-154` A cross-module transaction may be coordinated by an application use case when atomicity is required, but participating writes must still pass through the owning module interfaces.

`ARC-REQ-155` Cross-module read models may use explicit query projections, but a projection must not become an undocumented write path.

`ARC-REQ-156` Database foreign keys may enforce referential integrity across owned table groups within the shared PostgreSQL database.

`ARC-REQ-157` The detailed data specification must assign every domain aggregate and table concept to one owner consistent with this section.

### 5.5 Module boundaries

`ARC-REQ-158` Domain modules must expose typed application or repository interfaces and must not exchange web-framework requests, database rows, provider SDK responses, or object-store SDK types as domain contracts.

`ARC-REQ-159` Cross-module dependencies must follow the processing direction or depend on shared domain contracts; circular module dependencies are not permitted.

`ARC-REQ-160` A module boundary must remain testable without starting every deployable or contacting an external model.

### 5.6 Future microservice extraction

The initial modular boundaries permit later extraction but do not promise that extraction will be necessary.

`ARC-REQ-161` A logical module may become an independently deployed service only after an approved architecture change identifies a concrete need such as independent scaling, release ownership, failure isolation, security isolation, or technology specialization.

`ARC-REQ-162` A proposed service extraction must define its API or event contract, data ownership, migration path, consistency model, failure handling, observability, and operational cost.

`ARC-REQ-163` A service extraction must not create a shared-table write dependency between independently deployed services.

## 6. Trust Zones

| Zone | Contents | Trust posture |
|---|---|---|
| Z0 — Untrusted input | Uploaded files, structured caller input, document text, images, metadata, model output | Must be validated before domain use; content cannot grant authority |
| Z1 — User edge | Browser and future upstream caller | Authenticated context is required; client state is never authoritative |
| Z2 — Application control plane | API, Workflow Coordinator, validation, disposition, review commands | Trusted to enforce contracts and state transitions; holds no core banking authority |
| Z3 — Durable data plane | PostgreSQL and object storage | Authoritative for persisted application state and artifacts; access is service-scoped |
| Z4 — Restricted processing | PDF parsing, rendering, OCR, image processing | Assumes parser compromise is possible; isolated and resource limited |
| Z5 — Model processing | VLM/LLM adapters and bounded Pi session | Output is untrusted; tools and context are explicitly constrained |
| Z6 — Observability | Logs, traces, metrics, dashboards | Receives identifiers and measurements, not unrestricted document content |

`ARC-REQ-018` Every transition from Z0 into a trusted component must apply an allowlisted schema, file control, or artifact-integrity check appropriate to the data type.

`ARC-REQ-019` Passing an intake check must not cause a document or its content to be treated as trusted instructions.

`ARC-REQ-020` Z4 document processing must not receive business-system credentials, database administration credentials, unrestricted object-store credentials, or unrestricted network access.

`ARC-REQ-021` Z5 model processing must not receive a complete case package when a selected page, page window, region, or structured claim set is sufficient.

`ARC-REQ-022` Z6 telemetry must use allowlisted attributes and must not receive full documents, page images, unrestricted extracted text, full identity numbers, or full IBANs.

`ARC-REQ-023` A response from Z4 or Z5 must be treated as an extraction or classification candidate until validated by a trusted application component.

## 7. Logical Components

### 7.1 Review Web

The Review Web is the browser application for the Review Queue, compact case progress, Agent Report, evidence inspection, issue review, requested-change draft recording, final document-review actions, and a bounded case Agent log. It does not deliver customer messages. Detailed processing, aggregate Agent monitoring, and audit records remain backend or later operational concerns rather than V1 reviewer views. Dataset authoring and golden-truth mutation are outside its boundary.

`ARC-REQ-024` The Review Web must access case and document capabilities only through the API Service.

`ARC-REQ-025` The Review Web must not receive permanent object-store credentials or direct database access.

`ARC-REQ-026` Browser state must not be authoritative for a case, processing run, correction, finding, disposition, or audit event.

### 7.2 API Service

The API Service authenticates the caller, validates transport contracts, accepts uploads or approved object references, creates case commands, serves queries, records review commands, and provides processing events.

`ARC-REQ-027` The API Service must not perform PDF parsing, OCR, VLM inference, or long-running extraction in a request handler.

`ARC-REQ-028` Case intake must persist the accepted command and an outbox event before returning asynchronous acceptance.

`ARC-REQ-029` The API Service must stream uploaded content to an object-store write path rather than retaining an entire large document in application memory.

`ARC-REQ-030` The API Service must reject an arbitrary public URL as a document source.

### 7.3 Workflow Coordinator

The Workflow Coordinator evaluates committed stage state and schedules the next eligible stage through the outbox and job queue.

`ARC-REQ-031` The Workflow Coordinator must be deterministic for the same persisted run state and workflow version.

`ARC-REQ-032` The Workflow Coordinator must not use free-form model output to select an unregistered workflow stage.

`ARC-REQ-033` Workflow evolution must use an explicit workflow version recorded by each processing run.

`ARC-REQ-034` A stage must be scheduled only after its required predecessor outputs are committed.

### 7.4 Intake Guard

The Intake Guard performs the prototype's basic file and structured-input controls before semantic document processing.

`ARC-REQ-035` The Intake Guard must verify supported media type, configured resource limits, integrity metadata, and readable input before releasing an artifact to document processing.

`ARC-REQ-036` The Intake Guard must preserve the distinction between `accepted`, `rejected`, and `not_scanned`; it must not report malware safety when no malware scanner ran.

### 7.5 Document Processing and PDF Inspector Tool Component

The Document Processing Component wraps PDF Inspector and related native runtimes behind project-owned, schema-validated operations. After intake has established file safety, identity, and immutable storage, these operations are offered to the bounded Pi Case Review Agent as case-scoped tools for inspection, native-text access, rendering, classification, boundary analysis, selective OCR, and local table candidates. The component, not the model, owns execution, provenance, caching, prerequisite enforcement, and resource limits.

`ARC-REQ-037` Document processing must preserve physical-file, page, render, coordinate, and processor lineage.

`ARC-REQ-038` Native extraction must precede OCR when usable native content exists.

`ARC-REQ-039` OCR must be selectable per page rather than only per physical document.

`ARC-REQ-040` Business-page classification and boundary prediction must precede deterministic contiguous-page grouping.

`ARC-REQ-041` The initial architecture must not contain an automatic cross-file merge or non-contiguous page-reordering component.

`ARC-REQ-167` PDF Inspector capabilities exposed to the Agent must be registered project-owned tools rather than provider SDK objects, Shell commands, arbitrary file access, or unrestricted parser options.

`ARC-REQ-168` The tool control plane must enforce native-text inspection before OCR for the same usable page and must permit VLM extraction only after approved local paths leave an explicit unresolved need.

`ARC-REQ-169` A document tool invocation must be idempotent or resolve to an immutable cached artifact for the same run, source, operation version, and bounded arguments.

### 7.6 Extraction and Reconciliation Component

The Extraction and Reconciliation Component maps native, OCR, table, and VLM candidates into approved field schemas, normalizes values, binds evidence, and identifies extraction gaps or conflicts.

`ARC-REQ-042` This component must preserve competing candidates and provenance until a deterministic reconciliation result or human correction exists.

`ARC-REQ-043` This component must not convert a model candidate into a verified cross-document finding.

`ARC-REQ-044` This component must create an explicit extraction gap when a required value, structure, relationship, or evidence location remains unresolved.

### 7.7 Model Gateway

The Model Gateway presents provider-neutral, task-specific operations for page classification, structured extraction, table recovery, and constrained entity matching.

`ARC-REQ-045` Domain and workflow components must not depend on a model-provider SDK type.

`ARC-REQ-046` Each model invocation must bind to an immutable model, prompt, input-schema, and output-schema version.

`ARC-REQ-047` A model adapter must return usage and latency metadata when the provider makes it available.

`ARC-REQ-048` A model adapter must validate its response envelope before returning a candidate to a domain component.

`ARC-REQ-049` A model adapter failure must be classified as retryable, non-retryable, budget-exhausted, schema-invalid, or unavailable before workflow handling.

### 7.8 Pi Case Review Agent

The Pi Case Review Agent is the mandatory-attempt pre-screening orchestrator for every processable case. After deterministic intake and minimal file preflight, one bounded case-review session selects from registered document-inspection, extraction, evidence, reconciliation-request, validation-request, and report-submission tools. The Agent may adapt its review plan to the case, but it does not own durable workflow transitions, execute native libraries directly, or determine authoritative claims, findings, or dispositions. The previously separate adaptive-recovery behavior becomes a bounded part of this case-review session when approved local extraction leaves an eligible explicit gap.

`ARC-REQ-050` The Agent must be created with no default coding, Shell, arbitrary file, package-management, or unrestricted network tools.

`ARC-REQ-051` The Agent must receive only the case and run identity, bounded input inventory, committed tool results relevant to the active review, approved tool schemas, and execution budgets required for its task.

`ARC-REQ-052` Each Agent tool must enforce case, run, document, page or region, input-schema, and authorization boundaries outside the model.

`ARC-REQ-053` The Agent must not write directly to authoritative claim, finding, disposition, rule, prompt, or workflow tables.

`ARC-REQ-054` Submitted Agent candidates must pass the same schema, evidence, and reconciliation boundaries as non-Agent extraction candidates.

`ARC-REQ-174` The bounded Agent may visually inspect an uploaded document only through an authorized page or region rendering tool. The model receives transient image content plus a safe artifact reference; it must not receive source filesystem paths, object-store credentials, or arbitrary file access, and image bytes must not enter durable Agent state or telemetry.

`ARC-REQ-055` Agent-session state must not be the authoritative record of durable workflow progress.

`ARC-REQ-164` Report submission must occur only after the control plane makes committed reconciliation, findings, and recommended disposition available; report generation must not expose a tool that can mutate those authoritative outputs.

`ARC-REQ-165` A deterministic Report Verifier must validate report schema, references, registered vocabularies, value consistency, and prohibited-decision language before publication.

`ARC-REQ-166` Report generation or verification failure must not prevent routing the deterministic result to Human-in-the-Loop review.

`ARC-REQ-170` The Agent may choose among registered tools and bounded targets, but deterministic control-plane policy must enforce prerequisites, case and run scope, tool compatibility, evidence requirements, model-routing policy, and cumulative budgets before execution.

`ARC-REQ-171` The Agent must not declare a claim accepted, a validation rule complete, or a disposition available merely by emitting prose; it must request the corresponding deterministic component operation and consume its committed result.

`ARC-REQ-172` The workflow must persist enough session and tool state to resume or safely restart case review without treating model conversation memory as durable truth.

`ARC-REQ-173` Failure of the Agent before report submission must preserve committed tool artifacts and deterministic outputs and must route the case to human review with an explicit Agent-unavailable status when a reviewable deterministic result exists.

### 7.9 Entity Resolution Component

The Entity Resolution Component relates claims associated with applicant, identity-holder, employee, account-holder, employer, and payment-counterparty roles.

`ARC-REQ-056` Entity resolution must attempt deterministic normalization and configured similarity methods before an LLM fallback.

`ARC-REQ-057` An LLM fallback must receive only the minimal structured claims required for the comparison.

`ARC-REQ-058` An LLM fallback may return only a constrained matching opinion and must not return a validation finding or disposition.

### 7.10 Validation Engine

The Validation Engine executes registered, versioned rules selected by a versioned rule-set manifest.

`ARC-REQ-059` The Validation Engine must consume persisted, schema-valid claims, evidence state, and constrained entity-resolution results.

`ARC-REQ-060` The Validation Engine must reject an unknown, inactive, incompatible, or unregistered rule.

`ARC-REQ-061` A model must not create, modify, activate, order, or change the outcome semantics of a validation rule at runtime.

`ARC-REQ-062` The Validation Engine must produce findings without selecting a recommended disposition.

### 7.11 Disposition Mapper

The Disposition Mapper converts persisted processing state and validation findings into one controlled document-processing recommendation.

`ARC-REQ-063` The Disposition Mapper must not read raw document content or reinterpret extraction evidence.

`ARC-REQ-064` The Disposition Mapper must be deterministic for the same input state and disposition-policy version.

`ARC-REQ-065` The Disposition Mapper must emit only a recommended-disposition value defined by `INDEX.md`.

`ARC-REQ-066` The Disposition Mapper must not expose or invoke a core banking action.

### 7.12 Review Component

The Review Component validates and persists reviewer corrections, boundary corrections, and review dispositions without modifying original machine outputs.

`ARC-REQ-067` A review command must include an authenticated actor and required reason where the product specification requires one.

`ARC-REQ-068` A review command must append a correction or review revision and an audit event in one durable transaction.

`ARC-REQ-069` A human correction must not automatically update a prompt, model, validation rule, threshold, disposition policy, or golden truth.

### 7.13 Audit Component

The Audit Component creates application-level append-only events for material automated and human actions.

`ARC-REQ-070` Audit events must be persisted independently of logs and traces.

`ARC-REQ-071` The application must not expose an update operation for an existing audit event.

`ARC-REQ-072` The initial Audit Component must not be represented as tamper-proof, WORM-compliant, or suitable for statutory retention.

### 7.14 Dataset and Evaluation Tooling

Dataset and evaluation tooling operates outside the online case-processing path. It generates synthetic artifacts and truth, validates dataset releases, loads demo cases, runs offline or explicit live evaluation, and produces versioned reports.

`ARC-REQ-073` Online workers must not generate or silently mutate golden truth.

`ARC-REQ-074` Default automated evaluation must use fake-model adapters or fixed responses and must not require an external paid model.

`ARC-REQ-075` Live-model evaluation must be an explicit developer operation with a configured budget and separate report identity.

## 8. Durable Workflow

### 8.1 Stage graph

The architecture uses a versioned durable control graph around one bounded Agent-led review session. Tool calls may be selected dynamically by the Agent, but the set of tools, their prerequisites, authorization, output contracts, persistence effects, and terminal conditions are versioned deterministic policy. Retry attempts do not create new stage types.

```text
intake
  -> file preflight and immutable source registration
  -> bounded Pi case-review session
      -> inspect package and selected pages with PDF Inspector tools
      -> use native text before selective OCR
      -> use bounded VLM extraction only for eligible unresolved needs
      -> submit evidence-linked extraction candidates
      -> request deterministic reconciliation and entity resolution
      -> request the registered validation rule set and disposition mapping
      -> inspect committed findings and evidence
      -> submit a Case Review Brief
  -> deterministic report verification
  -> review_required
```

The diagram describes authority and dependency order, not a requirement that every case invoke every tool. A native-text case may complete without OCR or VLM. Tool output and deterministic component output remain immutable run artifacts even when the Agent session later fails.

`ARC-REQ-076` The workflow definition must identify stage dependencies, input contract versions, output contract versions, retry policy references, and completion conditions.

`ARC-REQ-077` A case lifecycle state must summarize the active run; it must not replace per-stage execution state.

`ARC-REQ-078` Independent page-level work may execute concurrently when its output identity and ordering remain deterministic.

`ARC-REQ-079` A worker must claim a durable job before executing its stage and must record the resulting attempt outcome.

`ARC-REQ-080` A stage handler must tolerate at-least-once job delivery without creating duplicate authoritative outputs.

`ARC-REQ-081` The system must use an idempotency identity derived from the run, stage, relevant input version, and work partition.

### 8.2 Transactional outbox

`ARC-REQ-082` A domain-state change that requires later asynchronous work must create its outbox event in the same database transaction.

`ARC-REQ-083` An outbox dispatcher must publish eligible events to the job queue and record successful publication idempotently.

`ARC-REQ-084` Failure between domain commit and job publication must be recoverable without manual reconstruction of case state.

### 8.3 Partial failure

`ARC-REQ-085` A failed partition must not erase successful immutable outputs from another partition or earlier stage.

`ARC-REQ-086` A downstream stage must consume only committed outputs that satisfy its declared input contract.

`ARC-REQ-087` A run with incomplete required stages must not transition to `completed`; a case with unresolved required evidence must not transition to `ready`.

`ARC-REQ-088` A retry, fallback, review, or terminal-failure path must be selected from persisted error classification and workflow policy rather than free-form exception text.

`ARC-REQ-174` The Workflow Coordinator may schedule the bounded case-review stage but must not prescribe one fixed document-processing path inside that stage when multiple registered, policy-eligible tools can satisfy the case.

`ARC-REQ-175` Agent-selected tool order must remain reconstructable from persisted step records and must be reproducible under the deterministic fake-model acceptance adapter.

## 9. Primary Processing Sequence

```text
Submitter      API        Object Store    PostgreSQL    Worker      Model/Agent
    |           |              |              |           |             |
    | create    |              |              |           |             |
    |---------->| stream file  |              |           |             |
    |           |------------->|              |           |             |
    |           | store case + run + outbox   |           |             |
    |           |---------------------------->|           |             |
    | 202       |              |              |           |             |
    |<----------|              |              |           |             |
    |           |              |              | job       |             |
    |           |              |              |---------->|             |
    |           |              |              | start bounded Agent     |
    |           |              |              |           |------------>|
    |           |              | read selected source/tool request      |
    |           |              |<-------------|-----------|<------------|
    |           |              |              | execute + persist tool  |
    |           |              |              |<----------|             |
    |           |              |              | candidate/reconcile/rule|
    |           |              |              |<----------|------------>|
    |           |              |              | verify submitted report |
    |           |              |              |<----------|             |
    | poll      |              |              |           |             |
    |---------->| query state  |              |           |             |
    |           |---------------------------->|           |             |
    |<----------| result/events|              |           |             |
```

`ARC-REQ-089` The API must acknowledge accepted asynchronous case creation without waiting for semantic document processing.

`ARC-REQ-090` The V1 browser must obtain authoritative state through polling query APIs, not by observing worker or Agent sessions directly. Event delivery is deferred.

`ARC-REQ-091` Every asynchronous boundary must propagate or link request, case, run, job, stage, and trace identifiers as applicable.

## 10. Storage Responsibilities

### 10.1 PostgreSQL

PostgreSQL is authoritative for case metadata, processing runs, stage executions and attempts, logical-document metadata, extraction candidates, claims, evidence metadata, entity relationships, findings, dispositions, corrections, audit events, idempotency records, workflow versions, outbox events, and job-queue state.

`ARC-REQ-092` Relational records must reference large binary artifacts by immutable object identity rather than storing those bytes in ordinary domain columns.

`ARC-REQ-093` Database migrations must be explicit, version controlled, and applied before application code that requires them.

`ARC-REQ-094` Application startup must not generate an unreviewed database schema from current code.

### 10.2 Object storage

Object storage is authoritative for source files and large derived artifacts such as page renders or bounded model-input images.

`ARC-REQ-095` An object reference must include or resolve to integrity, size, media-type, version, and lineage metadata.

`ARC-REQ-096` A source object must not be overwritten by re-upload, reprocessing, or derivation.

`ARC-REQ-097` Queue messages must carry object references and integrity metadata rather than document bytes.

`ARC-REQ-098` Browser artifact access must use an expiring or API-mediated capability and must not expose permanent storage credentials.

### 10.3 Temporary workspace

`ARC-REQ-099` A document task must use a task-specific temporary workspace with a bounded lifetime and explicit cleanup after success or failure.

`ARC-REQ-100` Temporary workspace cleanup must not delete an authoritative object or operate on an unresolved broad path.

## 11. Model and Prompt Architecture

### 11.1 Task-specific operations

The Model Gateway exposes task-specific operations rather than a generic unrestricted chat interface to domain components.

`ARC-REQ-101` A model operation must declare its task, allowed input shape, allowed output shape, and prompt artifact.

`ARC-REQ-102` A model operation must bind untrusted document content as data and must not concatenate it into an authority-bearing instruction channel.

`ARC-REQ-103` A model operation must not expose a tool unless the owning Agent specification explicitly permits that tool and an external wrapper enforces its scope.

### 11.2 Prompt registry

`ARC-REQ-104` Runtime prompt resolution must produce an immutable prompt version and content hash before model invocation.

`ARC-REQ-105` A processing run must retain the resolved prompt version rather than only a mutable environment alias.

`ARC-REQ-106` Loss of a future remote prompt registry must not cause the system to select an unapproved latest prompt automatically.

### 11.3 Model selection

`ARC-REQ-107` The architecture must permit configuration of a default model and fallback model selected through evaluation evidence.

`ARC-REQ-108` The Case Review Agent must not choose an arbitrary provider or model outside the configured operation.

`ARC-REQ-109` Model fallback must preserve task and output-contract semantics and must be visible in run provenance.

## 12. Security Architecture

### 12.1 Instruction injection

`ARC-REQ-110` A document instruction must have no direct path to a Workflow Coordinator command, rule registry, disposition policy, credential, or core banking capability.

`ARC-REQ-111` A model-returned tool request must be rejected unless the tool is registered for the active Agent task and its arguments pass external authorization and schema validation.

`ARC-REQ-112` A model response that fails schema validation must not be repaired by directly executing instructions found inside that response.

### 12.2 Identity and access

`ARC-REQ-113` Application components must consume a unified authentication context rather than depend directly on the development authentication mechanism.

`ARC-REQ-114` Development-only authentication must fail closed when the application is not explicitly configured for development use.

`ARC-REQ-115` Service credentials must be scoped to the minimum database, object, queue, model, or telemetry operations needed by the deployable.

### 12.3 Secrets

`ARC-REQ-116` Secrets must enter a deployable through an injected configuration boundary and must not be embedded in source, prompt artifacts, queue payloads, logs, traces, or browser bundles.

`ARC-REQ-117` Restricted document-processing tasks must not inherit model-provider or unrelated service credentials.

## 13. Observability Architecture

`ARC-REQ-118` API requests, outbox publication, job execution, document processing, model calls, validation, disposition, and review commands must participate in one trace or an explicit linked-trace relationship.

`ARC-REQ-119` Structured logs must carry stable correlation identifiers and machine-readable event names.

`ARC-REQ-120` Metrics must describe volume, stage latency, failure, retry, queue depth, extraction path, model usage, schema failure, and review activity without high-cardinality document content.

`ARC-REQ-121` Application audit events must remain distinct from operational logs and traces.

`ARC-REQ-122` A telemetry-backend outage must not grant broader processing authority or cause unrestricted sensitive payload logging.

## 14. Cloud Compatibility

`ARC-REQ-123` Application deployables must run as stateless containers with configuration supplied externally.

`ARC-REQ-124` Durable state must use PostgreSQL and an S3-compatible object-storage contract rather than a container-local filesystem.

`ARC-REQ-125` Worker concurrency must be configurable without changing a job or domain contract.

`ARC-REQ-126` The architecture must expose health, readiness, and graceful-shutdown behavior for long-running deployables.

`ARC-REQ-127` Database, object-storage, model, prompt-registry, identity, and telemetry implementations must sit behind replaceable interfaces where a cloud provider could otherwise enter domain code.

`ARC-REQ-128` The initial architecture must not require a Kubernetes control plane, provider-specific event bus, or provider-specific identity type.

`ARC-REQ-129` The deployment specification may map the architecture to AWS services, but the application domain must remain cloud neutral.

## 15. Architectural Constraints

The accepted initial technical baseline is TypeScript on Node.js, a Fastify API, TypeBox contracts, PostgreSQL with Drizzle, pg-boss, S3-compatible storage, React Review Web, OpenTelemetry, and Docker Compose. Detailed installation, version, and operations procedures belong to ADRs and the deployment specification.

`ARC-REQ-130` The initial architecture must not require Bun, Nx, Turborepo, Temporal, Kafka, Redis, Elasticsearch, a vector database, Kubernetes, Terraform, or a general-purpose rule DSL.

`ARC-REQ-131` Introducing a prohibited or materially equivalent platform must require an approved architecture change that identifies the need, alternatives, operational cost, and migration effect.

`ARC-REQ-132` An external library must be wrapped at a project-owned boundary when its types, lifecycle, or failure semantics would otherwise spread into domain logic.

## 16. Conformance and Verification

Architecture conformance must be demonstrated through automated tests, static dependency rules where practical, and the three product acceptance paths.

`ARC-REQ-133` A dependency test must prevent domain packages from importing model-provider SDKs, web-framework request types, object-store SDK types, or database adapter types.

`ARC-REQ-134` An Agent security test must prove that an unregistered tool request cannot execute.

`ARC-REQ-135` An instruction-injection test must prove that document content cannot modify the registered tool set, rule set, or disposition vocabulary.

`ARC-REQ-136` A workflow recovery test must prove that committed state can resume after worker termination without relying on Agent-session memory.

`ARC-REQ-137` An idempotency test must prove that repeated delivery of the same stage job does not create a duplicate authoritative output.

`ARC-REQ-138` An artifact-lineage test must trace a material displayed claim to its source artifact, page or structured-input location, extraction method, and processing run.

`ARC-REQ-139` A cloud-compatibility test must prove that application startup does not depend on a persistent container-local filesystem.

## 17. Assumptions

1. The demonstration uses only synthetic or explicitly demo-safe data.
2. PostgreSQL and S3-compatible storage are available to online deployables.
3. External model availability is optional for offline acceptance because fake adapters exist.
4. One Worker Service may host several logical processing components in V1.
5. A restricted subprocess or container boundary is available for native PDF, rendering, image, and OCR work.
6. The detailed data model may refine table and relationship shapes without changing the component responsibilities defined here.

## 18. Unresolved Architecture Questions

Version 3.0.0 is approved. Component specifications must subsequently define the exact tool registry, mandatory prerequisites, durable session re-entry protocol, and failure behavior when the Agent becomes unavailable before a reviewable deterministic result exists.

The following evidence-dependent decisions remain in [`BACKLOG.md`](../BACKLOG.md):

1. Evaluation evidence for the Agent-led document-tool policy and its deterministic fake-model path.
2. The measured PDF Inspector and PP-OCRv6 baseline.
3. The default and fallback VLM selection.
4. The measured quality, latency, and cost baseline.

These decisions may refine adapters, versions, thresholds, and budgets. They must not weaken the trust boundaries or component-authority limits in this specification.

## 19. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 3.1.0 | 2026-09-07 | Approved | Allowed the bounded multimodal Agent to inspect authorized uploaded-document page renders as transient tool content while retaining document sandboxing, artifact authorization, and non-persistence of page-image bytes. |
| 3.0.0 | 2026-09-06 | Approved | Made bounded Pi the case-review orchestrator after deterministic file preflight, exposed PDF Inspector through registered case-scoped tools, folded adaptive recovery into the main session, and retained deterministic persistence, reconciliation, validation, disposition, and report verification authority. |
| 2.2.0 | 2026-09-04 | Approved | Reduced V1 browser integration to polling and a bounded case Agent log; deferred SSE and aggregate Agent monitoring. |
| 2.1.0 | 2026-09-04 | Approved | Aligned Review Web with the V1 HTML baseline, separated Agent monitoring from case review, and limited requested changes to recorded drafts without customer delivery. |
| 2.0.0 | 2026-09-04 | Approved | Added per-case Pi pre-screening, verified Case Review Brief generation, and fail-open routing to human review while retaining bounded gap recovery. |
| 1.1.1 | 2026-09-04 | Approved | Removed development annotation from the Review Web boundary; golden truth remains an offline Dataset CLI responsibility. |
| 1.1.0 | 2026-09-03 | Approved | Corrected the run-versus-case lifecycle boundary and adopted the processing-run status vocabulary defined by `INDEX.md`. |
| 1.0 | 2026-09-03 | Approved | Approved the system architecture baseline, including the modular-monolith deployment, service communication, and database-ownership model. |
