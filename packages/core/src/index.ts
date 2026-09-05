export type CaseId = string;
export type RunId = string;

export type SupportedMediaType = "application/pdf" | "image/jpeg" | "image/png";

export interface ObjectStore {
  put(objectKey: string, content: AsyncIterable<Uint8Array>, mediaType: SupportedMediaType): Promise<void>;
  get(objectKey: string): Promise<AsyncIterable<Uint8Array>>;
  remove(objectKey: string): Promise<void>;
}

export interface StoredSourceArtifact {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly detectedMediaType: SupportedMediaType;
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

export interface OfflineCaseResult {
  readonly resultRevisionId: string;
  readonly reportAvailability: "ready" | "unavailable";
  readonly reportFailureReason?: string;
  readonly summary: string;
  readonly issues: readonly OfflineIssueResult[];
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
  readonly evidence: readonly OfflineEvidenceResult[];
  readonly claims: readonly OfflineClaimResult[];
  readonly modelLabel: string;
  readonly estimatedCost: string;
}

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

export interface CaseStatus {
  readonly caseId: CaseId;
  readonly applicantDisplayName: string;
  readonly lifecycle: "processing" | "ready_for_review" | "review_complete" | "processing_exception";
  readonly progress: "submitted" | "extracted" | "agent_checked" | "human_review" | "outcome";
  readonly resultAvailability: "pending" | "ready" | "unavailable";
  readonly version: number;
}

export interface CaseQueryService {
  get(caseId: CaseId): Promise<CaseStatus>;
}

export interface AgentReportView {
  readonly availability: "ready" | "pending" | "unavailable";
  readonly summary?: string;
  readonly issueLinks: readonly string[];
  readonly checkedFacts: readonly { statement: string; sourceType: "deterministic_check"; status: "passed"; references: readonly string[] }[];
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

export interface ReviewIssueView {
  readonly issueId: string;
  readonly origin: "agent" | "human";
  readonly code: string;
  readonly description: string;
  readonly recommendedAction: string;
  readonly reviewState: "pending" | "confirmed" | "ignored";
  readonly version: number;
}

export interface CaseReviewQueryService {
  getAgentReport(caseId: CaseId): Promise<AgentReportView>;
  getIssues(caseId: CaseId): Promise<readonly ReviewIssueView[]>;
  getEvidence(caseId: CaseId, evidenceId: string): Promise<EvidenceView>;
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
