# Financial Document AI Agent

Production-shaped prototype for evidence-linked processing and human review of synthetic German personal-loan documents.

The project does not approve or reject loans, determine creditworthiness, contact applicants, or make final AML or KYC decisions. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Demonstration release

Version `0.1.0` is a production-shaped demonstration prototype. It provides separate API, Worker, and Review Web entry points, durable asynchronous processing, a bounded Agent workflow, deterministic validation, evidence-linked review, and synthetic evaluation paths. It is not production-ready and must be used only with synthetic or explicitly demo-safe data.

Case intake accepts multipart PDF/JPEG/PNG streams, stores source bytes through MinIO, and transactionally registers immutable artifact and document-version metadata. The Worker then inspects, renders, and selectively OCRs every page, and every processable case enters one bounded `pi-coding-agent` review session that leads the document review.

The system has no deterministic field parser, so every document value comes from the Agent through a registered, case-scoped tool: it reads the bounded case manifest, inspects authorized pages, reads committed native text, runs the approved OCR boundary where a page needs it, uses bounded VLM extraction only for a page local processing could not resolve, and submits candidates that must cite a value an authorized tool returned for that same page. It then requests deterministic reconciliation and the five registered validation rules, reads the committed result, and submits one non-authoritative report. It receives no shell, arbitrary file, network, extension, or policy authority.

Deterministic code still owns normalization, reconciliation, claims, entity matching, findings, disposition, report verification, and workflow state, and PostgreSQL and pg-boss remain authoritative. The session persists its identity, attempts, steps, tool results, and consumed budgets as it goes, so a Worker that disappears mid-review resumes from committed state, reuses completed work, and cannot duplicate a candidate, result, or report.

The delivered demo defaults to a deterministic scripted fake model with fixture OCR and VLM answers. An opt-in, checksum-verified Linux runtime can instead run PDF Inspector's local PP-OCRv6 Small path fully offline; the six-case frozen synthetic corpus has completed the Linux ARM64 route with verified reports and precise native/OCR evidence regions. ADR-003 selects `openai/gpt-5.6-terra` as the opt-in live default and `openai/gpt-5.6-sol` as fallback from a bounded one-case synthetic comparison. These are not real-world recognition or production-quality claims. Broader OCR/VLM evaluation, provider-diverse fallback evidence, and hardened operating-system isolation remain follow-up work. See [`LIMITATIONS.md`](LIMITATIONS.md).

The Review Workbench can load one current case with `?case_id=<uuid>` and hydrates its report, findings, issues, application data, and documents through the V1 API. Reviewer-facing labels use stable `FD-YYYY-NNNN` references while UUIDs remain internal route and relationship identifiers. The document workspace presents the immutable source upload; derived page PNG renders are not listed as uploaded documents. Review mutations are still prototype-only. The Docker Compose demo starts PostgreSQL, MinIO, migrations, API, Worker, and Web together and includes a visibly synthetic four-page case loader.

For the shortest local demo path, start Docker Desktop and run:

```bash
pnpm demo:up
pnpm demo:load
```

The loader prints the exact Review Workbench URL. `pnpm demo:down` stops the environment while preserving demo data. `pnpm demo:reset` permanently removes its containers, database and object-store volumes, and generated local credentials. `pnpm demo:acceptance` performs an isolated build, startup, migration, health, case-processing, and teardown check. Acceptance always forces the fake Agent, fixture VLM, and offline mode and does not forward provider credentials, even when the ignored local `.env` opts into a live route.

In the Review Workbench, open a Checked Fact or Issue and select one of its document evidence references. A precise reference highlights its source region only after it is selected; page-level evidence deliberately opens the source page without inventing a box. Application data and Document remain separate evidence views. The case header shows a reviewer-facing `FD-YYYY-NNNN` reference while the URL retains the immutable internal case ID.

Real OCR is opt-in and never downloads models during case processing. Install and verify the pinned assets explicitly with `pnpm ocr:setup -- linux-arm64` (or `linux-x64`), then use `compose.ocr.yaml` together with `compose.yaml`. The overlay keeps the default fake Agent and fixture VLM and mounts OCR assets read-only. PDF, JPEG, and PNG full-page paths are accepted on Linux ARM64; `pnpm ocr:smoke` and `pnpm ocr:image-smoke` run bounded component checks. The source-pinned PDF Inspector compatibility patch exposes native items already present in the initial parse and OCR polygons already produced by the same recognition pass. Precise candidate boxes remain in source-page coordinates through evidence persistence, API projection, and original-document highlighting; missing or full-page locations remain page-level. Evidence highlighting therefore requires neither a second PDF parse nor crop re-recognition. Native Linux x64 acceptance remains deferred.

Release evidence and exact synthetic case/run identifiers are recorded in [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md). The frozen dataset remains `v0.1.2`; its version is independent from the application release version.

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
pnpm ocr:setup -- linux-arm64
pnpm ocr:verify -- linux-arm64
pnpm ocr:smoke
pnpm ocr:image-smoke
pnpm ocr:image-acceptance
```

Node.js 22.19 or later and pnpm 11.3.0 are required.

Build shared packages before starting development processes after source changes. The API and database commands require `DATABASE_URL`; API and Worker also require the MinIO settings documented in `.env.example`. The demo commands generate restricted local credentials in ignored `.data/demo.env`; do not reuse them outside the local demonstration.
