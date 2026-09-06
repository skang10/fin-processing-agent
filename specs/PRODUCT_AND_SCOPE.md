# Financial Document AI Agent Product and Scope Specification

Document ID: `PRD`

Version: 4.0.0

Status: Approved

Last updated: 2026-09-06

## 1. Purpose

This specification defines the product intent, users, initial-release scope, supported scenario, expected outcomes, exclusions, product requirements, and acceptance criteria for Financial Document AI Agent.

The product is an interview demonstration and production-shaped machine learning prototype. It demonstrates reliable document understanding and human review patterns without claiming to be a production banking system.

## 2. Authority and Related Documents

This document owns:

1. Product purpose and value.
2. Initial-release users and use cases.
3. Supported scenario, inputs, languages, currencies, and document types.
4. Product capability and authority boundaries.
5. User-visible outcomes.
6. Product-level acceptance criteria.

Related authorities are:

1. [`INDEX.md`](INDEX.md) for terminology, identifiers, controlled vocabularies, lifecycle, and document ownership.
2. [`LIMITATIONS.md`](../LIMITATIONS.md) for production-readiness and fitness limitations.
3. [`BACKLOG.md`](../BACKLOG.md) for accepted work awaiting implementation or evaluation evidence.
4. `SYSTEM_ARCHITECTURE.md`, when created and approved, for component and trust boundaries.
5. `ML_PIPELINE_AND_EVALUATION.md`, when created and approved, for datasets, metrics, confidence, and evaluation methodology.

The [migration source specification](../Intelligent_Document_Processing_Agent_Specification.md) is non-authoritative for product and scope concerns after this document is approved.

## 3. Product Statement

Financial Document AI Agent converts a synthetic personal-loan document package into structured, evidence-linked claims, deterministic findings, and a Pi-generated Case Review Brief for a human reviewer. Pi acts as a bounded junior document reviewer: for every processable case it selects from registered inspection and extraction capabilities, requests deterministic reconciliation and validation, flags evidence-grounded review issues, and suggests registered next review actions without making a banking decision.

The product answers:

1. What physical and logical documents were supplied?
2. Which pages and extraction paths produced each material value?
3. What applicant, identity, employment, income, account, and transaction claims were observed?
4. Which supported claims appear consistent, conflicting, missing, expired, or inconclusive?
5. Is the document package ready for a downstream system, missing documents, or in need of human review?

The product does not answer whether a customer should receive a loan or another regulated financial product.

## 4. Product Goals

`PRD-REQ-001` The product must demonstrate an end-to-end document-review workflow from case intake through automated processing and human review.

`PRD-REQ-002` The product must produce structured claims that link to inspectable source evidence.

`PRD-REQ-003` The product must use local document processing before external model processing when the local result is adequate for the requested task.

`PRD-REQ-004` The product must demonstrate selective use of OCR and VLM processing while using the bounded Case Review Agent for every processable case.

`PRD-REQ-005` The product must demonstrate cross-document validation over a finite, versioned example rule set.

`PRD-REQ-006` The product must provide a working Human Review Workbench for evidence inspection and correction.

`PRD-REQ-007` The product must provide reproducible evaluation over versioned synthetic datasets.

`PRD-REQ-008` The product must expose enough processing history, provenance, version, latency, and model-usage information to explain a demonstration result.

`PRD-REQ-009` The product must distinguish implemented prototype controls from controls required before production use.

## 5. Non-Goals

`PRD-REQ-010` The initial release must not make or represent a lending approval, lending decline, creditworthiness, loan-pricing, loan-amount, or loan-term decision.

`PRD-REQ-011` The initial release must not execute or expose an interface for fund disbursement, account opening, customer notification, or another core banking action.

`PRD-REQ-012` The initial release must not make or represent a final AML or KYC disposition.

`PRD-REQ-013` The initial release must not claim implementation of a real financial institution's policy.

`PRD-REQ-014` The initial release must not claim regulatory approval, production readiness, a production SLA, or measured performance beyond its identified datasets and environments.

`PRD-REQ-015` The initial release must not train a proprietary foundation model as a delivery requirement.

`PRD-REQ-016` The initial release must not require a general-purpose business-rule DSL, knowledge graph, vector database, or enterprise data platform.

## 6. Initial Scenario

### 6.1 Scenario definition

`PRD-REQ-017` The initial scenario must represent one natural person submitting a synthetic document package for German personal-loan document review.

`PRD-REQ-018` A case must represent exactly one applicant, one primary bank-account holder, and no more than one current employer in the initial release.

`PRD-REQ-019` Joint applicants, self-employed applicants, pension income, benefit income, beneficial ownership, and complex organization relationships must be treated as unsupported initial-release scenarios.

`PRD-REQ-020` An unsupported scenario must be identified explicitly and must not be silently processed as a supported scenario.

### 6.2 Demonstration context

The German personal-loan context provides realistic multilingual, identity, payslip, bank-statement, table, and entity-matching examples. It does not assert that the example documents, rules, or workflow satisfy a German bank's product or regulatory requirements.

## 7. Users and Responsibilities

### 7.1 Submitter

The submitter creates a demonstration case, supplies structured application data and documents, and monitors processing.

`PRD-REQ-021` A submitter must be able to create a case and view its processing state and available result.

`PRD-REQ-022` A submitter must not receive a product control that represents loan approval, decline, disbursement, account opening, or customer contact.

### 7.2 Reviewer

The reviewer examines document-processing results and corrects system output when required.

`PRD-REQ-023` A reviewer must be able to inspect the document, highlighted evidence, extracted value, confidence metadata, and related validation finding together.

`PRD-REQ-024` Deprecated for the V1 reviewer surface. Direct extracted-value correction is deferred; V1 records issue review and requested-change drafts without rewriting extracted claims.

`PRD-REQ-025` A reviewer must be able to confirm a document-review result or mark it for further review without making a lending or customer decision.

`PRD-REQ-026` Deprecated in V3.0.0; a reviewer-facing audit timeline is not part of the V1 HTML baseline and retained audit access is governed by `PRD-REQ-144`.

### 7.3 Developer or evaluator

The developer or evaluator generates synthetic data, runs the pipeline, compares model configurations, inspects traces, and produces evaluation reports.

`PRD-REQ-027` A developer or evaluator must be able to run the primary demonstration paths without real customer data.

`PRD-REQ-028` A developer or evaluator must be able to reproduce a reported result from identified dataset, input, workflow, model, prompt, schema, and rule-set versions.

### 7.4 Administrator

The prototype administrator inspects health and configuration versions. Runtime product administration is intentionally limited.

`PRD-REQ-029` The initial release must not provide an administrator interface that edits prompts, models, validation-rule code, or disposition semantics at runtime.

## 8. Supported Inputs

### 8.1 File types

`PRD-REQ-030` The initial release must accept PDF, JPEG, and PNG documents.

`PRD-REQ-031` TIFF and all unlisted file types must be reported as unsupported.

`PRD-REQ-032` The product must support both native-text PDFs and PDFs containing scanned pages.

`PRD-REQ-033` The product must support a physical PDF containing more than one contiguous logical document.

`PRD-REQ-034` The initial release must not promise automatic cross-file document merging or non-contiguous page reordering.

### 8.2 Languages and currency

`PRD-REQ-035` Product documentation, user-interface labels, API contracts, code identifiers, and reason codes must use English.

`PRD-REQ-036` The evaluated input-document language set must include German and English documents and may include both languages within one case.

`PRD-REQ-037` The initial validation currency must be EUR.

`PRD-REQ-038` A foreign-currency value may be preserved as an extracted claim, but the product must not perform foreign-exchange conversion.

`PRD-REQ-039` A case requiring unsupported currency validation must not receive `ready_for_downstream_processing` solely from the initial-release validation flow.

### 8.3 Data classification

`PRD-REQ-040` The initial release must be demonstrated and evaluated with synthetic or explicitly demo-safe data.

`PRD-REQ-041` The project documentation must instruct users not to submit real personal, identity, banking, or financial data to the demo deployment.

`PRD-REQ-042` Every synthetic document must be visibly identifiable as synthetic and must not reproduce official security features or real institution branding.

## 9. Core Document and Data Types

### 9.1 Structured application data

`PRD-REQ-043` A case must accept structured application data containing, at minimum, an applicant name and may contain birth date, declared employer, declared monthly income, and currency.

Structured application data is a source of claims and does not require an application-form document.

### 9.2 Identity documents

`PRD-REQ-044` The initial structured extraction scope must include synthetic German Personalausweis-style documents and synthetic German passport-style documents.

`PRD-REQ-045` Core identity fields must include name, birth date, document number, expiry date, and nationality when present.

`PRD-REQ-046` Other identity-document types may be classified as unsupported or routed to review but must not be represented as fully supported.

`PRD-REQ-047` The product must not claim biometric verification, liveness detection, identity authenticity certification, or official-document validation.

### 9.3 Payslips

`PRD-REQ-048` Core payslip fields must include employee name, employer name, pay period, gross income, net income, and currency when present.

### 9.4 Bank statements

`PRD-REQ-049` Core bank-statement fields must include account holder, masked IBAN, statement period, and supported transaction-row fields when present.

`PRD-REQ-050` Supported transaction-row fields must include date, description, amount, direction, currency, and source evidence.

`PRD-REQ-051` The product may identify salary-payment candidates but must not represent a model candidate as a verified income fact without deterministic reconciliation or review.

### 9.5 Additional documents

`PRD-REQ-052` Address and employment evidence may be classified and displayed, but complete field-level extraction and validation for those documents are not initial-release acceptance requirements.

## 10. Document Understanding Capabilities

`PRD-REQ-053` The product must identify the physical file type and page count before semantic extraction.

`PRD-REQ-054` The product must classify pages by supported business-document type and preserve uncertainty or alternatives when available.

`PRD-REQ-055` The product must produce logical documents from contiguous page ranges and retain their physical-file and page lineage.

`PRD-REQ-056` A low-confidence document type or boundary must remain reviewable and must not be silently converted into a final high-confidence result.

`PRD-REQ-057` The product must extract native text before applying OCR to a page when adequate native text is available.

`PRD-REQ-058` The product must apply OCR selectively to pages that require it.

`PRD-REQ-059` The product may use a VLM for difficult pages, tables, layouts, or evidence regions after local processing leaves an unresolved task.

`PRD-REQ-060` A VLM must receive only selected pages, bounded consecutive-page windows, or cropped regions rather than a complete case package.

`PRD-REQ-061` The product must preserve the extraction method and processor version for every material extraction candidate.

### 10.1 Pi Case Review Agent

`PRD-REQ-062` Every processable case must attempt a bounded Agent-in-the-Loop pre-screening step before Human-in-the-Loop review.

`PRD-REQ-063` The Agent must operate in one bounded `case_review` session for a processable run and within a versioned tool and execution budget. Separately scheduled `adaptive_recovery` and `case_review_report` modes are not part of the V1 product flow.

`PRD-REQ-064` Within that session, the Agent may select registered document-inspection and extraction operations, submit evidence-linked extraction candidates, request deterministic reconciliation and validation, consume their committed results, and submit a non-authoritative Case Review Brief. It must not determine or change an authoritative claim, validation finding, recommended disposition, workflow transition, or business action through model output.

`PRD-REQ-065` An unresolved extraction gap, exhausted Agent budget, or unavailable Agent report must remain explicit and visible to the reviewer when a reviewable deterministic result exists.

`PRD-REQ-147` PDF Inspector and related local document-processing capabilities made available to the Agent must be exposed only through registered, case-scoped product tools; the Agent must not receive Shell, arbitrary filesystem, unrestricted network, raw SDK, or dynamic-tool authority.

`PRD-REQ-148` The Agent may adapt which authorized documents, pages, regions, and eligible tools it uses, but local native processing must precede OCR when adequate, and VLM processing must remain selective and follow insufficient or failed approved local processing for the same task.

`PRD-REQ-131` A Case Review Brief must summarize the processed document package, identify registered document-review signals, cite persisted claims, evidence, gaps, or findings, suggest only registered review actions, and may include a verified signal-bound applicant-readable requested-change draft without delivery authority.

`PRD-REQ-132` Deterministic code must verify the brief's schema, references, registered vocabularies, and prohibited-decision boundary before the brief becomes reviewer-visible.

`PRD-REQ-133` Agent report failure or rejection must remain visible but must not prevent a reviewer from receiving the deterministic claims, findings, and disposition.

`PRD-REQ-134` Every completed case result must be presented for human review; `ready_for_downstream_processing` remains a document-processing recommendation and does not bypass reviewer confirmation.

`PRD-REQ-135` Agent suggestions must not express creditworthiness, lending approval or decline, pricing, AML, final KYC, customer-contact, or account-action advice.

## 11. Evidence, Claims, and Confidence

`PRD-REQ-066` Every material extracted claim must reference source evidence.

`PRD-REQ-067` Page evidence must identify the physical document, page number, and page or region location at a granularity appropriate to the claim.

`PRD-REQ-068` Evidence for structured application data must identify its structured-input location.

`PRD-REQ-069` The product must preserve raw and normalized claim values separately.

`PRD-REQ-070` The product must preserve conflicting observations rather than overwrite them with one unexplained canonical value.

`PRD-REQ-071` The product must distinguish raw provider confidence from calibrated system confidence.

`PRD-REQ-072` An uncalibrated score must not be presented as a statistically reliable probability.

`PRD-REQ-073` A model's self-reported confidence must not be used as the sole basis for a ready disposition.

## 12. Cross-Document Validation

`PRD-REQ-074` Cross-document validation must operate on evidence-backed claims associated with explicit person or organization roles.

`PRD-REQ-075` The initial demonstration must support comparison among the applicant, identity holder, employee, and account-holder roles.

`PRD-REQ-076` The initial demonstration must support comparison among declared employer, payslip employer, and salary-payment-counterparty roles when those claims are present.

`PRD-REQ-077` The initial release must implement only a finite, registered, versioned demonstration rule set.

`PRD-REQ-078` The initial demonstration rule set must contain document completeness, applicant-name consistency, employer consistency, income consistency, and identity-document expiry validations.

`PRD-REQ-079` A model may provide a constrained opinion for ambiguous entity matching, but deterministic versioned logic must produce the validation finding.

`PRD-REQ-080` A validation result must distinguish pass, warning, failure, inconclusive input, and non-applicability.

`PRD-REQ-081` Missing evidence or insufficient-confidence input must not be treated as an implicit match or pass.

`PRD-REQ-082` The demonstration rules must not be described as a real German bank policy.

## 13. Recommended Disposition

`PRD-REQ-083` The product must produce exactly one current recommended disposition for a completed processing run.

`PRD-REQ-084` The supported recommended dispositions must be the values defined in `INDEX.md`: `ready_for_downstream_processing`, `additional_documents_needed`, and `human_review_required`.

`PRD-REQ-085` A recommended disposition must describe document-processing state only.

`PRD-REQ-086` Disposition derivation must remain separate from validation-rule evaluation.

`PRD-REQ-087` A case with unresolved required evidence must not receive `ready_for_downstream_processing`.

`PRD-REQ-088` A technical or security failure that prevents reliable result completion must terminate the processing run as `failed`; it must not create a recommended disposition or be represented as a customer rejection.

## 14. Human Review and Feedback

`PRD-REQ-089` Deprecated in V3.0.0; the V1 Review Workbench presentation is governed by `PRD-REQ-145`.

`PRD-REQ-090` Deprecated for V1 together with `PRD-REQ-024`; immutable correction semantics remain available for a later correction workflow but are not required by the V1 HTML baseline.

`PRD-REQ-091` The product must preserve the actor, time, original value, corrected value, correction reason, and relevant evidence for each correction.

`PRD-REQ-092` A reviewer correction may become a dataset candidate only through an explicit controlled step.

`PRD-REQ-093` A reviewer correction must not automatically modify a prompt, model, rule, threshold, disposition policy, or golden truth.

`PRD-REQ-094` Deprecated in V3.0.0; its prohibited-action boundary and requested-change draft clarification are governed by `PRD-REQ-140`.

`PRD-REQ-143` Every completed processable case must enter the human Review Queue and open with its Agent Report as the default case view.

`PRD-REQ-137` A reviewer must be able to confirm, ignore, or edit an Agent-raised review issue and create a human-raised issue, with each action preserved as human review state rather than mutation of the original Agent brief.

`PRD-REQ-138` Confirming an issue may produce an editable applicant-readable requested-change draft, but confirming the issue and including its draft in the final message must remain separate reviewer choices.

`PRD-REQ-139` Final document review must permit exactly one of `request_changes`, `escalate_review`, or `clear_for_downstream`; `request_changes` requires at least one included non-empty requested-change draft, and `clear_for_downstream` requires none.

`PRD-REQ-140` The product must not send, deliver, or notify an applicant from the V1 Review Workbench; recording requested changes is not customer communication.

`PRD-REQ-141` Deprecated in V3.1.0. A separate aggregate Agent-monitoring product surface is deferred; V1 exposes only the bounded case-level Agent log required by `PRD-REQ-145`.

`PRD-REQ-142` Structured application review must support reviewer-relevant applicant, masked contact, submission-history, employment, and income projections when those values are supplied by the synthetic input fixture.

`PRD-REQ-144` Authorized operational users must be able to inspect safe Agent activity and retained audit records outside the default reviewer workflow; V1 does not require a reviewer-facing audit timeline.

`PRD-REQ-145` The Review Workbench must present the Case Review Brief, compact case progress, structured application data, source documents, evidence-linked checked facts, review issues, final document-review actions, and a bounded case-level Agent log. Detailed runs and aggregate operational monitoring are deferred.

`PRD-REQ-146` The product must retain correlated processing, model, validation, disposition, and human-action history. The V1 reviewer surface exposes only compact case progress and a bounded case Agent log; aggregate operational monitoring is deferred.

## 15. Processing Transparency and Reproducibility

`PRD-REQ-095` The product must retain immutable processing runs for a case.

`PRD-REQ-096` Reprocessing after a material input, model, prompt, schema, workflow, or rule-set change must create a new comparable processing run.

`PRD-REQ-097` A retry of the same stage with the same run inputs must remain traceable as a separate attempt within that run.

`PRD-REQ-098` The product must retain successful partial results when safe, but it must visibly identify incomplete or failed stages.

`PRD-REQ-099` Deprecated in V3.0.0; retained processing history and its V1 presentation are governed by `PRD-REQ-146`.

`PRD-REQ-100` A material runtime result must identify the component and configuration versions necessary to explain it.

## 16. Evaluation Product Requirements

`PRD-REQ-101` The first vertical slice must provide six manually verified end-to-end synthetic golden cases; the completed V1 target remains a versioned curated set of twenty.

`PRD-REQ-102` Removed in V1.0.1 with the V1 robustness-dataset concept; this identifier must not be reused.

`PRD-REQ-103` The curated cases must cover native-text, scanned/OCR, mixed or multi-document, complex-table/VLM, and cross-document-conflict behavior.

`PRD-REQ-104` Dataset tooling must support generation, truth validation, immutable dataset build, demo loading, evaluation, and reporting.

`PRD-REQ-105` Golden truth must be generated from source templates where possible and manually confirmed before release.

`PRD-REQ-106` The project must report measured quality, latency, usage, and estimated cost against identified dataset and runtime versions.

`PRD-REQ-107` The project must not publish an unsupported fixed accuracy, automation-rate, severe-error, latency, or cost claim.

`PRD-REQ-108` Default automated tests must be executable without a paid or external model call.

`PRD-REQ-109` A live-model evaluation must be explicit, separately reported, and subject to a configured budget.

## 17. Security and Trust Product Requirements

`PRD-REQ-110` The product must treat document content as untrusted data rather than system instructions.

`PRD-REQ-111` Document content must not expand model or Agent authority, modify a validation rule, alter disposition semantics, or trigger a core banking action.

`PRD-REQ-112` The primary safety demonstration must include instruction-like document content and show that it cannot change authorized behavior.

`PRD-REQ-113` The initial release must apply basic file-type, size, page, image-dimension, corruption, encryption, timeout, and processing-resource controls appropriate to the supported formats.

`PRD-REQ-114` The product must not represent a file as malware-scanned unless an approved scanner actually processed it.

`PRD-REQ-115` The project must disclose that enterprise malware scanning, CDR, production identity management, tamper-proof audit, and production data governance are not implemented.

## 18. User-Visible Processing Progress

`PRD-REQ-116` Case creation must return an identifier before asynchronous document processing completes.

`PRD-REQ-117` A user must be able to query current case state and available stage progress.

`PRD-REQ-118` The Review Workbench should receive incremental processing updates without requiring a full page reload.

`PRD-REQ-119` Failure and partial-completion messages must distinguish an unsupported input, recoverable stage failure, unresolved extraction, review requirement, and terminal processing failure.

## 19. Data Lifecycle

`PRD-REQ-120` The demonstration must allow a user to delete a case and its source and derived data.

`PRD-REQ-121` The project must provide a way to reset the local demonstration to its initial synthetic cases.

`PRD-REQ-122` Temporary document-processing artifacts must not be retained beyond their documented demonstration need.

`PRD-REQ-123` The initial data lifecycle must not be represented as a production retention, deletion-verification, legal-hold, backup, or recovery policy.

## 20. Demonstration Acceptance

### 20.1 Native-text happy path

`PRD-REQ-124` A fixed native-text golden case must complete without a VLM extraction call and display claims, evidence, findings, disposition, a verified Case Review Brief, and processing history.

### 20.2 Agent-led difficult-document path

`PRD-REQ-125` A fixed scanned or complex-table golden case must invoke the bounded Agent, demonstrate Agent selection of approved PDF Inspector or extraction tools, and preserve an explicit gap when the selected processing cannot establish a required claim.

`PRD-REQ-126` The difficult-document path must display the Agent's selected tool actions, resulting candidates and evidence, deterministic result requests, model usage, latency, and estimated-cost availability.

`PRD-REQ-136` Each primary demonstration path must attempt Case Review Brief generation and expose whether the brief was verified, rejected, or unavailable.

### 20.3 Review and safety path

`PRD-REQ-127` A fixed mixed-document golden case must contain a supported cross-document conflict and instruction-like document content.

`PRD-REQ-128` The review and safety path must demonstrate that document instructions do not change tools, rules, permissions, or disposition semantics.

`PRD-REQ-129` The review and safety path must allow a reviewer to inspect evidence, confirm, ignore, or edit an Agent-raised issue, create a human-raised issue, and observe the persisted human-review state without rewriting the extracted claim.

### 20.4 Offline reproducibility

`PRD-REQ-130` All three primary demonstration paths must have a deterministic offline mode using fixed fixtures or fake-model adapters.

## 21. Product Success Criteria

The initial product is successful when:

1. All requirements selected as release-critical by the approved implementation plan have passing acceptance evidence.
2. The three primary demonstration paths execute reproducibly.
3. The golden evaluation report identifies its dataset and component versions.
4. Evidence can be inspected for every material claim used by a validation rule.
5. Every processable case progresses through one bounded Agent-led pre-screening session to human review, with difficult cases using additional eligible tools inside that session without granting the model durable workflow, deterministic-result, or business authority.
6. The documentation clearly distinguishes demonstrated behavior from production gaps.

These criteria do not establish production fitness or a numeric model-quality threshold.

## 22. Assumptions

1. All initial-release documents and identities are synthetic or explicitly demo-safe.
2. The demonstration case manifest can identify which supported document types are required for that case; V1 does not encode a real bank's document policy.
3. The initial applicant is an employed natural person with at most one current employer.
4. The initial evaluation can use a mixture of generated PDF, rendered scan, and image artifacts.
5. External model availability is optional for offline acceptance because fake-model adapters are provided.

## 23. Unresolved Product Questions

No unresolved product-boundary decision blocks review of this document.

The following evidence-dependent choices are intentionally owned elsewhere and remain in the backlog:

1. Default and fallback VLM selection.
2. Measured PDF, OCR, extraction, evidence, latency, and cost baselines.
3. Regression tolerances derived from those baselines.

## 24. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 4.0.0 | 2026-09-06 | Approved | Replaced the two-mode recovery-and-report product flow with one bounded Agent-led case review that selects registered PDF Inspector and extraction tools while retaining deterministic results and mandatory human review; aligned the safety-path acceptance test with the V1 issue-review workflow. |
| 3.1.1 | 2026-09-05 | Approved | Added the removed `PRD-REQ-102` tombstone so the published identifier remains machine-verifiable. |
| 3.1.0 | 2026-09-04 | Approved | Reduced the first vertical slice to six golden cases and deferred the separate aggregate Agent-monitoring surface while retaining the bounded case Agent log. |
| 3.0.0 | 2026-09-04 | Approved | Adopted the V1 HTML UX baseline: Agent Report entry, issue review, applicant-readable request drafts without delivery, compact case progress, and separate Agent monitoring; deferred direct field and boundary correction from the V1 reviewer surface. |
| 2.1.0 | 2026-09-04 | Approved | Removed the V1 `processing_blocked` disposition and retained technical blocking conditions as failed workflow state without a disposition. |
| 2.0.0 | 2026-09-04 | Approved | Made the bounded Pi Case Review Agent a per-case pre-screening stage with verified review briefs, optional gap recovery, and mandatory human confirmation. |
| 1.0.1 | 2026-09-04 | Approved | Removed the V1 robustness dataset requirement `PRD-REQ-102`; the curated twenty-case golden set remains the evaluation and demonstration baseline. |
| 1.0 | 2026-09-03 | Approved | Created and approved the product and scope baseline from the approved index and reviewed migration source. |
