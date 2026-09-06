# ADR-001: Embed Pi as the Bounded Case Review Agent Harness

Status: Accepted

Date: 2026-09-06

## Context

V1 requires an Agent to pre-screen every processable case and generate an evidence-grounded Case Review Brief. The initial implementation split this work between report and optional adaptive-recovery sessions. The approved Agent-led architecture instead requires one bounded case-review session that may select registered PDF Inspector and extraction tools before requesting deterministic reconciliation and validation. Durable workflow, authoritative results, authorization, and budgets remain outside the model.

Pi's official SDK supports programmatic `AgentSession` creation, explicit tool lists, event subscriptions, model selection, and custom resource loading. Its normal coding-agent defaults also include filesystem and shell-oriented capabilities and automatic resource discovery, which are inappropriate for this domain.

## Decision

The Worker Service will embed the official pi-coding-agent SDK through a project-owned `PiCaseReviewAgentHarness` adapter in `packages/agent-pi`. The SDK is published as `@earendil-works/pi-coding-agent`; the former `@mariozechner/pi-coding-agent` scope named in the original decision is deprecated upstream in favour of that package, and the rename does not change this decision.

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

### Superseded spike evidence (2026-09-06, report mode)

The existing `packages/agent-pi` report harness proves the narrow Pi embedding, empty base-tool override, no-discovery resource loader, external authorization, budgets, deterministic fake-model behavior, and report verification boundaries. Its separately scheduled report session and three-tool view are retained as implementation evidence but are superseded as the target lifecycle by this amended decision.

### Superseded spike evidence (2026-09-06, adaptive-recovery mode)

The existing `PiAdaptiveRecoveryHarness` proves scope authorization for eight recovery tools, candidate-evidence binding, OCR and VLM budgets, and ordinary reconciliation of submitted candidates. Its separately scheduled gap-eligibility lifecycle is superseded. The fixture OCR and VLM ports remain synthetic outputs rather than recognition, and the live model route remains unverified.

### Required superseding implementation evidence

The V1 implementation must additionally prove one session spanning Agent-selected PDF Inspector operations, extraction candidate submission, deterministic reconciliation and validation requests, current-result retrieval, report submission, durable re-entry, and explicit failure routing. Until that evidence exists, the prior two-session code is implemented legacy behavior, not conformance with the current decision.

## Affected Specifications

This decision constrains the Pi Agent requirements in `SYSTEM_ARCHITECTURE.md` and `components/ADAPTIVE_EXTRACTION_AGENT.md`. Any replacement harness requires a superseding ADR and must preserve those boundaries.

## References

1. [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) and the `docs/sdk.md` shipped inside the pinned `@earendil-works/pi-coding-agent` package
2. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](../components/ADAPTIVE_EXTRACTION_AGENT.md)
