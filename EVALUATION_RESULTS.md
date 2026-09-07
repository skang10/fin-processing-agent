# Evaluation Results

## Offline Agent-led regression baseline — v0.1.1

**Recorded:** 2026-09-07

**Purpose:** Demonstration regression and diagnosis against the existing frozen truth

This result uses all six manually confirmed synthetic cases, the deterministic fake Case Review Agent model, fixture OCR, and the explicit fixture scanned-page adapter. It evaluates the current Agent-led extraction path and incurs no external model cost. It is not a live-model, OCR-quality, real-data, lending, or production-performance result.

### Configuration

| Component | Version |
|---|---|
| Dataset | `v0.1.1` |
| Source revision | `1f72965` |
| Environment | `local-compose-infrastructure-pnpm-fake-model` |
| Model | `findoc-fake/case-review-script-v1#standard` |
| Prompt | `case-review-prompt-3.5.0` |
| Agent | `pi-coding-agent@0.85.1;pi-harness-2.2.0;agent-budget-2.0.0` |
| Tool registry | `case-review-tools-3.6.0` |
| Extraction | `document-field-requirements-1.0.0;case-normalization-1.1.0;fixture-scanned-page-adapter-1.0.0` |
| Rule set | `demo-de-personal-loan-v1@1.0.0` |
| PDF Inspector | `1.17.0` |
| PDFium | `@hyzyla/pdfium-2.1.13` |
| OCR asset | `deterministic-fixture-1.0.0` |
| Evaluator | `offline-evaluator-1.0.0` |

The primary capture is `offline-agent-led-v0.1.1-20260907T043000Z`, evaluation `896eeb307978b08304e93d2ce0285bee27b3a148fb08f57bca1832a7f3952b04`. An independent repeat, `offline-agent-led-v0.1.1-20260907T044500Z`, produced identical normalized case results and aggregate metrics (evaluation `dcf4537e56870fea559432adfa6cc44770f73db3e4249fb2332fdb6312b4c769`). Generated JSON remains ignored local evidence and is not committed.

### Results

| Dimension | Result |
|---|---:|
| Agent issue precision | 3 / 4 (75.0%) |
| Agent issue recall | 3 / 6 (50.0%) |
| Correct evidence grounding | 28 / 29 (96.6%) |
| Unsupported claims | 1 / 29 (3.4%) |
| Verified-report completion | 5 / 6 (83.3%) |

| Case | Difference from frozen `v0.1.1` |
|---|---|
| `golden-001-native-clear` | Matches |
| `golden-002-employer-conflict` | Matches |
| `golden-003-multiple-review-issues` | Misses expected completeness and income issues; its generated document shows neither the frozen boundary ambiguity nor an income mismatch |
| `golden-004-missing-bank-evidence` | Adds `VAL_NAME_CONSISTENCY_001` because the absent bank statement leaves the account-holder name unresolved |
| `golden-005-instruction-inert` | Matches |
| `golden-006-scanned-adaptive-unavailable` | Expected system income finding remains available to review, while the evaluator intentionally excludes it from Agent-origin issue scoring; report remains unavailable as expected |

The single unsupported grounding item is the `golden-003` completeness Checked Fact: the current document-derived pages do not intersect the frozen evidence expectation for the obsolete completeness issue. This is a dataset/content mismatch, not an unresolved reference or fabricated claim.

### Dataset disposition

Frozen `v0.1.1` remains unchanged. The recommended next dataset candidate is:

1. Regenerate `golden-003` so its synthetic documents genuinely contain the intended boundary uncertainty and income conflict, preserving the case's multiple-issue purpose.
2. Carry `golden-004`'s unresolved account-holder name into a new candidate truth record and require explicit human confirmation before freezing a successor release.
3. Re-run capture twice against the successor release before replacing this baseline.

Latency, model-call, token, and estimated-cost observations are unavailable because `capture-evaluation.mjs` does not yet project durable session operations into the actual-run artifact. They must not be reported as zero.

---

> **Superseded configuration.** The result below was measured while document values were seeded from
> a fixture table before the Agent ran. Since `2026-09-07` the bounded Pi session leads document
> extraction through registered tools, so this report no longer describes the delivered pipeline and
> must not be cited for it. It is retained unchanged as the immutable record of the configuration it
> names. Two frozen `v0.1.1` case expectations also no longer match the Agent-led outcomes; the
> divergence and the options for resolving it are tracked in `BACKLOG.md` under BL-005 and BL-009.
> The replacement Agent-led baseline is recorded above.

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
