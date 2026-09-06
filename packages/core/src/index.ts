export type CaseId = string;
export type RunId = string;

export type SupportedMediaType = "application/pdf" | "image/jpeg" | "image/png";
export type ArtifactMediaType = SupportedMediaType | "text/markdown" | "application/json";

export interface ObjectStore {
  put(objectKey: string, content: AsyncIterable<Uint8Array>, mediaType: ArtifactMediaType): Promise<void>;
  get(objectKey: string): Promise<AsyncIterable<Uint8Array>>;
  remove(objectKey: string): Promise<void>;
}

export interface StoredSourceArtifact {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly detectedMediaType: SupportedMediaType;
}

export interface StoredDerivedArtifact {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mediaType: "text/markdown";
}

export interface StoredPageRenderArtifact {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mediaType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly targetDpi: number;
  readonly rendererVersion: string;
}

export interface StoredOcrArtifact {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mediaType: "application/json";
  readonly engine: string;
  readonly engineVersion: string;
  readonly modelAssetVersion: string;
  readonly languages: readonly string[];
}

export interface SourceArtifactIntake {
  store(source: AsyncIterable<Uint8Array>): Promise<StoredSourceArtifact>;
  discard(artifact: StoredSourceArtifact): Promise<void>;
}

export type AgentSessionMode = "case_review";

export type AgentTerminalReason =
  | "report_submitted" | "report_not_submitted" | "no_progress" | "conflicting_candidates"
  | "iteration_budget_exhausted" | "tool_budget_exhausted" | "model_budget_exhausted" | "token_budget_exhausted"
  | "cost_budget_exhausted" | "timeout" | "tool_failure" | "model_unavailable" | "schema_failure"
  | "cancelled_by_workflow" | "internal_error";

export type AgentStepOutcome =
  | "succeeded" | "unknown_tool_rejected" | "schema_rejected" | "authorization_rejected"
  | "budget_rejected" | "duplicate_resolved" | "failed";

export interface AgentBudgetEnvelope {
  /** Maximum linked execution attempts before durable workflow policy stops re-entry (AGT-REQ-139). */
  readonly maxAttempts: number;
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxModelCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxWallClockMs: number;
  readonly maxEstimatedCostUsd: number;
  readonly maxVlmCalls: number;
  readonly maxOcrPages: number;
  readonly maxConsecutiveNoProgressSteps: number;
}

export interface ExtractionGapScope {
  readonly documentVersionId: string;
  readonly logicalDocumentRevisionId: string;
  readonly pageNumber: number;
}

/** Explicit unresolved extraction requirement (DAT-REQ-101 to DAT-REQ-105). */
export interface ExtractionGap {
  readonly gapId: string;
  readonly fieldSchemaId: string;
  readonly fieldSchemaVersion: string;
  readonly valueType: "string" | "money" | "date";
  readonly required: boolean;
  readonly originatingStage: "extract";
  readonly reasonCode: string;
  readonly attemptedPaths: readonly string[];
  readonly scope: ExtractionGapScope;
}

export interface GapResolution {
  readonly gapId: string;
  readonly resolutionType: "claim" | "terminal_reason" | "review_action";
  readonly reference: string;
}

/** Persisted Agent-in-the-Loop eligibility decision (AGT-REQ-105). */
export interface AgentEligibilityDecision {
  readonly decisionId: string;
  readonly policyVersion: string;
  readonly gapIds: readonly string[];
  readonly decision: "eligible" | "ineligible";
  readonly reasonCodes: readonly string[];
}

export interface AgentStepTrace {
  readonly sequence: number;
  readonly phase?: "planning" | "document_inspection" | "extraction" | "reconciliation" | "validation" | "report_submission" | "terminal";
  readonly toolName: string;
  readonly toolVersion?: string;
  readonly argumentHash: string;
  readonly outcome: AgentStepOutcome;
  readonly summary: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly budgetState: { readonly iterationsUsed: number; readonly toolCallsUsed: number };
}

export interface AgentUsageTrace {
  readonly available: boolean;
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentSessionTrace {
  readonly sessionId: string;
  readonly mode: AgentSessionMode;
  readonly harnessId: string;
  readonly harnessVersion: string;
  readonly modelLabel: string;
  readonly modelRoute: "fake" | "live";
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly configurationVersion: string;
  readonly toolRegistryVersion: string;
  readonly offeredTools: readonly string[];
  readonly budget: AgentBudgetEnvelope;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly usage: AgentUsageTrace;
  readonly estimatedCost?: { readonly amount: string; readonly currency: "EUR" };
  readonly terminalReason: AgentTerminalReason;
  readonly steps: readonly AgentStepTrace[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly boundGapIds?: readonly string[];
  readonly submittedCandidateIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Durable Agent session lifecycle (AGT-REQ-072 to AGT-REQ-079, DAT-REQ-199 to DAT-REQ-206)
// ---------------------------------------------------------------------------

export type AgentSessionStatus = "running" | "terminal";

export type AgentAttemptStartReason = "initial" | "recovery";

export type AgentStepPhase =
  | "planning" | "document_inspection" | "extraction" | "reconciliation"
  | "validation" | "report_submission" | "terminal";

/** Versioned controlled phase vocabulary; phase is diagnostic provenance, never workflow state (DAT-REQ-200). */
export const AGENT_STEP_PHASE_VOCABULARY_VERSION = "agent-step-phase-1.0.0";
export const AGENT_STEP_PHASES: readonly AgentStepPhase[] = Object.freeze([
  "planning", "document_inspection", "extraction", "reconciliation", "validation", "report_submission", "terminal",
]);

/** Immutable domain records a committed Agent step produced (DAT-REQ-132). */
export type AgentProducedReferenceKind =
  | "artifact" | "evidence" | "extraction_candidate" | "gap_resolution"
  | "claim" | "reconciliation" | "result_revision" | "report_submission";

export interface AgentProducedReference {
  readonly kind: AgentProducedReferenceKind;
  readonly id: string;
}

/** Cumulative budget consumption that must survive recovery (AGT-REQ-136). */
export interface AgentConsumedBudget {
  readonly iterations: number;
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly vlmCalls: number;
  readonly ocrPages: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly usageAvailable: boolean;
}

export const EMPTY_AGENT_CONSUMED_BUDGET: AgentConsumedBudget = Object.freeze({
  iterations: 0, toolCalls: 0, modelCalls: 0, vlmCalls: 0, ocrPages: 0,
  inputTokens: 0, outputTokens: 0, costUsd: 0, usageAvailable: true,
});

export function addConsumedBudget(left: AgentConsumedBudget, right: Partial<AgentConsumedBudget>): AgentConsumedBudget {
  return {
    iterations: left.iterations + (right.iterations ?? 0),
    toolCalls: left.toolCalls + (right.toolCalls ?? 0),
    modelCalls: left.modelCalls + (right.modelCalls ?? 0),
    vlmCalls: left.vlmCalls + (right.vlmCalls ?? 0),
    ocrPages: left.ocrPages + (right.ocrPages ?? 0),
    inputTokens: left.inputTokens + (right.inputTokens ?? 0),
    outputTokens: left.outputTokens + (right.outputTokens ?? 0),
    costUsd: left.costUsd + (right.costUsd ?? 0),
    usageAvailable: left.usageAvailable && (right.usageAvailable ?? true),
  };
}

/** Identity a session is bound to; a change here requires a new run rather than a hidden retry (AGT-REQ-138). */
export interface AgentSessionConfiguration {
  readonly mode: AgentSessionMode;
  readonly harnessId: string;
  readonly harnessVersion: string;
  readonly modelLabel: string;
  readonly modelRoute: "fake" | "live";
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly configurationVersion: string;
  readonly toolRegistryVersion: string;
  readonly contextManifestVersion: string;
  readonly offeredTools: readonly string[];
  readonly budget: AgentBudgetEnvelope;
}

/** Immutable committed tool invocation result available for compatible reuse (DAT-REQ-201, DAT-REQ-202). */
export interface AgentCommittedToolResult {
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly outcome: AgentStepOutcome;
  readonly outputSchemaVersion: string;
  readonly outputHash: string;
  /** Bounded structured payload retained only when the registered tool declares it safe to reuse. */
  readonly safeOutput?: unknown;
  readonly producedReferences: readonly AgentProducedReference[];
  readonly authorizedInputVersions: Readonly<Record<string, string>>;
  readonly terminatesSession: boolean;
}

export interface AgentRecoverySnapshot {
  readonly sessionId: string;
  readonly caseId: CaseId;
  readonly runId: RunId;
  readonly status: AgentSessionStatus;
  readonly terminalReason?: AgentTerminalReason;
  readonly configuration: AgentSessionConfiguration;
  readonly consumed: AgentConsumedBudget;
  readonly attempts: number;
  readonly lastSequence: number;
  readonly steps: readonly AgentStepTrace[];
  readonly committedToolResults: readonly AgentCommittedToolResult[];
  readonly startedAt: string;
}

export type AgentSessionCompatibility =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reasonCodes: readonly string[] };

const BUDGET_KEYS: readonly (keyof AgentBudgetEnvelope)[] = Object.freeze([
  "maxAttempts", "maxIterations", "maxToolCalls", "maxModelCalls", "maxInputTokens", "maxOutputTokens",
  "maxWallClockMs", "maxEstimatedCostUsd", "maxVlmCalls", "maxOcrPages", "maxConsecutiveNoProgressSteps",
]);

/**
 * Deterministic re-entry compatibility over versioned identity only (AGT-REQ-077, AGT-REQ-138).
 * It never inspects model narrative or exception text.
 */
export function evaluateAgentSessionCompatibility(
  persisted: AgentSessionConfiguration,
  requested: AgentSessionConfiguration,
): AgentSessionCompatibility {
  const reasonCodes: string[] = [];
  if (persisted.mode !== requested.mode) reasonCodes.push("session_mode_changed");
  if (persisted.harnessId !== requested.harnessId) reasonCodes.push("harness_changed");
  if (persisted.harnessVersion !== requested.harnessVersion) reasonCodes.push("harness_version_changed");
  if (persisted.configurationVersion !== requested.configurationVersion) reasonCodes.push("harness_configuration_changed");
  if (persisted.toolRegistryVersion !== requested.toolRegistryVersion) reasonCodes.push("tool_registry_changed");
  if (persisted.contextManifestVersion !== requested.contextManifestVersion) reasonCodes.push("context_manifest_changed");
  if (persisted.promptVersion !== requested.promptVersion || persisted.promptHash !== requested.promptHash) reasonCodes.push("prompt_changed");
  if (persisted.modelRoute !== requested.modelRoute) reasonCodes.push("model_route_changed");
  if (persisted.modelLabel !== requested.modelLabel) reasonCodes.push("model_changed");
  if (BUDGET_KEYS.some((key) => persisted.budget[key] !== requested.budget[key])) reasonCodes.push("budget_changed");
  return reasonCodes.length === 0 ? { compatible: true } : { compatible: false, reasonCodes };
}

export class AgentSessionIncompatibleError extends Error {
  constructor(readonly reasonCodes: readonly string[]) {
    super("The persisted Agent session is incompatible with the requested configuration");
    this.name = "AgentSessionIncompatibleError";
  }
}

export class AgentStepConflictError extends Error {
  constructor(readonly sessionId: string, readonly sequence: number) {
    super("A different Agent step is already committed at this sequence");
    this.name = "AgentStepConflictError";
  }
}

/** A newer linked attempt owns the session; a stale Worker must not commit further work. */
export class AgentAttemptSupersededError extends Error {
  constructor(readonly sessionId: string, readonly attemptId: string) {
    super("The Agent session attempt was superseded by a newer execution");
    this.name = "AgentAttemptSupersededError";
  }
}

/** One canonical idempotency key may never identify two materially different tool results. */
export class AgentInvocationConflictError extends Error {
  constructor(readonly sessionId: string, readonly idempotencyKey: string) {
    super("The Agent tool idempotency key is already bound to an incompatible invocation result");
    this.name = "AgentInvocationConflictError";
  }
}

export class AgentSessionTerminalError extends Error {
  constructor(readonly terminalReason: AgentTerminalReason) {
    super("The Agent session already recorded a terminal reason");
    this.name = "AgentSessionTerminalError";
  }
}

export interface BeginAgentSessionInput {
  readonly caseId: CaseId;
  readonly runId: RunId;
  readonly configuration: AgentSessionConfiguration;
  readonly startedAt: string;
}

export interface AgentSessionStart {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly startReason: AgentAttemptStartReason;
  readonly resumed: boolean;
  /** Trusted state committed before this attempt began. */
  readonly snapshot: AgentRecoverySnapshot;
}

export interface AgentToolInvocationCommit {
  readonly idempotencyKey: string;
  readonly outputSchemaVersion: string;
  readonly outputHash: string;
  readonly safeOutput?: unknown;
  readonly producedReferences: readonly AgentProducedReference[];
  readonly authorizedInputVersions: Readonly<Record<string, string>>;
  readonly terminatesSession: boolean;
}

export interface CommitAgentStepInput {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly sequence: number;
  readonly phase: AgentStepPhase;
  readonly toolName: string;
  readonly toolVersion?: string;
  readonly argumentHash: string;
  readonly outcome: AgentStepOutcome;
  readonly summary: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly budgetDelta: Partial<AgentConsumedBudget>;
  readonly budgetState: { readonly iterationsUsed: number; readonly toolCallsUsed: number };
  /** Present when this step committed a new immutable invocation result. */
  readonly invocation?: AgentToolInvocationCommit;
  /** Present when this step reused an earlier compatible invocation result. */
  readonly reusedInvocationId?: string;
  readonly integrityCheck?: "hash_match" | "hash_mismatch" | "not_applicable";
}

export interface CommitAgentStepResult {
  readonly stepId: string;
  readonly sequence: number;
  readonly invocationId?: string;
  /** True when an equal step was already durable, so this call changed nothing. */
  readonly alreadyCommitted: boolean;
  readonly consumed: AgentConsumedBudget;
}

export interface TerminalizeAgentSessionInput {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly terminalReason: AgentTerminalReason;
  readonly completedAt: string;
  readonly offeredTools: readonly string[];
  readonly budgetDelta: Partial<AgentConsumedBudget>;
}

export interface AgentSessionTerminalResult {
  /** False when a terminal reason was already recorded; the persisted reason wins (AGT-REQ-070). */
  readonly applied: boolean;
  readonly terminalReason: AgentTerminalReason;
  readonly consumed: AgentConsumedBudget;
}

/**
 * Durable lifecycle boundary for one Agent session. PostgreSQL implements it; the harness
 * depends only on this port so Pi conversation memory never becomes workflow state (AGT-REQ-073).
 */
export interface AgentSessionLifecyclePort {
  /** Create-or-get the one authoritative session for a run and open an execution attempt (DAT-REQ-199). */
  beginSession(input: BeginAgentSessionInput): Promise<AgentSessionStart>;
  /** Append one committed step, its invocation result or reuse lineage, and cumulative budget, exactly once. */
  commitStep(input: CommitAgentStepInput): Promise<CommitAgentStepResult>;
  /** Record exactly one terminal reason and close the attempt. */
  terminalizeSession(input: TerminalizeAgentSessionInput): Promise<AgentSessionTerminalResult>;
  /** Read the trusted snapshot without opening an attempt. */
  loadSnapshot(runId: RunId): Promise<AgentRecoverySnapshot | undefined>;
}

export interface OfflineIssueResult {
  readonly origin: "agent" | "system";
  readonly code: string;
  readonly description: string;
  readonly recommendedAction: string;
}

export interface OfflineReportInput {
  readonly resultRevisionId: string;
  readonly findings: readonly {
    ruleId: string;
    ruleVersion: string;
    ruleSetId: string;
    ruleSetVersion: string;
    inputSnapshotId: string;
    resultRevisionId: string;
    status: string;
    reasonCode: string;
    materialInputRefs: readonly string[];
  }[];
  readonly recommendedDisposition: "ready_for_downstream_processing" | "additional_documents_needed" | "human_review_required";
}

export interface OfflineDeterministicResult extends OfflineReportInput {
  readonly evidence: readonly OfflineEvidenceResult[];
  readonly claims: readonly OfflineClaimResult[];
  readonly candidates: readonly ExtractionCandidate[];
  readonly reconciliations: readonly PersistedCandidateReconciliation[];
  readonly gaps?: readonly ExtractionGap[];
  readonly gapResolutions?: readonly GapResolution[];
  readonly eligibility?: AgentEligibilityDecision;
}

export interface OfflineReportResult {
  readonly reportAvailability: "ready" | "unavailable";
  readonly reportFailureReason?: string;
  readonly summary: string;
  readonly issues: readonly OfflineIssueResult[];
  readonly modelLabel: string;
  readonly estimatedCost?: string;
  readonly session?: AgentSessionTrace;
  readonly originalSubmission?: unknown;
}

export interface OfflineCaseResult extends OfflineDeterministicResult, OfflineReportResult {}

export interface OfflineEvidenceResult {
  readonly evidenceId: string;
  readonly evidenceType: "structured_input" | "page_level";
  readonly applicationSnapshotId?: string;
  readonly jsonPointer?: string;
  readonly documentVersionId?: string;
  readonly pageNumber?: number;
  readonly extractionMethod: "structured_input" | "offline_fixture" | "agent_vlm_extraction" | "agent_ocr_reading";
  readonly processorVersion: string;
}

export interface OfflineClaimResult {
  readonly claimId: string;
  readonly fieldSchemaId: string;
  readonly valueType: "string" | "money" | "date";
  readonly rawValue: string;
  readonly normalizedValue: unknown;
  readonly normalizationVersion: string;
  readonly evidenceIds: readonly string[];
  readonly supportingCandidateIds: readonly string[];
}

export interface PersistedCandidateReconciliation extends CandidateReconciliation {
  readonly reconciliationId: string;
  readonly resultingClaimId?: string;
}

export interface ExtractionCandidate {
  readonly candidateId: string;
  readonly fieldSchemaId: string;
  readonly fieldSchemaVersion: string;
  readonly valueType: "string" | "money" | "date";
  readonly rawValue: string;
  readonly normalizedValue: unknown;
  readonly extractionMethod: string;
  readonly processorVersion: string;
  readonly evidenceIds: readonly string[];
  readonly source: { readonly type: "structured_input"; readonly applicationSnapshotId: string; readonly jsonPointer: string } |
    { readonly type: "logical_document"; readonly logicalDocumentRevisionId: string };
  readonly qualityStatus: "accepted" | "rejected";
}

export interface CandidateReconciliation {
  readonly fieldSchemaId: string;
  readonly method: "single_accepted_candidate";
  readonly version: "1.0.0";
  readonly status: "selected" | "unresolved";
  readonly candidates: readonly { readonly candidateId: string; readonly status: "selected" | "not_selected" }[];
  readonly selectedCandidateId?: string;
  readonly reason: "one_accepted_candidate" | "no_accepted_candidate" | "competing_accepted_candidates";
}

export function reconcileSingleAcceptedCandidate(
  fieldSchemaId: string,
  candidates: readonly ExtractionCandidate[],
): CandidateReconciliation {
  if (candidates.length === 0 || candidates.some((candidate) => candidate.fieldSchemaId !== fieldSchemaId)) {
    throw new Error("Reconciliation candidates must target one declared field schema");
  }
  const accepted = candidates.filter((candidate) => candidate.qualityStatus === "accepted");
  const selected = accepted.length === 1 ? accepted[0] : undefined;
  return {
    fieldSchemaId, method: "single_accepted_candidate", version: "1.0.0",
    status: selected ? "selected" : "unresolved",
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      status: candidate.candidateId === selected?.candidateId ? "selected" : "not_selected",
    })),
    ...(selected ? { selectedCandidateId: selected.candidateId } : {}),
    reason: selected ? "one_accepted_candidate" : accepted.length === 0 ? "no_accepted_candidate" : "competing_accepted_candidates",
  };
}

export interface CaseIntakeCommand {
  readonly applicantDisplayName: string;
  readonly idempotencyKey: string;
  readonly applicationData: Readonly<Record<string, unknown>>;
  readonly documents?: readonly IntakeDocument[];
}

export interface IntakeDocument {
  readonly submittedFilename: string;
  readonly artifact: StoredSourceArtifact;
}

export interface AcceptedCase {
  readonly caseId: CaseId;
  readonly runId: RunId;
  readonly replayed: boolean;
}

export interface CaseCommandService {
  accept(command: CaseIntakeCommand): Promise<AcceptedCase>;
}

export interface ReviewCommandContext {
  readonly caseId: CaseId;
  readonly resultRevisionId: string;
  readonly commandId: string;
}

export interface ReviewCommandService {
  createIssue(command: ReviewCommandContext & {
    readonly expectedCaseVersion: number;
    readonly title: string;
    readonly description: string;
    readonly recommendedAction: string;
    readonly supportingReferences: readonly string[];
    readonly noReferenceReason?: string;
  }): Promise<{ readonly issueId: string; readonly issueVersion: number; readonly caseVersion: number }>;
  editIssue(command: ReviewCommandContext & {
    readonly issueId: string;
    readonly expectedIssueVersion: number;
    readonly title: string;
    readonly description: string;
    readonly recommendedAction: string;
    readonly supportingReferences: readonly string[];
    readonly noReferenceReason?: string;
  }): Promise<{ readonly issueVersion: number }>;
  resolveIssue(command: ReviewCommandContext & {
    readonly issueId: string;
    readonly expectedIssueVersion: number;
    readonly action: "accept_signal" | "dismiss_signal";
    readonly reason?: string;
  }): Promise<{ readonly issueVersion: number; readonly reviewState: "confirmed" | "ignored" }>;
  saveRequestedChange(command: ReviewCommandContext & {
    readonly issueId: string;
    readonly text: string;
    readonly included: boolean;
  }): Promise<{ readonly draftRevisionId: string; readonly revision: number }>;
  submitFinalReview(command: ReviewCommandContext & {
    readonly expectedCaseVersion: number;
    readonly action: "request_changes" | "escalate_review" | "clear_for_downstream";
    readonly selectedDraftRevisionIds: readonly string[];
    readonly internalNote?: string;
  }): Promise<{ readonly finalReviewId: string; readonly caseVersion: number; readonly action: "request_changes" | "escalate_review" | "clear_for_downstream" }>;
}

export interface CaseStatus {
  readonly caseId: CaseId;
  readonly applicantDisplayName: string;
  readonly lifecycle: "processing" | "ready_for_review" | "review_complete" | "processing_exception";
  readonly progress: "submitted" | "extracted" | "agent_checked" | "human_review" | "outcome";
  readonly resultAvailability: "pending" | "ready" | "unavailable";
  readonly version: number;
  readonly finalReviewAction?: "request_changes" | "escalate_review" | "clear_for_downstream";
}

export interface CaseQueryService {
  get(caseId: CaseId): Promise<CaseStatus>;
  list(view: "review" | "changes_requested" | "completed"): Promise<readonly QueueCaseView[]>;
}

export interface QueueCaseView {
  readonly caseId: CaseId;
  readonly applicantDisplayName: string;
  readonly summary: string;
  readonly issueCount: number;
  readonly workflowStatus: "processing" | "ready_for_review" | "escalated" | "changes_requested" | "ready_for_handoff";
  readonly lifecycle: CaseStatus["lifecycle"];
  readonly waitingSince: string;
  readonly version: number;
}

export interface AgentReportView {
  readonly availability: "ready" | "pending" | "unavailable";
  readonly failureReason?: string;
  readonly resultRevision?: { readonly id: string; readonly revision: number };
  readonly summary?: string;
  readonly issueLinks: readonly string[];
  readonly checkedFacts: readonly { ruleId: string; statement: string; sourceType: "deterministic_check"; status: "passed"; references: readonly string[] }[];
}

export interface AgentLogSessionView {
  readonly harnessLabel: string;
  readonly mode: AgentSessionMode;
  readonly status: AgentSessionStatus;
  readonly terminalReason?: AgentTerminalReason;
  /** Linked execution attempts; more than one means processing resumed from saved progress. */
  readonly attempts: number;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly usageAvailable: boolean;
}

export interface AgentLogView {
  readonly availability: "pending" | "ready" | "unavailable";
  readonly modelLabel?: string;
  readonly estimatedCost?: { readonly amount: string; readonly currency: "EUR" };
  readonly currentStep: "processing" | "awaiting_human_review" | "review_completed";
  readonly session?: AgentLogSessionView;
  readonly events: readonly { readonly timestamp: string; readonly activity: string; readonly toolLabel?: string }[];
}

export type EvidenceView =
  | {
      readonly evidenceId: string;
      readonly evidenceType: "structured_input";
      readonly jsonPointer: string;
      readonly extractionMethod: string;
      readonly processorVersion: string;
    }
  | {
      readonly evidenceId: string;
      readonly evidenceType: "page_level";
      readonly documentVersionId: string;
      readonly pageNumber: number;
      readonly extractionMethod: string;
      readonly processorVersion: string;
    };

export interface ApplicationDataView {
  readonly groups: readonly {
    group: "applicant" | "contact" | "employment" | "income";
    fields: readonly { key: string; displayValue: string; jsonPointer: string }[];
  }[];
  readonly submissionHistory: {
    initialSubmittedAt: string;
    latestSubmittedAt: string;
    applicationDataUpdatedAt: string;
  };
}

export interface DocumentView {
  readonly documentId: string;
  readonly physicalDocumentId: string;
  readonly version: number;
  readonly submittedFilename: string;
  readonly mediaType: string;
  readonly pageCount: number;
}

export interface DocumentPageView {
  readonly documentId: string;
  readonly pageNumber: number;
  readonly needsOcr: boolean;
  readonly ocrReason?: string;
  readonly hasTable: boolean;
  readonly hasColumns: boolean;
  readonly nativeCharacterCount: number;
  readonly nativeTextAvailable: boolean;
  readonly renderAvailable: boolean;
}

export interface NativeTextArtifactView {
  readonly objectKey: string;
  readonly byteSize: number;
  readonly mediaType: "text/markdown";
}

export interface SourceDocumentArtifactView {
  readonly objectKey: string;
  readonly byteSize: number;
  readonly mediaType: SupportedMediaType;
}

export interface PageRenderArtifactView {
  readonly objectKey: string;
  readonly byteSize: number;
  readonly mediaType: "image/png";
}

export interface ReviewIssueView {
  readonly issueId: string;
  readonly origin: "agent" | "system" | "human";
  readonly code: string;
  readonly title?: string;
  readonly description: string;
  readonly recommendedAction: string;
  readonly reviewState: "pending" | "confirmed" | "ignored";
  readonly version: number;
  readonly supportingReferences: readonly string[];
  readonly noReferenceReason?: string;
  readonly editRevision: number;
  readonly requestedChange?: { readonly draftRevisionId: string; readonly revision: number; readonly text: string; readonly included: boolean };
}

export interface FindingView {
  readonly findingId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly status: "passed" | "warning" | "failed" | "inconclusive" | "not_applicable";
  readonly reasonCode: string;
  readonly references: readonly string[];
}

export interface DownstreamHandoffView {
  readonly caseId: CaseId;
  readonly status: "ready_for_handoff";
  readonly resultRevision: { readonly id: string; readonly revision: number; readonly sealedAt: string };
  readonly finalReview: {
    readonly id: string;
    readonly action: "clear_for_downstream";
    readonly reviewerId: string;
    readonly completedAt: string;
    readonly resultingCaseVersion: number;
  };
  readonly recommendedDisposition: {
    readonly value: "ready_for_downstream_processing" | "additional_documents_needed" | "human_review_required";
    readonly policyId: string;
    readonly policyVersion: string;
  };
  readonly claims: readonly {
    readonly claimId: string;
    readonly fieldSchemaId: string;
    readonly valueType: string;
    readonly normalizedValue: unknown;
    readonly normalizationVersion: string;
    readonly evidenceReferences: readonly string[];
  }[];
  readonly findings: readonly FindingView[];
}

export interface CaseReviewQueryService {
  getAgentReport(caseId: CaseId): Promise<AgentReportView>;
  getAgentLog(caseId: CaseId): Promise<AgentLogView>;
  getIssues(caseId: CaseId): Promise<readonly ReviewIssueView[]>;
  getEvidence(caseId: CaseId, evidenceId: string): Promise<EvidenceView>;
  listEvidence(caseId: CaseId): Promise<readonly EvidenceView[]>;
  getApplicationData(caseId: CaseId): Promise<ApplicationDataView>;
  getDocuments(caseId: CaseId): Promise<readonly DocumentView[]>;
  getSourceDocumentArtifact(caseId: CaseId, documentId: string): Promise<SourceDocumentArtifactView>;
  getDocumentPage(caseId: CaseId, documentId: string, pageNumber: number): Promise<DocumentPageView>;
  getNativeTextArtifact(caseId: CaseId, documentId: string, pageNumber: number): Promise<NativeTextArtifactView>;
  getPageRenderArtifact(caseId: CaseId, documentId: string, pageNumber: number): Promise<PageRenderArtifactView>;
  getFindings(caseId: CaseId): Promise<readonly FindingView[]>;
  getDownstreamHandoff(caseId: CaseId): Promise<DownstreamHandoffView>;
}

export class CaseNotFoundError extends Error {
  constructor() {
    super("Case not found");
    this.name = "CaseNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with different input");
    this.name = "IdempotencyConflictError";
  }
}

export class ReviewConflictError extends Error {
  constructor(readonly code: "stale_review" | "review_incomplete" | "invalid_review_action", message: string) {
    super(message);
    this.name = "ReviewConflictError";
  }
}

export class HandoffUnavailableError extends Error {
  constructor() {
    super("The case is not ready for downstream handoff");
    this.name = "HandoffUnavailableError";
  }
}

export interface InspectDocumentPort {
  inspect(caseId: CaseId, runId: RunId): Promise<void>;
}

export interface ExtractDocumentsPort {
  extract(caseId: CaseId, runId: RunId): Promise<void>;
}

export interface ValidateCasePort {
  validate(caseId: CaseId, runId: RunId): Promise<void>;
}

export interface GenerateAgentReportPort {
  generate(caseId: CaseId, runId: RunId): Promise<void>;
}

export interface CasePipelinePorts {
  readonly inspector: InspectDocumentPort;
  readonly extractor: ExtractDocumentsPort;
  readonly validator: ValidateCasePort;
  readonly agentReporter: GenerateAgentReportPort;
}

export async function processCase(
  caseId: CaseId,
  runId: RunId,
  ports: CasePipelinePorts,
): Promise<void> {
  await ports.inspector.inspect(caseId, runId);
  await ports.extractor.extract(caseId, runId);
  await ports.validator.validate(caseId, runId);
  await ports.agentReporter.generate(caseId, runId);
}
