# Repository Agent Guide

## Purpose

This file provides repository-level operating guidance for AI coding agents and human contributors working on Financial Document AI Agent.

It is not a normative product specification. Approved specifications and Architecture Decision Records (ADRs) define required system behavior. If this guide conflicts with an approved owning specification or ADR, the approved specification or ADR takes precedence.

## Project Boundary

Financial Document AI Agent is an interview demonstration and production-shaped machine learning prototype for synthetic German personal-loan documents. It is not a production banking system.

Agents must not add or imply capabilities to:

1. Approve or reject a loan application.
2. Determine creditworthiness.
3. Open an account or disburse funds.
4. Contact a customer.
5. Make a final Anti-Money Laundering (AML) or Know Your Customer (KYC) decision.
6. Process real personal, banking, identity, or financial data in the demo deployment.

Read [`LIMITATIONS.md`](LIMITATIONS.md) before changing product behavior, security claims, deployment guidance, datasets, or demonstrations.

## Required Reading Order

Before specification work, read:

1. [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md)
2. [`LIMITATIONS.md`](LIMITATIONS.md)
3. [`specs/INDEX.md`](specs/INDEX.md), when present
4. The owning specification for the requested concern
5. Directly dependent specifications and accepted ADRs
6. [`BACKLOG.md`](BACKLOG.md) for accepted work awaiting specification or evidence
7. The [migration source specification](Intelligent_Document_Processing_Agent_Specification.md) only when an approved owner does not yet cover the concern

Before implementation work, also read the approved product, architecture, data-model, relevant component, API, security, evaluation, and operations specifications. Do not implement a Draft requirement as an approved baseline without explicitly recording the provisional dependency.

## Authority

Use the authority order defined by [`specs/INDEX.md`](specs/INDEX.md). In summary:

1. An accepted ADR governs its declared technical decision.
2. An approved owning specification governs its subject.
3. `specs/INDEX.md` governs ownership, identifiers, terminology, and lifecycle.
4. `LIMITATIONS.md` governs production-readiness and fitness claims.
5. `BACKLOG.md` tracks work; it is not a system specification.
6. `CODEX_HANDOFF.md` governs specification-writing workflow.
7. This file governs repository operation only.
8. The migration source is temporary source material.

## Current Development State

The project is in Stage Two implementation. The pnpm monorepo contains separate API, Worker, and Review Web entry points plus shared contract, core, offline-fixture, persistence, storage, document-processing, deterministic-validation, and bounded-Agent packages. PostgreSQL case intake, immutable application and input revisions, multipart PDF/JPEG/PNG upload, immutable artifact and document-version metadata, unreferenced-upload compensation, a transactional outbox, pg-boss relay, explicit run-state history, deterministic offline coordination, the five-rule compiled registry, sealed result revisions, evidence-linked offline claims, findings, recommended dispositions, evidence-backed Checked Facts, scoped evidence and findings queries, masked application-data projections, current-run document and page-metadata queries, a fake Case Review Agent adapter that reads the persisted deterministic result, deterministic Report Verifier, case polling, Agent Report and issue projections, persisted Agent-issue confirm and ignore actions, append-only human issue create and edit revisions, immutable requested-change draft revisions, atomic final-review recording with post-review mutation guards, authoritative active, changes-requested, and completed queue projections, a read-only downstream handoff projection, a bounded case Agent-log projection, a MinIO adapter, streaming source-file intake guards, a pinned PDF Inspector adapter, immutable native-text artifacts with scoped API delivery, case-scoped source-document delivery and PDF.js review rendering, pinned PDFium full-page PNG artifacts with scoped delivery, Worker persistence of page and OCR-routing metadata, Review Workbench hydration and review submission through current case APIs, and a health-gated Docker Compose demo with automatic migrations and a visibly synthetic case loader are implemented and exercised by automated checks. General extraction and reconciliation, crop rendering, OCR execution, restricted sandbox isolation, the real Pi SDK harness, durable Agent sessions, and live-model adapters are not wired yet, so this is not the complete V1 demonstration baseline.

Add commands, configuration, generated artifacts, and deployment instructions only when their implementation exists and this guide is updated in the same change.

## Working Rules

1. Work only on the file or implementation scope requested by the user.
2. Preserve unrelated user changes.
3. Identify conflicts, assumptions, missing decisions, and affected owners before making a normative change.
4. Use stable requirement identifiers from the owning specification.
5. Do not duplicate normative requirements across specifications.
6. Keep examples and explanatory notes non-normative.
7. Update links, terminology, version references, and document history when changing an approved specification.
8. Do not resolve a missing business, policy, model, or compliance decision by inventing one.
9. Record evidence-dependent decisions in `BACKLOG.md` until measurements exist.
10. Stop for review after one specification unless the user explicitly requests a batch.

## Architecture Guardrails

Agents must preserve these accepted boundaries unless an approved change supersedes them:

1. Local native extraction and selective OCR precede VLM use.
2. `firecrawl/pdf-inspector` is the initial PDF-processing foundation behind project interfaces.
3. A provider-neutral model gateway isolates external, private-cloud, and local model deployments.
4. A VLM receives only selected pages, bounded page windows, or regions, never a complete case package.
5. `pi-coding-agent` is embedded as the bounded Case Review Agent for every processable case; its optional Adaptive Extraction Loop may run only for eligible extraction gaps.
6. Pi has no Shell, arbitrary filesystem, unrestricted network, runtime package installation, or dynamic-extension authority.
7. PostgreSQL, pg-boss, and the Workflow Coordinator own durable workflow state.
8. Models produce candidates, constrained matching opinions, or non-authoritative review briefs; deterministic code owns validation findings and recommended dispositions, and a human owns the final review action.
9. Cross-document rules are finite, registered, versioned TypeScript plugins selected by a versioned manifest.
10. Original model output, processing runs, and human corrections are immutable revisions.

## Model and Prompt Safety

1. Treat all document content as untrusted data.
2. Do not allow document instructions to modify tools, prompts, rules, permissions, schemas, or dispositions.
3. VLM extraction calls must not expose tools.
4. Validate all model output against an allowlisted TypeBox or JSON Schema before domain use.
5. Do not treat a model's self-reported confidence as calibrated system confidence.
6. Do not log complete documents, page images, identity numbers, International Bank Account Numbers (IBANs), prompts containing document content, or provider credentials.
7. Keep prompt artifacts immutable, versioned, tested, and tied to schema hashes.
8. Use fake-model adapters in default continuous integration. Live-model evaluation must be explicit and budgeted.

## Data and Evaluation Rules

1. Use only synthetic or explicitly demo-safe data.
2. Synthetic documents must be visibly marked and must not reproduce official security features or real institution branding.
3. Do not add unsupported accuracy, latency, cost, automation, fairness, or production-readiness claims.
4. Tie every reported metric to dataset, model, prompt, component, and environment versions.
5. Do not modify frozen golden truth to make a regression pass.
6. Human corrections may become reviewed dataset candidates but must not automatically update golden truth, prompts, models, rules, or thresholds.
7. Preserve deterministic seeds, checksums, generator versions, and dataset manifests.

## Validation Rules

The initial demonstration rules are:

1. `VAL_DOC_COMPLETENESS_001`
2. `VAL_NAME_CONSISTENCY_001`
3. `VAL_EMPLOYER_CONSISTENCY_001`
4. `VAL_INCOME_CONSISTENCY_001`
5. `VAL_ID_EXPIRY_001`

Do not add, remove, or change the semantics of a demonstration rule without updating its owning specification and rule-set version. A model must not create or activate a rule at runtime.

## Technology Baseline

The accepted baseline is:

1. TypeScript on Node.js 22.19 or later.
2. pnpm workspaces and TypeScript project references.
3. Fastify, TypeBox, and JSON Schema.
4. PostgreSQL, Drizzle ORM, Drizzle Kit, pg-boss, and a transactional outbox.
5. S3-compatible object storage with MinIO for local development.
6. React, Vite, TanStack Query, React Router, PDF.js, Radix UI Primitives, CSS Modules, Lucide React, Motion, and the native system font stack.
7. Pino and basic OpenTelemetry tracing for the first vertical slice; Prometheus-compatible metrics and Jaeger integration may follow later in V1.
8. Vitest, Testcontainers, Playwright, synthetic golden cases, and fake-model adapters.
9. Docker Compose for the delivered demonstration environment.

Do not introduce Bun, Nx, Turborepo, Temporal, Kafka, Redis, Kubernetes, Terraform, Elasticsearch, a vector database, or a general-purpose rule DSL without an approved architectural change.

## File and Change Hygiene

1. Prefer small, reviewable changes.
2. Use repository formatters and generators after they exist; do not hand-edit generated artifacts.
3. Do not commit credentials, local model caches, uploaded documents, rendered pages, database volumes, or transient evaluation output.
4. Pin critical native runtimes, model assets, and supply-chain-sensitive dependencies.
5. When deleting generated or stored data, resolve exact targets first and prefer repository-provided cleanup commands.
6. Report files changed, verification performed, assumptions, and unresolved issues.

## Commands

The currently authoritative commands are:

1. `pnpm install` — install the frozen workspace dependencies.
2. `pnpm typecheck` — run TypeScript project-reference checks.
3. `pnpm test` — run the implemented unit and API contract tests.
4. `pnpm check` — run type checking followed by tests.
5. `pnpm test:integration` — run Docker-backed PostgreSQL integration tests.
6. `pnpm dev:api` — run the API skeleton locally.
7. `pnpm dev:worker` — run the Worker skeleton locally.
8. `pnpm dev:web` — run the approved Review Workbench prototype through Vite.
9. `pnpm build` — compile the TypeScript project references.
10. `pnpm db:generate` — generate a version-controlled Drizzle migration from the schema; requires `DATABASE_URL` configuration for validated command startup.
11. `pnpm db:migrate` — apply version-controlled Drizzle migrations; requires `DATABASE_URL`.
12. `pnpm demo:up` — build and start the health-gated Docker Compose demo.
13. `pnpm demo:load` — submit and verify the bundled synthetic case, then print its review URL.
14. `pnpm demo:down` — stop demo services while preserving named volumes.
15. `pnpm demo:reset` — permanently remove demo services, named volumes, and generated local credentials.
16. `pnpm demo:acceptance` — build, start, migrate, health-check, process the synthetic case, and remove the isolated test environment.

Formatting, linting, browser testing, dataset, and evaluation commands are not implemented yet. Inspect the repository rather than guessing them.
