# Financial Document AI Agent

Production-shaped interview prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Current implementation

The Stage Two skeleton provides separate API, Worker, and Review Web entry points, shared TypeBox contracts, internal processing ports, an asynchronous case-intake contract test, and an offline pipeline-order test.

Case intake accepts multipart PDF/JPEG/PNG streams, stores source bytes through MinIO, transactionally registers immutable artifact and document-version metadata, and discards newly uploaded objects after failed or replayed intake. The Worker reads bounded source objects, runs the pinned PDF Inspector adapter for PDFs, persists page-level OCR-routing metadata, seals a deterministic result with evidence-linked claims, findings, and disposition, then gives that persisted result to the fake Case Review Agent. The API exposes the report, issues, deterministic findings, evidence, masked application data, and document metadata. Derived native-text artifacts, general extraction and reconciliation, OCR execution, rendered page delivery, restricted sandbox isolation, the real Pi harness, and live-model adapters remain next implementation steps.

The Review Workbench can load one current case with `?case_id=<uuid>` and hydrates its report, findings, issues, application data, and documents through the V1 API. Review mutations are still prototype-only. Docker Compose is specified but not yet delivered; PostgreSQL and MinIO must currently be started separately.

## Commands

```bash
pnpm install
pnpm build
pnpm check
pnpm test:integration
pnpm db:migrate
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Node.js 22.19 or later and pnpm 11.3.0 are required.

Build shared packages before starting development processes after source changes. The API and database commands require `DATABASE_URL`; API and Worker also require the MinIO settings documented in `.env.example`.
