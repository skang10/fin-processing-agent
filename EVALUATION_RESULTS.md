# Evaluation Results

## Full live Agent comparison with real OCR — 2026-09-10

With explicit paid-run approval, `openai/gpt-5.6-terra` and `openai/gpt-5.6-sol` each processed all seven frozen synthetic `v0.1.4` cases once, for 14 fresh case runs. Source revision was `7454e7d4c1445663ee60ad62f953086cd38ef454`; the environment was Docker Compose on Linux ARM64. Frozen document checksums were verified, and golden truth was not modified.

Both rounds used `case-review-prompt-3.6.1`, `case-review-tools-3.8.0`, `pi-coding-agent@0.85.1;pi-harness-2.2.0;agent-budget-2.0.0`, `case-normalization-1.1.0`, rule set `demo-de-personal-loan-v1@1.0.0`, and `offline-evaluator-1.0.0`. Real OCR used PDF Inspector 1.17.0 with `pp-ocrv6-small@oar-ocr-v0.7.0`; the pinned OCR runtime used PDFium 153.0.7988.0 and ONNX Runtime 1.27.0. Page rendering was versioned separately as `@hyzyla/pdfium-2.1.13`. Live VLM extraction was enabled with the same model as the Agent in each round (`page-field-extraction-1.2.0`, `extract_with_vlm@3.2.0`), but was not called.

| Metric | Terra | Sol |
|---|---:|---:|
| Reports completed and verified | 7/7 | 7/7 |
| Expected issues detected | 6/7 (85.7%) | 6/7 (85.7%) |
| False positives | 0 | 0 |
| Issue precision | 6/6 (100%) | 6/6 (100%) |
| Evidence references matching expected sources | 34/34 | 34/34 |
| Average Agent session duration | 20.6 seconds | 25.3 seconds |
| Average estimated model cost per case | USD 0.047 | USD 0.089 |
| Total estimated model cost | USD 0.329217 | USD 0.622084 |
| Persisted real OCR pages | 4 | 4 |
| VLM extraction calls | 0 | 0 |

The evidence-reference metric assesses whether reported issues and checked facts cite the expected supporting sources, such as a document page or application field, according to the existing evaluator. **34/34 does not establish that every extracted value is correct or that every expected issue was detected.** It is not a field-extraction or character-level OCR accuracy score.

Both models missed `VAL_NAME_CONSISTENCY_001` in `golden-004-missing-bank-evidence`; neither produced an additional issue. The shared miss has not been diagnosed in this run. Both produced a verified report for `golden-006-scanned-adaptive-unavailable`, although its frozen historical unavailable-path expectation remains `expected_report: unavailable`; this difference is preserved in the reports rather than changing truth.

Persisted OCR metadata confirms one real OCR page in golden-005 and three in golden-006 per round. Safe Agent session diagnostics confirm zero VLM extraction calls across all 14 runs. These results therefore measure live Agent operation with native text and real OCR, **not VLM extraction quality**.

Combined estimated model cost was USD 0.951301. Authorization allowed USD 0.50 per case, USD 3.50 per model, and USD 7 total; the existing stricter runtime Agent limit remained USD 0.25 per case. Average costs divide each model's total by seven and exclude infrastructure costs. Durations measure Agent sessions, not end-to-end upload and document preprocessing. Costs are persisted usage estimates, not independently reconciled bills; provider-reported token counts retain the earlier input-token accounting caveat.

Terra had the same measured issue and reference scores with lower estimated cost and mean Agent duration in this run. One run per model over seven synthetic cases does not establish statistical superiority, repeatability, real-document accuracy, or production performance.

### Capture identifiers and local evidence

- Terra capture: `live-real-ocr-terra-v0.1.4-1788997439652`; evaluation: `7b1a354a87b0c61309afdf1c0e440c5733b36abab743459202e17ea085bdfbf4`.
- Sol capture: `live-real-ocr-sol-v0.1.4-1788997706967`; evaluation: `5a8a06840d00e7193d539f6d538ab5b7ee446b4b21b1e477dd3fbba0d8df5b6e`.
- Ignored local evidence is under `.data/live-comparison-20260910/`: per-model configuration, actual-run and evaluator reports, per-case runtime mappings, `diagnostics.json`, and `ocr-metadata.json`. Generated artifacts are not committed.

The Worker was restored to Terra for both Agent and VLM after the comparison. Historical measurements below remain unchanged.

## JPEG/PNG real-OCR acceptance — 2026-09-07

A no-network, read-only Linux ARM64 component smoke derived the visibly synthetic payslip page from frozen `golden-006-scanned-adaptive-unavailable`, encoded it independently as JPEG and PNG, and passed both through the sandboxed `image-intake-router` and the pinned PDF Inspector 1.17.0 / PP-OCRv6 Small `oar-ocr-v0.7.0` adapter. Both inputs produced one bounded render, one OCR result, and the expected synthetic name, employer, and `2980.00` markers. The source image is content-decoded with Sharp 0.35.4, checked against its detected media type and pixel ceiling, normalized, and wrapped as a one-page in-memory PDF only at the private OCR-adapter boundary.

End-to-end runtime case `8ff44666-b4c4-4ec0-9b54-067208393dcc`, run/result `be0c41b5-d60d-45bd-9f14-c9213fd58bec`, and session `e3bdd1b6-e23f-43b0-83cf-62291923672a` submitted two JPEG documents and one PNG document derived from the three frozen synthetic pages. Every image persisted one rendered, OCR-routed page with `firecrawl/pdf-inspector-oar` 1.17.0 / `pp-ocrv6-small@oar-ocr-v0.7.0`; all classifications used OCR content, and seven document candidates used `agent_ocr_reading`. The deterministic five-rule registry produced the expected sole `VAL_INCOME_CONSISTENCY_001` `failed` / `income_conflict` finding and a verified report. The standard fake Agent used 9 iterations, 15 tool calls, 9 model calls, 3 OCR pages, 54,811 input and 600 output tokens, zero VLM calls, and zero external-model cost.

This proves only bounded synthetic full-page image execution on Linux ARM64. It does not establish crop/region OCR, native Linux x64 support, corpus-level quality, real-document fitness, or production performance.

## Initial VLM selection benchmark — 2026-09-07

With explicit paid-run approval, `openai/gpt-5.6-terra` and `openai/gpt-5.6-sol` each processed only `golden-006-scanned-adaptive-unavailable` from frozen synthetic release `v0.1.2` at source `6a1c27c`. Each isolated configuration had equal USD 0.25 per-case and whole-run caps. Both inspected and rendered all three routed pages before fixture OCR and seven live VLM extractions, returned the expected seven scalar values with schema-valid outputs, ran deterministic reconciliation and all five rules, and produced a verified report containing only the expected `VAL_INCOME_CONSISTENCY_001` income conflict.

| Result | Terra | Sol |
|---|---:|---:|
| Issue precision / recall | 1/1 / 1/1 | 1/1 / 1/1 |
| Grounding / unsupported | 5/5 / 0 | 5/5 / 0 |
| Verified report | 1/1 | 1/1 |
| VLM schema compliance | 7/7 | 7/7 |
| Latency | 49,163 ms | 59,346 ms |
| Total tokens | 12,719 | 12,671 |
| Nested VLM cost | USD 0.027896 | USD 0.055424 |
| Cumulative cost | USD 0.105081 | USD 0.200450 |

Terra identifiers are case `04943e2f-bf9c-41d5-a1ed-f8bcb6845681`, run/result `aecabe9b-7a81-496e-86d7-43f1768dd1f4`, session `bcfe90d3-4102-46f6-a846-4b07395bf9f7`, and evaluation `2c646b36dc7eddf2de21561adf973e40f1a9002cd7bfb1e47e256d4058ceca33`. Sol identifiers are case `279f7d48-2327-440f-814f-773df49a65ec`, run/result `864afd3f-eaf8-4767-a12e-fc8c0cf6ffdd`, session `ba41e872-73e7-4165-ad63-504cf266f24d`, and evaluation `50b613c175e956722b0e47da7629f62e04b1c5e27b3d90321e57ae172e1f09fe`.

ADR-003 therefore selects Terra as the opt-in live default and Sol as fallback. This one-case, same-provider synthetic comparison is not corpus-level, provider-resilience, real-OCR/live-VLM, real-data, lending, AML, KYC, or production-fitness evidence.

## Real offline OCR acceptance — 2026-09-07

One explicit Linux ARM64 run used only `golden-006-scanned-adaptive-unavailable` with PDF Inspector 1.17.0, PDFium 153.0.7988.0, ONNX Runtime 1.27.0, and `pp-ocrv6-small@oar-ocr-v0.7.0`. All assets were downloaded from their pinned release URLs, SHA-256 verified against `config/ocr-runtime-assets.json`, mounted read-only, and executed with container networking disabled for the component smoke check. The end-to-end Compose run used the same mounted assets and the deterministic fake Agent in `standard` mode; it made no VLM call.

Runtime case `ee0663a5-b7e5-4851-aad8-a0ed78d1e01a`, run/result revision `afe947fe-78f5-4bd1-877f-2e8d2c60e23e`, and session `9984dd35-ff2d-4235-91e8-88744809ebdf` produced a verified report with the expected sole `VAL_INCOME_CONSISTENCY_001` `failed` / `income_conflict` finding; the other four rules passed. The Agent visually inspected and ran OCR on all three routed pages, submitted seven OCR-derived document candidates, requested deterministic reconciliation and all five rules, then submitted the report. Persisted usage was 9 iterations, 15 tool calls, 9 fake-model calls, 3 OCR pages, 0 VLM calls, 54,674 input tokens, 600 output tokens, and zero external-model cost. All three page classifications used `synthetic-demo-ocr-content-classifier`; no fixture page-type or fixture VLM result entered the run.

A compatible Worker restart and same-run redelivery returned the same terminal session with `resumed=true`, `submitted_candidates=0`, one attempt, 15 immutable invocations, and unchanged OCR, token, and cost usage. This single synthetic run is runtime acceptance only, not a corpus-level OCR quality, latency, real-data, lending, or production-performance result.

## Budgeted live Agent subset — v0.1.2 `golden-003`

**Recorded:** 2026-09-07

One explicitly approved synthetic attention case ran at source `aa218af` with `openai/gpt-5.6-terra`, an explicit frozen subset, and equal USD 0.25 per-case and whole-run caps. No other case ran. Runtime case `bfb1a51c-5a6c-4889-b893-e52feff5fa33`, processing run `f74ee21c-579f-42b9-9762-86748e9cf3f2`, and Agent session `c33911de-643a-42bd-a270-e81d3154dcc4` produced a verified report.

The corrected capture identifier is `live-agent-led-v0.1.2-golden-003-20260907T030832Z`; evaluation `6bf9574de0ea46628a24c797dbce4717d2db03c5b439d996d826d1b6a568a79f` uses the authoritative persisted session start time after the initial configuration incorrectly labelled Berlin local time as UTC. Correcting metadata and projecting the already persisted operations did not repeat a model call; the earlier generated report remains unmodified local history.

| Dimension | Result |
|---|---:|
| Agent issue precision | 2 / 2 (100%) |
| Agent issue recall | 2 / 2 (100%) |
| Correct evidence grounding | 5 / 5 (100%) |
| Unsupported claims | 0 / 5 (0%) |
| Verified-report completion | 1 / 1 (100%) |
| Duration | 39,409 ms |
| Model calls | 8 |
| Provider-reported tokens | 24 input / 1,210 output / 1,234 total |
| VLM calls / OCR pages | 0 / 0 |
| Persisted estimated cost | USD 0.044510 |

The deterministic five-rule registry produced the expected `VAL_EMPLOYER_CONSISTENCY_001` and `VAL_INCOME_CONSISTENCY_001` findings; the other three rules passed. The result contains no lending, creditworthiness, AML, or KYC decision. This is one synthetic, native-text, live-Agent case, not live-VLM, OCR-quality, corpus-level, real-data, or production-performance evidence.

---

## Offline Agent-led regression baseline — v0.1.2

**Recorded:** 2026-09-07

The six synthetic candidates were explicitly confirmed by reviewer `sulmae` and frozen in checksum-verified release `v0.1.2` at source revision `c18186448c4e68df540b5c858d1497efedf8a59a`. The manifest SHA-256 is `382ef0f609a82f7c173731fe66e50a341418c03da664460a8d921ca4e5fd1eb8`.

Two independent full API/Worker captures using the deterministic fake Case Review Agent and fixture OCR/VLM produced identical normalized cases, operations, and metrics:

- `offline-agent-led-v0.1.2-20260907T053000Z`, evaluation `e9440172d4a8670422825c13af7ef7d13c8c74af056f278ee6d942f60a93aac7`
- `offline-agent-led-v0.1.2-20260907T054000Z`, evaluation `72c0a49ff88bf1f1256498edf28e38d3c0a35693a95b15aaf2e103dcfd43ffa4`

| Dimension | Result |
|---|---:|
| Agent issue precision | 5 / 5 (100%) |
| Agent issue recall | 5 / 6 (83.3%) |
| Correct evidence grounding | 29 / 29 (100%) |
| Unsupported claims | 0 / 29 (0%) |
| Verified-report completion | 5 / 6 (83.3%) |

The sole false negative and unavailable report are the intentional `golden-006` fake-policy path: its deterministic income finding is excluded from Agent-origin issue scoring and its report is deliberately rejected. Cases 003 and 004 match the reviewed truth completely. This offline fixture-backed baseline incurs no external-model cost and does not establish real OCR, live-model corpus quality, lending, or production performance. Latency and durable usage are not projected by capture and remain unavailable, not zero.

---

## Successor candidate diagnostic — pre-confirmation history

**Recorded:** 2026-09-07

The six candidates were evaluated before confirmation through the explicit `--candidates` diagnostic mode. This mode preserved `pending_human_review`, did not create a release, and did not weaken the default checksum and confirmation checks for frozen-release evaluation.

Two independent captures at source `1fca67e` produced identical normalized actual-run cases and reports:

- `offline-successor-candidate-20260907T051000Z`, evaluation `75e7ff73e3ef6eda8aa832b17ff82020b96df073719426382b88acbb766ebb76`
- `offline-successor-candidate-20260907T052000Z`, evaluation `863e35c3f5efdacaacf27dc3a471244110f63962655dfa91554e9cc6ba1b7336`

| Dimension | Result |
|---|---:|
| Agent issue precision | 5 / 5 (100%) |
| Agent issue recall | 5 / 6 (83.3%) |
| Correct evidence grounding | 29 / 29 (100%) |
| Unsupported claims | 0 / 29 (0%) |
| Verified-report completion | 5 / 6 (83.3%) |

The single false negative and unavailable report are both `golden-006`: its deterministic income finding is intentionally excluded from Agent-origin issue scoring, and its fake policy deliberately exercises the report-unavailable path. The changed `golden-003` and `golden-004` candidates have no missed, additional, or incorrectly grounded items. These results remain pre-confirmation history; the frozen successor baseline is recorded above.

---

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

Frozen `v0.1.1` remains unchanged. The successor candidates prepared after this measurement are:

1. `golden-003` now visibly carries EUR 3310.00 monthly net pay against declared EUR 3480.00 and retains the conflicting salary counterparty, producing `VAL_INCOME_CONSISTENCY_001` and `VAL_EMPLOYER_CONSISTENCY_001`. Its obsolete boundary-uncertainty expectation and coverage label were removed because the current deterministic router cannot derive that state from the generated pages; the case remains a genuine multi-issue, multi-page candidate.
2. `golden-004` now expects both the missing bank statement and the consequently unresolved account-holder name.
3. Both changed candidates are `pending_human_review`. They must be explicitly confirmed before a successor release is frozen, then captured twice before replacing this baseline.

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
