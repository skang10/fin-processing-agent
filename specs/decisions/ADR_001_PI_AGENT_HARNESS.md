# ADR-001: Embed Pi as the Bounded Case Review Agent Harness

Status: Accepted

Date: 2026-09-06

## Context

V1 requires an Agent to pre-screen every processable case and generate an evidence-grounded Case Review Brief. The initial implementation split this work between report and optional adaptive-recovery sessions. The approved Agent-led architecture instead requires one bounded case-review session that may select registered PDF Inspector and extraction tools before requesting deterministic reconciliation and validation. Durable workflow, authoritative results, authorization, and budgets remain outside the model.

Pi's official SDK supports programmatic `AgentSession` creation, explicit tool lists, event subscriptions, model selection, and custom resource loading. Its normal coding-agent defaults also include filesystem and shell-oriented capabilities and automatic resource discovery, which are inappropriate for this domain.

## Decision

The Worker Service will embed the official pi-coding-agent SDK through a project-owned `PiAgentLedCaseReviewHarness` adapter in `packages/agent-pi`. The SDK is published as `@earendil-works/pi-coding-agent`; the former `@mariozechner/pi-coding-agent` scope named in the original decision is deprecated upstream in favour of that package, and the rename does not change this decision.

The adapter will:

1. Create one bounded Pi `case_review` session for one processable run; document inspection, extraction-gap handling, deterministic result requests, and report submission are phases or steps inside that session rather than separately scheduled Agent modes.
2. Supply only project-owned registered domain tools explicitly selected for that session.
3. Use a project-owned resource loader that performs no automatic discovery of skills, extensions, prompts, themes, context files, or packages.
4. Omit Pi coding and read-only tool bundles, including Shell and general filesystem tools.
5. Use project-owned prompt, model-gateway, schema, authorization, budget, and event adapters.
6. Treat Pi conversation and session memory as ephemeral diagnostic execution state; PostgreSQL, pg-boss, and immutable domain records remain authoritative.
7. Verify every report and tool result outside Pi before domain use.
8. Expose PDF Inspector and related processing only through registered project-owned case-scoped tools; Pi receives neither SDK objects nor native execution authority.
9. Require Pi to request deterministic reconciliation and validation and consume their committed outputs before report submission; Pi prose cannot establish claims, findings, dispositions, or workflow state.

The implementation pins `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-ai` at exact version `0.85.1`, and every Agent session trace records `pi-coding-agent@<version>` as its harness version together with the prompt version and hash, tool-registry version, budget envelope, and configuration version. This ADR does not select a model provider.

## Rejected Alternatives

1. Using Pi CLI or RPC as the primary integration: rejected because the TypeScript SDK offers a narrower typed in-process adapter boundary for V1.
2. Using Pi as the workflow engine: rejected because Agent memory is not durable workflow state.
3. Using default Pi tools or resource discovery: rejected because their authority exceeds the case-scoped document-review task.
4. Building an unrestricted general-purpose Agent framework: rejected as unnecessary for the V1 demonstration.
5. Removing Pi and generating one direct model response: rejected because bounded tool-using pre-screening is the central product demonstration.
6. Keeping separate recovery and report sessions: rejected because it makes Pi an optional repair step plus a summarizer rather than the central reviewer, duplicates context and lifecycle handling, and obscures one case-level Agent trace.

## Consequences

Positive consequences:

1. Pi remains the visible Agent core while business authority stays deterministic.
2. Custom tool and resource boundaries can be tested independently.
3. Fake-model sessions can reproduce offline acceptance paths.

Costs and risks:

1. The integration depends on Pi SDK APIs and requires a pinned compatibility adapter.
2. In-process embedding does not itself provide a security boundary; external authorization, budgets, and the Document Sandbox remain required.
3. Default SDK behavior must be actively overridden and verified after upgrades.

## Verification

The implementation spike must prove that:

1. No default Shell, filesystem, network, extension, package, or resource-discovery capability is exposed.
2. Unknown tools and invalid or cross-case arguments cannot execute.
3. Iteration, model-call, token, time, and cost budgets stop work outside the model.
4. Worker termination does not lose durable case progress.
5. Fake-model sessions produce deterministic report and failure fixtures.
6. Document prompt injection cannot alter tools, rules, dispositions, schemas, or customer-contact authority.

### Implementation evidence (2026-09-06)

`PiAgentLedCaseReviewHarness` proves one session spanning scoped document inspection, optional OCR/VLM extraction, evidence-bound candidate submission, deterministic reconciliation and validation requests, current-result retrieval, and report submission. Automated tests cover unknown-tool and cross-scope rejection, schema enforcement, OCR/VLM and session budgets, no-progress handling, provider failure, and external report verification. The former separately scheduled report and adaptive-recovery harnesses were removed.

### Durability evidence (2026-09-06)

Verification item 4 is met. The adapter no longer materializes a trace at session end. `PostgresAgentSessionLifecycle` owns one authoritative session per processing run, guarded by a run-scoped advisory lock and a `(run_id, mode)` unique index, plus linked execution attempts, immutable tool invocation results keyed by a canonical idempotency key, step reuse lineage, and cumulative budget counters. The control plane persists the session and its attempt before the first model call and commits each completed step, its invocation result or reuse lineage, and the consumed budget before the result reaches the model.

Each registered tool declares how a committed result is reused: a result whose payload carries document text keeps only an integrity hash and is re-read from its committed artifact, while a paid or side-effecting result keeps a bounded structured payload that restores session state without repeating the operation. Durable re-entry opens a linked attempt, restores tool state from committed results, seeds the model with a resumed-progress block instead of claiming that conversation survived, and refuses to resume when harness, prompt, tool-registry, context-manifest, model-route, or budget identity changed. A configured attempt limit ends endless re-entry with `cancelled_by_workflow`.

A Docker-backed suite terminates the Worker after each committed boundary — page inspection, fake OCR output, model extraction output, candidate submission, deterministic reconciliation, deterministic validation and result sealing, and report completion — then redelivers the job through the real coordinator. Every row reaches the correct human-reviewable state with one authoritative session, one result revision, one report, one gap resolution, ordered steps, and OCR and model budgets charged once. A tool call that completed but whose step had not yet committed may repeat; the deterministic components it calls are idempotent for the run, which is the documented mitigation rather than a hidden transport retry.

Real OCR/VLM ports and live-model acceptance remain required before this prototype can claim those capabilities.

## Affected Specifications

This decision constrains the Pi Agent requirements in `SYSTEM_ARCHITECTURE.md` and `components/ADAPTIVE_EXTRACTION_AGENT.md`. Any replacement harness requires a superseding ADR and must preserve those boundaries.

## References

1. [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) and the `docs/sdk.md` shipped inside the pinned `@earendil-works/pi-coding-agent` package
2. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](../components/ADAPTIVE_EXTRACTION_AGENT.md)
