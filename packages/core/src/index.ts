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

export interface OfflineIssueResult {
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
}

export interface OfflineReportResult {
  readonly reportAvailability: "ready" | "unavailable";
  readonly reportFailureReason?: string;
  readonly summary: string;
  readonly issues: readonly OfflineIssueResult[];
  readonly modelLabel: string;
  readonly estimatedCost: string;
}

export interface OfflineCaseResult extends OfflineDeterministicResult, OfflineReportResult {}

export interface OfflineEvidenceResult {
  readonly evidenceId: string;
  readonly evidenceType: "structured_input" | "page_level";
  readonly applicationSnapshotId?: string;
  readonly jsonPointer?: string;
  readonly documentVersionId?: string;
  readonly pageNumber?: number;
  readonly extractionMethod: "structured_input" | "offline_fixture";
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
  readonly resultRevision?: { readonly id: string; readonly revision: number };
  readonly summary?: string;
  readonly issueLinks: readonly string[];
  readonly checkedFacts: readonly { statement: string; sourceType: "deterministic_check"; status: "passed"; references: readonly string[] }[];
}

export interface AgentLogView {
  readonly availability: "pending" | "ready" | "unavailable";
  readonly modelLabel?: string;
  readonly estimatedCost?: { readonly amount: string; readonly currency: "EUR" };
  readonly currentStep: "processing" | "awaiting_human_review" | "review_completed";
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
  readonly origin: "agent" | "human";
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
