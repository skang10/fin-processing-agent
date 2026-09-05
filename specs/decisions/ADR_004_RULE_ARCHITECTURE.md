# ADR-004: Use Compiled TypeScript Rule Plugins and Versioned Manifests

Status: Accepted

Date: 2026-09-05

## Context

V1 needs five finite demonstration validation rules with deterministic findings and recommended-disposition mapping. Models and runtime users must not create, edit, upload, or activate validation logic. A general rule language would add parsing, sandboxing, governance, and debugging complexity without serving the interview demonstration.

## Decision

V1 validation rules will be compiled TypeScript plugins registered explicitly at build time and selected by an immutable versioned YAML or JSON rule-set manifest.

Each plugin must:

1. Declare stable rule, implementation, input-schema, parameter-schema, status, and reason-code versions.
2. Evaluate one immutable validated input projection through a pure no-I/O boundary.
3. Receive explicit reference dates and exact-decimal values rather than reading the clock or using floating-point financial arithmetic.
4. Return a schema-valid finding proposal without calling databases, filesystems, networks, models, Agents, or other rules.

The registry rejects unknown, duplicate, inactive, incompatible, or invalid manifest entries. The deterministic disposition mapper remains a separately versioned component over committed findings and processing state.

## Rejected Alternatives

1. A general-purpose rule DSL: rejected as unnecessary V1 complexity.
2. Runtime JavaScript, expressions, or uploaded code: rejected for authority and security reasons.
3. Model-generated rules or findings: rejected because outputs would be non-deterministic and policy authority would leak to a model.
4. Hard-coded unversioned `if` statements without a registry and manifest: rejected because historical runs and evaluation require exact rule identity.
5. A separate rule-engine service: rejected because a modular-monolith plugin boundary is sufficient.

## Consequences

Positive consequences:

1. Rule execution is deterministic, testable, and type checked.
2. Historical runs retain exact rule and parameter versions.
3. The small demonstration rule set remains explicit and reviewable.

Costs and risks:

1. Every semantic rule change requires code review, a new plugin or manifest version, and regression tests.
2. Non-developers cannot author rules at runtime in V1.
3. Plugin purity and registry boundaries require architecture tests.

## Verification

Tests must reject invalid manifests, prove plugin purity, verify exact-decimal and reference-date behavior, execute the five registered rules over fixed fixtures, prove order independence, and demonstrate that models and Agent output cannot change findings or disposition precedence.

## Affected Specifications

This decision governs `VAL-REQ-026` through `VAL-REQ-045`, the five registered demonstration rules, and backlog item `BL-001`. A general rule DSL or runtime rule administration requires a superseding ADR.

## References

1. [`components/VALIDATION_AND_DISPOSITION.md`](../components/VALIDATION_AND_DISPOSITION.md)
2. [`BACKLOG.md`](../../BACKLOG.md)
