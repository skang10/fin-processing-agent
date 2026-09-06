# Golden Dataset Candidates

These files are synthetic dataset candidates, not frozen golden truth and not production-performance evidence.

Review each generated PDF together with its candidate JSON. Confirm that the expected issue codes, acceptable evidence, checked facts, report outcome, required content, and prohibited content are correct. Cases tagged `runtime_support_pending` describe required V1 coverage whose real OCR, mixed/scanned rendering, Adaptive Agent, or verifier path is not implemented yet; do not confirm those cases until the corresponding artifact and execution path are real.

```text
pnpm dataset:generate
pnpm dataset:validate
pnpm dataset:inspect
pnpm dataset:confirm -- CASE_ID REVIEWER
pnpm dataset:build -- v0.1.0
```

`dataset:build` refuses to freeze a release while any case remains `pending_human_review`, and it never rewrites a prior release.
