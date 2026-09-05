# ADR-003: Select Default and Fallback VLM by Measured Evidence

Status: Proposed

Date: 2026-09-05

## Context

V1 may use an external VLM for selected difficult pages or regions and for configured Agent tasks. Choosing a named provider or model before running the frozen synthetic evaluation would create an unsupported quality, latency, and cost claim.

## Proposed Decision

Do not select a default or fallback VLM yet.

After the six-case initial golden release and live-evaluation path exist, evaluate at least two compatible candidate configurations on the same frozen subset. Compare:

1. Review-issue precision and recall.
2. Evidence-grounding correctness and unsupported-claim rate.
3. Verified-report completion and verifier-failure categories.
4. Schema compliance for bounded extraction tasks.
5. Latency, model calls, token usage, and estimated cost with unavailable values explicit.
6. Compliance with selected-page or region limits and prohibited-content constraints.

Selection must consider all quality and operational dimensions rather than one aggregate score. The selected default and fallback must preserve the provider-neutral Model Gateway and identical project-owned task schemas.

## Decision Gate

This ADR may become `Accepted` only when it records:

1. Frozen dataset and compatible subset versions.
2. Candidate provider, model, prompt, schema, Agent, tool, and evaluator versions.
3. Per-case and aggregate comparison results.
4. Missing or incompatible capability disclosures.
5. The selected default, fallback, rationale, and approved budgets.

## Rejected Premature Alternatives

1. Selecting the cheapest candidate without report-quality evidence.
2. Selecting the most accurate extraction candidate without Agent-report and grounding evidence.
3. Letting Pi choose an arbitrary provider or model at runtime.
4. Encoding a provider SDK or model name in domain contracts.

## Consequences

Until this ADR is accepted, offline acceptance uses the fake-model adapter and live-model configuration remains explicitly experimental. Product specifications remain provider-neutral, and no default-model performance claim is permitted.

## Affected Specifications

This proposal governs `ARC-REQ-107` through `ARC-REQ-109`, `MLE-REQ-061` through `MLE-REQ-064`, and backlog item `BL-004`.

## References

1. [`ML_PIPELINE_AND_EVALUATION.md`](../ML_PIPELINE_AND_EVALUATION.md)
2. [`BACKLOG.md`](../../BACKLOG.md)
