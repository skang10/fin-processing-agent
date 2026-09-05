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
  readonly summary: string;
  readonly issues: readonly OfflineIssueResult[];
  readonly modelLabel: string;
  readonly estimatedCost: string;
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
  readonly checkedFacts: readonly { statement: string; status: string; references: readonly string[] }[];
}

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
