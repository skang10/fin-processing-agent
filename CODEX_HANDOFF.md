# Codex Handoff

## Project

Project name: Financial Document AI Agent

Short name: FinDoc AI Agent

Project type: Interview demonstration and production-shaped machine learning prototype

Reference domain: Banking and financial services

Initial scenario: Single-applicant personal-loan document review in Germany

Future scenarios: Business lending, invoice review, and standalone Know Your Customer (KYC) review

## Mission

Build a specification-driven prototype that demonstrates reliable machine learning document processing, evidence-linked extraction, a bounded Pi Case Review Agent, cross-document validation, and human review.

The system receives structured application data and supporting documents. It validates and stores files, identifies logical documents, classifies pages, extracts native text, selectively runs local Optical Character Recognition (OCR), routes difficult pages or regions to a Vision Language Model (VLM), normalizes evidence-backed claims, validates selected facts across documents, and produces a recommended document-processing disposition.

The system has no permission or interface to disburse funds, open accounts, approve or reject applications, contact customers, or perform any other core banking action. It does not perform credit, Anti-Money Laundering (AML), or final KYC decisions.

## Product Positioning

1. The initial release is a production-shaped prototype, not a production banking system.
2. The project must emphasize the machine learning pipeline, evidence, evaluation, observability, controlled model use, and human review.
3. Business validation is limited to a small demonstration rule set. The project must not invent or claim to implement a real German bank's lending policy.
4. The initial release uses synthetic and explicitly demo-safe data.
5. Known production gaps are defined in [`LIMITATIONS.md`](LIMITATIONS.md) and must remain visible in the README and demonstrations.

## Initial Scope

### Supported inputs

1. Portable Document Format (PDF), JPEG, and PNG files.
2. German and English synthetic documents.
3. Euro (EUR) as the validation currency. Foreign-exchange conversion is outside scope.
4. Structured application data, supported German identity documents, payslips, and bank statements as core schemas.
5. One applicant, one primary account holder, and one current employer.

### Explicit exclusions

1. Tagged Image File Format (TIFF).
2. Joint applications.
3. Self-employed, pension, or benefit-income workflows.
4. Automatic merging of documents across files or reordering of non-contiguous pages.
5. Production KYC, credit scoring, lending policy, customer communication, and core banking integration.
6. Training a proprietary foundation model.

## Core Design Decisions

1. Local processing is the default. PDF native extraction and selective OCR precede VLM use.
2. [`firecrawl/pdf-inspector`](https://github.com/firecrawl/pdf-inspector) is the initial PDF classification, native extraction, layout, rendering, and selective OCR foundation.
3. PDF processing runs in an isolated, resource-limited worker. The prototype implements basic file validation, not enterprise malware scanning or Content Disarm and Reconstruction (CDR).
4. PDF Inspector supplies OCR-routing inputs. The initial independent `OcrEngine` target is PP-OCRv6 behind a replaceable interface, subject to an implementation spike and pinned runtime verification.
5. External VLM use is allowed for the prototype. A provider-neutral gateway must allow later private-cloud or local deployment.
6. A VLM receives only selected pages, bounded consecutive-page windows, or cropped regions. It never receives an entire case package.
7. Models produce candidates, classifications, constrained matching opinions, or non-authoritative review briefs. They do not create validation rules, determine authoritative validation findings or dispositions, or select business decisions.
8. `pi-coding-agent` is embedded through its software development kit as a bounded Agent harness. Default coding tools, dynamic extensions, automatic resource discovery, Shell access, and unrestricted network or file access are disabled.
9. Pi runs for every processable case as a bounded pre-screening reviewer that produces a verified Case Review Brief; it may additionally use the Adaptive Extraction Loop only for eligible gaps.
10. The durable workflow is owned by PostgreSQL state, pg-boss jobs, and a Workflow Coordinator. Pi is not the durable workflow engine.
11. Every material extracted claim links to source evidence.
12. Original model output, human corrections, and repeated processing runs are immutable revisions rather than overwritten values.

## Processing Model

```text
Case intake
  -> basic file validation and immutable storage
  -> PDF/image inspection and page rendering
  -> page classification and logical-document grouping
  -> native extraction or selective local OCR
  -> fixed VLM fallback where configured
  -> optional bounded Pi Adaptive Extraction Loop for eligible unresolved gaps
  -> field normalization and evidence binding
  -> entity and claim resolution
  -> finite demonstration validation rule set
  -> deterministic recommended-disposition mapping
  -> bounded Pi Case Review Brief and deterministic report verification
  -> Human-in-the-Loop review
```

Logical-document splitting supports contiguous page ranges within one physical PDF. Page classification and boundary prediction precede deterministic grouping. Low-confidence boundaries remain reviewable.

## Evidence and Confidence

1. Evidence stores page number, page dimensions, rotation, normalized bounding boxes, original source coordinates, extraction method, and processor version.
2. Normalized bounding boxes use a top-left origin and values from zero through one.
3. Structured application input uses a JSON Pointer rather than page coordinates.
4. Raw provider confidence and calibrated system confidence are separate values.
5. Uncalibrated model scores must not be represented as reliable probabilities.
6. VLM self-reported confidence is not a final system confidence value.

## Entities and Cross-Document Validation

Cross-document comparison operates on evidence-backed entities, roles, and claims. Initial person roles include applicant, identity holder, employee, and account holder. Organization roles include declared employer, payslip employer, and payment counterparty.

Validation rules are finite, explicitly registered, approved, and versioned. V1 uses compiled TypeScript rule plugins selected through a versioned YAML or JSON rule-set manifest. V1 does not implement a general-purpose rule Domain-Specific Language (DSL).

The initial demonstration rule set contains:

1. `VAL_DOC_COMPLETENESS_001`
2. `VAL_NAME_CONSISTENCY_001`
3. `VAL_EMPLOYER_CONSISTENCY_001`
4. `VAL_INCOME_CONSISTENCY_001`
5. `VAL_ID_EXPIRY_001`

Ambiguous entity matching may use a Large Language Model (LLM) after deterministic normalization and similarity matching. The LLM returns only a constrained matching opinion. A deterministic, versioned rule produces the validation finding.

Validation findings and recommended dispositions are separate concerns. The initial recommended dispositions are:

1. `ready_for_downstream_processing`
2. `additional_documents_needed`
3. `human_review_required`

These values describe document-processing state only. They are not lending or customer decisions.

## Human Review

The initial release includes a small working Review Workbench with:

1. A workflow-state Review Queue and Agent Report default case view.
2. Compact shared case progress and a bounded case Agent log.
3. Structured application data, document rendering, checked facts, and navigable evidence.
4. Agent-raised and human-raised issue review with confirm, ignore, and edit actions.
5. Applicant-readable requested-change drafts that the V1 system records but never sends or delivers.
6. Final `request_changes`, `escalate_review`, or `clear_for_downstream` document-review actions without approve, decline, disburse, open-account, or contact-customer authority.
7. A bounded case Agent log with model, estimated cost, timestamps, and safe reviewer-readable activity; aggregate Agent monitoring is deferred.

Reviewer issue edits and any later correction workflow never update models, prompts, rules, thresholds, or golden truth automatically.

## Data and Evaluation

1. V1 does not train a proprietary model. It orchestrates and evaluates pretrained components.
2. Quality targets are baseline-driven. Unsupported numerical claims must not be added before measurement.
3. The first vertical slice contains 6 manually verified end-to-end golden cases; the completed V1 target is 20.
4. Synthetic documents must be visibly marked as synthetic and must not reproduce official security features or real institution branding.
5. Dataset preparation and evaluation use lightweight command-line workflows rather than Airflow, Dagster, or dbt.
6. Golden truth is generated with templates and manually confirmed through lightweight dataset command-line workflows before release.
7. Live-model evaluation is separate from default continuous integration and must have an explicit cost budget.

## Technical Baseline

1. TypeScript monorepo.
2. Node.js 22.19 or later.
3. pnpm workspaces and TypeScript project references; no Nx or Turborepo in V1.
4. Fastify API with TypeBox and JSON Schema contracts.
5. PostgreSQL with Drizzle ORM and Drizzle Kit migrations.
6. pg-boss for PostgreSQL-backed asynchronous jobs.
7. Transactional outbox for reliable stage scheduling before the completed V1 baseline; the first vertical slice may establish the workflow before completing the outbox path.
8. S3-compatible object storage through an `ObjectStore` interface; MinIO for local development.
9. React, Vite, TanStack Query, React Router, PDF.js, Radix UI Primitives, CSS Modules, Lucide React, Motion, and the native system font stack for the Review Workbench.
10. Pino and basic OpenTelemetry tracing for the first vertical slice; Prometheus-compatible metrics and Jaeger may follow later in V1.
11. Vitest, Testcontainers, Playwright, and synthetic golden cases for testing.
12. Docker Compose is the delivered runtime. The design remains cloud-neutral and includes an Amazon Web Services reference mapping without Terraform in V1.

## Prompt and Model Governance

1. Prompts are GitOps-managed immutable artifacts containing prompt content, metadata, input and output schema references, tests, and hashes.
2. Environment aliases resolve to immutable prompt versions.
3. Runtime prompt editing is not supported.
4. A future external prompt registry may be added behind a `PromptRegistry` interface.
5. The default and fallback VLM are selected by a golden-set benchmark and recorded in an Architecture Decision Record (ADR).
6. Each processing run records exact model, prompt, schema, workflow, OCR, PDF renderer, rule-set, and disposition-policy versions.

## API and Persistence Conventions

1. Public endpoints use `/api/v1`.
2. Errors use one stable Problem Details-style structure and never expose internal stack traces or provider payloads.
3. Case creation and final-review submission support `Idempotency-Key` with request-hash conflict detection; issue edits use optimistic concurrency.
4. Case progress is available through polling. SSE and external webhooks are outside the first V1 implementation slice.
5. Physical files and derived artifacts are immutable objects referenced from PostgreSQL.
6. Large document bytes are not placed in queue payloads or relational columns.
7. A case has immutable processing runs; each run has stage executions and retry attempts.
8. Partial valid results may be retained, but a case with unresolved required evidence cannot become ready.

## Security and Operational Boundaries

1. Documents are untrusted data. Document instructions cannot modify tools, prompts, policies, schemas, or dispositions.
2. VLM extraction calls have no tools and accept only schema-constrained output.
3. The Case Review Agent has mode-specific fixed tool allowlists, iteration limits, VLM-call limits, timeouts, and cost budgets.
4. Its brief uses registered document-review signal and suggested-action codes, cites persisted evidence or findings, and passes schema and reference verification before display.
5. Local demo authentication is development-only and sits behind a replaceable authentication provider interface for future OpenID Connect (OIDC).
6. Audit events are append-only at the application layer but are not represented as tamper-proof.
7. The prototype has no production Service Level Agreement (SLA). It reports measured quality, latency, and cost baselines.
8. Critical dependencies, native runtimes, and model assets are pinned. Continuous integration uses a frozen lockfile and performs baseline supply-chain checks.
9. The complete limitation set is owned by [`LIMITATIONS.md`](LIMITATIONS.md).

## Demonstration Acceptance Paths

1. A native-text happy path completes without VLM extraction and produces a verified Pi Case Review Brief.
2. A difficult scanned or table case triggers the bounded Pi Adaptive Extraction Loop, produces a brief, and records its trace and cost.
3. A mixed document containing a cross-document conflict and prompt injection reaches Human-in-the-Loop review without executing document instructions.

Each path must be reproducible with a fixed golden case and an offline fake-model adapter.

## Specification Authority

The superseded migration source retained for history is:

```text
Intelligent_Document_Processing_Agent_Specification.md
```

It is archived source material only and is marked `Superseded`. The approved owning specifications in `specs/` are authoritative.

`specs/INDEX.md` owns the specification map. Each normative requirement has one owning specification. Other documents reference the owner rather than duplicate normative text.

## Target Specification Set

```text
specs/
  INDEX.md
  PRODUCT_AND_SCOPE.md
  SYSTEM_ARCHITECTURE.md
  DATA_MODEL.md
  API_CONTRACTS.md
  ML_PIPELINE_AND_EVALUATION.md
  SECURITY_AND_LIMITATIONS.md

  components/
    DOCUMENT_PROCESSING.md
    ADAPTIVE_EXTRACTION_AGENT.md
    VALIDATION_AND_DISPOSITION.md
    REVIEW_WORKBENCH.md

  operations/
    OBSERVABILITY_AND_FAILURES.md
    DEPLOYMENT.md

  decisions/
    ADR_001_PI_AGENT_HARNESS.md
    ADR_002_PDF_INSPECTOR.md
    ADR_003_VLM_SELECTION.md
    ADR_004_RULE_ARCHITECTURE.md
```

Executable TypeBox schemas and generated OpenAPI are contract artifacts. Separate prose files are not required for every schema.

## Specification Order

### Stage One — Scope and architecture

1. `specs/INDEX.md`
2. `specs/PRODUCT_AND_SCOPE.md`
3. `specs/SYSTEM_ARCHITECTURE.md`
4. `specs/DATA_MODEL.md`

### Stage Two — Core behavior

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
3. `specs/components/VALIDATION_AND_DISPOSITION.md`
4. `specs/components/REVIEW_WORKBENCH.md`
5. `specs/API_CONTRACTS.md`

Stage Two approval permits vertical-slice implementation.

### Stage Three — ML and operations

1. `specs/ML_PIPELINE_AND_EVALUATION.md`
2. `specs/SECURITY_AND_LIMITATIONS.md`
3. `specs/operations/OBSERVABILITY_AND_FAILURES.md`
4. `specs/operations/DEPLOYMENT.md`

### Stage Four — Technical decisions

ADRs are created when their decisions are ready. The Pi, PDF Inspector, and rule-architecture ADRs may precede related component specifications. The VLM selection ADR follows benchmark evidence.

## Working Method

For every requested specification:

1. Read `AGENTS.md`, this handoff, `LIMITATIONS.md`, and `specs/INDEX.md`; consult the superseded migration source only for historical context not needed by an approved owner.
2. Read only the specifications that directly affect the requested document.
3. Identify conflicts, missing decisions, assumptions, and owning documents before writing.
4. Create or update only the requested specification and required direct references.
5. Do not implement unrelated software.
6. Use English Markdown, stable requirement identifiers, and consistent normative terms: must, should, and may.
7. Keep normative requirements separate from notes and examples.
8. Define acronyms on first use unless already defined by `specs/INDEX.md`.
9. Validate internal links, terminology, identifiers, schemas, and version references.
10. Report the changed file, decisions, assumptions, and unresolved questions.
11. Stop for review before creating the next specification unless the user explicitly requests a batch.

## Repository Agent Guidance

[`AGENTS.md`](AGENTS.md) provides repository-level operating guidance for specification and implementation agents. It is not a normative product specification. Approved owning specifications and ADRs take precedence over it. The file must be updated after the implementation skeleton exists so that its commands and directory guidance match the repository rather than planned structure.
