# Golden Dataset Candidates

These files are synthetic dataset candidates, not frozen golden truth and not production-performance evidence.

Review each generated PDF together with its candidate JSON. Confirm that the expected issue codes, acceptable evidence, checked facts, report outcome, required content, and prohibited content are correct. Cases tagged `runtime_support_pending` now contain real mixed or image-only scanned pages, but their Adaptive Agent or verifier execution path is not implemented yet; do not confirm them until that execution evidence exists.

```text
pnpm dataset:generate
pnpm dataset:validate
pnpm dataset:inspect
pnpm dataset:load -- golden-001-native-clear
pnpm dataset:confirm -- CASE_ID REVIEWER
pnpm dataset:build -- v0.1.0
pnpm evaluate:offline -- datasets/releases/v0.1.0 actual-run.json
```

`dataset:build` refuses to freeze a release while any case remains `pending_human_review`, and it never rewrites a prior release.

`dataset:load` submits one candidate to a running local demo, waits for processing, and prints the case lifecycle, report outcome, issue codes, and Review Workbench URL. It does not confirm or mutate golden truth.

`evaluate:offline` accepts only a frozen, checksum-verified release and an explicit actual-run manifest. It writes one immutable report under `output/evaluations/` and keeps issue detection, evidence grounding, and report validity separate.
