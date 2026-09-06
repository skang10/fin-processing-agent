# Claude Implementation Handoff

## Mission

Continue the Financial Document AI Agent from the current `main` branch and complete the next coherent milestone: **durable, incrementally persisted, resumable Case Review Agent execution**.

Work autonomously through the entire milestone. Do not stop after planning, scaffolding, a schema migration, or unit tests. Make a small commit after each verified slice, then continue. Stop only when the automated acceptance criteria in this document pass and the remaining work genuinely requires the human reviewer to inspect product behavior, or when a specification conflict or destructive/data-authority decision cannot be resolved from the approved repository documents.

This is an implementation handoff, not authority to change product scope. `AGENTS.md`, approved specifications, accepted ADRs, and `LIMITATIONS.md` remain authoritative.

## Starting Point

- Repository: `/Users/sulmae/xuemei/projects/fin-processing-agent`
- Branch: `main`
- Expected starting commit: `7ce7dd8 fix: explain agent report policy rejection`
- Expected worktree: clean except that this handoff may still be uncommitted; preserve and include it in the first appropriate documentation commit unless the human commits it first.
- Runtime: Docker Compose may already be running, but do not assume persisted case IDs or container state.
- Candidate truth status: `golden-001` through `golden-005` were human-confirmed by `sulmae`; `golden-006-scanned-adaptive-unavailable` is still pending human review. Do not confirm it or freeze a release.

Before editing, run:

```bash
git status --short
git log -8 --oneline
```

If the starting state differs, preserve unrelated user work and reconcile it rather than resetting or deleting it.

## Required Reading

Read in the repository-mandated order before implementation:

1. `AGENTS.md`
2. `CODEX_HANDOFF.md`
3. `LIMITATIONS.md`
4. `specs/INDEX.md`
5. `specs/PRODUCT_AND_SCOPE.md`
6. `specs/SYSTEM_ARCHITECTURE.md`
7. `specs/DATA_MODEL.md`
8. `specs/components/ADAPTIVE_EXTRACTION_AGENT.md`
9. `specs/API_CONTRACTS.md`
10. `specs/SECURITY_AND_PRIVACY.md`
11. `specs/operations/OBSERVABILITY_AND_FAILURES.md`
12. `specs/operations/DEPLOYMENT.md`
13. `specs/decisions/ADR_001_PI_AGENT_HARNESS.md`
14. `specs/decisions/ADR_002_PDF_INSPECTOR.md`
15. `BACKLOG.md`

Do not use the migration source specification where an approved owner already exists.

## Why This Is the Next Milestone

The Agent-led orchestration and one-session Pi harness are implemented, but the implementation currently materializes the Agent session trace at the end of the session. A Worker process loss can therefore discard already completed step provenance even when its domain side effects were committed. The approved architecture requires PostgreSQL and pg-boss—not Pi conversation memory—to own recovery.

This milestone closes the primary remaining Agent durability gap:

- `AGT-REQ-072` through `AGT-REQ-079`
- `AGT-REQ-099` and `AGT-REQ-100`
- `DAT-REQ-131` through `DAT-REQ-134`
- `DAT-REQ-199` through `DAT-REQ-206`
- `ARC-REQ-169`, `ARC-REQ-172`, `ARC-REQ-173`
- `ARC-REQ-136`
- ADR-001 verification item: Worker termination does not lose durable case progress

## Non-Negotiable Boundaries

Preserve all of these:

1. One processable run has one current authoritative `case_review` Agent-session identity. Recovery may create linked attempts but never parallel authoritative sessions.
2. PostgreSQL stage/session/step/invocation/domain records are durable truth. Pi conversation memory is disposable.
3. The Agent does not own workflow transitions, claims, findings, recommended dispositions, or final review decisions.
4. Completed non-idempotent work must not be blindly replayed. Cacheable document operations must reuse integrity-valid committed outputs.
5. Re-entry reconstructs scope, compatible tool results, produced record references, consumed budgets, and remaining budgets from trusted persisted state.
6. Agent steps and tool results must not persist complete documents, page images, unrestricted text, prompts/responses, credentials, or chain-of-thought.
7. Default CI remains deterministic, offline, and free of paid model calls.
8. The fake OCR/VLM adapters remain explicitly fake fixture adapters. Do not describe them as recognition or quality evidence.
9. Do not add approval, rejection, creditworthiness, AML/KYC, account-opening, disbursement, or customer-contact authority.
10. Do not confirm candidate 006, build a golden release, select a live model provider, or alter frozen/confirmed truth.
11. Do not introduce new infrastructure or dependencies unless an approved specification already requires them and the existing stack cannot implement the requirement.

## Definition of the Durable Model

Implement the smallest model that satisfies the approved contracts. Prefer extending the existing `agent_sessions` and `agent_steps` design over creating a second workflow system.

At minimum, durable state must represent:

- the stable authoritative case-review session identity for a processing run;
- one or more linked execution attempts when recovery is needed;
- running versus terminal session/attempt status;
- each committed Agent step, in sequence, with phase, registered tool, safe/canonical argument identity, outcome, timing, usage, cumulative budget state, trace identity, and produced record references;
- immutable tool invocation results or compatible references carrying tool and implementation version, canonical idempotency key, authorized input versions, output schema version, safe output hash/references, usage, timing, outcome, and reuse lineage;
- the session terminal reason, recorded exactly once;
- enough state to calculate remaining budgets without resetting already consumed calls, tokens, cost, pixels, OCR pages, iterations, or time according to approved policy.

Do not persist model reasoning. A reconstructed continuation prompt may summarize safe committed facts and available/reused tool outputs, but must not pretend to restore hidden conversational state.

## Execution Plan

### Slice 1 — Inventory, invariants, and persistence contract

1. Trace the current path from the pg-boss job through the Worker coordinator, `PiAgentLedCaseReviewHarness`, `BoundedPiSession`, registered tools, offline result persistence, and Agent-log projection.
2. Identify where session IDs, step sequence numbers, tool idempotency keys, budgets, report submission, and deterministic side effects are currently created.
3. Add or refine core ports/types for incremental lifecycle persistence and recovery state. Keep package direction clean: Agent packages depend on ports/contracts, not directly on PostgreSQL.
4. Define stable status/reason vocabularies and uniqueness/idempotency constraints from approved specs, not from free-form exceptions.
5. Add focused contract/unit tests proving the invariants before wiring the database.

Verification before commit:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Commit the verified slice with a narrow message, then continue.

### Slice 2 — Schema and transactional repository operations

1. Extend the Drizzle schema only as needed for linked attempts and immutable tool invocation results/reuse lineage.
2. Generate a version-controlled migration with the existing generator; do not hand-edit generated migration metadata.
3. Add transactional repository operations to:
   - create-or-get the authoritative session identity;
   - begin or reclaim a compatible attempt safely;
   - append a step exactly once by session/attempt/sequence or canonical step identity;
   - record a tool result exactly once by canonical idempotency key and authorized input versions;
   - record reuse that points to the original invocation result;
   - update cumulative budget accounting without lost updates;
   - terminalize a session exactly once;
   - load a trusted recovery snapshot.
4. Use database uniqueness and transactional checks for duplicate delivery; do not rely only on process-local maps or locks.
5. Preserve compatibility with existing demo data/migrations where practical. Never reset user volumes merely to make a migration pass.

Required tests:

- concurrent or duplicate create returns one authoritative identity;
- duplicate step append is idempotent or rejected with a stable conflict result;
- duplicate tool invocation reuses the committed result without duplicate side effects;
- recovery snapshot contains only safe fields and correct remaining budget;
- a terminal session cannot be terminalized differently or mutated as running;
- prior existing session/log queries still work.

Verification before commit:

```bash
pnpm check
pnpm test:integration
pnpm build
git diff --check
```

Commit, then continue.

### Slice 3 — Incremental harness checkpoints

1. Inject the durable lifecycle port into the Pi harness/session control plane.
2. Persist the session/attempt before the first model call.
3. For every authorized tool step, establish a safe order that prevents an untracked side effect:
   - validate and authorize arguments;
   - resolve the canonical idempotency key;
   - reuse an integrity-valid compatible committed result when present;
   - otherwise execute through the bounded tool adapter;
   - durably commit the invocation result and produced references;
   - durably append/complete the Agent step and cumulative budget state;
   - only then expose the committed result to further Agent continuation.
4. Ensure deterministic reconciliation, validation, and report submission preserve ordinary authoritative records and carry the requesting step link where the current schema supports it.
5. Persist terminal outcome exactly once on success, controlled exhaustion, timeout, provider failure, verifier rejection, or other structured end state.
6. Keep the final aggregate trace projection for API/UI compatibility, but build it from durable records rather than treating an end-of-session blob as truth.

Required tests:

- step is visible in persistence immediately after it completes, before session termination;
- produced evidence/candidate/result/report references are correctly linked;
- budgets are cumulative and cannot reset on a new attempt;
- unknown/cross-scope/malformed tool calls remain rejected and safely recorded;
- policy-rejected reports remain distinct from Agent-session terminal state;
- existing fake harness sequencing, no-progress, timeout, provider failure, and budget tests remain deterministic.

Verification before commit:

```bash
pnpm check
pnpm test:integration
pnpm build
git diff --check
```

Commit, then continue.

### Slice 4 — Durable re-entry and duplicate delivery

1. On a redelivered/retried case-review job, load the authoritative session identity and recovery snapshot before invoking Pi.
2. Decide compatibility deterministically using the bound run, stage attempt policy, configuration version, tool-registry version, context-manifest version, prompt/schema/model route where applicable, and authorized input versions.
3. When compatible, start a linked attempt or use an explicitly supported continuation mechanism. Reconstruct only safe trusted state and remaining budgets.
4. Reuse committed compatible tool results and domain side effects. Never rerun candidate submission, reconciliation, validation, or report submission when their idempotency contract says the corresponding result is already committed.
5. If state is incompatible, corrupted, or integrity-invalid, produce a stable structured failure and let durable workflow policy route it. Do not silently start over with fresh budgets.
6. Make duplicate concurrent job delivery unable to create parallel authoritative sessions or duplicate domain outputs.

The deterministic fake script may need a recovery-aware continuation input. It must choose its next useful action from the persisted view; it must not assume prior Pi messages survived.

Required tests:

- re-entry after one committed inspection step continues without duplicating it;
- re-entry after OCR/VLM reuses the committed artifact/result and charged budget;
- re-entry after candidate submission does not create a second candidate;
- re-entry after reconciliation does not create duplicate claims/lineage;
- re-entry after validation does not create duplicate findings/result revisions;
- re-entry after report submission does not create a duplicate report;
- simultaneous duplicate stage delivery leaves one authoritative current session;
- incompatible versions fail safely and visibly.

Verification before commit:

```bash
pnpm check
pnpm test:integration
pnpm build
git diff --check
```

Commit, then continue.

### Slice 5 — Worker-termination fault-injection acceptance

Add deterministic test-only fault injection at durable boundaries, not arbitrary timing sleeps. Exercise at least these interruption points:

1. after document/page inspection commits;
2. after fake OCR/VLM tool output commits;
3. after extraction candidate submission commits;
4. after deterministic reconciliation commits;
5. after deterministic validation/result sealing commits;
6. after report submission commits but before the enclosing Worker handler returns.

For each point:

- terminate or simulate loss of the first Worker execution only after the target commit is confirmed;
- redeliver/restart through the real durable job/coordinator path;
- prove recovery uses PostgreSQL/pg-boss state rather than in-memory session state;
- prove no duplicate authoritative session, artifacts, candidates, claims, findings, result revisions, or reports;
- prove consumed budgets and ordered step history remain accurate;
- prove the case reaches the correct human-reviewable state.

Prefer one table-driven integration suite over six unrelated fixtures. Keep fault hooks test-only and impossible to activate accidentally in the delivered demo configuration.

Verification before commit:

```bash
pnpm check
pnpm test:integration
pnpm build
git diff --check
```

Commit, then continue.

### Slice 6 — Reviewer-facing recovery projection

Use existing API and Review Workbench patterns; do not create aggregate Agent monitoring.

1. Ensure the bounded case Agent log can represent a running, interrupted, resumed, and terminal case-review attempt in chronological order.
2. Present a single understandable case-review timeline. Avoid exposing database vocabulary, raw hashes, hidden prompts, raw model messages, or duplicate low-level rows.
3. Make reused work understandable with concise reviewer language such as “Reused the previously extracted page result after processing resumed.”
4. Make a resumed attempt understandable without implying the Agent itself owns recovery, for example “Processing resumed from saved progress.”
5. Preserve the existing explicit verifier-rejection copy, including the concrete prohibited recommendation and policy reason.
6. Do not add a large dashboard, configuration editor, token inspector, or separate monitoring product.

Add projection/component tests for ordering, interrupted/resumed state, result reuse, and safe redaction. If repository browser automation is still not an authoritative command, perform browser validation using the available browser tooling without inventing a package command.

Verification before commit:

```bash
pnpm check
pnpm test:integration
pnpm build
git diff --check
```

Also run a fresh Docker demo and inspect at least one normal case and the difficult scanned case. Commit, then continue.

### Slice 7 — Full regression, documentation, and handback

1. Run the full automated suite and Docker acceptance:

```bash
pnpm check
pnpm test:integration
pnpm build
pnpm dataset:validate
pnpm demo:acceptance
git diff --check
```

2. Run the six candidates through a fresh local demo if the existing commands support doing so without modifying confirmed truth. Verify runtime outcomes remain consistent with `CODEX_HANDOFF.md`.
3. Update `AGENTS.md`, `CODEX_HANDOFF.md`, `BACKLOG.md`, ADR verification status, and directly affected spec implementation-status notes only to reflect behavior that now exists. Do not rewrite approved normative requirements unless a real conflict is discovered.
4. State explicitly that real OCR/VLM recognition, live-model acceptance, crop rendering, and hardened OS/network isolation remain pending.
5. Make a final documentation commit.

## Commit Discipline

- Commit after every completed, verified slice.
- Use non-interactive Git commands.
- Do not amend or squash earlier commits.
- Do not push unless the human explicitly asks.
- Do not commit generated runtime data, secrets, uploaded documents, database volumes, model caches, or transient evaluation output.
- Before each commit, inspect `git status --short` and ensure only intended files are staged.
- If a slice exposes a defect in an earlier slice, fix it in a new commit and continue.

## Automated Completion Criteria

Do not hand back merely because the implementation compiles. All must be true:

1. A session/attempt is durable before the first model call.
2. Every completed Agent step is durable before the next Agent continuation.
3. Tool invocation identity, result/reuse lineage, produced references, timing, usage, and budget state are persisted safely.
4. A Worker can disappear after any tested committed boundary and a replacement execution reaches the correct terminal/human-review state.
5. Recovery does not depend on Pi conversation memory.
6. Duplicate job delivery does not duplicate authoritative sessions or domain side effects.
7. Consumed budgets survive recovery.
8. The API/UI Agent log remains concise, chronological, safe, and understandable.
9. Existing review, issue, report-verifier, requested-change, queue, handoff, dataset, and offline-evaluation behavior does not regress.
10. All validation commands in Slice 7 pass.
11. The worktree is clean after the final commit.

## Human Acceptance Checkpoint

Only after the automated completion criteria pass, ask `sulmae` to review these items:

1. In the Review Workbench, a normal case still shows a concise Agent report and chronological log.
2. A fault-injected/recovered demo case clearly says processing resumed from saved progress and does not show duplicated steps.
3. The difficult scanned candidate still clearly distinguishes fake fixture OCR/VLM orchestration from real recognition.
4. The verifier-rejected report still explains the exact prohibited recommendation and policy boundary.
5. The reviewer agrees the recovery log is useful without being too technical or visually heavy.

Provide the exact local URLs/case IDs generated by the final run and a compact commit list. Do not confirm candidate 006 or freeze the golden release on the reviewer’s behalf.

## Stop Early Only For a Real Blocker

Stop and ask the human only if one of these occurs:

- approved specifications conflict on a material invariant;
- a migration would require destructive handling of existing user data;
- a required behavior needs a new product/policy decision rather than an implementation choice;
- a required external credential, paid model call, or unapproved dependency is unavoidable;
- the same external/environment blocker remains after safe diagnostics and documented alternatives.

Do not stop for ordinary type errors, failing tests, migration bugs, container rebuilds, stale demo data, or implementation complexity. Diagnose, fix, verify, commit, and continue.

## Explicitly Deferred Work

Do not absorb these into this milestone:

- real PP-OCRv6/PDF Inspector runtime acceptance;
- real VLM extraction or provider benchmarking;
- live Pi model acceptance and Euro cost policy;
- candidate 006 human confirmation or golden-release freezing;
- expanding the golden dataset from six to twenty cases;
- crop rendering, JPEG/PNG execution completion, or hardened OS/network isolation;
- aggregate Agent monitoring or administration UI;
- core banking integration or any automated lending/customer decision.

These are later milestones. Durable Agent execution is the only primary scope of this handoff.
