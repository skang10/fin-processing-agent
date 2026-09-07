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

**Status:** The single `case_review` Pi SDK harness is implemented and used by the Worker for every processable case, and it now leads document extraction: the manifest, page inspection, native-text, OCR, render, classification, boundary, VLM, candidate-submission, reconciliation-request, validation-request, current-result, and report tools are the Agent's only route to document content, and no fixture seeds structured values on the native-text path. Incremental per-step persistence and durable re-entry are implemented and proven by a Docker-backed Worker-termination suite covering seven committed boundaries. One budgeted `openai/gpt-5.6-terra` synthetic scanned case completed the Agent-led end-to-end live-VLM path with correct income-conflict semantics and restart reuse; a separate Linux ARM64 run completed the same scanned case through pinned real OCR and a fake Agent with zero VLM calls. Evaluation capture requires an explicit whole-run cost cap for live models. Corpus-level OCR and live-model measurement remain pending.

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

**Status:** The pinned PDF Inspector PP-OCRv6 Small runtime is accepted on Linux ARM64 for scanned PDF, JPEG, and PNG synthetic inputs. Linux x64 assets are pinned and checksum-verified but native execution is deferred. Default demo/CI remain fixture-backed. Optional real bounded PNG cropping is implemented for input minimization or magnification. Re-recognizing the same small page crop is not a V1 default or an acceptance objective; source-page OCR/VLM bounding boxes should flow to reviewer evidence highlighting instead. Hardened OS resource isolation, cross-platform smoke evidence, and corpus-level quality/latency/resource measurement remain pending.

The default OCR result remains deterministic fixture output and must not be presented as recognition evidence. The explicit real-runtime mode now proves offline PDF OCR execution, persisted provenance, Agent OCR reading, deterministic reconciliation and validation, and report generation for one bounded synthetic case. Remaining work:

1. Extend the accepted `processPdfWithOcr` offline smoke path beyond Linux ARM64 to Linux x64 after the main functional path is complete; the assets remain pinned and checksum-verifiable, but native x64 execution is explicitly deferred and must not be claimed as accepted.
2. Add release-manifest integration for the committed OCR runtime asset manifest.
3. Preserve accurate source-page bounding boxes from each recognition result and use them as evidence rather than running a redundant crop-recognition pass. Keep optional crop rendering bounded for exceptional input minimization or magnification; if that path becomes release-required, complete its derived-artifact acceptance then. JPEG and PNG full-page execution is accepted on Linux ARM64.
4. OCR quality, latency, and resource measurements on the versioned synthetic dataset.

Use `firecrawl/pdf-inspector` as the initial PDF classification, native text and coordinate extraction, layout, table, rendering integration, selective OCR-routing, and PP-OCRv6 Small execution foundation. Keep its OCR result behind the project-owned adapter contract.

The evaluation must report results for German and English synthetic identity documents, payslips, bank statements, native PDFs, scanned pages, mixed PDFs, and complex tables. Versions of PDF Inspector, PDFium, ONNX Runtime, and OCR model assets must be pinned and recorded.

**Target documents:**

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/ML_PIPELINE_AND_EVALUATION.md`
3. `specs/decisions/ADR_002_PDF_INSPECTOR.md`

### BL-004 — VLM Selection Benchmark

**Status:** Completed for the initial bounded subset; ADR-003 accepted

`openai/gpt-5.6-terra` and `openai/gpt-5.6-sol` were evaluated on the same frozen `v0.1.2` scanned adaptive case under independent USD 0.25 ceilings. Both achieved identical perfect bounded quality results; Terra was faster and materially cheaper, so ADR-003 selects it as default and Sol as fallback. Broader corpus and provider-diversity evidence remains part of BL-006 rather than reopening this initial selection gate.

The resulting choice belongs in `specs/decisions/ADR_003_VLM_SELECTION.md`. Product specifications must remain provider-neutral.

### BL-005 — Versioned Golden Dataset

**Status:** Six visibly synthetic candidates are manually confirmed and frozen as checksum-verified `v0.1.2`; frozen `v0.1.1` remains unchanged and the completed V1 target remains twenty cases. Release `v0.1.2` makes `golden-003-multiple-review-issues` carry a real payslip-income conflict plus its employer conflict, and makes `golden-004-missing-bank-evidence` expect the account-holder name to remain unresolved when the bank statement is absent. Two independent frozen-release captures reproduced 5/5 issue precision, 5/6 recall, 29/29 grounding, and 5/6 verified reports with identical normalized results.

Public datasets are tracked separately as opt-in component diagnostics. Their exact revisions, licenses, privacy fitness, deterministic subsets, and checksums must be approved before download or use; they do not replace project-owned end-to-end golden truth.

Build incrementally:

1. Six curated, manually verified end-to-end golden cases for the first vertical slice, expanding to twenty for completed V1.
2. Generator-produced truth followed by human confirmation through lightweight dataset command-line workflows.
3. Command-line generation, validation, build, load, evaluation, and reporting workflows.

Synthetic files must be visibly marked and must not reproduce official security features or real institution branding.

### BL-006 — Measured Quality, Latency, and Cost Baseline

**Status:** A reproducible Agent-led offline regression result is recorded against frozen `v0.1.2`; two independent captures produced identical 100% issue precision, 83.3% issue recall, 100% grounding, zero unsupported claims, and 83.3% verified-report completion. The sole missed issue and unavailable report are the intentional `golden-006` fake-policy path. One budgeted live-Agent native-text run and one pinned real-OCR scanned run are recorded. Formal measured baseline work still requires corpus-level real-OCR and compatible live-model evidence.

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

### BL-009 — Declared Field Requirements and Agent-Led Extraction Coverage

**Status:** Implemented for the demonstration corpus; coverage and evidence quality remain to be broadened

Document values now come from the Agent through registered, scoped tools rather than from a fixture table. The versioned requirement set (`document-field-requirements-1.0.0`) declares seven document fields across the three required document types, and a requirement becomes an explicit extraction gap only when the run actually contains a logical document of that type.

Remaining work:

1. Extend the requirement set beyond the seven demonstration fields once more document variation exists.
2. Attach normalized evidence regions to native-text candidates; PDF Inspector layout coordinates are not exposed through the current native-text boundary, so those candidates carry a page reference without a bounding box.
3. Keep the fixture scanned-page adapter only for default fixture mode; the explicit real-OCR route now resolves the scanned demonstration fields locally. Optional bounded VLM requests receive real pixel crops, but the ordinary small-page path should recognize once and retain the returned source-page bbox. Do not make crop persistence or a second OCR/VLM call a default requirement without measured need.
4. Frozen `v0.1.2` now makes `golden-003-multiple-review-issues` carry two document-supported conflicts and no longer claims boundary-uncertainty coverage that the current deterministic router cannot produce.
5. The explicit real-OCR route classifies the three scanned golden-006 pages from committed OCR content under `synthetic-demo-ocr-content-classifier`; it does not use the fixture page-type declaration. The fixture declaration remains visibly identified and limited to default fixture mode.
6. Move page rendering, OCR, classification, and grouping from the current eager pre-session pass into idempotent Agent-requested sandbox operations. The implemented visual boundary lets Pi inspect authorized uploaded-document page renders, but those renders are still generated before the session; do not describe the runtime as fully demand-driven until this item is complete.
7. Add a project-owned page-quality router only if measured cases show PDF Inspector `needsOcr` is insufficient. Until that evidence exists, `needsOcr` remains the deterministic routing signal and routed pages require Agent visual inspection before OCR or VLM.

**Target documents:**

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
3. `specs/components/VALIDATION_AND_DISPOSITION.md`

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
