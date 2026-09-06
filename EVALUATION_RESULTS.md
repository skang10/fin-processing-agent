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

## Initial live-model acceptance observation

**Recorded:** 2026-09-06

**Purpose:** Verify the authorized OpenAI route and bounded Pi harness on one synthetic clean case

`golden-001-native-clear` completed in the local Docker Compose environment with `openai/gpt-5.6-terra`, `pi-coding-agent@0.85.1`, fixture-backed structured extraction, fake OCR, and the existing per-case `USD 0.25` hard cost limit. PDF Inspector performed pre-Agent native-text inspection and rendering; the live model reviewed the resulting preprocessed case and submitted a verifier-accepted report with no Agent issues. This run did not measure general PDF-to-structured-data extraction.

| Observation | Result |
|---|---:|
| Session duration | 7.718 seconds |
| Model calls | 4 |
| Input tokens reported | 12 |
| Output tokens reported | 150 |
| Estimated model cost | USD 0.010538 |
| Tool calls | 4 |
| Terminal reason | `report_submitted` |

This single-case observation proves route and harness acceptance only. It is not the formal measured baseline, a model comparison, or an OCR-quality result. The provider-reported token counts require reconciliation before use in a published baseline. The reviewer projection now presents the persisted live cost explicitly in USD rather than omitting it or labeling it as EUR.
