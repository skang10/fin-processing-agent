# Backlog

This backlog tracks accepted decisions that still require a dedicated specification or implementation evidence, plus work intentionally deferred beyond the initial demonstration release. Product limitations are owned by [`LIMITATIONS.md`](LIMITATIONS.md).

## Accepted Decisions Awaiting Specification or Implementation

### BL-001 — Finite Cross-Document Validation Rule Sets

**Status:** Deterministic five-rule baseline implemented; awaiting golden-dataset evaluation evidence

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

### BL-002 — Bounded Pi Case Review Agent

**Status:** Fake report harness and verifier implemented; real bounded Pi SDK spike pending

Embed the `pi-coding-agent` software development kit as a bounded pre-screening Agent for every processable case. It produces a verified Case Review Brief and may enter Adaptive Extraction mode only for eligible gaps. Disable built-in coding tools, Shell access, arbitrary file and network access, dynamic extensions, runtime package installation, and automatic resource discovery.

The implementation spike must prove:

1. Only registered TypeBox-validated tools can execute.
2. The loop respects iteration, model-call, timeout, token, and cost budgets.
3. Durable progress survives Agent-process loss because PostgreSQL and pg-boss own workflow state.
4. Document instruction injection cannot expand tool authority or change validation and disposition logic.
5. A fake-model adapter can reproduce the acceptance path offline.
6. Every processable case attempts a schema- and reference-validated report without making the report a single point of failure for human review.
7. Report suggestions use registered document-review codes and cannot express lending, creditworthiness, AML, or KYC decisions.

**Target documents:**

1. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
2. `specs/decisions/ADR_001_PI_AGENT_HARNESS.md`
3. `specs/SECURITY_AND_LIMITATIONS.md`

### BL-003 — PDF Inspector Integration Baseline

**Status:** PDF Inspector adapter and native inspection path implemented; dataset evidence and remaining rendering/OCR spike pending

Use `firecrawl/pdf-inspector` as the initial PDF classification, native text and coordinate extraction, layout, table, rendering integration, and selective OCR-routing foundation. Keep PDF rendering and the independent PP-OCRv6-targeted `OcrEngine` behind project interfaces.

The evaluation must report results for German and English synthetic identity documents, payslips, bank statements, native PDFs, scanned pages, mixed PDFs, and complex tables. Versions of PDF Inspector, PDFium, ONNX Runtime, and OCR model assets must be pinned and recorded.

**Target documents:**

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/ML_PIPELINE_AND_EVALUATION.md`
3. `specs/decisions/ADR_002_PDF_INSPECTOR.md`

### BL-004 — VLM Selection Benchmark

**Status:** Proposed ADR; pending benchmark evidence

Evaluate at least two compatible external VLM configurations on the same versioned golden subset. Compare issue precision and recall, evidence grounding, verified-report completion, bounded-extraction schema compliance, latency, usage, and estimated cost. Select a default and fallback only after results exist.

The resulting choice belongs in `specs/decisions/ADR_003_VLM_SELECTION.md`. Product specifications must remain provider-neutral.

### BL-005 — Versioned Golden Dataset

**Status:** Approved specification; awaiting dataset tooling and artifacts

Build incrementally:

1. Six curated, manually verified end-to-end golden cases for the first vertical slice, expanding to twenty for completed V1.
2. Generator-produced truth followed by human confirmation through lightweight dataset command-line workflows.
3. Command-line generation, validation, build, load, evaluation, and reporting workflows.

Synthetic files must be visibly marked and must not reproduce official security features or real institution branding.

### BL-006 — Measured Quality, Latency, and Cost Baseline

**Status:** Blocked on BL-003 through BL-005 evidence; measurement method is approved

Replace unsupported numerical targets with measured results tied to dataset, model, prompt, component, and environment versions. Establish regression tolerances only after the initial baseline exists.

### BL-007 — V1 Review UX Contracts

**Status:** Read projections, API-hydrated workbench, Agent-issue confirm/ignore, append-only human issue create/edit, requested-change revisions, atomic final-review recording, post-review read-only enforcement, separate active, changes-requested, and completed queues, and the read-only downstream handoff contract implemented; case Agent-log projection pending; aggregate monitoring deferred

Define implementation contracts for the approved V1 HTML UX baseline:

1. Review Queue workflow-state queries and ordering.
2. Agent Report, review-issue, human edit, confirm, ignore, and create commands.
3. Applicant-readable requested-change drafts, inclusion state, final message projection, and the prohibition on delivery from V1.
4. Final `request_changes`, `escalate_review`, and `clear_for_downstream` command preconditions.
5. Structured application projections for masked contact and submission-history fields.
6. Case Agent log with safe model, cost, timestamp, and bounded activity projections.
7. Top-level reviewer navigation separates active `Review queue`, `Changes requested`, and read-only `Completed` cases. Completed cases must not remain mixed into the actionable Review Queue.
8. `request_changes` moves the case to `Changes requested`; V1 must not label this state `Waiting for applicant` because the Workbench does not deliver the draft or contact the applicant.
9. `clear_for_downstream` atomically persists the immutable final review, transitions the case lifecycle to `ready`, removes it from the active Review Queue, and exposes it in `Completed` as `Ready for handoff`.
10. The initial V1 demo exposes completed results through a read-only, versioned downstream contract without connecting to or implying a real lending system. `Handed off` and `Handoff failed` states remain unavailable until an authorized consumer and delivery acknowledgement exist.
11. Completed-case projections preserve the reviewed result revision, final review action, reviewer, completion time, structured claims, deterministic findings, evidence references, and audit linkage required by the downstream contract.

**Target documents:**

1. `specs/API_CONTRACTS.md`
2. `specs/SECURITY_AND_LIMITATIONS.md`
3. `specs/operations/OBSERVABILITY_AND_FAILURES.md`
4. Executable TypeBox schemas after the Stage Two repository skeleton exists.

**Acceptance conditions:**

1. Active, changes-requested, and completed cases cannot appear in the wrong top-level list.
2. Refresh and concurrent commands converge to the persisted reviewer workflow state.
3. Replaying `clear_for_downstream` cannot create a duplicate final review or downstream-ready record.
4. No V1 state or copy claims applicant delivery or successful downstream consumption without an acknowledged integration.

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
