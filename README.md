# Financial Document AI Agent

Production-shaped interview prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Current implementation

The Stage Two skeleton provides separate API, Worker, and Review Web entry points, shared TypeBox contracts, internal processing ports, an asynchronous case-intake contract test, and an offline pipeline-order test.

Case intake accepts multipart PDF/JPEG/PNG streams, stores source bytes through MinIO, and transactionally registers immutable artifact and document-version metadata. After minimum deterministic file preflight, every processable case enters one bounded `pi-coding-agent` review session. PDF Inspector capabilities are exposed only through registered case-scoped tools; the Agent may inspect authorized pages, address explicit extraction gaps, submit evidence-backed candidates, request deterministic reconciliation and validation, read the committed result, and submit one non-authoritative report. It receives no shell, arbitrary file, network, extension, or policy authority. The delivered demo uses a deterministic scripted fake model and fixture OCR/VLM values; these prove orchestration rather than recognition or Agent quality. PostgreSQL and pg-boss remain authoritative, and deterministic code owns claims, findings, disposition, report verification, and workflow state. Incremental mid-session persistence, hardened operating-system isolation, real OCR/VLM tool ports, and live-model acceptance remain follow-up work.

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
