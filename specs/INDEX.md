# Financial Document AI Agent Specification Index

Document ID: `IDX`

Version: 1.0.2

Status: Approved

Last updated: 2026-09-03

## 1. Purpose

This index is the entry point and authority map for the Financial Document AI Agent specification set. It defines the specification boundaries, document ownership, terminology, requirement identifiers, lifecycle states, dependency order, and migration rules for the project.

The project is an interview demonstration and production-shaped machine learning prototype. It is not a production banking system. [`LIMITATIONS.md`](../LIMITATIONS.md) is required reading and defines constraints that must remain visible in project documentation and demonstrations.

## 2. Specification Authority

### 2.1 Authority order

The following order applies when project documents conflict:

1. An approved Architecture Decision Record (ADR) governs the technical decision within its declared scope.
2. The approved owning specification listed in this index governs its subject area.
3. This index governs document ownership, terminology, identifiers, and specification process.
4. [`LIMITATIONS.md`](../LIMITATIONS.md) governs claims about current-release fitness, production readiness, and known gaps.
5. [`BACKLOG.md`](../BACKLOG.md) tracks accepted work not yet specified or implemented and deferred production work; it is not a normative system specification.
6. [`CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) governs the specification-writing workflow.
7. [`AGENTS.md`](../AGENTS.md) provides repository operating guidance; it is not a normative product specification.
8. The [migration source specification](../Intelligent_Document_Processing_Agent_Specification.md) supplies source material only and is not authoritative after a requirement has moved to an approved owning specification.

### 2.2 Single-owner rule

`IDX-REQ-001` Each normative requirement must have exactly one owning specification.

`IDX-REQ-002` A non-owning specification must reference the owning requirement rather than duplicate its normative wording.

`IDX-REQ-003` Examples, diagrams, generated contracts, and explanatory notes must not introduce behavior that is absent from the owning normative requirements.

`IDX-REQ-004` An ADR may constrain an owning specification but must identify the affected specifications and requirements.

### 2.3 Current authority state

This index and `PRODUCT_AND_SCOPE.md` are approved. All other planned specifications remain pending until created and approved. The migration source remains the working behavioral baseline for subjects that do not yet have an approved owner.

## 3. Product Baseline

The specification set is based on these accepted boundaries:

1. The initial release is a production-shaped machine learning prototype for demonstration and evaluation.
2. The reference scenario is single-applicant personal-loan document review in Germany.
3. Specifications, application contracts, code identifiers, and reason codes use English.
4. Evaluated synthetic input documents use German, English, or both.
5. Core inputs are structured application data, supported German identity documents, payslips, and bank statements.
6. Supported file formats are PDF, JPEG, and PNG.
7. Euro is the validation currency; foreign-exchange conversion is outside scope.
8. The system produces document-processing findings and a recommended disposition only.
9. The system has no permission or interface to approve or reject applications, disburse funds, open accounts, contact customers, or perform other core banking actions.
10. The initial release uses synthetic and explicitly demo-safe data.

Normative product scope belongs to `PRODUCT_AND_SCOPE.md`. This section is an index summary and must be reconciled with that document when it is approved.

## 4. Specification Catalog

| Order | Document | ID prefix | Owner scope | Status |
|---:|---|---|---|---|
| 1 | `INDEX.md` | `IDX` | Authority map, terminology, identifiers, lifecycle, and dependency order | Approved |
| 2 | `PRODUCT_AND_SCOPE.md` | `PRD` | Users, use cases, V1 scope, exclusions, outcomes, and product acceptance | Approved |
| 3 | `SYSTEM_ARCHITECTURE.md` | `ARC` | System boundaries, components, trust boundaries, processing flow, and cross-cutting architecture | Pending |
| 4 | `DATA_MODEL.md` | `DAT` | Domain entities, claims, evidence, processing runs, stages, corrections, audit references, and persistence semantics | Pending |
| 5 | `components/DOCUMENT_PROCESSING.md` | `DOC` | Intake, inspection, rendering, page classification, logical-document grouping, native extraction, OCR, and table extraction | Pending |
| 6 | `components/ADAPTIVE_EXTRACTION_AGENT.md` | `AGT` | Pi Agent boundary, extraction gaps, allowlisted tools, budgets, stopping, and escalation | Pending |
| 7 | `components/VALIDATION_AND_DISPOSITION.md` | `VAL` | Entity matching, validation-rule architecture, findings, and deterministic recommended-disposition mapping | Pending |
| 8 | `components/REVIEW_WORKBENCH.md` | `UI` | Reviewer workflows, evidence viewer, corrections, audit timeline, and annotation mode | Pending |
| 9 | `API_CONTRACTS.md` | `API` | HTTP endpoints, events, idempotency, error format, authentication context, and generated OpenAPI ownership | Pending |
| 10 | `ML_PIPELINE_AND_EVALUATION.md` | `MLE` | Datasets, dataset pipeline, metrics, model selection, confidence, evaluation, and regression | Pending |
| 11 | `SECURITY_AND_LIMITATIONS.md` | `SEC` | Threat model, prompt injection, file controls, authorization boundary, secrets, and operational security controls | Pending |
| 12 | `operations/OBSERVABILITY_AND_FAILURES.md` | `OPS` | Logs, traces, metrics, retries, degradation, recovery, and operational diagnosis | Pending |
| 13 | `operations/DEPLOYMENT.md` | `DEP` | Docker Compose delivery, configuration, containers, storage dependencies, and cloud reference mapping | Pending |
| 14 | `decisions/ADR_001_PI_AGENT_HARNESS.md` | `ADR-001` | Selection and hardening of the Pi Agent harness | Pending |
| 15 | `decisions/ADR_002_PDF_INSPECTOR.md` | `ADR-002` | Selection and integration boundary of PDF Inspector | Pending |
| 16 | `decisions/ADR_003_VLM_SELECTION.md` | `ADR-003` | Evidence-based selection of default and fallback VLMs | Pending evidence |
| 17 | `decisions/ADR_004_RULE_ARCHITECTURE.md` | `ADR-004` | TypeScript rule plugins, registry, manifests, and deterministic mapping | Pending |

## 5. Ownership Boundaries

### 5.1 Product versus architecture

`PRODUCT_AND_SCOPE.md` owns what the system must achieve and what it must not do. `SYSTEM_ARCHITECTURE.md` owns how responsibilities are divided among components. Product requirements must not mandate an implementation detail unless it is an accepted product constraint.

### 5.2 Architecture versus components

`SYSTEM_ARCHITECTURE.md` owns component boundaries, trust boundaries, and interactions. Component specifications own detailed behavior inside those boundaries. A component specification must not create a new external system capability without a corresponding architecture requirement.

### 5.3 Data model versus contracts

`DATA_MODEL.md` owns domain meaning, identity, lifecycle, relationships, and immutability semantics. `API_CONTRACTS.md` owns external representations and transport behavior. Executable TypeBox schemas are contract artifacts and must conform to both owners.

### 5.4 Machine learning versus validation

`ML_PIPELINE_AND_EVALUATION.md` owns datasets, measurements, model selection, calibration, and regression. `VALIDATION_AND_DISPOSITION.md` owns the finite rule set and deterministic outcome semantics. A model may produce an extraction candidate or constrained entity-matching opinion, but it must not define a validation finding or recommended disposition.

### 5.5 Security versus limitations

`SECURITY_AND_LIMITATIONS.md` owns implemented security requirements and the threat model. The root [`LIMITATIONS.md`](../LIMITATIONS.md) owns the concise public disclosure of unimplemented production controls and fitness boundaries. The security specification must reference, not weaken, those disclosures.

### 5.6 Observability versus audit

`OBSERVABILITY_AND_FAILURES.md` owns operational logs, traces, metrics, retry, and recovery behavior. `DATA_MODEL.md` owns the domain audit-event meaning and immutability model. Operational telemetry is not a substitute for the application audit trail.

## 6. Requirement Identifiers

### 6.1 Format

Normative requirements use:

```text
<DOCUMENT_PREFIX>-REQ-<THREE_DIGIT_NUMBER>
```

Examples:

```text
PRD-REQ-001
ARC-REQ-014
DOC-REQ-027
AGT-REQ-008
```

`IDX-REQ-005` Requirement numbers must be unique within their owning document.

`IDX-REQ-006` Once published for review, a requirement identifier must not be reused for a different requirement.

`IDX-REQ-007` Removed requirements must be marked deprecated or removed in document history; remaining identifiers must not be renumbered to close gaps.

`IDX-REQ-008` A split requirement must receive new identifiers and retain a history reference to its source identifier.

`IDX-REQ-009` Requirement references must include identifiers, not only section names or prose descriptions.

### 6.2 ADR identifiers

ADRs use sequential filenames and identifiers:

```text
ADR_<THREE_DIGIT_NUMBER>_<UPPER_SNAKE_CASE_TITLE>.md
```

An ADR status is one of `Proposed`, `Accepted`, `Superseded`, or `Rejected`. A superseding ADR must link to the superseded record.

### 6.3 Non-requirement identifiers

Stable identifiers for schemas, events, jobs, rules, reason codes, metrics, prompts, and datasets are defined by their owning specification. They must not be inferred from display labels.

## 7. Normative Language

The key words `must`, `must not`, `should`, `should not`, and `may` indicate normative strength:

1. `must` or `must not`: required for conformance.
2. `should` or `should not`: recommended; a deviation requires documented rationale.
3. `may`: permitted but optional.

Explanatory text must be labeled `Note` when it could otherwise be mistaken for a requirement. Examples are non-normative unless a requirement explicitly incorporates them.

## 8. Document Lifecycle

Formal specification statuses are:

1. `Draft`: active writing; not approved for implementation.
2. `In Review`: complete enough for stakeholder review; changes are expected.
3. `Approved`: accepted implementation baseline within its declared version and scope.
4. `Superseded`: replaced by a newer approved document or version.
5. `Archived`: retained for history and not an active authority.

`IDX-REQ-010` Every specification must declare document ID, version, status, and last-updated date near its title.

`IDX-REQ-011` Approval must identify unresolved assumptions or explicitly state that none remain.

`IDX-REQ-012` A normative change to an approved specification must update its version and document history.

`IDX-REQ-013` An implementation must not claim conformance to a Draft or In Review requirement without identifying the provisional dependency.

## 9. Versioning

Specification versions use semantic intent:

1. Major: incompatible requirement or contract changes.
2. Minor: backward-compatible requirements or material clarification.
3. Patch: editorial correction that does not change required behavior.

Executable schemas, prompts, rule sets, disposition policies, workflows, datasets, models, OCR assets, and processing components maintain their own versions under their owning specifications.

Git commit identifiers support traceability but do not replace explicit artifact versions.

## 10. Terminology

| Term | Definition |
|---|---|
| Agent | The bounded Pi-based Adaptive Extraction Agent, unless another agent is explicitly named. It is not the durable workflow engine or a business decision-maker. |
| Adaptive Extraction Loop | A budgeted Agent loop that selects from approved extraction tools after fixed extraction paths leave an explicit gap and before human escalation. |
| Application data | Structured JSON supplied by an upstream caller; it is not necessarily extracted from an application-form document. |
| Artifact | An immutable stored input or derived object with identity, version, checksum, media type, and lineage. |
| Case | The top-level document-review container for one applicant, application data, documents, processing runs, and review history. It is not a loan account or lending decision. |
| Claim | A raw or normalized value asserted about an entity or role and linked to source evidence. |
| Document type | A supported business category such as identity document, payslip, or bank statement. |
| Evidence | A traceable source location supporting a claim, represented by page or structured-input location and provenance. |
| Extraction candidate | A model-, OCR-, parser-, or rule-produced proposed value that has not yet become a reconciled claim. |
| Extraction gap | A structured statement that a required field, table, relationship, or evidence location is unresolved after an extraction step. |
| Finding | The deterministic output of one registered validation rule applied to versioned inputs. |
| Golden case | A fixed, manually verified synthetic end-to-end case with versioned truth used for regression evaluation. |
| Human-in-the-Loop | Reviewer intervention after automated processing cannot safely complete or when explicit review is required. |
| Logical document | A contiguous page range representing one business document within a physical file. |
| Model gateway | A provider-neutral interface for external, private-cloud, or local language and vision-language model implementations. |
| Physical document | One uploaded PDF, JPEG, or PNG object before logical-document grouping. |
| Processing run | An immutable execution over fixed input and component versions. Stage retries are attempts within a run; material version changes create a new run. |
| Recommended disposition | A deterministic document-processing recommendation. It is not a lending, KYC, AML, account, or customer decision. |
| Robustness case | A reproducibly generated synthetic variation used for batch evaluation beyond the curated golden set. |
| Stage execution | The durable record of one processing stage and its attempts within a processing run. |

## 11. Acronyms

| Acronym | Meaning |
|---|---|
| ADR | Architecture Decision Record |
| AI | Artificial Intelligence |
| AML | Anti-Money Laundering |
| API | Application Programming Interface |
| CDR | Content Disarm and Reconstruction |
| CI | Continuous Integration |
| EUR | Euro |
| GDPR | General Data Protection Regulation |
| IBAN | International Bank Account Number |
| KYC | Know Your Customer |
| LLM | Large Language Model |
| OCR | Optical Character Recognition |
| OIDC | OpenID Connect |
| PDF | Portable Document Format |
| PII | Personally Identifiable Information |
| SBOM | Software Bill of Materials |
| SLA | Service Level Agreement |
| SSE | Server-Sent Events |
| VLM | Vision Language Model |
| WORM | Write Once Read Many |

Specifications may use an acronym from this table without redefining it. A specification must define any project-specific acronym not listed here at first use.

## 12. Controlled Vocabularies

### 12.1 Case lifecycle

```text
created
queued
processing
review_required
ready
failed
```

### 12.2 Stage execution status

```text
pending
running
succeeded
failed
skipped
```

### 12.3 Validation finding status

```text
passed
warning
failed
inconclusive
not_applicable
```

### 12.4 Recommended disposition

```text
ready_for_downstream_processing
additional_documents_needed
human_review_required
processing_blocked
```

`IDX-REQ-014` A specification must not add, rename, or redefine a value in these vocabularies without updating this index and the owning specification in the same approved change.

## 13. Dependency and Writing Order

| Stage | Documents | Dependency rule |
|---|---|---|
| One | `INDEX.md`, `PRODUCT_AND_SCOPE.md`, `SYSTEM_ARCHITECTURE.md`, `DATA_MODEL.md` | Establish scope, ownership, boundaries, and domain meaning before detailed behavior. |
| Two | `DOCUMENT_PROCESSING.md`, `ADAPTIVE_EXTRACTION_AGENT.md`, `VALIDATION_AND_DISPOSITION.md`, `REVIEW_WORKBENCH.md`, `API_CONTRACTS.md` | Define the end-to-end vertical slice and executable contracts. Stage Two approval permits vertical-slice implementation. |
| Three | `ML_PIPELINE_AND_EVALUATION.md`, `SECURITY_AND_LIMITATIONS.md`, `OBSERVABILITY_AND_FAILURES.md`, `DEPLOYMENT.md` | Define evaluation, controls, operational behavior, and delivery around the approved core. |
| Four | ADRs | Create an ADR when its decision is ready; it may precede a dependent component specification. VLM selection remains pending benchmark evidence. |

`IDX-REQ-015` A later-stage specification must not silently override an earlier approved owner.

`IDX-REQ-016` A blocked downstream decision must be recorded as an assumption or backlog item rather than invented by the specification author.

## 14. Migration Map

The following table assigns sections from the migration source to their future owners. Migration is complete only when the relevant requirement is present in an approved owner and its duplicate normative wording has been removed or marked archival in the source.

| Migration-source concern | Owning specification |
|---|---|
| Purpose, users, scenario, goals, exclusions, supported inputs, and product acceptance | `PRODUCT_AND_SCOPE.md` |
| Processing sequence, component boundaries, trust boundaries, workflow ownership, and technology-neutral integration | `SYSTEM_ARCHITECTURE.md` |
| Cases, documents, pages, entities, claims, evidence, runs, stages, corrections, findings, dispositions, and audit-event semantics | `DATA_MODEL.md` |
| File intake, PDF inspection, rendering, OCR, page classification, logical splitting, and table extraction | `components/DOCUMENT_PROCESSING.md` |
| Pi integration, extraction gaps, allowlisted tools, budgets, stopping, and human escalation | `components/ADAPTIVE_EXTRACTION_AGENT.md` |
| Entity matching, finite rule sets, five demonstration rules, finding states, and disposition mapping | `components/VALIDATION_AND_DISPOSITION.md` |
| Case UI, evidence viewer, corrections, review actions, timeline, and annotation mode | `components/REVIEW_WORKBENCH.md` |
| HTTP endpoints, SSE, error format, idempotency, authentication context, and OpenAPI | `API_CONTRACTS.md` |
| Golden and robustness sets, dataset tooling, confidence, metrics, model comparison, prompts, and regression | `ML_PIPELINE_AND_EVALUATION.md` |
| File controls, prompt injection, secrets, access boundaries, and production-gap references | `SECURITY_AND_LIMITATIONS.md` |
| Logs, traces, metrics, retries, partial results, budgets, and degradation | `operations/OBSERVABILITY_AND_FAILURES.md` |
| Docker Compose, dependencies, configuration, containers, supply chain, and AWS reference mapping | `operations/DEPLOYMENT.md` |

## 15. Contract Artifacts

The project intends to generate or maintain these executable artifacts:

1. TypeBox and JSON Schema contracts.
2. OpenAPI output generated from Fastify route schemas.
3. Database migrations generated and managed with Drizzle Kit.
4. Versioned rule-set and disposition-policy manifests.
5. Immutable prompt bundles and environment aliases.
6. Dataset manifests, truth schemas, and evaluation reports.
7. Event and job-message schemas.

`IDX-REQ-017` A generated artifact must identify its source specification and artifact version.

`IDX-REQ-018` A generated artifact must not be edited manually when a declared source generator exists.

`IDX-REQ-019` Contract compatibility checks must be part of the relevant specification's acceptance criteria.

## 16. Traceability Expectations

Each implementation change should be traceable to one or more approved requirement identifiers. Each material runtime result should be traceable to the relevant input and artifact versions.

The minimum processing-run version set will be owned by `DATA_MODEL.md` and must include the workflow, PDF Inspector, PDFium, OCR, model, prompt, schema, normalization, validation rule set, and disposition policy used by the run.

## 17. Open Items

The following decisions require implementation or evaluation evidence and remain tracked in [`BACKLOG.md`](../BACKLOG.md):

1. Pi Adaptive Extraction Loop integration proof.
2. PDF Inspector and PP-OCRv6 baseline on the project dataset.
3. Default and fallback VLM selection.
4. Versioned golden and robustness dataset artifacts.
5. Measured quality, latency, and cost baseline.

These open items do not change the accepted product boundary. They must not be resolved by adding unsupported claims to a specification.

## 18. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.0.2 | 2026-09-03 | Approved | Registered `PRODUCT_AND_SCOPE.md` as Approved. |
| 1.0.1 | 2026-09-03 | Approved | Registered `PRODUCT_AND_SCOPE.md` as Draft for review. |
| 1.0 | 2026-09-03 | Approved | Created and approved the formal specification index from the reviewed handoff and migration source. |
