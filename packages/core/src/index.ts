export type CaseId = string;
export type RunId = string;

export interface CaseIntakeCommand {
  readonly applicantDisplayName: string;
  readonly idempotencyKey: string;
}

export interface AcceptedCase {
  readonly caseId: CaseId;
  readonly runId: RunId;
}

export interface CaseCommandService {
  accept(command: CaseIntakeCommand): Promise<AcceptedCase>;
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
