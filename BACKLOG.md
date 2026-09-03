# Backlog

This backlog tracks accepted decisions that still require a dedicated specification or implementation evidence, plus work intentionally deferred beyond the initial demonstration release. Product limitations are owned by [`LIMITATIONS.md`](LIMITATIONS.md).

## Accepted Decisions Awaiting Specification or Implementation

### BL-001 — Finite Cross-Document Validation Rule Sets

**Status:** Accepted; awaiting component specification and implementation

Cross-document validation must execute only rules from a finite, explicitly registered, versioned rule set. V1 uses compiled TypeScript rule plugins and a versioned YAML or JSON manifest. Models cannot create, modify, activate, or change validation-rule semantics at runtime.

Validation findings, risk or review signals, and recommended-disposition mapping must remain separate and independently versioned.

**V1 demonstration rules:**

1. `VAL_DOC_COMPLETENESS_001`
2. `VAL_NAME_CONSISTENCY_001`
3. `VAL_EMPLOYER_CONSISTENCY_001`
4. `VAL_INCOME_CONSISTENCY_001`
5. `VAL_ID_EXPIRY_001`

**Target documents:**

1. `specs/SYSTEM_ARCHITECTURE.md`
2. `specs/DATA_MODEL.md`
3. `specs/components/VALIDATION_AND_DISPOSITION.md`
4. `specs/ML_PIPELINE_AND_EVALUATION.md`
5. `specs/decisions/ADR_004_RULE_ARCHITECTURE.md`

**Acceptance conditions:**

1. Every finding records the rule and rule-set versions.
2. The same normalized facts, evidence state, rule set, and configuration produce the same finding.
3. Missing or insufficient-confidence inputs produce an explicit result.
4. Unknown, unapproved, or inactive rules cannot execute.
5. Historical processing runs retain the exact rule-set version.
6. An ambiguous matching model can return only a constrained opinion; deterministic rule code produces the finding.

### BL-002 — Bounded Pi Adaptive Extraction Loop

**Status:** Accepted; awaiting ADR, component specification, and implementation spike

Embed the `pi-coding-agent` software development kit as a bounded Agent between fixed extraction fallback and Human-in-the-Loop review. Disable built-in coding tools, Shell access, arbitrary file and network access, dynamic extensions, runtime package installation, and automatic resource discovery.

The implementation spike must prove:

1. Only registered TypeBox-validated tools can execute.
2. The loop respects iteration, model-call, timeout, token, and cost budgets.
3. Durable progress survives Agent-process loss because PostgreSQL and pg-boss own workflow state.
4. Document instruction injection cannot expand tool authority or change validation and disposition logic.
5. A fake-model adapter can reproduce the acceptance path offline.

**Target documents:**

1. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
2. `specs/decisions/ADR_001_PI_AGENT_HARNESS.md`
3. `specs/SECURITY_AND_LIMITATIONS.md`

### BL-003 — PDF Inspector Integration Baseline

**Status:** Accepted; awaiting ADR and dataset evidence

Use `firecrawl/pdf-inspector` as the initial PDF classification, native text and coordinate extraction, layout, table, rendering, selective OCR routing, and PP-OCRv6 integration foundation. Keep PDF rendering and OCR behind project interfaces.

The evaluation must report results for German and English synthetic identity documents, payslips, bank statements, native PDFs, scanned pages, mixed PDFs, and complex tables. Versions of PDF Inspector, PDFium, ONNX Runtime, and OCR model assets must be pinned and recorded.

**Target documents:**

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/ML_PIPELINE_AND_EVALUATION.md`
3. `specs/decisions/ADR_002_PDF_INSPECTOR.md`

### BL-004 — VLM Selection Benchmark

**Status:** Pending evidence

Evaluate two candidate external VLMs on the same versioned subset of the golden set. Compare field accuracy, evidence-region quality, schema compliance, latency, usage, and estimated cost. Select a default and fallback only after results exist.

The resulting choice belongs in `specs/decisions/ADR_003_VLM_SELECTION.md`. Product specifications must remain provider-neutral.

### BL-005 — Versioned Golden and Robustness Datasets

**Status:** Accepted; awaiting dataset tooling and artifacts

Build:

1. Twenty curated, manually verified end-to-end golden cases.
2. One hundred fixed-seed robustness cases by default.
3. Generator-produced truth followed by human confirmation in a development-only Review Workbench mode.
4. Command-line generation, validation, build, load, evaluation, and reporting workflows.

Synthetic files must be visibly marked and must not reproduce official security features or real institution branding.

### BL-006 — Measured Quality, Latency, and Cost Baseline

**Status:** Blocked on BL-003 through BL-005 evidence

Replace unsupported numerical targets with measured results tied to dataset, model, prompt, component, and environment versions. Establish regression tolerances only after the initial baseline exists.

## Deferred Production Work

### BL-100 — Enterprise File Security

Add an approved malware scanner or CDR service, complete a document-processing threat model, and perform adversarial-file and penetration testing before any production use.

### BL-101 — Production Identity and Authorization

Replace development-only demo authentication with an approved OpenID Connect provider, production role mapping, service identities, and case-level authorization.

### BL-102 — Production Data Governance

Define retention, legal hold, deletion verification, backup, recovery, data residency, and privacy-impact controls for an approved jurisdiction and business purpose.

### BL-103 — Private or Local Model Deployment

Implement and evaluate a private-cloud or local model adapter through the provider-neutral model gateway when required by deployment policy.

### BL-104 — Production Reliability and Cloud Infrastructure

Define Service Level Objectives, capacity, autoscaling, high availability, disaster recovery, Infrastructure as Code, artifact signing, and cloud deployment validation. The initial release provides only Docker Compose and an Amazon Web Services reference mapping.

### BL-105 — Authorized Real-Data Evaluation

Obtain approved representative data and complete privacy, fairness, model-risk, subgroup, drift, and operational evaluation before claiming real-world performance.

