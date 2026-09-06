# ADR-002: Use PDF Inspector Behind Project-Owned Document Interfaces

Status: Accepted

Date: 2026-09-05

## Context

V1 needs local-first PDF inspection, native text and coordinates, page classification signals, layout and table candidates, selected-page processing, and per-page or region OCR routing before VLM use.

The official `@firecrawl/pdf-inspector` Node package provides a Rust core through native Node bindings, PDF type classification, native and region text extraction, layout information, tables, `pagesNeedingOcr` or region `needsOcr` signals, and opt-in local PP-OCRv6 Small execution through `processPdfWithOcr`. Its OCR model, PDFium, and ONNX Runtime assets remain external runtime dependencies. It is not a malware scanner, Content Disarm and Reconstruction system, authoritative truth source, or stable project-domain contract.

## Decision

V1 will use the native Node package `@firecrawl/pdf-inspector` inside the restricted Document Sandbox through a project-owned `PdfInspector` adapter.

The adapter will:

1. Accept bounded immutable PDF bytes or authorized sandbox-local input.
2. Translate PDF Inspector results into project-owned versioned schemas.
3. Preserve page geometry, native coordinates, page order, classification and OCR-routing signals, layout and table candidates, processor version, and configuration provenance.
4. Use full per-page inspection for evaluated V1 documents rather than sampling that could hide mixed pages.
5. Treat PDF Inspector confidence and routing output as uncalibrated processing signals, not truth.
6. Keep server rendering and translated OCR results behind project-owned interfaces even when PDF Inspector supplies their initial implementation.
7. Route scanned or unreliable pages and regions to PDF Inspector's selected OCR execution only under project-owned policy.

The initial OCR implementation is PDF Inspector's local PP-OCRv6 Small path. The deployment must pre-provision and verify the documented PDFium, ONNX Runtime, and model assets and use offline mode; runtime model downloads are not part of the delivered demo path.

## Rejected Alternatives

1. Browser WASM as the authoritative processor: rejected because untrusted parsing belongs in the server-side sandbox and durable provenance belongs in backend processing.
2. Sending every PDF page to a VLM: rejected for cost, privacy, reproducibility, and local-first requirements.
3. Exposing PDF Inspector types directly to domain modules: rejected because library changes would leak into persisted and API contracts.
4. Treating PDF Inspector Markdown as final structured truth: rejected because fields, evidence, normalization, and validation require project-owned stages.
5. Building a PDF parser from scratch: rejected as disproportionate for the V1 demonstration.

## Consequences

Positive consequences:

1. Native PDFs can avoid OCR and VLM calls.
2. Mixed PDFs can route only selected pages or regions to OCR.
3. A replaceable adapter limits dependency coupling.

Costs and risks:

1. Native binaries and platform support must be pinned and tested for the delivered container target.
2. Layout and Markdown behavior can vary across versions and complex PDFs.
3. OCR runtime assets remain a separate deployment and resource-management concern even though PDF Inspector supplies the execution path.
4. PDF Inspector does not replace sandboxing or file-security controls.

## Verification

The implementation spike must prove native-text, scanned, mixed, region, table, coordinate, corrupt, encrypted, and resource-limit fixtures; preserve versioned provenance; and demonstrate that fake adapters can replace PDF Inspector without changing downstream types.

## Affected Specifications

This decision constrains `DOC-REQ-030` through `DOC-REQ-036`, `DOC-REQ-061`, the Document Sandbox boundary, and the PDF Inspector evaluation fixtures. Replacement requires a superseding ADR.

## References

1. [PDF Inspector repository and README](https://github.com/firecrawl/pdf-inspector)
2. [PDF Inspector Node API](https://github.com/firecrawl/pdf-inspector/blob/main/napi/README.md)
3. [`components/DOCUMENT_PROCESSING.md`](../components/DOCUMENT_PROCESSING.md)
