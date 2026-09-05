# Financial Document AI Agent

Production-shaped interview prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Current implementation

The Stage Two skeleton provides separate API, Worker, and Review Web entry points, shared TypeBox contracts, internal processing ports, an asynchronous case-intake contract test, and an offline pipeline-order test.

Case intake now has PostgreSQL persistence, a transactional outbox, a pg-boss relay, and a deterministic offline coordinator that publishes a fake Agent Report and review issues. A MinIO adapter and streaming PDF/JPEG/PNG intake guard are tested independently. Multipart document persistence, evidence, PDF Inspector, OCR, the real Pi harness, and model adapters remain next implementation steps, so this is not yet a complete document-processing vertical slice.

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
