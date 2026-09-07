# Release notes

## v0.1.0-interview-demo

Financial Document AI Agent is an interview demonstration and production-shaped prototype for evidence-linked review of synthetic German personal-loan documents. It is not a production banking system and does not approve or reject applications, determine creditworthiness, contact applicants, or make AML or KYC decisions.

### Demonstrated

- Multipart PDF, JPEG, and PNG intake with immutable source artifacts and durable PostgreSQL workflow state.
- One bounded Pi Case Review Agent session per processable case, with scoped tools, persisted steps, cumulative budgets, and compatible restart/re-entry.
- Agent-led extraction followed by deterministic normalization, reconciliation, five registered validation rules, disposition, and report verification.
- Original-document evidence navigation with click-activated bounding boxes from same-pass native PDF text, local OCR, or bounded VLM extraction.
- Six manually confirmed synthetic golden cases frozen as dataset release `v0.1.2`.
- Default offline fixture route, opt-in pinned Linux ARM64 PP-OCRv6 Small route, and explicitly budgeted live page-VLM route.

### Verified release checks

- `pnpm check`
- `pnpm build`
- `pnpm dataset:validate`
- `pnpm test:integration`
- `pnpm demo:acceptance`

### Known limits

- Synthetic/demo-safe data only; no real personal or banking data.
- Docker Compose demonstration deployment, not a production service.
- Linux x64 native-runtime acceptance, hardened operating-system isolation, broader document variation, and representative OCR/VLM evaluation remain future work.
- Fixture OCR/VLM defaults are deterministic orchestration fixtures and provide no model-accuracy evidence.

See [`LIMITATIONS.md`](LIMITATIONS.md) for the complete boundary and [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md) for exact acceptance evidence and versioned run identifiers.
