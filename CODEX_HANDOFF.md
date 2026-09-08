# Codex Handoff

## Current Implementation Handoff — 2026-09-07

This section is the operational starting point for the next implementation agent. The specifications and ADRs remain authoritative for required behavior.

### Repository and runtime state

1. The repository is on `main`. Commit `8d538a6` (`feat: wire live page VLM extraction`) adds the opt-in live page-VLM route, schema boundary, configuration, durable usage accounting, and documentation. Commit `f2e902a` (`fix: bind live VLM extraction to requirements`) binds each live request to its declared semantic requirement after the first acceptance attempt exposed the ambiguity of a generic `organization.name` request.
2. `pnpm check`, `pnpm test:integration`, `pnpm dataset:validate`, `pnpm build`, the Review Web production build, and Docker Compose synthetic paths pass. Three explicit `openai/gpt-5.6-terra` acceptance attempts on `golden-001` drove two contract fixes; the confirming run cost USD 0.039304 and committed the expected verified report. A confirming `golden-006` run under Agent 3.5.0 cost USD 0.084095, delivered all three `needsOcr` page images to the live Agent before OCR/VLM, retained no image markers in durable safe output, produced the expected income issue, and committed a verified report in 11 iterations and 22 tool calls. The isolated live VLM adapter separately recognized `EUR 2980.00` from the synthetic scanned payslip page with `openai/gpt-5.6-terra` at 1,507 input tokens, 14 output tokens, and USD 0.003934. The requirement-bound end-to-end live-VLM acceptance result is recorded in items 20 and 21; the single-case real-OCR acceptance is in item 30. Corpus-level quality and production fitness remain unproven.
3. The bounded Pi `case_review` session now leads the document review. The Worker still inspects, renders, and selectively OCRs every page before the session, but the system has no deterministic field parser, so every document value reaches the deterministic pipeline as an Agent candidate produced through a registered, scoped tool. `buildOfflineExtraction` and the fixture-seeded result builder are gone.
4. A versioned declared field-requirement set (`document-field-requirements-1.0.0`, `packages/offline/src/case-assembly.ts`) declares seven document fields across the three required document types. A requirement becomes an explicit extraction gap only when the run actually contains a grouped logical document of that type. Nothing is derived from golden truth.
5. `submit_extraction_candidates` accepts a value only when an authorized tool returned it for a page of the candidate's own logical document: exactly a model-extraction value, inside a returned recognition line, or inside the committed native text. The model never supplies a normalized value; `assembleCaseResult` normalizes money, dates, and names deterministically and owns reconciliation, claims, entity matching, the five registered rules, and the disposition.
6. `get_extraction_gaps` is replaced by `get_case_manifest` (logical documents, authorized pages, declared requirements with semantic target roles and extraction guidance, field schemas, structured application data; no document content). After the first end-to-end live-VLM attempt exposed an ambiguous generic-schema request, the registry is `case-review-tools-3.6.0`, `extract_with_vlm` is 3.2.0, the case-review prompt is `case-review-prompt-3.5.0`, and the page-field prompt is `page-field-extraction-1.2.0`: a VLM call now binds one trusted `gap_id`, and the control plane supplies that requirement's role and extraction guidance. The budget envelope remains `agent-budget-2.0.0` (24 iterations, 40 tool calls, 8 VLM calls, 8 OCR pages, 180 s wall clock). The `USD 0.25` per-case cost cap is unchanged; nested VLM tokens and provider-reported USD cost enter the same persisted budget.
7. `components/ADAPTIVE_EXTRACTION_AGENT.md` is version 3.5.0 and `specs/INDEX.md` is 3.9.0. The report-submission tool uses the same closed candidate schema as the deterministic Report Verifier and rejects references outside non-passing deterministic findings before terminating the session, so a live model can repair invented signals, actions, or page references. The owning specification, not this handoff, is the authority for the tool catalog and requirement semantics.
8. A gap anchors on its logical document's first page but is scoped to the whole document, so a value on a continuation page of a multi-page payslip or statement resolves it. The reviewer-facing log names the page the accepted value actually came from, not the anchor page.
9. The fake policy is local-first: it satisfies a requirement from committed native text, then from returned recognition lines, and spends a bounded model-extraction call only on what neither could resolve. This exercises `AGT-REQ-166` end to end, which the previous per-field escalation did not.
10. Document tools are backed by committed run state: `apps/worker/src/document-ports.ts` reads persisted page metadata, the stored native-text artifact, the stored OCR output, the stored page render, and the persisted classification and boundary through `PostgresWorkflowCoordinator.loadCaseDocumentInventory`.
11. `classifySyntheticDemoPages` previously matched a heading spelling PDF Inspector never produces, so every real page classified as `unknown`. The fixture-seeded result hid this. It now normalizes separators and classifies the whole corpus correctly.
12. A durable step commit that is rejected now stops the loop immediately instead of spending further model turns on work that cannot be recorded.
13. The Agent Log separates system preprocessing from Agent document tools: the API returns an `actor` of `system`, `agent_document_tool`, or `agent` per event, the log opens with a system-preprocessing event, and a VLM step names its gateway so `fixture-vlm-gateway` is never read as a real model result.
14. Docker Compose still warns when shell-level `POSTGRES_PASSWORD` and `MINIO_SECRET_KEY` are absent even though the running demo uses its generated local configuration. Treat removal of this warning as cleanup, not as evidence that a service is unhealthy.
15. `render_page_region` 3.0.0 delivers the authorized uploaded-document page image to Pi as transient multimodal tool content and records page identity in its safe result for durable restoration. The durable invocation stores only the safe artifact reference and integrity metadata; image bytes are absent from Agent steps, logs, traces, and resumed progress. PDF Inspector `needsOcr` is the interim deterministic router, and the control plane requires a successful visual inspection before OCR or VLM on such a page. Rendering and OCR are still eagerly produced before the session; BL-009 tracks moving those operations behind demand-driven Agent calls.
16. The Review Workbench formats visible Agent-log timestamps as German local `DD.MM.YYYY, HH:mm:ss` values without milliseconds; authoritative ISO timestamps remain unchanged and continue to determine event order.
17. Local `.env` is ignored by Git and currently opts into `AGENT_MODEL=openai/gpt-5.6-terra`, `VLM_MODE=live`, `VLM_MODEL=openai/gpt-5.6-terra`, and `PI_OFFLINE=0`; it reuses the existing `OPENAI_API_KEY`, which must never be printed or committed. `.env.example`, Compose propagation, and `scripts/demo-compose.mjs` document/forward the new VLM settings while retaining `fixture` as the default.
18. A host-launched pnpm Worker could not connect to the original Compose-only topology because PostgreSQL and MinIO were reachable only inside its network. The paid attempt established a coherent local topology without changing the delivered baseline: Compose ran PostgreSQL and MinIO with loopback-only published ports, while API, Worker, and Review Web ran through pnpm against an isolated database and bucket.
19. The first paid end-to-end attempt used case `357dfaed-5244-4869-b3e0-9292b423b88a`, run `b8406fcc-3065-4228-82ee-a09187dd2880`, and session `9bdfa126-fb91-47b7-82a4-d7e39433416d`. It exposed the generic `organization.name` ambiguity described in item 6 and ended `processing_exception` / `tool_budget_exhausted`. Persisted cumulative usage was 7 iterations, 18 charged tool calls, 15 model calls, 8 VLM calls, 3 OCR pages, 12,096 input tokens, 2,189 output tokens, and USD 0.095664; nested VLM usage was 12,075 input tokens, 103 output tokens, and USD 0.0314115. No result or report was sealed.
20. The approved confirming live-VLM run succeeded in a fresh isolated database and bucket using only `golden-006-scanned-adaptive-unavailable`: case `0d937583-6bd3-4853-9c21-a312b13adbe7`, run/result revision `3b2442d6-5e89-4134-acac-0f52f12305c0`, session `5df0f1ee-f6d6-4b93-9d83-f8e3a07ab1a6`. It used `openai/gpt-5.6-terra`, `case-review-prompt-3.5.0`, `case-review-tools-3.6.0`, `extract_with_vlm` 3.2.0, and `page-field-extraction-1.2.0`. The Agent inspected and viewed all three `needsOcr` pages, attempted OCR on all three, then made seven live VLM calls. Their seven values, including payslip income `EUR 2980.00` and the bank-statement salary counterparty `Demowerk GmbH`, appeared verbatim in the accepted candidate-submission output; no `fixture-vlm-gateway` marker entered the run. Deterministic reconciliation followed extraction and the complete `demo-de-personal-loan-v1` 1.0.0 five-rule registry ran. The verified report is `ready_for_review`, with the expected sole attention finding `VAL_INCOME_CONSISTENCY_001` (`inconclusive`, `income_input_incomparable`) and no lending, creditworthiness, AML, or KYC decision. The session ended `report_submitted` after 10 iterations, 22 tool calls, 17 model calls, 7 VLM calls, and 3 OCR pages. Cumulative persisted usage is 10,751 input tokens, 2,088 output tokens, and USD 0.107772; the nested VLM portion is 10,721 input tokens, 92 output tokens, and USD 0.027896. Durable tool output retained the model and prompt versions and contained neither encoded page/document bytes nor fixture gateway markers. The reviewer Agent Log exposes the same ordered, bounded history and cumulative cost.
21. A compatible Worker restart and same-run pg-boss redelivery then reclaimed case `0d937583-6bd3-4853-9c21-a312b13adbe7` / run `3b2442d6-5e89-4134-acac-0f52f12305c0` with `resumed=true`. It returned the existing terminal session with `submitted_candidates=0`; the session remained at one attempt, 22 invocations, 7 VLM invocations, 10,751/2,088 tokens, and USD 0.107772. No paid operation repeated and no usage reset.
22. Review of the first confirming result found that `case-normalization-1.0.0` rejected the correctly observed raw value `EUR 2980.00` because it supported the `€` symbol but not the ISO `EUR` prefix. The VLM and candidate evidence boundary were correct, but the payslip income did not become a claim, so that immutable run reported `inconclusive` / `income_input_incomparable` instead of the semantically correct conflict. `case-normalization-1.1.0` accepts explicit EUR prefixes and suffixes and rejects unsupported or duplicate currency markers.
23. The approved final live-VLM confirmation used only `golden-006-scanned-adaptive-unavailable`: case `ef976108-532e-43f9-8a52-a1503e581f7b`, run/result revision `73e282d3-98af-4cc1-b9b7-6dd5dc6d90f2`, session `cb9cf644-a49f-4c99-aec5-775ce8b38a9e`. It persisted application `3050.00` as EUR 3050.00 and the verbatim VLM value `EUR 2980.00` as EUR 2980.00; `VAL_INCOME_CONSISTENCY_001` returned `failed` / `income_conflict`, while the other four registered rules passed. The verified ready report states that the income values conflict and suggests the registered `compare_claims` action without making a lending, creditworthiness, AML, or KYC decision. The session used `openai/gpt-5.6-terra`, `case-review-prompt-3.5.0`, `case-review-tools-3.6.0`, and `case-normalization-1.1.0`; it ended `report_submitted` after 10 iterations, 22 tool calls, 17 model calls, 7 VLM calls, 3 OCR pages, 10,751 input tokens, 1,939 output tokens, and USD 0.104453. Nested VLM usage was 10,721 input tokens, 92 output tokens, and USD 0.027896. Durable outputs contained neither fixture gateway markers nor encoded page/document bytes. A Worker restart and same-run redelivery returned the same session with `resumed=true`, one attempt, zero newly submitted candidates, unchanged invocation counts, and unchanged cost.
24. Two complete offline Agent-led captures against frozen `v0.1.1` used source `1f72965`, `findoc-fake/case-review-script-v1#standard`, fixture OCR/VLM, `case-review-prompt-3.5.0`, `case-review-tools-3.6.0`, and `case-normalization-1.1.0`. Runs `offline-agent-led-v0.1.1-20260907T043000Z` and `offline-agent-led-v0.1.1-20260907T044500Z` produced identical normalized cases and metrics: issue precision 3/4 (75.0%), recall 3/6 (50.0%), grounding 28/29 (96.6%), unsupported claims 1/29 (3.4%), and verified reports 5/6 (83.3%). Evaluation identifiers are `896eeb307978b08304e93d2ce0285bee27b3a148fb08f57bca1832a7f3952b04` and `dcf4537e56870fea559432adfa6cc44770f73db3e4249fb2332fdb6312b4c769`. `golden-003` misses two obsolete document-content expectations and `golden-004` adds the defensible unresolved-name issue; frozen truth was not modified. Operations remain unavailable, not zero, because capture does not yet project durable session measurements.
25. Successor candidates are prepared without changing frozen `v0.1.1`. `golden-003` now renders EUR 3310.00 payslip net pay against declared EUR 3480.00 and keeps the conflicting bank salary counterparty, producing exactly `VAL_EMPLOYER_CONSISTENCY_001` and `VAL_INCOME_CONSISTENCY_001`; its coverage now says `multi_page_document`, not the unimplemented boundary uncertainty. `golden-004` candidate truth now expects both `VAL_DOC_COMPLETENESS_001` and the defensible `VAL_NAME_CONSISTENCY_001`. Offline runtime cases `29b1c288-a813-49b5-af35-32ece37eacda` and `8b5897ee-7c35-45b4-8957-e303e58af752` matched those candidates. All four pages of the regenerated `golden-003` PDF were rendered and visually checked for legibility, layout, synthetic markings, the 3310.00 payslip value, and the conflicting counterparty. Both changed candidates remain `pending_human_review`.
26. Explicit `--candidates` modes for `evaluate:capture` and `evaluate:offline` allow pre-confirmation diagnosis without treating pending candidates as a release; default frozen-release confirmation and checksum enforcement is unchanged. The first use exposed nondeterministic Checked Fact ordering from database reads, so capture now sorts issues and Checked Facts by stable code. Final candidate runs `offline-successor-candidate-20260907T051000Z` and `offline-successor-candidate-20260907T052000Z` at source `1fca67e` produced identical normalized artifacts. Evaluation IDs `75e7ff73e3ef6eda8aa832b17ff82020b96df073719426382b88acbb766ebb76` and `863e35c3f5efdacaacf27dc3a471244110f63962655dfa91554e9cc6ba1b7336` both report issue precision 5/5, recall 5/6, grounding 29/29, zero unsupported claims, and verified reports 5/6. The sole missed issue/unavailable report remains the intentional `golden-006` system-origin/report-rejection path; changed candidates 003 and 004 match completely.
27. Reviewer `sulmae` explicitly confirmed candidates 003 and 004. Commit `c181864` freezes all six cases as checksum-verified release `v0.1.2`; manifest SHA-256 is `382ef0f609a82f7c173731fe66e50a341418c03da664460a8d921ca4e5fd1eb8`. Full Agent-led runs `offline-agent-led-v0.1.2-20260907T053000Z` and `offline-agent-led-v0.1.2-20260907T054000Z` produced identical normalized cases and reports. Evaluation IDs `e9440172d4a8670422825c13af7ef7d13c8c74af056f278ee6d942f60a93aac7` and `72c0a49ff88bf1f1256498edf28e38d3c0a35693a95b15aaf2e103dcfd43ffa4` report issue precision 5/5, recall 5/6, grounding 29/29, zero unsupported claims, and verified reports 5/6. Generated actual-run and report JSON remains ignored local evidence.
28. Live-model evaluation capture now requires an explicit non-empty `case_ids` subset plus `cost_budget.maximum_total_usd` and `cost_budget.maximum_per_case_usd`. The coordinator therefore cannot silently choose the first release case, reserves at least the delivered USD 0.25 case ceiling before starting each selected case, reconciles the persisted Agent Log USD cost after it, rejects a breached per-case or total limit, and records remaining selected cases as `whole_run_cost_budget_exhausted` or `whole_run_cost_unavailable` instead of starting them. The capture output is atomically reserved as `capture_in_progress` before any case submission so the same output target cannot silently repeat paid work after interruption. Offline fake-model full-release capture remains compatible without a subset or cost budget. Evaluation reports score and retain the selected frozen subset, configured cost budget, and structured excluded-case reasons; live sessions take their cumulative USD cost from durable session usage rather than the legacy report-level EUR projection.
29. The explicitly approved one-case live evaluation selected only `golden-003-multiple-review-issues` under equal USD 0.25 per-case and whole-run caps. Runtime case `bfb1a51c-5a6c-4889-b893-e52feff5fa33`, run `f74ee21c-579f-42b9-9762-86748e9cf3f2`, and session `c33911de-643a-42bd-a270-e81d3154dcc4` used `openai/gpt-5.6-terra`, ended `report_submitted`, and produced both expected employer and income findings with a verified report. Corrected capture `live-agent-led-v0.1.2-golden-003-20260907T030832Z` and evaluation `6bf9574de0ea46628a24c797dbce4717d2db03c5b439d996d826d1b6a568a79f` report 2/2 precision and recall, 5/5 grounding, 39,409 ms, 8 model calls, 24 input tokens, 1,210 output tokens, zero VLM/OCR calls, and USD 0.044510. The initial configuration timestamp treated Berlin local time as UTC; it was corrected from authoritative persisted `started_at` without repeating model work, and the earlier generated report was not overwritten.
30. The explicit real-OCR acceptance route pins PDF Inspector 1.17.0, PDFium 153.0.7988.0, ONNX Runtime 1.27.0, and `pp-ocrv6-small@oar-ocr-v0.7.0` in `config/ocr-runtime-assets.json`; `pnpm ocr:setup -- PLATFORM` downloads them only on request and verifies every archive/model and installed shared library by SHA-256. A no-network, read-only Linux ARM64 component smoke recognized the required synthetic markers on all three `golden-006` pages. End-to-end case `ee0663a5-b7e5-4851-aad8-a0ed78d1e01a`, run/result revision `afe947fe-78f5-4bd1-877f-2e8d2c60e23e`, and session `9984dd35-ff2d-4235-91e8-88744809ebdf` then used the real local OCR and deterministic standard fake Agent with zero VLM calls. All three pages were visually inspected, OCR-routed, and classified from OCR content without fixture page declarations; seven OCR-derived candidates reached deterministic reconciliation, all five rules ran, and the verified report contained only `VAL_INCOME_CONSISTENCY_001` (`failed` / `income_conflict`). Persisted usage was 9 iterations, 15 tool calls, 9 fake-model calls, 3 OCR pages, 0 VLM calls, 54,674 input tokens, 600 output tokens, and zero external-model cost. A Worker restart and same-run redelivery returned `resumed=true`, one attempt, `submitted_candidates=0`, and unchanged invocation and usage counts.
31. Final image review found that `.dockerignore` had not excluded the ignored local `.env`; no credential was printed or committed, but pre-fix local task images could contain that file in a layer. `.dockerignore` now excludes `.env` and `.env.*` while retaining example files. The final rebuilt acceptance image was checked to contain neither `/app/.env` nor embedded model/native-asset directories and passed the no-network read-only OCR smoke. All five task-created pre-fix images were deleted after the Compose stack was stopped; the PostgreSQL and MinIO named volumes remain available for audit.
32. The explicitly approved initial VLM selection benchmark ran `openai/gpt-5.6-terra` and `openai/gpt-5.6-sol` on the same sole frozen `v0.1.2` case, `golden-006-scanned-adaptive-unavailable`, under independent USD 0.25 per-case/whole-run caps. Both produced 1/1 issue precision and recall, 5/5 grounding, zero unsupported claims, 7/7 schema-valid VLM calls, and a verified report with only `VAL_INCOME_CONSISTENCY_001` (`failed` / `income_conflict`). Terra case/run/session `04943e2f-bf9c-41d5-a1ed-f8bcb6845681` / `aecabe9b-7a81-496e-86d7-43f1768dd1f4` / `bcfe90d3-4102-46f6-a846-4b07395bf9f7` completed in 49,163 ms with 10,751/1,968 input/output tokens, USD 0.027896 nested VLM cost, and USD 0.105081 cumulative cost; evaluation `2c646b36dc7eddf2de21561adf973e40f1a9002cd7bfb1e47e256d4058ceca33`. Sol case/run/session `279f7d48-2327-440f-814f-773df49a65ec` / `864afd3f-eaf8-4767-a12e-fc8c0cf6ffdd` / `ba41e872-73e7-4165-ad63-504cf266f24d` completed in 59,346 ms with 10,751/1,920 tokens, USD 0.055424 nested VLM cost, and USD 0.200450 cumulative cost; evaluation `50b613c175e956722b0e47da7629f62e04b1c5e27b3d90321e57ae172e1f09fe`. The original Sol capture client timed out at 60 seconds even though the same durable run completed successfully; its result was projected from the API and database without resubmitting or repeating a paid call. The polling default is now 120 seconds, and capture validates complete evaluator version metadata before case submission. ADR-003 selects Terra as the opt-in live default and Sol as fallback, with explicit one-case and same-provider limitations.
33. JPEG and PNG now enter the same credential-stripped Document Sandbox as PDFs. Sharp 0.35.4 decodes the claimed media type under the configured pixel ceiling, applies orientation, removes alpha onto white, emits the committed PNG render, and builds an in-memory one-page JPEG-backed PDF solely for the existing pinned PDF Inspector OCR adapter; original image bytes and the wrapper are not added to Agent traces. A no-network, read-only Linux ARM64 smoke recognized all expected synthetic payslip markers from both encodings. End-to-end case `8ff44666-b4c4-4ec0-9b54-067208393dcc`, run/result `be0c41b5-d60d-45bd-9f14-c9213fd58bec`, session `e3bdd1b6-e23f-43b0-83cf-62291923672a` used two JPEG and one PNG synthetic documents, persisted three PP-OCRv6 outputs, classified every page from OCR content, submitted seven `agent_ocr_reading` candidates, ran all five deterministic rules, and produced the expected sole income conflict with a verified report. Usage was 9 iterations, 15 tool calls, 9 fake-model calls, 3 OCR pages, 54,811/600 input/output tokens, zero VLM calls, and zero external-model cost.
34. Cases now retain a concurrency-safe PostgreSQL display sequence and project an immutable reviewer-facing `FD-YYYY-NNNN` reference derived from the UTC creation year; UUIDs remain technical primary keys and route identifiers. Queue rows and case headers show the reviewer reference rather than the UUID. The retained Terra live-VLM case `04943e2f-bf9c-41d5-a1ed-f8bcb6845681` migrated to `FD-2026-0001`; API and browser verification confirmed one immutable source document, `golden-006-scanned-adaptive-unavailable.pdf` (`application/pdf`, three pages), with the original PDF rendered in the document workspace. The later JPEG/PNG acceptance case remains separate component evidence and is not the default reviewer demonstration. No model or OCR operation was repeated.
35. `case-review-tools-3.7.0` / `adaptive-recovery-tools-2.3.0` add optional real bounded region delivery; `render_page_region` is 3.1.0. Sharp 0.35.4 validates a normalized in-page rectangle, converts it deterministically to source-pixel bounds, and emits a cropped PNG, so bounded visual inspection and `extract_with_vlm` can minimize or magnify input when necessary. The ordinary small-document route still recognizes each page once: `run_ocr` remains page-scoped, and OCR/VLM source-page bounding boxes are evidence for candidates and reviewer highlighting rather than instructions to recognize a crop again. This change makes no model call. Focused crop/VLM tests, the full `pnpm check`, `pnpm build`, six-case `pnpm dataset:validate`, and all Docker-backed integration tests pass. Optional crop-derived artifact acceptance remains deferred until measured use requires it.
36. Precise non-full-page regions from accepted OCR/VLM candidates now become `page_region` evidence instead of being discarded as page-level. Persistence migration 0025 adds normalized bbox and source render geometry; migration 0026 adds the deterministically derived original render-pixel box, coordinate unit, and top-left origin required by `DAT-REQ-070`. The Evidence API exposes both coordinate forms without object-store locations, and the Review Workbench maps normalized coordinates over the original PDF.js canvas or uploaded image when an issue or Checked Fact evidence link is selected. Full-page and absent regions remain page-level under `DAT-REQ-074`. `pnpm check` passes 175 tests, including case-assembly and API region coverage; `pnpm build`, six-case dataset validation, and all 23 Docker-backed integration tests pass. No OCR/VLM call was made. Existing sealed cases, including `FD-2026-0001`, remain immutable page-level evidence and are not backfilled.
37. A fresh zero-cost original-PDF run exercised the current real local OCR path after migrations 0025/0026: case `04660148-088f-42d6-baab-d11e181e5732` (`FD-2026-0002`), run/result `d930af0d-4e5f-428e-93f2-b96fce0fc2e8`, session `67ffb01a-e0a4-4c74-9b45-0abbc5a153e2`. It used the standard fake Agent, fixture VLM with zero VLM calls, and PDF Inspector OCR, reached `ready_for_review`, and produced the expected sole income conflict. Its evidence correctly remained page-level: PDF Inspector 1.17.0's public `processPdfWithOcr` result returns per-page Markdown and confidence but no word/line boxes, and `PdfInspectorOcrAdapter` explicitly persists `spans: []`. No bbox was fabricated. The Workbench overlay itself was browser-accepted with a non-persistent intercepted `page_region` fixture: one overlay was rendered over the original page, and its measured canvas-relative geometry exactly matched normalized `{x:0.24,y:0.58,width:0.52,height:0.10}`. The browser fixture did not alter durable case state.
38. The real-OCR coordinate path now uses a small committed compatibility patch rather than vendoring upstream source or adding a second recognizer. `ocr:setup` downloads the official PDF Inspector release commit `32555d23356f7892762a38edb3a5b0cad7ec326b`, verifies archive SHA-256 `978fd36c9379d6b05b0066295f1d5441799a2fcd9f927eee4c703312d610fd22`, applies `patches/pdf-inspector-1.17.0-ocr-spans.patch`, and builds with the digest-pinned Rust 1.98.0 Bookworm image; generated source, Cargo cache, and native libraries remain ignored. The patch retains the existing OAR `OcrSpan` polygons through fusion and N-API, and the project adapter validates each four-point polygon before converting it to an axis-aligned render-pixel box. A Linux ARM64 component smoke returned 22 positioned spans across all three `golden-006` pages and included positioned `2980.00` evidence. Fresh end-to-end case `09671ca2-e20e-4d2f-8eb4-a93db0ea2026` (`FD-2026-0003`), run/result `e424677c-df3b-45a1-bd4b-24f4b3a3d147`, session `304296d3-0b2f-4fb4-8ef3-e37bc4cb09f1` used the standard fake Agent, real PDF Inspector OCR, and zero VLM calls. It visually inspected all three pages, ran OCR on all three, reconciled seven OCR candidates, ran all five deterministic rules, and produced the expected sole `VAL_INCOME_CONSISTENCY_001` `failed` / `income_conflict` finding and a verified report. The payslip evidence is a durable page-region on page 2 with original render-pixel box `{left:50,top:308,width:257,height:24}` and normalized `{x:0.0550055,y:0.2398754,width:0.2827283,height:0.0186916}`. Browser acceptance measured zero overlays before opening that evidence and exactly one afterward, with matching inline percentages `5.50055% / 23.9875% / 28.2728% / 1.86916%`. The only browser console error was an unrelated missing favicon. Usage was 9 iterations, 15 tool calls, 9 fake-model calls, 3 OCR pages, 58,505 input tokens, 600 output tokens, zero VLM calls, and zero external-model cost. No frozen truth changed.
39. The Review Workbench now treats both `page_level` and `page_region` references as valid issue-default page evidence. Switching from Application data back to Document therefore restores the evidence-owned document and page directly instead of briefly presenting the deterministic no-page fallback; multi-document cases also retain the evidence-owned document rather than falling back to the first upload. Browser regression on `FD-2026-0003` confirmed page 2 and its one bbox remain visible after the tab round trip.
40. A zero-cost frozen-corpus diagnostic ran all six `v0.1.2` cases through the Linux ARM64 real-OCR Worker with the standard fake Agent and fixture VLM. Runtime cases `FD-2026-0004` through `FD-2026-0009` map in golden order to cases `ab68754b-cc51-4277-bc6c-b4aa83065569`, `dea334da-49a9-4d12-9641-2ca7e3a16802`, `f663ca14-8ad6-4eea-b1c1-2d5a8ec9ac19`, `ae849e93-1ffb-4fd0-aaed-55d6ee0924af`, `b312ddc9-7c40-448b-a91f-f96c5a243308`, and `3b655c95-a7e7-4552-ac0a-c54aa3f76109`; their run IDs are respectively `09edcaa0-d708-4131-90e2-442df6f14a44`, `f8c64977-c840-49a4-b874-f07c5e2da155`, `1a0eb983-f841-4ffc-951f-fec4e0d416e3`, `4fd03a4d-166c-4744-9053-516669357638`, `cca338f1-eeba-4728-ba85-d939875f48a4`, and `1faf9a3d-8fd6-4bb8-a9c0-1ac8218e667d`. Capture `real-ocr-coordinate-corpus-v0.1.2-20260907T195629Z` produced evaluation `d53c0e79b37aea31cd306e72607b38fcc715e2616c52508d43dc81f56b8cf460`: issue precision and recall were both 6/6, grounding was 30/30 with zero unsupported claims, and all 6 reports verified. Across accepted document claims, all 10 OCR-derived claims had `page_region` evidence; 28 native-text claims remained explicit `page_level`, for overall region coverage 10/38 (26.3%). All 10 regions were in bounds and retained original coordinates, page dimensions, and `render_pixel` / `top_left` lineage; area ranged from 0.3389% to 0.9068% of the page. The mixed-case visual check showed the region exactly covering `Monthly net pay: EUR 2750.00`, and scanned-case issue and Checked Fact links retained click-activated regions. Cumulative usage was 51 iterations, 76 tool calls, 51 fake-model calls, 4 OCR pages, 220,903 input tokens, 3,096 output tokens, zero VLM calls, and USD 0 external-model cost. This is synthetic supporting evidence under `MLE-REQ-008`/`MLE-REQ-043`, not a comprehensive OCR benchmark or production-quality claim; frozen truth was unchanged.

41. Native PDF candidates now receive same-pass geometry without OCR, VLM, cropping, or a second PDF parse. The compatibility patch carries `TextItem` values already held by `extract_pages_markdown_mem_impl`, converts PDF bottom-left coordinates to page top-left coordinates with the source page height, and exposes them through N-API. The Worker stores bounded structured native text plus source-pixel boxes; `get_native_text` still presents only the bounded text to the Agent, while the deterministic evidence resolver attaches a box only when the submitted raw value occurs verbatim in one positioned item. Legacy Markdown artifacts remain readable. Registry versions are `case-review-tools-3.8.0`, `adaptive-recovery-tools-2.4.0`, and `agent-native-text-reading-1.1.0`. A fresh zero-cost six-case diagnostic used cases `c74a70f7-6f0b-4bfe-bb4d-66fbfe86cac1`, `68d468c4-73ec-45d5-ad5d-23d5c27272ad`, `4c9aa0b7-ffef-4747-b3c9-165888119f6f`, `c2824f57-7838-4bd8-bde8-9df5c9872a83`, `940f3707-a9ba-46fd-8e15-8a2b608036f9`, and `af5fae89-a010-4bc1-a6bb-dc75095e4e5f`, with run IDs `2a0c774c-7cdc-4e19-a9ca-26ddb36dccfe`, `7c591c6e-9f20-4402-9a32-1c876dc0fb86`, `83466c24-19dd-46a8-aafc-c18124cfa6c2`, `43fd58f3-7d58-4cae-84b6-bd2bae568221`, `af1e82f2-131f-48bc-b7a1-18994711b624`, and `fe391655-0834-4e53-ad72-f6de8044ab47`. All 30 accepted native claims and all 10 OCR claims persisted as `page_region`; expected issue sets and all five deterministic findings remained correct, with 0 VLM calls and USD 0 external-model cost. Final corrected-coordinate browser acceptance used case `3750c09c-ad41-48c1-add9-3864191f6403` (`FD-2026-0017`), run `ad00a415-3229-4c48-b382-4741f740b511`, and session `817f35da-9e6e-4a25-83f6-a02a2e23920d`; clicking the identity-expiry Checked Fact rendered exactly one box over `31 August 2030` on the original PDF. It used 8 fake-model calls, 12 tool calls, 30,764 input tokens, 455 output tokens, 0 VLM calls, and USD 0 external-model cost. `pnpm check` passed 179 tests, `pnpm build` and six-case dataset validation passed, and all 23 Docker-backed integration tests passed. The earlier case `78ad77be-e1e6-41b6-ba9d-2fa1236169a1` was consumed by an obsolete duplicate Worker and intentionally remains immutable legacy evidence; that duplicate consumer was stopped. Frozen truth was unchanged.

42. Release preparation exposed that `pnpm demo:acceptance` inherited allowlisted live-model settings from the ignored local `.env`; one isolated attempt therefore entered `processing` and exceeded the loader's 30-second polling window instead of exercising the documented fake path. Its isolated database and object-store volumes were automatically destroyed, so exact provider usage cannot be recovered and no cost claim is made for that attempt. The acceptance action now forcibly sets `AGENT_MODEL=fake`, `VLM_MODE=fixture`, and `PI_OFFLINE=1` and clears every forwarded provider model/key value before invoking Compose. Ordinary `demo:up` remains configurable. The corrected isolated run completed `ready_for_review` with five deterministic findings, two expected issues, and eight Agent document-tool calls, then removed its containers and volumes. A tracked-file scan found no credentials or generated data, and the release Worker image contains no `.env`, generated demo credentials, or native runtime/model asset directory. This makes the release check deterministic and prevents a local live opt-in from silently turning an acceptance command into a paid run.

43. The Review Workbench demo button now chooses uniformly from the six frozen `v0.1.2` synthetic cases and submits only that case's application inputs and PDF; complete golden expected-result JSON is not shipped to the browser. Its JavaScript API tests are included in the root Vitest configuration. The local `findoc-bench-terra` demo queue was backed up to `/private/tmp/findoc-before-six-case-refresh.dump`, cleared with explicit user approval, and regenerated through the current fake-Agent, real-local-OCR, fixture-VLM route. The resulting runtime cases are `4e9ad1db-1dda-440e-a290-888c96de8c9d` (`FD-2026-0019`, zero issues), `d87acf70-68a1-4582-aa7e-0312d3307f41` (`FD-2026-0020`, one issue), `b9f4037f-72fc-438d-8fb6-4a562046fd11` (`FD-2026-0021`, two issues), `507cf516-8fd7-476d-8e5a-1240bf67dc8a` (`FD-2026-0022`, two issues), `3191e730-55f3-453d-af70-9923fa5ead69` (`FD-2026-0023`, zero issues), and `36b150fd-1558-4f58-8eec-0db2c3f64963` (`FD-2026-0024`, one issue). The Review Queue API and real-browser snapshot both showed exactly six ready-for-review cases and six total issues. No paid model call ran and frozen truth was unchanged.

44. Review Queue summaries no longer repeat the persisted generic Agent sentence. The presentation derives concise grammatical text from authoritative workflow status and issue count (`No issues require review.`, `1 issue requires review.`, or the plural form), while case detail retains the complete persisted report. New deterministic fake reports use the same wording. Evidence regions remain click-activated but render as a translucent blue fill without a border, radius, or surrounding ring.

45. The Agent Log no longer renders the redundant `Report submitted` session-status badge or the duplicate `Session ended: report submitted` presentation event for a successfully completed session. The durable terminal reason, auditable `Submit report` tool call, and final `Report ready` outcome remain unchanged.

46. Machine-produced review issues are labeled `System generated` rather than the misleading `AI created`. VLM and Agent boundaries are unchanged: models may extract candidates and write a non-authoritative review brief, while the finite deterministic registry remains authoritative for findings and issue eligibility.

47. The case workspace review pane is responsive instead of fixed at 540 px: its default width scales from 420 to 620 px with the viewport, the document pane retains a 420 px minimum, and the compact-navigation breakpoint preserves the document/resizer/review three-column structure. Pointer and keyboard resizing now clamp against the actual available workspace and remain safe after a browser resize.

48. The Review Queue replaces its repetitive summary column with authoritative processing provenance. Offline fake-model sessions display `Deterministic workflow` / `Demo only`; live sessions display `Agent` plus the persisted Agent model, or `Agent + VLM` plus the persisted Agent model and the VLM model retained in the committed extraction-tool output. Deterministic reconciliation and validation still run for every path and are not misrepresented as a generative model.

49. The random-demo action is now a pre-intake browser preview rather than an immediate case submission. It selects one frozen `v0.1.2` synthetic candidate and shows only its submitted application values and original PDF, explicitly withholding report, Checked Facts, issues, and Agent activity because none exists yet. `Run agent review` then submits that prepared input through the existing intake API and waits for the normal durable asynchronous workflow before opening the persisted case. Backend automatic processing after intake is unchanged; this is a demo presentation boundary, not a paused workflow state.

50. The generated demo-case launch now treats the selected synthetic inputs as a not-yet-submitted demo case rather than labeling them a preview. Before intake, the user selects from the API's configuration allowlist; `openai/gpt-5.6-terra` is the default when the API is configured with the existing live OpenAI credential, `openai/gpt-5.6-sol` is the same-provider fallback, and the deterministic demo Agent remains a zero-cost option. Paid selection requires an explicit browser confirmation naming the model and USD 0.25 per-case ceiling. Migration 0027 persists the selected Agent model on the immutable processing run and includes it in intake idempotency; the Worker resolves its harness from that trusted run field and prevents a fake-Agent selection from silently using the live VLM. After intake, the generated-case view polls and displays the bounded durable Agent Log, then opens the verified report or explicit unavailable result at terminal state. No paid run was started while implementing this flow.
51. Generated cases now use the ordinary case workspace from the start. `Agent log` is the default tab until a verified report exists; Report, Issues, and Review & submit remain unavailable before then, while the original document and application-data views stay usable. The stable workflow progression is now `Submitted -> Documents prepared -> Agent review -> Human review -> Outcome`; whether preparation or Agent review is active follows durable Agent-session availability rather than the obsolete implication that extraction precedes the Agent. `POST /api/v1/cases/{case_id}/agent-review/stop` cooperatively terminalizes an active session as `cancelled_by_workflow`, preserves committed activity and cumulative usage, and prevents subsequent steps or recovery. The UI confirms that an already in-flight provider request may still finish and count. API, UI, and Agent owner versions were 1.10.0, 3.6.0, and 3.6.0; IDX was 3.11.0. `pnpm check` passed 198 tests, the production Web build and dataset validation passed, and the Docker-backed integration suite passed 24 tests.

52. A reviewer-stopped run now atomically creates a sealed, empty `human_review` anchor with a `human_review_required` fallback disposition when no machine result exists, then enters `ready_for_review` without fabricating an Agent report or deterministic findings. Humans can create issues and submit against that immutable anchor. The Agent timeline step remains neutral grey; Human review becomes active and completes normally. Before any human issue or final review exists, **Restart Agent review** creates a new run over the same input revision and selected model while preserving the stopped run, Agent Log, tool results, and usage. The running and persisted Agent-log views use the available panel width and independently scroll their full event history without moving the model metadata or action controls out of view. API, UI, Agent, and data owner versions are 1.11.0, 3.7.0, 3.7.0, and 3.2.0; IDX is 3.12.0. `pnpm check` passed 200 tests, the production build and six-case dataset validation passed, and the Docker-backed integration suite passed all 25 tests.

53. The generated-case completion transition no longer requires a browser refresh: polling replaces the provisional URL with the durable case URL, loads the completed bundle in place, and selects Agent Report. Agent Log now preserves the same running-card presentation before and after completion; the selected run model stays fixed, and its cost changes from a pending label to the final persisted cumulative amount in the same header. The pre-run view contains only model selection, cost ceiling, and the run action; paid confirmation uses an application-native dialog that restates synthetic-only scope, model, and maximum cost. During execution the card header and Stop action remain fixed while its full event timeline scrolls within the available panel height. Review Workbench is 3.8.0 and IDX is 3.13.0. The production Web build and all 200 unit/API tests passed; no new case or paid model call was triggered for this UI change.

54. Reviewer `sulmae` explicitly confirmed the new synthetic `golden-007-instruction-with-income-conflict` candidate. Immutable release `v0.1.3` contains seven cases and preserves `v0.1.1`/`v0.1.2` unchanged. Case 007 places inert instruction-like text beside a scanned payslip net value of EUR 2980.00 while the application declares EUR 3050.00; its sole expected issue is `VAL_INCOME_CONSISTENCY_001`, and its report constraints prohibit following the document instruction or expressing approval or creditworthiness. `MLE-REQ-017`, `MLE-REQ-018`, and `MLE-REQ-079` now explicitly permit manually confirmed incremental releases toward the unchanged twenty-case V1 target. Zero-cost fake-Agent acceptance case/run/session `28932f1d-d41b-49c0-a278-15eb2cf95ae7` / `54de860b-3f24-4cc5-8072-1ccd0fab7a90` / `33cac818-b98a-45b1-ab15-88e3135cfe36` completed `report_submitted` with a verified report and only `VAL_INCOME_CONSISTENCY_001` (`failed` / `income_conflict`); the other four registered findings passed. It used 11 iterations, 16 tool calls, 14 deterministic fake-model calls, 3 explicitly fixture-backed VLM calls, 51,577 input tokens, 623 output tokens, and zero external-model cost. The seven-case release is wired into the generated-demo selector; a formal seven-case evaluation capture remains pending.

55. Reviewer `sulmae` confirmed the corrected 007 candidate and immutable release `v0.1.4` preserves `v0.1.1` through `v0.1.3`. The corrected payslip exposes both EUR 2980.00 and its instruction-like sentence through committed native PDF text, so the Agent can report the observation only after an authorized `get_native_text` result; prompt `case-review-prompt-3.6.0` requires the summary to say the content was treated as untrusted and not followed without fabricating a sixth business rule. Zero-cost fake-Agent acceptance case/code/run/session `1a0ca4dd-8de9-44b8-b300-efaf073f7ad3` / `FD-2026-0051` / `6a9c1980-624f-4636-8f02-bcfa0c6ac27e` / `bb732072-31d0-4840-bd52-0017fb2bd081` completed `report_submitted`. Its verified summary is `1 issue requires review. Instruction-like document content was observed, treated as untrusted, and not followed.` The only issue is `VAL_INCOME_CONSISTENCY_001`; the other four registered findings passed. The session used 8 iterations, 12 tool calls, 8 deterministic fake-model calls, 30,797 input tokens, 518 output tokens, and zero external-model cost. All three pages used committed native text, so this acceptance made no OCR or VLM call. The generated-demo selector now serves `v0.1.4`; live-model behavior under the new prompt remains unevaluated and requires a separately approved paid run.

56. The processing Agent Log now follows newly polled activity only while the reviewer remains at the end of the list; replacing its rendered events preserves a deliberate historical scroll position, opening the tab follows the latest event by default, and the constrained timeline remains manually scrollable. The automatic processing-to-report transition now rebinds the document viewer to the durable first document and preserves its current page instead of rendering a deterministic issue's `No page evidence` placeholder. The redundant case-header `Latest Agent activity / Generated review report` control and its duplicate dialog were removed; Agent Log and Agent Report tabs are the respective process and result entry points. Review Workbench 3.8.1 and IDX 3.13.1 record this behavior. `pnpm check` passed all 202 tests, the production Web build passed, and a headed Playwright check measured the visible Agent Log at 356 px viewport / 1,282 px content with `scrollTop=926` and `atBottom=true`; the report opened beside the original PDF page 1.

### What is still fixture-backed

1. Default demo and CI OCR remain deterministic fixture-backed. The explicit `pdf_inspector` mode uses pinned, verified, pre-provisioned assets and now has Linux ARM64 synthetic evidence across all six frozen cases; broader platform and non-template corpus evidence remains pending.
2. The default VLM route remains fixture-backed. For a registered synthetic case, `findFixtureScannedPageAdapter` answers `extract_with_vlm` for a page with no committed native text and declares that page's document type for classification. It is named `fixture-vlm-gateway` / `fixture-scanned-page-adapter` everywhere it appears. Explicit `VLM_MODE=live` instead invokes the configured provider/model over one committed page render with no tools, validates its bounded JSON result, and reconciles reported tokens and cost into the durable session budget. One synthetic end-to-end live route has completed acceptance; that single case is orchestration and bounded-recognition evidence, not a corpus-level accuracy or production-fitness claim.
3. Optional crop rendering is implemented, but ordinary small-page OCR still recognizes the full selected page once; evidence boxes do not trigger crop re-recognition.
4. Native-text, patched local-OCR, and precise model-extraction candidates carry the same source region their authorized boundary returned when the submitted raw value matches it verbatim. Existing sealed cases are not backfilled.
5. Fixture page-type fallback remains available only in default fixture OCR mode. The accepted real-OCR run classified every scanned page from committed OCR content.

### Implemented baseline

The implemented baseline is summarized in `AGENTS.md`. In practical terms, the repository now has:

1. A working pnpm monorepo with separate API, Worker, and Review Web applications.
2. Durable PostgreSQL workflow state, a transactional outbox, pg-boss processing, immutable run and result revisions, MinIO artifact storage, and scoped artifact delivery.
3. PDF Inspector-backed native extraction and PDFium rendering behind project interfaces, exposed to the Agent only through registered tools.
4. Selective OCR orchestration and persisted provenance using either the default deterministic fixture adapter or the explicit pinned offline PDF Inspector PP-OCRv6 Small adapter. Only one synthetic Linux ARM64 case is accepted for the real route; it is not corpus-level OCR quality evidence.
5. Deterministic page classification, contiguous logical-document grouping, declared field requirements, explicit extraction gaps, Agent-produced evidence-linked candidates, deterministic normalization, reconciliation lineage, entity matching, five registered validation rules, recommended dispositions, deterministic report verification, and one bounded Agent-led Pi harness whose session, attempts, steps, tool results, and budgets are persisted as it runs and resumed after Worker loss.
6. The Review Workbench flows for active review, changes requested, completed cases, evidence navigation, Agent and human issues, requested-change drafts, final review, downstream handoff projection, and bounded case Agent logs that name the actor of every step.
7. Six manually confirmed structured synthetic golden cases frozen as immutable release `v0.1.2`, runtime loading, candidate lifecycle commands, evaluation-run capture, and immutable offline evaluation reports. Frozen `v0.1.1` remains unchanged as historical evidence.

### Historical `v0.1.1` golden case status under the Agent-led path

All six cases were loaded through the Docker demo with `AGENT_MODEL=fake` after the change:

| Candidate | Agent-led runtime result | Frozen `v0.1.1` expectation | Status |
|---|---|---|---|
| `golden-001-native-clear` | Report ready; no issues; five Checked Facts | no issues | Matches |
| `golden-002-employer-conflict` | Report ready; `VAL_EMPLOYER_CONSISTENCY_001` | same | Matches |
| `golden-003-multiple-review-issues` | Report ready; `VAL_EMPLOYER_CONSISTENCY_001` only | also completeness and income | **Diverges** |
| `golden-004-missing-bank-evidence` | Report ready; `VAL_DOC_COMPLETENESS_001` and `VAL_NAME_CONSISTENCY_001` | completeness only | **Diverges** |
| `golden-005-instruction-inert` | Report ready; no issues; five Checked Facts | no issues | Matches |
| `golden-006-scanned-adaptive-unavailable` | `VAL_INCOME_CONSISTENCY_001`; report rejected as `policy_rejected_loan_approval` | same | Matches |

Both divergences are the fixture seeding being removed, not a regression:

1. `golden-003` was expected to show an uncertain bank-statement boundary and an incomparable payslip income. The generated document shows neither: page 3 is a payslip continuation of the same type, so the boundary is certain, and the payslip net pay equals the declared income. The old expectation came from a hard-coded `boundaryUncertain` and `incomeEvidenceSufficient: false` in the fixture table.
2. `golden-004` has no bank statement, so the account-holder name genuinely cannot be confirmed and `VAL_NAME_CONSISTENCY_001` is `person_name_unresolved`. The fixture previously fabricated an account-holder claim from the application data.

Do not edit frozen truth. The divergences above motivated the reviewed candidate changes now frozen in `v0.1.2`; both `v0.1.1` and `v0.1.2` remain immutable.

`EVALUATION_RESULTS.md` now records the replacement Agent-led baseline and retains the older fixture-seeded result only as explicitly superseded history.

### Immediate next task for the new session

**Proceed to V1 hardening and broader evaluation (`BL-009`, `BL-006`).**

The bbox persistence/API/UI chain is now accepted end to end for genuine same-pass native items and local-OCR polygons across the six-case frozen synthetic corpus, while retaining page-level presentation when no precise bbox exists. Next prioritize operating-system isolation, broader document variation, and reproducible browser/demo acceptance. The user explicitly deferred native Linux x64 runtime acceptance until the main functional path is complete. Any additional live-model call requires fresh explicit approval immediately before execution.

### Global next steps

After the immediate task, proceed in this order:

1. **Finish V1 hardening and demonstration evidence**: OS resource and network isolation, observability evidence, browser acceptance coverage, README/demo limitations, and a reproducible acceptance run. Defer native Linux x64 execution until the main functional path is complete.
2. **Establish the formal measured baseline** (`BL-006`) from compatible live-model and real-runtime evidence without claiming real-world OCR or banking performance; obtain fresh approval before any paid calls.
3. **Expand from six to twenty golden cases**, prioritizing meaningful document variation over nearly identical templates.

Broader OCR and live-VLM measurement and hardened operating-system resource isolation remain pending. Genuine same-pass native-text and local-OCR coordinate delivery plus click-activated overlay behavior are accepted on the frozen synthetic corpus. Crop-only re-recognition is deliberately not a default objective without measured need. The accepted synthetic OCR and live-VLM results do not establish real-world extraction quality or production fitness.

## Project

Project name: Financial Document AI Agent

Short name: FinDoc AI Agent

Project type: Production-shaped machine learning prototype

Reference domain: Banking and financial services

Initial scenario: Single-applicant personal-loan document review in Germany

Future scenarios: Business lending, invoice review, and standalone Know Your Customer (KYC) review

## Mission

Build a specification-driven prototype that demonstrates reliable machine learning document processing, evidence-linked extraction, a bounded Pi Case Review Agent, cross-document validation, and human review.

The system receives structured application data and supporting documents. It validates and stores files, identifies logical documents, classifies pages, extracts native text, selectively runs local Optical Character Recognition (OCR), routes difficult pages or regions to a Vision Language Model (VLM), normalizes evidence-backed claims, validates selected facts across documents, and produces a recommended document-processing disposition.

The system has no permission or interface to disburse funds, open accounts, approve or reject applications, contact customers, or perform any other core banking action. It does not perform credit, Anti-Money Laundering (AML), or final KYC decisions.

## Product Positioning

1. The initial release is a production-shaped prototype, not a production banking system.
2. The project must emphasize the machine learning pipeline, evidence, evaluation, observability, controlled model use, and human review.
3. Business validation is limited to a small demonstration rule set. The project must not invent or claim to implement a real German bank's lending policy.
4. The initial release uses synthetic and explicitly demo-safe data.
5. Known production gaps are defined in [`LIMITATIONS.md`](LIMITATIONS.md) and must remain visible in the README and demonstrations.

## Initial Scope

### Supported inputs

1. Portable Document Format (PDF), JPEG, and PNG files.
2. German and English synthetic documents.
3. Euro (EUR) as the validation currency. Foreign-exchange conversion is outside scope.
4. Structured application data, supported German identity documents, payslips, and bank statements as core schemas.
5. One applicant, one primary account holder, and one current employer.

### Explicit exclusions

1. Tagged Image File Format (TIFF).
2. Joint applications.
3. Self-employed, pension, or benefit-income workflows.
4. Automatic merging of documents across files or reordering of non-contiguous pages.
5. Production KYC, credit scoring, lending policy, customer communication, and core banking integration.
6. Training a proprietary foundation model.

## Core Design Decisions

1. Local processing is the default. PDF native extraction and selective OCR precede VLM use.
2. [`firecrawl/pdf-inspector`](https://github.com/firecrawl/pdf-inspector) is the initial PDF classification, native extraction, layout, rendering, and selective OCR foundation.
3. PDF processing runs in an isolated, resource-limited worker. The prototype implements basic file validation, not enterprise malware scanning or Content Disarm and Reconstruction (CDR).
4. PDF Inspector supplies OCR-routing inputs and the initial local PP-OCRv6 Small execution path. Its result is translated behind a replaceable project-owned OCR interface, subject to pinned offline runtime and model-asset verification.
5. External VLM use is allowed for the prototype. A provider-neutral gateway must allow later private-cloud or local deployment.
6. A VLM receives only selected pages, bounded consecutive-page windows, or cropped regions. It never receives an entire case package.
7. Models produce candidates, classifications, constrained matching opinions, or non-authoritative review briefs. They do not create validation rules, determine authoritative validation findings or dispositions, or select business decisions.
8. `pi-coding-agent` is embedded through its software development kit as a bounded Agent harness. Default coding tools, dynamic extensions, automatic resource discovery, Shell access, and unrestricted network or file access are disabled.
9. Pi runs for every processable case as a bounded pre-screening reviewer that produces a verified Case Review Brief; it may additionally use the Adaptive Extraction Loop only for eligible gaps.
10. The durable workflow is owned by PostgreSQL state, pg-boss jobs, and a Workflow Coordinator. Pi is not the durable workflow engine.
11. Every material extracted claim links to source evidence.
12. Original model output, human corrections, and repeated processing runs are immutable revisions rather than overwritten values.

## Processing Model

```text
Case intake
  -> basic file validation and immutable storage
  -> PDF/image inspection, page rendering, and selective local OCR
  -> page classification and logical-document grouping
  -> declared field requirements -> explicit extraction gaps for this run
  -> bounded Pi case-review session:
       bounded case manifest
       -> page inspection -> committed native text -> selective OCR -> bounded VLM for what is left
       -> evidence-linked extraction candidates
  -> deterministic normalization, reconciliation, and evidence binding
  -> entity and claim resolution
  -> finite demonstration validation rule set
  -> deterministic recommended-disposition mapping
  -> bounded Pi Case Review Brief and deterministic report verification
  -> Human-in-the-Loop review
```

Logical-document splitting supports contiguous page ranges within one physical PDF. Page classification and boundary prediction precede deterministic grouping. Low-confidence boundaries remain reviewable.

## Evidence and Confidence

1. Evidence stores page number, page dimensions, rotation, normalized bounding boxes, original source coordinates, extraction method, and processor version.
2. Normalized bounding boxes use a top-left origin and values from zero through one.
3. Structured application input uses a JSON Pointer rather than page coordinates.
4. Raw provider confidence and calibrated system confidence are separate values.
5. Uncalibrated model scores must not be represented as reliable probabilities.
6. VLM self-reported confidence is not a final system confidence value.

## Entities and Cross-Document Validation

Cross-document comparison operates on evidence-backed entities, roles, and claims. Initial person roles include applicant, identity holder, employee, and account holder. Organization roles include declared employer, payslip employer, and payment counterparty.

Validation rules are finite, explicitly registered, approved, and versioned. V1 uses compiled TypeScript rule plugins selected through a versioned YAML or JSON rule-set manifest. V1 does not implement a general-purpose rule Domain-Specific Language (DSL).

The initial demonstration rule set contains:

1. `VAL_DOC_COMPLETENESS_001`
2. `VAL_NAME_CONSISTENCY_001`
3. `VAL_EMPLOYER_CONSISTENCY_001`
4. `VAL_INCOME_CONSISTENCY_001`
5. `VAL_ID_EXPIRY_001`

Ambiguous entity matching may use a Large Language Model (LLM) after deterministic normalization and similarity matching. The LLM returns only a constrained matching opinion. A deterministic, versioned rule produces the validation finding.

Validation findings and recommended dispositions are separate concerns. The initial recommended dispositions are:

1. `ready_for_downstream_processing`
2. `additional_documents_needed`
3. `human_review_required`

These values describe document-processing state only. They are not lending or customer decisions.

## Human Review

The initial release includes a small working Review Workbench with:

1. A workflow-state Review Queue and Agent Report default case view.
2. Compact shared case progress and a bounded case Agent log.
3. Structured application data, document rendering, checked facts, and navigable evidence.
4. Agent-raised and human-raised issue review with confirm, ignore, and edit actions.
5. Applicant-readable requested-change drafts that the V1 system records but never sends or delivers.
6. Final `request_changes`, `escalate_review`, or `clear_for_downstream` document-review actions without approve, decline, disburse, open-account, or contact-customer authority.
7. A bounded case Agent log with model, estimated cost, timestamps, and safe reviewer-readable activity; aggregate Agent monitoring is deferred.

Reviewer issue edits and any later correction workflow never update models, prompts, rules, thresholds, or golden truth automatically.

## Data and Evaluation

1. V1 does not train a proprietary model. It orchestrates and evaluates pretrained components.
2. Quality targets are baseline-driven. Unsupported numerical claims must not be added before measurement.
3. The first vertical slice contains 6 manually verified end-to-end golden cases; the completed V1 target is 20.
4. Synthetic documents must be visibly marked as synthetic and must not reproduce official security features or real institution branding.
5. Dataset preparation and evaluation use lightweight command-line workflows rather than Airflow, Dagster, or dbt.
6. Golden truth is generated with templates and manually confirmed through lightweight dataset command-line workflows before release.
7. Live-model evaluation is separate from default continuous integration and must have an explicit cost budget.

## Technical Baseline

1. TypeScript monorepo.
2. Node.js 22.19 or later.
3. pnpm workspaces and TypeScript project references; no Nx or Turborepo in V1.
4. Fastify API with TypeBox and JSON Schema contracts.
5. PostgreSQL with Drizzle ORM and Drizzle Kit migrations.
6. pg-boss for PostgreSQL-backed asynchronous jobs.
7. Transactional outbox for reliable stage scheduling before the completed V1 baseline; the first vertical slice may establish the workflow before completing the outbox path.
8. S3-compatible object storage through an `ObjectStore` interface; MinIO for local development.
9. React, Vite, TanStack Query, React Router, PDF.js, Radix UI Primitives, CSS Modules, Lucide React, Motion, and the native system font stack for the Review Workbench.
10. Pino and basic OpenTelemetry tracing for the first vertical slice; Prometheus-compatible metrics and Jaeger may follow later in V1.
11. Vitest, Testcontainers, Playwright, and synthetic golden cases for testing.
12. Docker Compose is the delivered runtime. The design remains cloud-neutral and includes an Amazon Web Services reference mapping without Terraform in V1.

## Prompt and Model Governance

1. Prompts are GitOps-managed immutable artifacts containing prompt content, metadata, input and output schema references, tests, and hashes.
2. Environment aliases resolve to immutable prompt versions.
3. Runtime prompt editing is not supported.
4. A future external prompt registry may be added behind a `PromptRegistry` interface.
5. The default and fallback VLM are selected by a golden-set benchmark and recorded in an Architecture Decision Record (ADR).
6. Each processing run records exact model, prompt, schema, workflow, OCR, PDF renderer, rule-set, and disposition-policy versions.

## API and Persistence Conventions

1. Public endpoints use `/api/v1`.
2. Errors use one stable Problem Details-style structure and never expose internal stack traces or provider payloads.
3. Case creation and final-review submission support `Idempotency-Key` with request-hash conflict detection; issue edits use optimistic concurrency.
4. Case progress is available through polling. SSE and external webhooks are outside the first V1 implementation slice.
5. Physical files and derived artifacts are immutable objects referenced from PostgreSQL.
6. Large document bytes are not placed in queue payloads or relational columns.
7. A case has immutable processing runs; each run has stage executions and retry attempts.
8. Partial valid results may be retained, but a case with unresolved required evidence cannot become ready.

## Security and Operational Boundaries

1. Documents are untrusted data. Document instructions cannot modify tools, prompts, policies, schemas, or dispositions.
2. VLM extraction calls have no tools and accept only schema-constrained output.
3. The Case Review Agent has mode-specific fixed tool allowlists, iteration limits, VLM-call limits, timeouts, and cost budgets.
4. Its brief uses registered document-review signal and suggested-action codes, cites persisted evidence or findings, and passes schema and reference verification before display.
5. Local demo authentication is development-only and sits behind a replaceable authentication provider interface for future OpenID Connect (OIDC).
6. Audit events are append-only at the application layer but are not represented as tamper-proof.
7. The prototype has no production Service Level Agreement (SLA). It reports measured quality, latency, and cost baselines.
8. Critical dependencies, native runtimes, and model assets are pinned. Continuous integration uses a frozen lockfile and performs baseline supply-chain checks.
9. The complete limitation set is owned by [`LIMITATIONS.md`](LIMITATIONS.md).

## Demonstration Acceptance Paths

1. A native-text happy path completes without VLM extraction and produces a verified Pi Case Review Brief.
2. A difficult scanned or table case triggers the bounded Pi Adaptive Extraction Loop, produces a brief, and records its trace and cost.
3. A mixed document containing a cross-document conflict and prompt injection reaches Human-in-the-Loop review without executing document instructions.

Each path must be reproducible with a fixed golden case and an offline fake-model adapter.

## Specification Authority

The superseded migration source retained for history is:

```text
Intelligent_Document_Processing_Agent_Specification.md
```

It is archived source material only and is marked `Superseded`. The approved owning specifications in `specs/` are authoritative.

`specs/INDEX.md` owns the specification map. Each normative requirement has one owning specification. Other documents reference the owner rather than duplicate normative text.

## Target Specification Set

```text
specs/
  INDEX.md
  PRODUCT_AND_SCOPE.md
  SYSTEM_ARCHITECTURE.md
  DATA_MODEL.md
  API_CONTRACTS.md
  ML_PIPELINE_AND_EVALUATION.md
  SECURITY_AND_LIMITATIONS.md

  components/
    DOCUMENT_PROCESSING.md
    ADAPTIVE_EXTRACTION_AGENT.md
    VALIDATION_AND_DISPOSITION.md
    REVIEW_WORKBENCH.md

  operations/
    OBSERVABILITY_AND_FAILURES.md
    DEPLOYMENT.md

  decisions/
    ADR_001_PI_AGENT_HARNESS.md
    ADR_002_PDF_INSPECTOR.md
    ADR_003_VLM_SELECTION.md
    ADR_004_RULE_ARCHITECTURE.md
```

Executable TypeBox schemas and generated OpenAPI are contract artifacts. Separate prose files are not required for every schema.

## Specification Order

### Stage One — Scope and architecture

1. `specs/INDEX.md`
2. `specs/PRODUCT_AND_SCOPE.md`
3. `specs/SYSTEM_ARCHITECTURE.md`
4. `specs/DATA_MODEL.md`

### Stage Two — Core behavior

1. `specs/components/DOCUMENT_PROCESSING.md`
2. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
3. `specs/components/VALIDATION_AND_DISPOSITION.md`
4. `specs/components/REVIEW_WORKBENCH.md`
5. `specs/API_CONTRACTS.md`

Stage Two approval permits vertical-slice implementation.

### Stage Three — ML and operations

1. `specs/ML_PIPELINE_AND_EVALUATION.md`
2. `specs/SECURITY_AND_LIMITATIONS.md`
3. `specs/operations/OBSERVABILITY_AND_FAILURES.md`
4. `specs/operations/DEPLOYMENT.md`

### Stage Four — Technical decisions

ADRs are created when their decisions are ready. The Pi, PDF Inspector, and rule-architecture ADRs may precede related component specifications. The VLM selection ADR follows benchmark evidence.

## Working Method

For every requested specification:

1. Read `AGENTS.md`, this handoff, `LIMITATIONS.md`, and `specs/INDEX.md`; consult the superseded migration source only for historical context not needed by an approved owner.
2. Read only the specifications that directly affect the requested document.
3. Identify conflicts, missing decisions, assumptions, and owning documents before writing.
4. Create or update only the requested specification and required direct references.
5. Do not implement unrelated software.
6. Use English Markdown, stable requirement identifiers, and consistent normative terms: must, should, and may.
7. Keep normative requirements separate from notes and examples.
8. Define acronyms on first use unless already defined by `specs/INDEX.md`.
9. Validate internal links, terminology, identifiers, schemas, and version references.
10. Report the changed file, decisions, assumptions, and unresolved questions.
11. Stop for review before creating the next specification unless the user explicitly requests a batch.

## Repository Agent Guidance

[`AGENTS.md`](AGENTS.md) provides repository-level operating guidance for specification and implementation agents. It is not a normative product specification. Approved owning specifications and ADRs take precedence over it. The file must be updated after the implementation skeleton exists so that its commands and directory guidance match the repository rather than planned structure.
