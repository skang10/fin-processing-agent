# Financial Document AI Agent

## Migration Source Specification

Version: 2.0

Status: Superseded

Project type: Production-shaped machine learning prototype

Reference scenario: Single-applicant personal-loan document review in Germany

Document and application language: English

Supported input-document languages: German and English

## 1. Purpose

> **Archived migration source:** This document was superseded on 2026-09-05 by the approved owning specifications indexed in [`specs/INDEX.md`](specs/INDEX.md). It is retained only for migration history and must not be used as an implementation baseline.

This specification formerly defined the reviewed migration baseline for Financial Document AI Agent. The system demonstrates how a reliable machine learning pipeline can inspect financial documents, extract evidence-linked claims, recover from difficult extraction cases with a bounded Agent, compare facts across documents, and route unresolved results to a human reviewer.

The initial release is not a production banking system. It must use synthetic or explicitly demo-safe data and must be presented with the limitations defined in [`LIMITATIONS.md`](LIMITATIONS.md).

This file is an archived migration source. Approved documents under `specs/` are authoritative.

## 2. Product Boundary

### 2.1 In scope

1. Receive structured application data and supporting PDF, JPEG, or PNG documents.
2. Validate basic file properties and store immutable source objects.
3. Inspect PDF structure and distinguish native-text, scanned, image-based, and mixed pages.
4. Classify pages into supported business-document types.
5. Split a physical PDF into contiguous logical documents.
6. Extract native text, layout, tables, and coordinates.
7. Run selective local Optical Character Recognition (OCR).
8. Route difficult pages, bounded page windows, or cropped regions to a Vision Language Model (VLM).
9. Use a bounded Pi Agent loop to recover unresolved extraction gaps.
10. Normalize extracted values while preserving raw observations.
11. Bind material claims to page or structured-input evidence.
12. Resolve person and organization roles across documents.
13. Run a finite demonstration validation rule set.
14. Derive a deterministic recommended document-processing disposition.
15. Provide a Human Review Workbench for evidence inspection and correction.
16. Measure extraction quality, evidence quality, routing, latency, cost, and human correction.

### 2.2 Outside the initial scope

1. Lending approval, decline, creditworthiness determination, pricing, loan amount, or loan-term decisions.
2. Account opening, fund disbursement, customer notification, or any other core banking action.
3. Final Anti-Money Laundering (AML) or Know Your Customer (KYC) disposition.
4. A complete German bank policy or compliance implementation.
5. Processing real personal financial or banking data in the demo deployment.
6. Joint applications, self-employed applicants, pension income, and benefit income.
7. Tagged Image File Format (TIFF).
8. Foreign-exchange conversion.
9. Training a proprietary foundation model.
10. A general-purpose rule Domain-Specific Language (DSL).
11. Enterprise malware scanning or Content Disarm and Reconstruction (CDR).
12. Production high availability, disaster recovery, legal hold, or formal Service Level Agreements (SLAs).

## 3. Users

### 3.1 Submitter

The submitter creates a demo case, supplies structured application data and documents, and monitors processing status.

### 3.2 Reviewer

The reviewer examines extracted fields, document boundaries, conflicts, evidence, and processing failures. The reviewer may correct a value or record a document-review disposition with a reason.

### 3.3 Developer or evaluator

The developer runs synthetic dataset generation, golden evaluation, model comparison, regression tests, and local observability tools.

### 3.4 Administrator

The administrator may inspect configuration versions and system health. The initial release does not provide runtime model, prompt, validation-rule, or policy editing.

## 4. Initial Scenario and Documents

### 4.1 Scenario

The initial scenario is a single natural person submitting documents for a German personal-loan document review. The scenario is used to demonstrate document processing only; it does not implement a lending decision.

### 4.2 Core inputs

1. Structured application data supplied as JSON.
2. A supported German identity document: Personalausweis or German passport.
3. Payslips.
4. Bank statements.

Address or employment evidence may be classified and displayed, but complete field-level extraction and cross-document validation are not initial-release commitments.

### 4.3 Currency and language

1. Project specifications, API fields, code identifiers, and reason codes use English.
2. The evaluated synthetic documents use German, English, or a mixture of both.
3. Euro (EUR) is the validation currency.
4. A foreign-currency value may be preserved as extracted data, but the system does not convert it or use it to produce a ready disposition.

## 5. Product Principles

1. Local processing must precede external model use where it can produce an adequate result.
2. Models must receive the minimum page, page window, region, text, and schema context necessary for their task.
3. Every material claim must link to source evidence.
4. Extraction candidates, validation findings, and recommended dispositions must remain separate concepts.
5. Deterministic code must perform arithmetic, date comparison, checksum validation, schema validation, rule evaluation, and disposition mapping.
6. Model output must be treated as an unverified candidate until it passes structural and evidence checks.
7. Documents are untrusted data. Text inside a document must not modify system instructions, tools, rules, permissions, or dispositions.
8. Missing evidence or unresolved required extraction must prevent a ready disposition.
9. Original model outputs, human corrections, and processing runs must remain independently traceable.
10. Claims about quality, latency, and cost must reference a dataset version and measured result.

## 6. Processing Architecture

### 6.1 Processing sequence

```text
Case intake
  -> basic file validation
  -> immutable object storage
  -> PDF/image inspection and rendering
  -> page classification and boundary prediction
  -> deterministic contiguous-page grouping
  -> native text/table extraction or selective OCR
  -> fixed VLM fallback for configured cases
  -> optional bounded Adaptive Extraction Loop for eligible remaining gaps
  -> normalization and evidence binding
  -> entity, role, and claim resolution
  -> demonstration validation rules
  -> deterministic recommended-disposition mapping
  -> bounded Pi Case Review Brief and deterministic verification
  -> Human-in-the-Loop review
```

### 6.2 Durable workflow

PostgreSQL is the durable state authority. pg-boss delivers asynchronous stage jobs. A Workflow Coordinator advances a run after committed stage output. A transactional outbox must couple domain-state changes to subsequent job publication.

Pi is not the durable workflow engine. Loss of an Agent process must not erase case, stage, or retry state.

### 6.3 Case and stage states

Case lifecycle states are:

1. `created`
2. `queued`
3. `processing`
4. `review_required`
5. `ready`
6. `failed`

Stage execution states are:

1. `pending`
2. `running`
3. `succeeded`
4. `failed`
5. `skipped`

Each stage attempt records its input version, processor version, attempt number, start and end times, result, error classification, and trace identifier.

## 7. Intake and Storage

### 7.1 Intake methods

1. A multipart API supports the interactive demo.
2. A system-integration API accepts an object reference from an approved S3-compatible store.
3. Arbitrary public URLs must not be accepted.
4. Case creation and processing-run creation must support `Idempotency-Key`.

### 7.2 Basic file controls

1. Determine media type from content rather than the file extension.
2. Permit only PDF, JPEG, and PNG.
3. Enforce configured file-size, page-count, image-dimension, decompressed-size, time, and memory limits.
4. Calculate and record SHA-256.
5. Reject corrupt and unsupported encrypted PDFs.
6. Run parsing and OCR in an isolated worker without business credentials or unrestricted network access.
7. Report malware scanning as `not_scanned` unless an approved scanner actually runs.

### 7.3 Object storage

Source and derived objects are immutable. PostgreSQL records the object key, checksum, media type, size, version, and lineage. Database rows and queue payloads must not contain large document bytes.

The application uses an `ObjectStore` interface. MinIO is the local implementation; an Amazon Simple Storage Service (S3) adapter is the reference cloud mapping.

## 8. PDF, Image, and OCR Processing

### 8.1 PDF Inspector

The initial implementation uses [`firecrawl/pdf-inspector`](https://github.com/firecrawl/pdf-inspector) for PDF classification, native text and coordinate extraction, layout analysis, table detection, page rendering integration, and selective OCR routing.

The library output is a processing candidate and must be evaluated on the project dataset. The library is not a malware scanner or a complete security boundary.

### 8.2 Page rendering

The worker uses a pinned PDFium runtime for server-side page and region rendering. A render artifact records resolution, dimensions, rotation, renderer version, and source checksum.

The Review Workbench uses PDF.js. Normalized evidence coordinates bridge server and browser coordinate systems.

### 8.3 OCR

The initial `OcrEngine` implementation uses PDF Inspector's PP-OCRv6 integration. It returns text, regions, raw confidence, language information, and engine version. The interface must permit later replacement without changing downstream contracts.

### 8.4 Logical documents

Each page receives a supported business type, boundary prediction, confidence metadata, and alternatives. Deterministic grouping converts consecutive compatible pages into logical documents.

The initial release does not automatically merge logical documents across uploaded files, reorder non-contiguous pages, or silently accept an uncertain boundary. A reviewer may correct boundaries, and the correction must be audited.

## 9. VLM and Pi Case Review Agent

### 9.1 Model gateway

A provider-neutral gateway must isolate external, private-cloud, and future local model deployments. Provider SDK types must not enter domain contracts.

The initial release may use an external VLM because the project uses synthetic and demo-safe data. The selected default and fallback models must be chosen through a golden-set comparison and recorded in an Architecture Decision Record (ADR).

### 9.2 Invocation boundary

1. A VLM may receive a selected page, a bounded consecutive-page window, or a cropped region.
2. A VLM must not receive a complete case package.
3. The request should include available native or OCR text and the target extraction schema when useful.
4. Extraction-model calls must not expose tools.
5. Every invocation records routing reason, provider, model, prompt version, schema version, latency, usage, estimated cost, and trace identifier.

### 9.3 Case Review Agent and Adaptive Extraction Loop

The initial release embeds `pi-coding-agent` through its software development kit. Default coding tools, Shell access, arbitrary file access, unrestricted HTTP, automatic resource discovery, runtime package installation, and dynamic extensions must be disabled.

The bounded Agent attempts a Case Review Brief for every processable result and may additionally enter Adaptive Extraction mode when fixed extraction leaves an eligible explicit gap. Recovery-mode allowlisted tools may include:

1. `inspect_page`
2. `get_native_text`
3. `run_ocr`
4. `render_page_region`
5. `classify_page`
6. `extract_with_vlm`
7. `get_extraction_gaps`
8. `submit_extraction_candidates`

The Agent can submit extraction candidates. It cannot persist unchecked facts, execute validation rules, select a disposition, call a banking system, or modify configuration.

The loop ends when required gaps are resolved, no new useful candidate is produced, conflicting strong candidates appear, or an iteration, model-call, timeout, token, or cost budget is exhausted.

## 10. Fields, Evidence, Entities, and Claims

### 10.1 Field candidate

Each material extracted field contains:

1. Field name and schema version.
2. Raw and normalized values.
3. Value type and currency where applicable.
4. Extraction method and processor version.
5. Source document and page.
6. Evidence identifiers.
7. Raw confidence metadata.
8. Calibrated confidence metadata when available.
9. Validation and reconciliation status.

### 10.2 Evidence

Page evidence records page number, page dimensions, rotation, normalized bounding boxes, original coordinates, coordinate unit and origin, text span, extraction method, and processor version.

Normalized bounding boxes use a top-left origin with values from zero through one. Evidence may contain multiple regions. Page-only evidence must declare page granularity. Structured application data uses a JSON Pointer location.

### 10.3 Confidence

Raw provider confidence must be stored with its score type and source. A calibrated score requires a calibration dataset and version. OCR confidence, classifier probability, heuristic score, and VLM self-assessment must not be averaged or treated as interchangeable.

### 10.4 Entity and claim model

Cross-document validation operates on evidence-backed claims attached to entity roles. Initial person roles are applicant, identity holder, employee, and account holder. Initial organization roles are declared employer, payslip employer, and payment counterparty.

Entity resolution may use deterministic normalization, character or token similarity, and a bounded LLM fallback. An LLM returns only one of a constrained set of matching opinions; it does not produce the final validation finding.

## 11. Extraction Schemas

### 11.1 Structured application data

The core fields are applicant name, birth date, declared employer, declared monthly income, and currency.

### 11.2 Identity document

The core fields are name, birth date, document number, expiry date, and nationality. Machine-readable-zone checks, when applicable, use deterministic code. The system does not perform face matching, liveness, or authenticity certification.

### 11.3 Payslip

The core fields are employee name, employer name, pay period, gross income, net income, and currency.

### 11.4 Bank statement

The core fields are account holder, masked International Bank Account Number (IBAN), statement period, and transaction rows containing date, description, amount, direction, currency, and evidence.

Native table extraction precedes OCR. VLM table recovery is a fallback. Decimal arithmetic validates parsed rows; a model must not calculate balances or income totals.

## 12. Validation and Disposition

### 12.1 Rule architecture

Validation rules are compiled TypeScript plugins registered at build time. A versioned YAML or JSON manifest selects enabled, registered rule versions and schema-validated parameters. Unknown, inactive, or unapproved rules cannot execute.

Models cannot create, modify, activate, or change the semantics of a rule at runtime.

### 12.2 Initial demonstration rules

1. `VAL_DOC_COMPLETENESS_001`
2. `VAL_NAME_CONSISTENCY_001`
3. `VAL_EMPLOYER_CONSISTENCY_001`
4. `VAL_INCOME_CONSISTENCY_001`
5. `VAL_ID_EXPIRY_001`

The rule set is illustrative and is not a German bank policy.

### 12.3 Finding states

1. `passed`
2. `warning`
3. `failed`
4. `inconclusive`
5. `not_applicable`

Missing or insufficient-confidence input must produce an explicit result and must not be silently treated as a match or conflict.

### 12.4 Recommended disposition

The disposition mapper consumes structured findings and processing state. It does not reinterpret source documents.

Initial values are:

1. `ready_for_downstream_processing`
2. `additional_documents_needed`
3. `human_review_required`

Precedence is:

```text
additional_documents_needed
  > human_review_required
  > ready_for_downstream_processing
```

An unrecoverable technical or security failure terminates the processing run as `failed` before disposition creation. None of the disposition values approves, rejects, or otherwise decides a loan.

## 13. Review Workbench

The initial release must implement:

1. Case list and case detail.
2. Case lifecycle and stage execution views.
3. Logical-document list and boundary correction.
4. Extracted fields, confidence metadata, validation findings, and disposition.
5. PDF.js page rendering with normalized evidence overlays.
6. Field correction with required reason.
7. Review confirmation or further-review action.
8. Application-level append-only audit timeline.

The interface must not contain controls for loan approval, loan decline, disbursement, account opening, or customer contact.

## 14. Processing Runs, Corrections, and Audit

### 14.1 Processing runs

Each case contains immutable processing runs. A run fixes its input versions and the workflow, PDF Inspector, PDFium, OCR, model, prompt, schema, normalization, rule-set, and disposition-policy versions.

A stage retry creates a new attempt in the same run. A material input or processing-version change creates a new run.

### 14.2 Corrections

Human corrections are immutable revisions linked to the original field and evidence. They record actor, old value, new value, reason, and time. They may be exported as dataset candidates only after explicit review.

Corrections must not automatically update an online model, prompt, rule, threshold, or golden truth.

### 14.3 Audit

Audit events are append-only through application APIs and include event, case, run, actor, event type, time, trace, and relevant version identifiers. The initial implementation is not tamper-proof or WORM-compliant.

## 15. Data and Evaluation

### 15.1 Data strategy

The initial release uses synthetic and demo-safe data. Synthetic documents use fictional identities, organizations, accounts, and transactions; display a visible synthetic marker; and avoid real institution branding and official security features.

### 15.2 Dataset composition

1. Twenty curated, manually verified end-to-end golden cases.
2. Separate mutable development fixtures.
3. Three selected golden cases for the primary demonstration paths.

The curated set should cover native-text, scanned/OCR, mixed or multi-document, complex table/VLM, and cross-document-conflict cases.

### 15.3 Dataset pipeline

Lightweight command-line tools generate documents, inject variations, emit truth, validate manifests and coordinates, build immutable dataset releases, load demo data, run evaluations, and create reports.

The project does not require Airflow, Dagster, dbt, or a production data warehouse.

### 15.4 Metrics

The evaluation runner reports, where applicable:

1. Page and document classification accuracy and F1.
2. Boundary detection quality.
3. Field exact match, precision, recall, and F1.
4. Evidence page accuracy and bounding-box overlap.
5. OCR and VLM routing behavior.
6. Schema validation failure rate.
7. Validation finding accuracy.
8. Recommended-disposition accuracy on the demonstration rule set.
9. Latency, model usage, and estimated cost.
10. Reviewer correction rate.

The specification must not declare unsupported numerical accuracy, automation, latency, or severe-error targets. A baseline must be measured first; later releases may define regression tolerances with the dataset version and rationale.

## 16. Prompt and Model Governance

Prompts are immutable GitOps artifacts. Each artifact contains prompt content, metadata, input and output schema references, tests, and hashes. An environment alias resolves to an immutable prompt version at run creation.

A `PromptRegistry` interface permits a future external platform adapter. The initial implementation uses a bundled registry and must not require a prompt-management service at runtime.

Prompt or model changes require relevant golden evaluation. Default continuous integration uses a fake model adapter; live evaluation is explicit, separately reported, and budgeted.

## 17. API

### 17.1 Conventions

1. Public endpoints use `/api/v1`.
2. Contracts use TypeBox and JSON Schema.
3. OpenAPI is generated from route contracts.
4. Errors use one stable Problem Details-style format.
5. Responses contain a request identifier; asynchronous responses contain case and run identifiers.
6. Internal stack traces, object keys, prompts, and provider payloads must not appear in public errors.

### 17.2 Initial endpoints

```text
POST /api/v1/cases
GET  /api/v1/cases
GET  /api/v1/cases/{case_id}
GET  /api/v1/cases/{case_id}/events
GET  /api/v1/cases/{case_id}/stream
POST /api/v1/cases/{case_id}/runs
POST /api/v1/cases/{case_id}/corrections
POST /api/v1/cases/{case_id}/review
DELETE /api/v1/cases/{case_id}
```

Case creation returns `202 Accepted`. Polling is the base progress mechanism; Server-Sent Events (SSE) support the workbench. External callbacks and webhooks are outside V1.

## 18. Failure and Degradation

1. Successful partial results may remain available after a later stage fails.
2. Validation consumes only schema-valid, persisted inputs.
3. A missing required fact or evidence produces `inconclusive` or review routing, not an implicit pass.
4. A case cannot become `ready` while required evidence or required stages remain unresolved.
5. OCR or external-model unavailability may trigger retry, an allowed fallback, or human review.
6. Object-storage or evidence-persistence failure prevents completion.
7. Every retry creates a stage attempt and respects a configured maximum.
8. Adaptive Agent iteration, VLM calls, tokens, time, and estimated cost have configurable budgets.

The project reports measured performance rather than a production SLA.

## 19. Security

1. Model calls must treat document content as data, not instructions.
2. Model outputs must pass strict allowlisted schemas.
3. The Agent tool allowlist and execution budgets must be enforced outside the model.
4. A document instruction cannot create a new tool call, modify a rule, alter a disposition, or expose system configuration.
5. The golden set must contain at least one instruction-injection case.
6. Secrets must not be committed, logged, or exposed to document-processing containers.
7. Local demo authentication is development-only and must fail closed outside the development environment.
8. API handlers consume a unified authentication context so that OpenID Connect (OIDC) can replace demo authentication.
9. Logs, traces, prompts, and analytics must not contain full identity numbers, IBANs, document images, or unrestricted extracted text.
10. The prototype's full security limitations are defined in [`LIMITATIONS.md`](LIMITATIONS.md).

## 20. Observability

Pino provides structured logs. OpenTelemetry propagates traces and metrics across Fastify, pg-boss, worker stages, model calls, and storage operations. A Prometheus-compatible endpoint and Jaeger support local inspection.

The system records stage latency, failure, retry, queue depth, OCR/VLM routing, model usage, estimated cost, schema failures, field missing rate, findings, and reviewer corrections. A trace must correlate request, case, run, document, job, and stage identifiers without logging sensitive payloads.

## 21. Technical Baseline

1. TypeScript monorepo on Node.js 22.19 or later.
2. pnpm workspaces and TypeScript project references.
3. Fastify for the HTTP API.
4. TypeBox and JSON Schema for runtime contracts.
5. PostgreSQL, Drizzle ORM, and Drizzle Kit migrations.
6. pg-boss and a transactional outbox for asynchronous workflow stages.
7. MinIO through an S3-compatible `ObjectStore` interface for local storage.
8. React, Vite, TanStack Query, React Router, PDF.js, Radix UI Primitives, CSS Modules, Lucide React, Motion, and the native system font stack for the workbench.
9. Vitest, Testcontainers, and Playwright for automated testing.
10. Pino, OpenTelemetry, Prometheus-compatible metrics, and Jaeger for observability.
11. Docker Compose as the delivered demonstration environment.
12. Cloud-neutral service boundaries with an Amazon Web Services reference mapping.

V1 does not require Bun, Nx, Turborepo, Temporal, Kafka, Redis, Kubernetes, Terraform, Elasticsearch, or a vector database.

## 22. Delivery and Supply Chain

1. GitHub Actions runs formatting, linting, type checking, tests, evaluation smoke tests, and container builds.
2. The pnpm lockfile is committed and continuous integration uses frozen resolution.
3. Pi, PDF Inspector, PDFium, ONNX Runtime, OCR models, and other critical assets use pinned versions and recorded checksums where applicable.
4. Dependency licenses and a Software Bill of Materials (SBOM) are generated.
5. Continuous integration performs dependency, secret, and container scanning.
6. Unreviewed Pi packages, extensions, and skills are not loaded.
7. Containers use multi-stage builds, non-root users, health endpoints, readiness checks, and graceful shutdown.
8. V1 delivers Docker Compose. It does not deliver an actual cloud environment or Infrastructure as Code.

## 23. Demonstration Acceptance

### 23.1 Happy path

A native-text case completes through local extraction without a VLM call. The workbench displays extracted values, evidence overlays, stage trace, and ready document-processing disposition.

### 23.2 Adaptive path

A scanned or complex-table case leaves an explicit extraction gap. The bounded Pi Agent selects one or more approved recovery tools, obtains a schema-valid evidence-linked candidate, and records tool choices, model usage, latency, and cost.

### 23.3 Review and safety path

A mixed PDF contains a cross-document conflict and instruction-like content. The instruction does not change tools, rules, or disposition. The case reaches human review, where a reviewer inspects evidence, corrects a field with a reason, and sees the resulting audit event.

### 23.4 Reproducibility

1. Each acceptance path uses a fixed golden case.
2. Each path has an offline fake-model mode.
3. A processing run contains all component and configuration versions required to explain its output.
4. Reprocessing after a model, prompt, schema, or rule change creates a new comparable run.

## 24. Required Specifications

The reviewed baseline must be decomposed into:

1. `specs/INDEX.md`
2. `specs/PRODUCT_AND_SCOPE.md`
3. `specs/SYSTEM_ARCHITECTURE.md`
4. `specs/DATA_MODEL.md`
5. `specs/API_CONTRACTS.md`
6. `specs/ML_PIPELINE_AND_EVALUATION.md`
7. `specs/SECURITY_AND_LIMITATIONS.md`
8. `specs/components/DOCUMENT_PROCESSING.md`
9. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
10. `specs/components/VALIDATION_AND_DISPOSITION.md`
11. `specs/components/REVIEW_WORKBENCH.md`
12. `specs/operations/OBSERVABILITY_AND_FAILURES.md`
13. `specs/operations/DEPLOYMENT.md`
14. `specs/decisions/ADR_001_PI_AGENT_HARNESS.md`
15. `specs/decisions/ADR_002_PDF_INSPECTOR.md`
16. `specs/decisions/ADR_003_VLM_SELECTION.md`
17. `specs/decisions/ADR_004_RULE_ARCHITECTURE.md`

Executable TypeBox schemas and generated OpenAPI documents are contract artifacts. The project does not require a separate prose specification for every schema.
