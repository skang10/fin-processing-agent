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
pnpm evaluate:capture -- datasets/releases/v0.1.0 evaluation-config.json actual-run.json
```

`dataset:build` refuses to freeze a release while any case remains `pending_human_review`, and it never rewrites a prior release.

`dataset:load` submits one candidate to a running local demo, waits for processing, and prints the case lifecycle, report outcome, issue codes, and Review Workbench URL. It does not confirm or mutate golden truth.

`evaluate:offline` accepts only a frozen, checksum-verified release and an explicit actual-run manifest. It writes one immutable report under `output/evaluations/` and keeps issue detection, evidence grounding, and report validity separate.

`evaluate:capture` loads every case from a frozen release through the running API and Worker, resolves persisted evidence into stable golden references, and writes a new actual-run manifest. The command requires an explicit version manifest and never overwrites output.

Golden evidence tokens use `page:<number>` for page evidence, `application:<json-pointer>` for structured input, `document:<filename>` for a submitted artifact, and `finding:<rule-code>` when an issue is supported by a deterministic finding such as the absence of a required document. Every checked fact presented by the report must have a corresponding truth entry. A verifier-rejected report contributes no verified Agent issues, while its deterministic findings and system-detected review issues remain available to human reviewers.
