# Evaluation Results

## Offline deterministic regression baseline — v0.1.1

**Recorded:** 2026-09-06  
**Purpose:** Demonstration acceptance and deterministic regression only

This result uses six manually confirmed, visibly synthetic cases, the deterministic fake Case Review Agent model, and fixture OCR output. It is not a live-model baseline, OCR-quality measurement, real-data result, lending metric, or production-performance claim.

### Configuration

| Component | Version |
|---|---|
| Dataset | `v0.1.1` |
| Source revision | `85f11e8` |
| Environment | `local-docker-compose-fake-model` |
| Model | `findoc-fake/case-review-script-v1` |
| Prompt | `case-review-prompt-2.0.0` |
| Agent | `pi-coding-agent@0.85.1;pi-harness-2.0.0` |
| Tool registry | `case-review-tools-2.0.0` |
| Rule set | `demo-de-personal-loan-v1@1.0.0` |
| PDF Inspector | `1.17.0` |
| OCR asset | `deterministic-fixture-1.0.0` |
| Evaluator | `offline-evaluator-1.0.0` |

The immutable dataset manifest records the complete component and document checksums under `datasets/golden/releases/v0.1.1/`.

### Results

| Dimension | Result |
|---|---:|
| Agent issue precision | 5 / 5 (100%) |
| Agent issue recall | 5 / 6 (83.3%) |
| Correct evidence grounding | 29 / 29 (100%) |
| Unsupported claims | 0 / 29 (0%) |
| Verified-report completion | 5 / 6 (83.3%) |

Case 006 accounts for both expected non-success outcomes. Its income issue is system-origin and therefore intentionally excluded from verified Agent issues, producing one missed Agent issue. The case remains processable, while its report is unavailable because the deterministic verifier rejects a prohibited loan-approval recommendation. Human review still receives the system-origin issue.

Case 004 represents the absent bank statement only as `finding:VAL_DOC_COMPLETENESS_001`; no present document page is treated as evidence of the missing file.

Two independent runs against the same frozen release and fake-model configuration produced equivalent aggregate metrics and per-case outcomes, satisfying the deterministic regression expectation. Run identifiers and generated JSON reports remain local evaluation artifacts and are not committed.

### Operational data

Latency, token usage, model-call totals, and estimated cost are unavailable in this captured baseline. They must not be reported as zero. Capturing those observations and completing a budgeted live-model run remain prerequisites for the formal measured baseline in `BL-006`.

### Reproduction

```text
pnpm demo:up
pnpm evaluate:capture -- datasets/golden/releases/v0.1.1 CONFIGURATION_JSON ACTUAL_RUN_JSON
pnpm evaluate:offline -- datasets/golden/releases/v0.1.1 ACTUAL_RUN_JSON
```
