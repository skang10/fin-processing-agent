# Financial Document AI Agent

Production-shaped interview prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Current implementation

The Stage Two skeleton provides separate API, Worker, and Review Web entry points, shared TypeBox contracts, internal processing ports, an asynchronous case-intake contract test, and an offline pipeline-order test.

Case intake accepts multipart PDF/JPEG/PNG streams, stores source bytes through MinIO, transactionally registers immutable artifact and document-version metadata, and discards newly uploaded objects after failed or replayed intake. The Worker reads bounded source objects, runs the pinned PDF Inspector adapter for PDFs, stores native text and PDFium page renders, and selectively runs OCR inside a bounded document subprocess. The delivered synthetic demo explicitly selects a deterministic fake OCR mode that emits fixture text and is not real OCR. A project-owned adapter for PDF Inspector's local PP-OCRv6 Small path is present but requires pre-provisioned offline runtime assets and acceptance testing before use. The Worker then seals a deterministic offline result with evidence-linked claims, findings, and disposition and gives that persisted result to the bounded Case Review Agent: an embedded pi-coding-agent session that receives only three registered report tools, no shell, file, network, or extension capability, fixed budgets, and a deterministic scripted fake model in the delivered demo. Each session and every tool step is persisted and shown in the case Agent log. General extraction and reconciliation, hardened operating-system sandbox isolation, the Agent adaptive-recovery mode, and live-model acceptance remain next implementation steps.

The Review Workbench can load one current case with `?case_id=<uuid>` and hydrates its report, findings, issues, application data, and documents through the V1 API. Review mutations are still prototype-only. The Docker Compose demo starts PostgreSQL, MinIO, migrations, API, Worker, and Web together and includes a visibly synthetic four-page case loader.

For the shortest local demo path, start Docker Desktop and run:

```bash
pnpm demo:up
pnpm demo:load
```

The loader prints the exact Review Workbench URL. `pnpm demo:down` stops the environment while preserving demo data. `pnpm demo:reset` permanently removes its containers, database and object-store volumes, and generated local credentials. `pnpm demo:acceptance` performs an isolated build, startup, migration, health, case-processing, and teardown check.

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
pnpm demo:up
pnpm demo:load
pnpm demo:down
pnpm demo:reset
pnpm demo:acceptance
```

Node.js 22.19 or later and pnpm 11.3.0 are required.

Build shared packages before starting development processes after source changes. The API and database commands require `DATABASE_URL`; API and Worker also require the MinIO settings documented in `.env.example`. The demo commands generate restricted local credentials in ignored `.data/demo.env`; do not reuse them outside the local demonstration.
