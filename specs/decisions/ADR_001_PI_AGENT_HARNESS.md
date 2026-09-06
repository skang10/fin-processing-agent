# ADR-001: Embed Pi as the Bounded Case Review Agent Harness

Status: Accepted

Date: 2026-09-05

## Context

V1 requires an Agent to pre-screen every processable case, generate an evidence-grounded Case Review Brief, and optionally recover one eligible extraction gap in the demonstration path. Durable workflow, deterministic validation, disposition, authorization, and budgets must remain outside the model.

Pi's official SDK supports programmatic `AgentSession` creation, explicit tool lists, event subscriptions, model selection, and custom resource loading. Its normal coding-agent defaults also include filesystem and shell-oriented capabilities and automatic resource discovery, which are inappropriate for this domain.

## Decision

The Worker Service will embed the official pi-coding-agent SDK through a project-owned `PiCaseReviewAgentHarness` adapter in `packages/agent-pi`. The SDK is published as `@earendil-works/pi-coding-agent`; the former `@mariozechner/pi-coding-agent` scope named in the original decision is deprecated upstream in favour of that package, and the rename does not change this decision.

The adapter will:

1. Create one bounded Pi session for one declared `case_review_report` or `adaptive_recovery` operation.
2. Supply only project-owned registered domain tools explicitly selected for that session.
3. Use a project-owned resource loader that performs no automatic discovery of skills, extensions, prompts, themes, context files, or packages.
4. Omit Pi coding and read-only tool bundles, including Shell and general filesystem tools.
5. Use project-owned prompt, model-gateway, schema, authorization, budget, and event adapters.
6. Treat Pi conversation and session memory as ephemeral diagnostic execution state; PostgreSQL, pg-boss, and immutable domain records remain authoritative.
7. Verify every report and tool result outside Pi before domain use.

The implementation pins `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-ai` at exact version `0.85.1`, and every Agent session trace records `pi-coding-agent@<version>` as its harness version together with the prompt version and hash, tool-registry version, budget envelope, and configuration version. This ADR does not select a model provider.

## Rejected Alternatives

1. Using Pi CLI or RPC as the primary integration: rejected because the TypeScript SDK offers a narrower typed in-process adapter boundary for V1.
2. Using Pi as the workflow engine: rejected because Agent memory is not durable workflow state.
3. Using default Pi tools or resource discovery: rejected because their authority exceeds the case-scoped document-review task.
4. Building an unrestricted general-purpose Agent framework: rejected as unnecessary for the V1 demonstration.
5. Removing Pi and generating one direct model response: rejected because bounded tool-using pre-screening is the central product demonstration.

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

### Spike evidence (2026-09-06, report mode)

The `packages/agent-pi` harness constructs the Pi `AgentSession` directly with an empty base-tool override, an empty allowlist apart from the registered report tools, a resource loader that discovers nothing, in-memory session, settings, credential, and model-runtime stores, compaction and auto-retry disabled, and image input blocked. Automated tests in `packages/agent-pi/src/harness.test.ts` demonstrate items 1, 2, 3, 5, and the tool-authority half of item 6 with the real Pi loop and a scripted fake model: the session exposes exactly `list_findings`, `get_finding_references`, and `submit_case_review_brief`; `bash`, `read`, out-of-scope, and schema-invalid requests are rejected and recorded without executing; tool-call, iteration, token, cost, and wall-clock budgets and the no-progress policy each terminate the session with a stable reason; identical inputs produce identical step records; and a policy-violating brief stays out of the verified report while remaining in the immutable trace. Item 4 is covered by the PostgreSQL session and step records written in the same transaction as the report (`packages/persistence`). The adaptive-recovery mode and the live model route remain unverified: no live provider run has been executed, and adaptive extraction is not implemented.

## Affected Specifications

This decision constrains `ARC-REQ-040` through `ARC-REQ-049` and the Agent requirements in `components/ADAPTIVE_EXTRACTION_AGENT.md`. Any replacement harness requires a superseding ADR and must preserve those boundaries.

## References

1. [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) and the `docs/sdk.md` shipped inside the pinned `@earendil-works/pi-coding-agent` package
2. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](../components/ADAPTIVE_EXTRACTION_AGENT.md)
