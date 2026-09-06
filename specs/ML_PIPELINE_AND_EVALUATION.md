# Financial Document AI Agent ML Pipeline and Evaluation Specification

Document ID: `MLE`

Version: 1.2.0

Status: Approved

Last updated: 2026-09-06

## 1. Purpose

This specification defines the V1 machine-learning evaluation question, golden dataset, truth records, evaluation execution, metrics, model comparison, reporting, and regression policy.

V1 evaluates one primary machine-learning capability:

> Can the bounded Pi Case Review Agent use persisted document-processing results and evidence to produce a reliable, evidence-grounded pre-screening report for a human reviewer?

PDF Inspector remains the initial foundation for PDF inspection, native extraction, layout, rendering integration, selective OCR routing, and local PP-OCRv6 Small execution behind the project-owned adapter. These outputs are necessary inputs to the evaluated report and receive focused fixture coverage, but V1 does not turn every document-processing component into a separate research benchmark.

## 2. Authority and Dependencies

This document owns:

1. V1 evaluation scope and primary ML question.
2. Golden-case composition, truth semantics, dataset lifecycle, and dataset tooling behavior.
3. Agent-report quality metrics and evaluation reports.
4. Model and prompt comparison protocol.
5. Regression-baseline and live-model evaluation policy.

Normative dependencies are:

1. [`INDEX.md`](INDEX.md) for terminology, controlled vocabularies, and lifecycle.
2. [`PRODUCT_AND_SCOPE.md`](PRODUCT_AND_SCOPE.md) for product goals and prohibited claims.
3. [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) for pipeline and trust boundaries.
4. [`DATA_MODEL.md`](DATA_MODEL.md) for cases, evidence, versions, Agent sessions, and reports.
5. [`components/DOCUMENT_PROCESSING.md`](components/DOCUMENT_PROCESSING.md) for PDF Inspector and OCR contracts.
6. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](components/ADAPTIVE_EXTRACTION_AGENT.md) for bounded Agent behavior and report verification.
7. [`components/VALIDATION_AND_DISPOSITION.md`](components/VALIDATION_AND_DISPOSITION.md) for deterministic findings and disposition.
8. [`components/REVIEW_WORKBENCH.md`](components/REVIEW_WORKBENCH.md) for reviewer-visible report behavior.
9. [`LIMITATIONS.md`](../LIMITATIONS.md) for dataset and production-fitness boundaries.

`MLE-REQ-001` Evaluation must preserve the separation between model-produced candidates or reports and deterministic validation findings, dispositions, schema checks, reference checks, and workflow state.

`MLE-REQ-002` No evaluation result may be represented as credit-risk, lending, fraud, final AML, final KYC, document-authenticity, or production-readiness performance.

## 3. V1 Evaluation Scope

### 3.1 Primary task

`MLE-REQ-003` The V1 primary ML task must be the production of a schema-valid, evidence-grounded Case Review Brief from the immutable result-revision projection supplied to the Pi Case Review Agent.

`MLE-REQ-004` Primary evaluation must assess exactly three quality dimensions:

1. Review-issue detection.
2. Evidence grounding.
3. Report validity.

`MLE-REQ-005` The three dimensions must be reported separately; V1 must not collapse them into one opaque aggregate score.

`MLE-REQ-006` Latency, model invocations, token usage, and estimated cost must be reported as operational observations and must not substitute for report quality.

### 3.2 Supporting pipeline checks

`MLE-REQ-007` PDF Inspector, PP-OCRv6, page classification, boundary prediction, extraction, entity matching, deterministic validation, and disposition must not each become a separate V1 headline benchmark.

`MLE-REQ-008` Supporting pipeline components must instead have focused deterministic or golden-fixture checks sufficient to establish that the evaluated Agent received valid, traceable inputs.

`MLE-REQ-009` Adaptive extraction must be exercised in at least one fixed difficult golden case and evaluated through its effect on the final report, evidence, budget compliance, and safe termination rather than through a separate leaderboard.

`MLE-REQ-010` Deterministic rules, disposition mapping, schema validation, reference validation, workflow transitions, and API behavior must be assessed through software tests and must not be reported as model accuracy.

### 3.3 Excluded V1 evaluations

`MLE-REQ-011` V1 must not claim a comprehensive OCR benchmark, document-classification benchmark, human-productivity study, fairness study, production drift baseline, calibrated risk score, or real-data performance evaluation.

`MLE-REQ-012` V1 must not evaluate automatic loan approval, loan rejection, creditworthiness, customer communication, final AML, or final KYC because those capabilities do not exist in product scope.

## 4. Evaluated Pipeline

```text
Synthetic case package
  -> PDF Inspector native inspection, layout, rendering, and OCR routing
  -> selective PP-OCRv6 when required
  -> bounded extraction and normalization
  -> evidence binding
  -> deterministic entity and validation inputs
  -> deterministic findings and recommended disposition
  -> bounded Pi Case Review Agent
  -> deterministic report schema and reference verification
  -> evaluation against golden report truth
```

`MLE-REQ-013` Every evaluated run must identify exact case-package, dataset, generator, PDF Inspector, PDFium, OCR model asset, extraction component, model, prompt, schema, Agent configuration, tool registry, rule-set, disposition-policy, and evaluator versions.

`MLE-REQ-014` Local native extraction and selective OCR must precede VLM use according to the approved processing contracts.

`MLE-REQ-015` PDF Inspector must remain behind the project-owned interfaces defined by `DOC-REQ-002` and `DOC-REQ-030`; evaluation code must not make downstream truth or metric schemas depend on PDF Inspector SDK types.

`MLE-REQ-016` A PDF Inspector, OCR, classifier, extraction, VLM, or Agent output must never be used as its own golden truth.

## 5. Golden Dataset

### 5.1 Dataset purpose and size

`MLE-REQ-017` The first vertical slice must contain six curated, manually verified synthetic end-to-end golden cases; the completed V1 target is twenty cases.

`MLE-REQ-018` The six-case initial set and twenty-case completed set form demonstration acceptance and regression sets, not statistically representative production samples.

`MLE-REQ-019` A reported metric must identify the exact frozen dataset release and compatible subset; excluded and unevaluable cases must be listed with reasons.

### 5.2 Required coverage

`MLE-REQ-020` The golden set must cover native-text, scanned, and mixed PDFs; German and English content; supported identity documents, payslips, and bank statements; and visibly synthetic structured application data.

`MLE-REQ-021` The set must include at least these three fixed acceptance paths:

1. A native-text case that completes without VLM extraction.
2. A difficult scanned or table case that uses bounded adaptive extraction.
3. A cross-document conflict case containing instruction-like document content that remains inert.

`MLE-REQ-022` Coverage must include cases with no review issue, one review issue, multiple review issues, missing evidence, conflicting evidence, and a report-unavailable or verifier-rejected outcome.

`MLE-REQ-023` Dataset composition must remain tied to the five registered V1 demonstration rules and must not invent unapproved business or compliance policies.

### 5.3 Synthetic-data constraints

`MLE-REQ-024` Every input document must be synthetic or explicitly demo-safe, visibly marked as synthetic, and free of real institution branding and reproduced official security features.

`MLE-REQ-025` The dataset repository must not contain real names, contact details, identity numbers, bank details, credentials, or other real personal or financial data.

`MLE-REQ-026` Dataset generation must use deterministic seeds and record generator version, template version, asset version, and source manifest.

## 6. Golden Truth

`MLE-REQ-027` Golden truth must be stored outside the Review Workbench and confirmed through lightweight dataset command-line workflows; V1 must not reintroduce a golden-annotation product UI.

`MLE-REQ-028` Generator-produced truth must remain a candidate until a human verifier confirms it for a frozen dataset release.

`MLE-REQ-029` Each golden case must define only the truth required for the primary task and supporting acceptance path:

1. Expected review issues with stable issue or signal codes.
2. Acceptable supporting evidence references for each expected issue.
3. Expected checked facts with acceptable supporting references.
4. Required report content constraints.
5. Prohibited report content constraints.
6. Expected report availability or verifier outcome.

`MLE-REQ-030` Truth may additionally contain the page, boundary, field, transaction, or entity values required to diagnose an end-to-end failure, but those additions must not silently expand the primary metric set.

`MLE-REQ-031` Expected issues must be matched by stable semantics and evidence, not exact natural-language wording alone.

`MLE-REQ-032` An issue may declare multiple acceptable evidence references when more than one persisted source supports the same material conclusion.

`MLE-REQ-033` A golden case with intentionally ambiguous evidence must encode the allowed unresolved or escalation outcome rather than force a fabricated definitive answer.

`MLE-REQ-034` Human corrections from ordinary review may become dataset candidates but must never update frozen truth automatically.

## 7. Primary Metrics

### 7.1 Review-issue detection

`MLE-REQ-035` Issue detection must compare verified Agent-raised issue instances with expected golden issue instances using stable issue semantics and case identity.

`MLE-REQ-036` The evaluation report must provide micro precision, micro recall, and counts of true-positive, false-positive, and false-negative issue instances.

`MLE-REQ-037` A semantically correct issue with no acceptable supporting reference must not count as a fully correct grounded issue.

`MLE-REQ-038` Per-case results must identify missed expected issues and unsupported additional issues so every aggregate remains auditable.

### 7.2 Evidence grounding

`MLE-REQ-039` Evidence grounding must be evaluated over every material Agent issue and checked fact that requires a persisted reference.

`MLE-REQ-040` A grounded item must reference the correct case, result revision, source record, and an acceptable page, region, structured-data pointer, claim, gap, or finding defined by golden truth.

`MLE-REQ-041` The evaluation report must provide correct-grounding rate and unsupported-claim rate with numerator and denominator counts.

`MLE-REQ-042` A valid-looking reference to irrelevant evidence must be scored as incorrect grounding even when the identifier resolves successfully.

`MLE-REQ-043` Evidence-region overlap may be recorded for diagnosis when region truth exists, but V1 must not promote bounding-box Intersection over Union to a headline metric.

### 7.3 Report validity

`MLE-REQ-044` Report validity must use the deterministic Report Verifier outcome and must separately report schema validity, reference validity, registered-code validity, and prohibited-content validity.

`MLE-REQ-045` The headline report-validity metric must be verified-report completion rate: the number of cases with a verified reviewer-presentable report divided by the number of processable evaluated cases.

`MLE-REQ-046` A verifier-rejected, unavailable, timed-out, or budget-exhausted report must remain an explicit outcome and must not be removed from the denominator when the case was processable.

`MLE-REQ-047` A report containing lending, creditworthiness, fraud-guilt, customer-contact, final AML, final KYC, or unsupported document-authenticity content must fail prohibited-content validity.

`MLE-REQ-048` Natural-language style, tone, and exact wording must not be scored as a separate headline metric in V1; requested-change drafts are acceptable only when their verifier constraints and golden content requirements pass.

## 8. Supporting Checks and Diagnostics

`MLE-REQ-049` PDF Inspector integration fixtures must at minimum demonstrate:

1. Native text and coordinates from a native PDF without unnecessary OCR.
2. Selective PP-OCRv6 execution for a scanned page.
3. Preserved page geometry and evidence coordinates.
4. Ordered pages and contiguous logical-document boundaries in a mixed PDF.
5. Structured failure for corrupt or unsupported input.

`MLE-REQ-050` Supporting extraction fixtures must check schema-valid critical values and evidence links needed by the golden reports; failures must be visible in case-level diagnostics.

`MLE-REQ-051` Entity-matching fixtures must include exact, normalized, different, and ambiguous examples, and must prove that any LLM opinion cannot directly create a finding.

`MLE-REQ-052` Deterministic validation fixtures must prove all five registered rules and disposition precedence independently of the Agent report score.

`MLE-REQ-053` Adaptive extraction diagnostics must record trigger gap, selected registered tool, bounded target, outcome, evidence, stop reason, iterations, model calls, token usage when available, latency, and estimated cost when available.

`MLE-REQ-054` Supporting checks must be reported as pass/fail acceptance evidence and diagnostic context rather than averaged into the three primary ML dimensions.

## 9. Evaluation Execution

`MLE-REQ-055` The default continuous-integration evaluation must use fake-model adapters and deterministic fixtures, require no provider credentials, and incur no external model cost.

`MLE-REQ-056` Live-model evaluation must be a separate explicit command with an identified dataset release, model configuration, maximum call, token, time, and estimated-cost budget.

`MLE-REQ-057` An evaluation run must use a frozen input manifest and must not change prompts, schemas, models, rules, truth, or thresholds after execution begins.

`MLE-REQ-058` Failed, timed-out, skipped, and budget-exhausted cases must be retained in the evaluation report with structured reasons.

`MLE-REQ-059` Repeating an offline evaluation with the same frozen inputs and fake-model adapter must reproduce equivalent results.

`MLE-REQ-060` Evaluation outputs must be immutable artifacts linked to their configuration and source revisions and must not overwrite an earlier report.

## 10. Model and Prompt Comparison

`MLE-REQ-061` A model or prompt comparison must run candidates on the same frozen compatible dataset subset, schemas, Agent configuration, tool registry, rule set, disposition policy, and evaluator version.

`MLE-REQ-062` Candidate comparison must report all three primary quality dimensions plus latency, usage, estimated cost, and unavailable-data counts; it must not select a winner using cost or one quality number alone.

`MLE-REQ-063` The default and fallback VLM must remain provider-neutral in product specifications and may be selected only after the comparison evidence is recorded in `decisions/ADR_003_VLM_SELECTION.md`.

`MLE-REQ-064` A comparison with incompatible provider capabilities, missing usage data, or incomplete cases must disclose those differences and must not silently normalize them into equivalence.

## 11. Baselines and Regression

`MLE-REQ-065` The initial live-model run establishes a measured baseline; this specification must not invent numerical quality, latency, or cost targets before that baseline exists.

`MLE-REQ-066` Regression tolerances may be approved only after baseline variance and repeated-run behavior are measured and documented.

`MLE-REQ-067` Until tolerances are approved, continuous integration must gate deterministic contracts and fixed fake-model expectations, while live-model differences remain reported evidence requiring review.

`MLE-REQ-068` Frozen golden truth must not be modified to make a regression pass. A truth correction requires a reviewed new dataset release with recorded rationale and predecessor lineage.

`MLE-REQ-069` A change to dataset, truth, generator, model, prompt, schema, Agent, tools, PDF Inspector, OCR asset, rules, disposition policy, or evaluator must be visible in the comparison report.

## 12. Evaluation Report

`MLE-REQ-070` Every evaluation report must identify execution time, environment, source revision, dataset and truth versions, complete component-version manifest, model configuration, prompt, Agent budgets, and evaluator version.

`MLE-REQ-071` The report summary must present:

1. Issue precision and recall with counts.
2. Correct-grounding and unsupported-claim rates with counts.
3. Verified-report completion rate and verifier-failure categories.
4. Case completion counts and excluded-case reasons.
5. Latency, model calls, tokens, and estimated cost with unavailable values distinguished from zero.

`MLE-REQ-072` The report must contain per-case results sufficient to trace each metric contribution to expected issues, actual issues, checked facts, references, and verifier outcomes.

`MLE-REQ-073` Aggregate results must not conceal a failed safety case, prohibited-content failure, instruction-following failure, or missing critical issue.

`MLE-REQ-074` Any published metric must name the dataset release, compatible subset, model, prompt, Agent, evaluator, and environment versions and repeat the synthetic-data limitation.

## 13. Dataset Tooling

The intended Stage Two command families are conceptual until the monorepo skeleton exists:

```text
dataset generate
dataset validate
dataset build
dataset inspect
evaluate offline
evaluate live
evaluate report
```

`MLE-REQ-075` The implementation must provide lightweight command-line workflows for deterministic generation, validation, release building, inspection, offline evaluation, live evaluation, and report generation.

`MLE-REQ-076` This specification does not authorize inventing concrete package scripts or executable paths before the Stage Two repository skeleton defines them.

`MLE-REQ-077` Dataset validation must verify manifest schemas, unique identities, checksums, referenced artifacts, visible synthetic markings, truth completeness, evidence-reference integrity, deterministic seeds, and prohibited real-data indicators.

`MLE-REQ-078` Building a frozen release must produce a versioned manifest and checksums without modifying source candidates or prior releases.

## 14. Acceptance Criteria

The ML evaluation system is acceptable for implementation when automated tests demonstrate that:

`MLE-REQ-079` The six-case initial release and later twenty-case completed release must each be reproducible, schema-valid, visibly synthetic, checksum-verified, and manually confirmed.

`MLE-REQ-080` The three acceptance paths execute with pinned PDF Inspector and OCR provenance and produce traceable inputs to the Agent.

`MLE-REQ-081` Issue matching fixtures produce correct precision, recall, and instance counts for exact, missing, additional, and semantically equivalent issues.

`MLE-REQ-082` Evidence fixtures distinguish resolving references from relevant grounding and correctly score page, region, structured-input, claim, gap, and finding references.

`MLE-REQ-083` Report-verifier fixtures reject invalid schemas, missing references, unregistered codes, prohibited content, and cross-case references.

`MLE-REQ-084` Offline evaluation is deterministic, uses no external model, and produces an immutable versioned report.

`MLE-REQ-085` Live evaluation refuses to start without an explicit compatible dataset selection and cost budget.

`MLE-REQ-086` Missing usage or cost data is reported as unavailable rather than zero.

`MLE-REQ-087` Supporting PDF Inspector, extraction, matching, validation, and adaptive-recovery fixtures remain separate from headline report metrics.

`MLE-REQ-088` No dataset truth, metric, evaluator, or report introduces a lending, customer-contact, final AML, final KYC, or production-readiness claim.

## 15. Assumptions and Deferred Evidence

1. Six curated cases are sufficient to start the vertical slice; twenty remain the completed V1 target. Neither supports representative statistical or production claims.
2. Exact issue-matching normalization, baseline values, regression tolerances, and default/fallback VLM selection require measured evidence.
3. PDF Inspector remains the accepted inspection, OCR-routing, and local PP-OCRv6 Small execution foundation behind project-owned contracts; integration quality is demonstrated through focused fixtures and end-to-end report outcomes.
4. Human-review time savings and inter-reviewer agreement are useful future studies but are outside the V1 ML evaluation.
5. Authorized real-data, fairness, subgroup, drift, and production model-risk evaluation remain deferred in [`BACKLOG.md`](../BACKLOG.md).

No unresolved decision blocks review of the V1 evaluation scope. Numerical thresholds and model selection remain evidence-dependent by design.

## 16. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.2.0 | 2026-09-06 | Approved | Aligned evaluation provenance with PDF Inspector 1.17.0's local PP-OCRv6 Small execution path without expanding headline evaluation scope. |
| 1.1.1 | 2026-09-05 | Approved | Clarified the independent PDF Inspector and PP-OCRv6 adapter boundaries without changing evaluation scope. |
| 1.1.0 | 2026-09-04 | Approved | Reduced the first vertical-slice dataset to six complete golden cases while retaining twenty as the completed V1 target. |
| 1.0.0 | 2026-09-04 | Approved | Approved one primary V1 ML task with three report-quality dimensions, retained PDF Inspector as the processing foundation, and limited supporting components to focused fixtures and diagnostics. No unresolved evaluation-scope decision remains; numerical thresholds and model selection remain evidence-dependent. |
