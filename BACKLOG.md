# Backlog

This backlog tracks accepted decisions that still require a dedicated specification or implementation evidence, plus work intentionally deferred beyond the initial demonstration release. Product limitations are owned by [`LIMITATIONS.md`](LIMITATIONS.md).

## Accepted Decisions Awaiting Specification or Implementation

### BL-001 — Finite Cross-Document Validation Rule Sets

**Status:** Deterministic five-rule baseline implemented and exercised by the frozen six-case `v0.1.1` offline regression baseline; broader non-fixture evaluation remains pending

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

**Status:** The single `case_review` Pi SDK harness is implemented and used by the Worker for every processable case. Its registered tools cover bounded PDF inspection and extraction, candidate submission, deterministic reconciliation and validation requests, current-result retrieval, and report submission. Incremental per-step persistence and durable re-entry are implemented and proven by a Docker-backed Worker-termination suite covering six committed boundaries. Live-model acceptance and real OCR/VLM adapters remain pending.

Embed the `pi-coding-agent` software development kit as the bounded pre-screening orchestrator for every processable case. After deterministic intake and minimum file preflight, one case-review session may select registered PDF Inspector, extraction, evidence, reconciliation-request, validation-request, and report-submission tools. Disable built-in coding tools, Shell access, arbitrary file and network access, dynamic extensions, runtime package installation, and automatic resource discovery.

The implementation spike must prove:

1. Only registered TypeBox-validated tools can execute.
2. The loop respects iteration, model-call, timeout, token, and cost budgets.
3. Durable progress survives Agent-process loss because PostgreSQL and pg-boss own workflow state. *(Proven: one authoritative session per run, linked recovery attempts, incrementally committed steps and tool results, budgets that never reset, and no duplicate candidate, claim, finding, result revision, or report after termination at any tested boundary.)*
4. Document instruction injection cannot expand tool authority or change validation and disposition logic.
5. A fake-model adapter can reproduce the acceptance path offline.
6. Every processable case attempts a schema- and reference-validated report without making the report a single point of failure for human review.
7. Report suggestions use registered document-review codes and cannot express lending, creditworthiness, AML, or KYC decisions.

**Target documents:**

1. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
2. `specs/decisions/ADR_001_PI_AGENT_HARNESS.md`
3. `specs/SECURITY_AND_LIMITATIONS.md`

### BL-003 — PDF Inspector Integration Baseline

**Status:** PDF Inspector, native-text persistence, PDF.js reviewer display, pinned PDFium full-page rendering, the credential-stripped bounded subprocess protocol, and selective OCR orchestration with a deterministic fake adapter and persisted provenance are implemented; dataset evidence, hardened OS resource/network isolation, crop rendering, and the real pinned PP-OCRv6 runtime remain pending

The current OCR result is a deterministic synthetic fixture output. It proves routing, sandbox execution, artifact persistence, provenance, confidence semantics, and coordinate transforms, but it does not recognize text and must not be presented or evaluated as real OCR. Defer the following until the end-to-end candidate-to-report path is complete:

1. Pre-provision and verify PDF Inspector's pinned local PP-OCRv6 Small, PDFium, and ONNX Runtime assets.
2. Exercise the `processPdfWithOcr` adapter in offline mode across supported development and Docker platforms.
3. JPEG and PNG OCR execution, bounded region and crop OCR, and mixed-language quality tuning.
4. OCR quality, latency, and resource measurements on the versioned synthetic dataset.

Use `firecrawl/pdf-inspector` as the initial PDF classification, native text and coordinate extraction, layout, table, rendering integration, selective OCR-routing, and PP-OCRv6 Small execution foundation. Keep its OCR result behind the project-owned adapter contract.

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

**Status:** Initial six-case release complete. All visibly synthetic candidates are manually confirmed and frozen as checksum-verified `v0.1.1`; the completed V1 target remains twenty cases

Public datasets are tracked separately as opt-in component diagnostics. Their exact revisions, licenses, privacy fitness, deterministic subsets, and checksums must be approved before download or use; they do not replace project-owned end-to-end golden truth.

Build incrementally:

1. Six curated, manually verified end-to-end golden cases for the first vertical slice, expanding to twenty for completed V1.
2. Generator-produced truth followed by human confirmation through lightweight dataset command-line workflows.
3. Command-line generation, validation, build, load, evaluation, and reporting workflows.

Synthetic files must be visibly marked and must not reproduce official security features or real institution branding.

### BL-006 — Measured Quality, Latency, and Cost Baseline

**Status:** Offline deterministic regression result recorded for `v0.1.1`; formal measured baseline remains blocked on live-model acceptance, real OCR evidence, and captured latency, usage, and cost observations

Replace unsupported numerical targets with measured results tied to dataset, model, prompt, component, and environment versions. Establish regression tolerances only after the initial baseline exists.

### BL-007 — V1 Review UX Contracts

**Status:** Read projections, API-hydrated workbench, Agent-issue confirm/ignore, append-only human issue create/edit, requested-change revisions, atomic final-review recording, post-review read-only enforcement, separate active, changes-requested, and completed queues, the read-only downstream handoff contract, and the bounded case Agent-log projection implemented; aggregate monitoring deferred

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

### BL-008 — Logical Documents and Candidate Reconciliation

**Status:** The deterministic synthetic path now produces evidence-linked structured-input and document-derived candidates, reconciles each accepted candidate into a claim, and persists complete candidate-to-claim lineage; broader non-fixture extraction remains pending

Implement the minimum deterministic path in dependency order:

1. Persist page classifications and boundary predictions for the existing synthetic case types.
2. Create deterministic contiguous logical-document revisions from those committed inputs.
3. Create schema-valid structured-input and document-derived extraction candidates with distinct evidence links.
4. Reconcile candidates deterministically into claims while preserving every considered candidate and selection reason.
5. Replace the offline fixture shortcut that currently materializes claims directly, without changing the five-rule validation semantics or Agent authority.

Do not add new business fields or document types until their owning schema and rule inputs are approved. A document-derived candidate must not be persisted before its logical-document revision exists.

**Target documents:**

1. `specs/SYSTEM_ARCHITECTURE.md`
2. `specs/DATA_MODEL.md`
3. `specs/components/DOCUMENT_PROCESSING.md`
4. `specs/components/VALIDATION_AND_DISPOSITION.md`

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
