# Review Workbench UI Prototype

This is a non-authoritative, static interaction prototype for reviewing `specs/components/REVIEW_WORKBENCH.md`.

The selected direction is an "Audit Desk": a neutral, information-dense evidence-review console designed to feel like a professional operational tool rather than a consumer FinTech interface. It uses a workflow-state Review Queue, an Agent Report as the case entry point, a document-first two-pane workspace, explicit issue review, applicant-readable requested-change drafts, and a restrained final review. The prototype remains dependency-free; the formal React implementation will use Radix UI Primitives, CSS Modules, Lucide React, and Motion.

It uses synthetic data only and has no API, database, model, authentication, or banking-system connection. It must not be treated as the production React implementation or as an executable contract.

## Preview

From this directory, run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.

## Developer Agent diagnostics

When the API runs with `FINDOC_SYNTHETIC_DEMO=true` and `AGENT_DIAGNOSTICS=true`, developers can open the unlinked `/agent-debug.html?case_id=CASE_UUID` page. It is intentionally absent from reviewer navigation and displays only the guarded durable trace: prompt identity, run configuration, aggregate model usage, attempts, tool calls, bounded safe-result previews, references, and final verification metadata. Raw model conversations, chain-of-thought, document text, and page images are excluded.

For an on-demand terminal export that also reads protected OCR results without copying them into application logs, run `pnpm agent:trace` for the latest synthetic Agent session or `pnpm agent:trace -- CASE_UUID` for a specific case. The command refuses non-synthetic cases. Existing runs expose raw OCR artifacts but cannot recover raw model turns or raw tool arguments that were never persisted.

## Included views

1. Review Queue with search and workflow-state filters.
2. Agent Report default case view with peer Issues and Review & Submit views.
3. Document and structured Application data views with selectable evidence references.
4. Human confirm, ignore, edit, and create-issue interactions.
5. Applicant-readable requested-change drafts that the demo records but does not send.
6. Compact shared case progress and a bounded case Agent log showing model, cost, and safe events.
7. A wider resizable case workspace with bounded pointer and keyboard resizing.
