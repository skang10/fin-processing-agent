# ADR-003: Select Default and Fallback VLM by Measured Evidence

Status: Accepted

Date: 2026-09-05

## Context

V1 may use an external VLM for selected difficult pages or regions and for configured Agent tasks. Choosing a named provider or model before running the frozen synthetic evaluation would create an unsupported quality, latency, and cost claim.

## Decision

Select `openai/gpt-5.6-terra` as the default VLM configuration and `openai/gpt-5.6-sol` as the fallback for the current opt-in external-model route. Both remain behind the provider-neutral Model Gateway and use identical project-owned task schemas. Runtime selection must be explicit configuration; Pi must not select an arbitrary model.

This decision is based on two compatible configurations evaluated on the same frozen subset. Future replacement requires equivalent or broader measured evidence comparing:

1. Review-issue precision and recall.
2. Evidence-grounding correctness and unsupported-claim rate.
3. Verified-report completion and verifier-failure categories.
4. Schema compliance for bounded extraction tasks.
5. Latency, model calls, token usage, and estimated cost with unavailable values explicit.
6. Compliance with selected-page or region limits and prohibited-content constraints.

Selection must consider all quality and operational dimensions rather than one aggregate score. The selected default and fallback must preserve the provider-neutral Model Gateway and identical project-owned task schemas.

## Recorded Evidence

The approved benchmark ran only `golden-006-scanned-adaptive-unavailable` from checksum-verified synthetic release `v0.1.2`, at source revision `6a1c27c`, in isolated Linux ARM64 Docker Compose environments. Each configuration had independent USD 0.25 per-case and whole-run caps. Both used PDF Inspector 1.17.0, `@hyzyla/pdfium-2.1.13`, fixture OCR followed by page inspection, `case-review-prompt-3.5.0`, `case-review-tools-3.6.0`, `extract_with_vlm` 3.2.0, `page-field-extraction-1.2.0`, `case-normalization-1.1.0`, and `demo-de-personal-loan-v1@1.0.0`.

| Dimension | `openai/gpt-5.6-terra` | `openai/gpt-5.6-sol` |
|---|---:|---:|
| Issue precision / recall | 1/1 / 1/1 | 1/1 / 1/1 |
| Evidence grounding | 5/5 | 5/5 |
| Unsupported claims | 0/5 | 0/5 |
| Verified reports | 1/1 | 1/1 |
| VLM schema-compliant calls | 7/7 | 7/7 |
| Session latency | 49,163 ms | 59,346 ms |
| Model / VLM calls | 17 / 7 | 17 / 7 |
| Session input / output tokens | 10,751 / 1,968 | 10,751 / 1,920 |
| Nested VLM input / output tokens | 10,721 / 92 | 10,721 / 92 |
| Nested VLM cost | USD 0.027896 | USD 0.055424 |
| Cumulative session cost | USD 0.105081 | USD 0.200450 |

Both configurations returned the same seven expected scalar values verbatim, including `EUR 2980.00`, and produced the expected deterministic `VAL_INCOME_CONSISTENCY_001` income conflict with the other four rules passing. Both inspected and rendered every routed page before local OCR and VLM extraction. No fixture VLM value entered either run, no complete document or page-image bytes were retained in durable Agent traces, and both reports passed schema, reference, registered-code, and prohibited-content verification.

Terra is the default because observed quality tied while it completed about 17% faster and cost about 48% less cumulatively on this subset. Sol is a compatible fallback because it satisfied the same schemas and quality checks within the same USD 0.25 case ceiling. The approved operational ceiling remains USD 0.25 per live case; a multi-case live evaluation additionally requires an explicit whole-run cap.

The Terra runtime identifiers are case `04943e2f-bf9c-41d5-a1ed-f8bcb6845681`, run/result `aecabe9b-7a81-496e-86d7-43f1768dd1f4`, and session `bcfe90d3-4102-46f6-a846-4b07395bf9f7`. Its evaluation ID is `2c646b36dc7eddf2de21561adf973e40f1a9002cd7bfb1e47e256d4058ceca33`. The Sol identifiers are case `279f7d48-2327-440f-814f-773df49a65ec`, run/result `864afd3f-eaf8-4767-a12e-fc8c0cf6ffdd`, and session `ba41e872-73e7-4165-ad63-504cf266f24d`; its evaluation ID is `50b613c175e956722b0e47da7629f62e04b1c5e27b3d90321e57ae172e1f09fe`.

## Evidence Limitations

This is a one-case synthetic comparison, not a corpus-level accuracy result. Both candidates use the same provider, so the fallback does not provide provider-outage independence. Fixture OCR was used to force the approved VLM path; the separate real-OCR acceptance is not a combined real-OCR/live-VLM benchmark. Crop rendering remains unavailable. These limitations prevent any real-data, production-fitness, lending, creditworthiness, AML, or KYC performance claim.

## Rejected Premature Alternatives

1. Selecting the cheapest candidate without report-quality evidence.
2. Selecting the most accurate extraction candidate without Agent-report and grounding evidence.
3. Letting Pi choose an arbitrary provider or model at runtime.
4. Encoding a provider SDK or model name in domain contracts.

## Consequences

Default demo and continuous integration continue to use the offline fake-model and fixture adapters. The selected live default and fallback remain opt-in, budgeted configurations. Product specifications remain provider-neutral, and the bounded evidence above must not be generalized beyond its recorded subset.

## Affected Specifications

This proposal governs `ARC-REQ-107` through `ARC-REQ-109`, `MLE-REQ-061` through `MLE-REQ-064`, and backlog item `BL-004`.

## References

1. [`ML_PIPELINE_AND_EVALUATION.md`](../ML_PIPELINE_AND_EVALUATION.md)
2. [`BACKLOG.md`](../../BACKLOG.md)
