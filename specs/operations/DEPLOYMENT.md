# Financial Document AI Agent Deployment Specification

Document ID: `DEP`

Version: 1.0.0

Status: Approved

Last updated: 2026-09-05

## 1. Purpose

This specification defines the V1 local Docker Compose delivery, runtime units, infrastructure dependencies, configuration boundaries, startup checks, synthetic demo-data loading, reset behavior, and reproducibility requirements.

V1 delivers a local demonstration, not a production cloud deployment. Kubernetes, Terraform, high availability, autoscaling, disaster recovery, and production identity or data governance are outside scope.

## 2. Authority and Dependencies

This document owns deployable composition, runtime configuration, local service dependencies, container behavior, startup and shutdown, and demo environment lifecycle.

It depends on [`../SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md), [`../SECURITY_AND_LIMITATIONS.md`](../SECURITY_AND_LIMITATIONS.md), [`OBSERVABILITY_AND_FAILURES.md`](OBSERVABILITY_AND_FAILURES.md), [`../ML_PIPELINE_AND_EVALUATION.md`](../ML_PIPELINE_AND_EVALUATION.md), [`../components/DOCUMENT_PROCESSING.md`](../components/DOCUMENT_PROCESSING.md), and [`../../LIMITATIONS.md`](../../LIMITATIONS.md).

`DEP-REQ-001` The delivered V1 runtime must be runnable locally through Docker Compose and must not require Kubernetes, Terraform, a cloud account, or real customer data.

`DEP-REQ-002` Deployment documentation must identify the runtime as a synthetic-data demonstration and must not claim production readiness, regulatory approval, or a production Service Level Agreement.

## 3. First Vertical-Slice Composition

The first vertical slice contains:

```text
Review Web
API Service
Worker Service
PostgreSQL with pg-boss
MinIO-compatible object storage
restricted document-processing execution boundary
```

`DEP-REQ-003` Review Web, API Service, and Worker Service must have separate runtime entry points even when built from one monorepo.

`DEP-REQ-004` PostgreSQL must own durable relational and workflow state; MinIO must provide the local S3-compatible object-store implementation.

`DEP-REQ-005` The first slice may run the Document Sandbox as a restricted worker subprocess or isolated task container if it preserves the approved credential, filesystem, network, and resource boundaries.

`DEP-REQ-006` The first slice must not require Prometheus, Jaeger, an external log platform, Redis, Kafka, Elasticsearch, or a separate Agent-monitoring service.

`DEP-REQ-007` Transactional-outbox completion may follow the first working slice but remains required before the completed V1 baseline; interim scheduling must remain bounded, use pg-boss, and be documented as non-final reliability behavior.

## 4. Offline and Live-Model Modes

`DEP-REQ-008` The default demo and continuous-integration configuration must use fake-model adapters and require no external model credentials or network calls.

`DEP-REQ-009` Live-model execution must require an explicit non-default configuration or Compose profile and the required provider credential inputs.

`DEP-REQ-010` Enabling a live model must not change domain contracts, validation rules, disposition policy, Agent tool authority, or synthetic-only data restrictions.

`DEP-REQ-011` Missing live-model credentials must fail the live configuration at startup or invocation without breaking the default offline configuration.

`DEP-REQ-012` Provider credentials must be available only to the Model Gateway boundary and must not enter Review Web bundles, the Document Sandbox, datasets, logs, or Agent context.

## 5. Images and Runtime Users

`DEP-REQ-013` Application images must use pinned Node.js 22.19-or-later base versions compatible with the approved runtime baseline.

`DEP-REQ-014` Delivered application containers must run as non-root users unless a documented native dependency makes a narrower exception necessary.

`DEP-REQ-015` Images must use multi-stage builds or an equivalent separation so build-only tools and source caches are absent from runtime layers where practical.

`DEP-REQ-016` Runtime images must not contain provider credentials, local uploads, database volumes, generated evaluation output, or developer model caches.

`DEP-REQ-017` Critical native runtimes and assets, including PDF Inspector, PDFium, ONNX Runtime, and PP-OCRv6 assets, must be pinned or integrity-identified and recorded in the release manifest.

## 6. Configuration and Secrets

`DEP-REQ-018` Each runtime unit must validate its typed configuration before accepting work and fail startup on missing required or incompatible values.

`DEP-REQ-019` Configuration must distinguish safe non-secret version and limit values from credentials and secret material.

`DEP-REQ-020` Secrets must enter containers through deployment-managed secret inputs and must not be committed, baked into images, placed in browser bundles, or printed during startup.

`DEP-REQ-021` Development authentication must require an explicit local-demo configuration and must fail closed in any configuration represented as non-development.

`DEP-REQ-022` The repository skeleton must define and document authoritative configuration names, defaults, and validation; this specification does not invent environment-variable names before that skeleton exists.

## 7. Storage and Networking

`DEP-REQ-023` PostgreSQL and object-store data must use named local volumes or an explicitly configured demo storage path; application containers must not treat their writable filesystem as authoritative storage.

`DEP-REQ-024` Only ports required for local browser access and explicit developer inspection may be published to the host; internal database, queue, and object-store traffic should remain on the Compose network by default.

`DEP-REQ-025` The Document Sandbox must not have unrestricted outbound network access and must not receive database, object-store administration, model-provider, or user credentials.

`DEP-REQ-026` The API must access stored artifacts through project-owned interfaces and must not expose internal MinIO keys or permanent credentials to the browser.

`DEP-REQ-027` Source and derived artifacts must retain checksum and lineage metadata across container restart.

## 8. Health, Readiness, and Shutdown

`DEP-REQ-028` API and Worker must expose process health and dependency-aware readiness behavior appropriate to their runtime role.

`DEP-REQ-029` Review Web readiness must indicate that its static application is servable; it must not imply API or pipeline readiness unless that dependency is checked separately.

`DEP-REQ-030` API readiness must fail when required PostgreSQL or object-store access is unavailable; optional live-model availability must not fail offline readiness.

`DEP-REQ-031` Worker readiness must fail when it cannot reach required PostgreSQL, pg-boss, object storage, or required processing configuration.

`DEP-REQ-032` Long-running processes must handle graceful shutdown, stop accepting new work, and preserve or release claimed work according to pg-boss and workflow semantics.

## 9. Database and Demo Data

`DEP-REQ-033` Schema migrations must be explicit, version-controlled, and applied through the repository-authoritative migration workflow after the skeleton exists.

`DEP-REQ-034` Demo-data loading must install only synthetic cases and must retain visible synthetic markers and dataset-release identity.

`DEP-REQ-035` The first vertical slice must support loading the six-case golden release without requiring live-model execution.

`DEP-REQ-036` Demo reset must target only resolved project-owned local Compose volumes or records, require an explicit action, and must not delete repository files or unrelated container data.

`DEP-REQ-037` Reset behavior must state that local demo data is destroyed and whether recovery is possible before execution.

## 10. Observability and Verification

`DEP-REQ-038` Application containers must emit structured logs to standard output or error and propagate the basic trace context required by the Observability specification.

`DEP-REQ-039` The first vertical slice need not deploy Prometheus or Jaeger; adding them later must remain optional to the core offline demonstration.

`DEP-REQ-040` A Compose acceptance test must start the offline stack, verify readiness, load synthetic demo data, execute the native-text path, retrieve the Agent Report and evidence through the API, and shut down cleanly.

`DEP-REQ-041` A restart test must prove that authoritative case, run, review, and artifact state survives API and Worker replacement.

`DEP-REQ-042` A sandbox verification must prove that document processing lacks application and provider credentials and cannot use unrestricted network access.

`DEP-REQ-043` A release check must verify pinned dependencies, frozen package resolution, absence of committed secrets, synthetic-data markings, safe image contents, and limitation disclosure.

## 11. Cloud Compatibility and Non-Goals

`DEP-REQ-044` Application contracts must remain compatible with replacement PostgreSQL, S3-compatible storage, model, identity, and telemetry adapters without embedding cloud-provider types in domain modules.

`DEP-REQ-045` An AWS mapping may be documented later as a non-delivered reference; V1 must not ship Terraform or claim a validated AWS production deployment.

`DEP-REQ-046` Kubernetes, autoscaling, multi-region operation, high availability, disaster recovery, production backup, production certificate management, and production secret rotation are outside V1.

## 12. Acceptance

`DEP-REQ-047` A new developer with the documented prerequisites must be able to run the offline synthetic demonstration using only repository-provided configuration and workflows defined after the skeleton exists.

`DEP-REQ-048` The offline acceptance path must not require provider credentials, unrestricted internet access, or manual database editing.

`DEP-REQ-049` Failure of an optional live-model or observability dependency must not prevent the offline native-text acceptance path.

`DEP-REQ-050` Deployment documentation must distinguish the first working vertical slice, completed V1 requirements, optional profiles, and deferred production capabilities.

No unresolved local-demo deployment decision blocks review. Concrete commands and configuration names will be owned by the implementation skeleton rather than invented in advance.

## 13. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-05 | Approved | Approved a minimal Docker Compose deployment for the offline synthetic vertical slice with optional live-model use and explicit production exclusions. No unresolved local-demo deployment decision remains. |
