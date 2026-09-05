# Financial Document AI Agent

Production-shaped interview prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Current implementation

The Stage Two skeleton provides separate API, Worker, and Review Web entry points, shared TypeBox contracts, internal processing ports, an asynchronous case-intake contract test, and an offline pipeline-order test.

Case intake now accepts multipart PDF/JPEG/PNG streams, stores source bytes through MinIO, transactionally registers immutable artifact and document-version metadata, and discards newly uploaded objects after failed or replayed intake. The Worker reads bounded source objects, runs the pinned PDF Inspector adapter for PDFs, and persists page-level OCR-routing metadata before the offline coordinator publishes a fake Agent Report and review issues. Derived native-text artifacts, evidence, OCR execution, restricted sandbox isolation, the real Pi harness, and model adapters remain next implementation steps.

## Commands

```bash
pnpm install
pnpm check
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Node.js 22.19 or later and pnpm 11.3.0 are required.

The API and database commands require `DATABASE_URL`; `.env.example` documents the local-demo shape without containing production credentials.
