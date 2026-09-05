# Financial Document AI Agent Security and Limitations Specification

Document ID: `SEC`

Version: 1.0.0

Status: Approved

Last updated: 2026-09-04

## 1. Purpose

This specification defines the minimum security boundary required for the V1 synthetic-data demonstration. It intentionally avoids turning the prototype into a production banking-security programme.

V1 is not approved for real personal or financial data, production banking use, regulatory compliance, or customer communication. [`LIMITATIONS.md`](../LIMITATIONS.md) remains the concise public disclosure of those boundaries.

## 2. Authority and Dependencies

This document owns the V1 threat boundary, implemented security controls, authentication and authorization baseline, secrets handling, and security acceptance tests.

It depends on [`PRODUCT_AND_SCOPE.md`](PRODUCT_AND_SCOPE.md), [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md), [`API_CONTRACTS.md`](API_CONTRACTS.md), [`ML_PIPELINE_AND_EVALUATION.md`](ML_PIPELINE_AND_EVALUATION.md), [`components/DOCUMENT_PROCESSING.md`](components/DOCUMENT_PROCESSING.md), and [`components/ADAPTIVE_EXTRACTION_AGENT.md`](components/ADAPTIVE_EXTRACTION_AGENT.md).

`SEC-REQ-001` This specification must not weaken `LIMITATIONS.md` or imply loan approval, loan rejection, creditworthiness, customer contact, account opening, disbursement, final AML, or final KYC authority.

`SEC-REQ-002` V1 must be described and configured as a synthetic-data demonstration, not a production banking system.

## 3. V1 Threat Boundary

V1 treats uploaded files, document text and metadata, parser and OCR output, model output, Agent output, browser input, and external provider responses as untrusted.

`SEC-REQ-003` Trust must not be based solely on filename extension, declared media type, provider success, model confidence, or Agent narrative.

`SEC-REQ-004` Invalid contracts, unauthorized access, unknown Agent tools, unregistered rules, missing required configuration, and artifact-integrity failures must fail closed.

`SEC-REQ-005` V1 must not claim protection equivalent to enterprise malware scanning, Content Disarm and Reconstruction, penetration testing, tamper-proof audit, production identity, or production data governance.

## 4. Synthetic-Only Data

`SEC-REQ-006` The demo deployment, examples, screenshots, datasets, and evaluation artifacts must use only synthetic or explicitly demo-safe data.

`SEC-REQ-007` Documentation and the interface must warn that real personal, identity, banking, or financial data must not be submitted.

`SEC-REQ-008` Synthetic documents must be visibly marked and must not reproduce official security features or real institution branding.

`SEC-REQ-009` Automated dataset checks may support this boundary but must not be described as proof that personal data is absent.

## 5. File Processing

`SEC-REQ-010` Intake must determine supported media type from content, compute a checksum while streaming, enforce configured size and resource limits, and reject unsupported, corrupt, unreadable, or unsupported encrypted input.

`SEC-REQ-011` PDF parsing, rendering, image decoding, PDF Inspector, and OCR must execute through the restricted Document Sandbox.

`SEC-REQ-012` A sandbox task must receive one bounded operation, explicit artifact references, resource limits, and a validated response contract.

`SEC-REQ-013` The sandbox must have no database, model-provider, object-store administration, business-system, or user credentials and no unrestricted network access.

`SEC-REQ-014` Sandbox timeout, crash, resource exhaustion, or invalid output must create a structured failure rather than trusted partial success.

`SEC-REQ-015` PDF Inspector must not be represented as a malware scanner or Content Disarm and Reconstruction system; absent an approved scanner, malware-scan state remains `not_scanned`.

## 6. Model and Prompt Safety

`SEC-REQ-016` Document content must be supplied to models as untrusted data and must not alter trusted prompts, schemas, tools, budgets, rules, dispositions, authorization, or workflow commands.

`SEC-REQ-017` VLM extraction calls must have no tools, must receive only selected pages, bounded page windows, or regions, and must return allowlisted schema-valid output.

`SEC-REQ-018` Every external model call must pass through the provider-neutral Model Gateway; provider credentials must remain inside that boundary.

`SEC-REQ-019` Invalid, cross-case, unknown-schema, or unreferenced model output must not become a claim, finding, disposition, or verified report.

`SEC-REQ-020` Model self-reported confidence must not bypass deterministic validation or human review.

## 7. Pi Agent Safety

`SEC-REQ-021` Pi built-in coding tools, Shell, arbitrary filesystem access, unrestricted network access, dynamic extensions, runtime installation, automatic resource discovery, and core banking access must be disabled.

`SEC-REQ-022` Pi may invoke only immutable registered tools with validated inputs, authorized case-scoped targets, validated outputs, and one bounded operation.

`SEC-REQ-023` Tool access, iterations, VLM calls, token use, cost, and timeout must be enforced outside the model.

`SEC-REQ-024` Pi output remains non-authoritative until deterministic schema, reference, registered-code, and prohibited-content verification succeeds.

`SEC-REQ-025` Pi must not modify prompts, schemas, tools, rules, thresholds, dispositions, golden truth, authentication, or authorization.

`SEC-REQ-026` An unavailable or rejected Agent report must not prevent human review of deterministic results and evidence.

## 8. Authentication, Authorization, and Commands

`SEC-REQ-027` Every non-health API request must resolve the development authentication context and enforce server-side authorization for the requested case, artifact, query, or command.

`SEC-REQ-028` Development authentication must be explicitly enabled and must fail closed in other environments; it must not be described as production identity assurance.

`SEC-REQ-029` Review commands must enforce their approved validation, result-revision concurrency, and actor requirements; browser visibility is not authorization.

`SEC-REQ-030` V1 must expose no route or hidden command for customer-message delivery, runtime prompt or rule editing, Agent tool installation, protected-value reveal, or general case deletion.

`SEC-REQ-031` Case creation and final-review submission must be idempotent; other reviewer edits require optimistic concurrency but need not implement a persistent idempotency ledger in the first vertical slice.

## 9. Secrets, Storage, and Display

`SEC-REQ-032` Credentials must not be committed, embedded in datasets or images, returned by APIs, passed to the sandbox or Agent, or written to logs, traces, metrics, screenshots, or evaluation reports.

`SEC-REQ-033` Source and derived artifacts must retain checksum and lineage metadata; browser access must be authorized and must not expose permanent object-store credentials or internal object keys.

`SEC-REQ-034` Complete documents, page images, unrestricted extracted text, full identity-document numbers, and full IBANs must not appear in logs, traces, metrics, analytics, or routine Agent activity.

`SEC-REQ-035` Identity-document numbers and IBANs must be masked in V1 browser and API projections.

`SEC-REQ-036` Document and model content must render as inert text; the browser must not execute embedded actions, HTML, scripts, links, or external resources derived from documents.

## 10. Audit, Dependencies, and Verification

`SEC-REQ-037` The application must retain append-only audit events for material case, Agent-tool, artifact-access, and review actions, while explicitly disclosing that V1 audit is not tamper-proof or WORM-compliant.

`SEC-REQ-038` Critical versions for PDF Inspector, PDFium, PP-OCRv6 assets, model identifiers, prompts, and dependencies must be pinned or recorded for reproducibility; Agent-driven runtime installation is prohibited.

`SEC-REQ-039` Automated tests must cover malformed and oversized files, unsupported encryption, sandbox failure, prompt injection, invalid model output, unknown Agent tools, budget exhaustion, unauthorized or cross-case references, stale review commands, masked values, safe errors, and absence of prohibited actions.

`SEC-REQ-040` The fixed instruction-injection golden case must prove that document content cannot expand model or Agent authority, access secrets, change rules or dispositions, or trigger customer or banking actions.

## 11. Deferred Production Work

The following are intentionally outside V1: enterprise malware scanning or CDR, production OIDC and fine-grained authorization, real-data governance, secret rotation infrastructure, protected-value reveal, formal security headers and network policy certification, tamper-resistant audit, penetration testing, private model hosting, incident response, legal hold, production retention, backup, and disaster recovery.

These items remain in [`BACKLOG.md`](../BACKLOG.md) and [`LIMITATIONS.md`](../LIMITATIONS.md); their absence must not be hidden by production-shaped terminology.

No unresolved V1 authority or synthetic-demo security decision blocks review.

## 12. Document History

| Version | Date | Status | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Approved | Approved a deliberately minimal forty-requirement security baseline for the synthetic V1 vertical slice. No unresolved V1 authority or synthetic-demo security decision remains. |
