# ADR-001: Embed Pi as the Bounded Case Review Agent Harness

Status: Accepted

Date: 2026-09-05

## Context

V1 requires an Agent to pre-screen every processable case, generate an evidence-grounded Case Review Brief, and optionally recover one eligible extraction gap in the demonstration path. Durable workflow, deterministic validation, disposition, authorization, and budgets must remain outside the model.

Pi's official SDK supports programmatic `AgentSession` creation, explicit tool lists, event subscriptions, model selection, and custom resource loading. Its normal coding-agent defaults also include filesystem and shell-oriented capabilities and automatic resource discovery, which are inappropriate for this domain.

## Decision

The Worker Service will embed the official `@mariozechner/pi-coding-agent` SDK through a project-owned `PiAgentHarness` adapter.

The adapter will:

1. Create one bounded Pi session for one declared `case_review_report` or `adaptive_recovery` operation.
2. Supply only project-owned registered domain tools explicitly selected for that session.
3. Use a project-owned resource loader that performs no automatic discovery of skills, extensions, prompts, themes, context files, or packages.
4. Omit Pi coding and read-only tool bundles, including Shell and general filesystem tools.
5. Use project-owned prompt, model-gateway, schema, authorization, budget, and event adapters.
6. Treat Pi conversation and session memory as ephemeral diagnostic execution state; PostgreSQL, pg-boss, and immutable domain records remain authoritative.
7. Verify every report and tool result outside Pi before domain use.

The exact Pi package version will be pinned by the implementation lockfile and recorded in the processing-run manifest after the integration spike. This ADR does not select a model provider.

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

## Affected Specifications

This decision constrains `ARC-REQ-040` through `ARC-REQ-049` and the Agent requirements in `components/ADAPTIVE_EXTRACTION_AGENT.md`. Any replacement harness requires a superseding ADR and must preserve those boundaries.

## References

1. [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
2. [`components/ADAPTIVE_EXTRACTION_AGENT.md`](../components/ADAPTIVE_EXTRACTION_AGENT.md)
