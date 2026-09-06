import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey(),
  applicantDisplayName: text("applicant_display_name").notNull(),
  lifecycle: text("lifecycle").notNull(),
  version: integer("version").notNull().default(1),
  currentRunId: uuid("current_run_id").references((): AnyPgColumn => processingRuns.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationSnapshots = pgTable("application_snapshots", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  schemaId: text("schema_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  contentHash: text("content_hash").notNull(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("application_snapshot_case_idx").on(table.caseId)]);

export const inputRevisions = pgTable("input_revisions", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  applicationSnapshotId: uuid("application_snapshot_id").notNull().references(() => applicationSnapshots.id),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("input_revision_case_number_uq").on(table.caseId, table.revision)]);

export const caseStateTransitions = pgTable("case_state_transitions", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id"),
  priorState: text("prior_state"),
  newState: text("new_state").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("case_transition_case_idx").on(table.caseId, table.createdAt)]);

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  detectedMediaType: text("detected_media_type").notNull(),
  artifactKind: text("artifact_kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("artifact_object_key_uq").on(table.objectKey), index("artifact_case_idx").on(table.caseId)]);

export const physicalDocuments = pgTable("physical_documents", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("physical_document_case_idx").on(table.caseId)]);

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey(),
  physicalDocumentId: uuid("physical_document_id").notNull().references(() => physicalDocuments.id),
  sourceArtifactId: uuid("source_artifact_id").notNull().references(() => artifacts.id),
  version: integer("version").notNull(),
  submittedFilename: text("submitted_filename").notNull(),
  detectedMediaType: text("detected_media_type").notNull(),
  integrityState: text("integrity_state").notNull(),
  readabilityState: text("readability_state").notNull(),
  malwareScanState: text("malware_scan_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("document_version_number_uq").on(table.physicalDocumentId, table.version)]);

export const inputDocumentSelections = pgTable("input_document_selections", {
  id: uuid("id").primaryKey(),
  inputRevisionId: uuid("input_revision_id").notNull().references(() => inputRevisions.id),
  physicalDocumentId: uuid("physical_document_id").notNull().references(() => physicalDocuments.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
}, (table) => [uniqueIndex("input_selection_revision_document_uq").on(table.inputRevisionId, table.physicalDocumentId)]);

export const documentInspections = pgTable("document_inspections", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  processor: text("processor").notNull(),
  processorVersion: text("processor_version").notNull(),
  pdfType: text("pdf_type").notNull(),
  routingSignal: text("routing_signal").notNull(),
  isComplex: boolean("is_complex").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("inspection_run_document_uq").on(table.runId, table.documentVersionId)]);

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey(),
  documentInspectionId: uuid("document_inspection_id").notNull().references(() => documentInspections.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  pageNumber: integer("page_number").notNull(),
  needsOcr: boolean("needs_ocr").notNull(),
  ocrReason: text("ocr_reason"),
  hasTable: boolean("has_table").notNull(),
  hasColumns: boolean("has_columns").notNull(),
  nativeCharacterCount: integer("native_character_count").notNull(),
  nativeTextArtifactId: uuid("native_text_artifact_id").references(() => artifacts.id),
  renderArtifactId: uuid("render_artifact_id").references(() => artifacts.id),
  renderWidth: integer("render_width"),
  renderHeight: integer("render_height"),
  renderDpi: integer("render_dpi"),
  rendererVersion: text("renderer_version"),
}, (table) => [uniqueIndex("page_inspection_number_uq").on(table.documentInspectionId, table.pageNumber)]);

export const pageOcrOutputs = pgTable("page_ocr_outputs", {
  id: uuid("id").primaryKey(),
  pageId: uuid("page_id").notNull().references(() => pages.id),
  artifactId: uuid("artifact_id").notNull().references(() => artifacts.id),
  engine: text("engine").notNull(),
  engineVersion: text("engine_version").notNull(),
  modelAssetVersion: text("model_asset_version").notNull(),
  languages: jsonb("languages").notNull(),
  coordinateSpace: text("coordinate_space").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("page_ocr_output_page_uq").on(table.pageId)]);

export const pageClassifications = pgTable("page_classifications", {
  id: uuid("id").primaryKey(),
  pageId: uuid("page_id").notNull().references(() => pages.id),
  selectedType: text("selected_type").notNull(),
  method: text("method").notNull(),
  version: text("version").notNull(),
  qualityStatus: text("quality_status").notNull(),
  rawConfidence: jsonb("raw_confidence").notNull(),
  alternatives: jsonb("alternatives").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("page_classification_page_uq").on(table.pageId)]);

export const boundaryPredictions = pgTable("boundary_predictions", {
  id: uuid("id").primaryKey(),
  pageId: uuid("page_id").notNull().references(() => pages.id),
  startsNewDocument: boolean("starts_new_document").notNull(),
  method: text("method").notNull(),
  version: text("version").notNull(),
  rawConfidence: jsonb("raw_confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("boundary_prediction_page_uq").on(table.pageId)]);

export const processingRuns = pgTable("processing_runs", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  inputRevisionId: uuid("input_revision_id").notNull().references(() => inputRevisions.id),
  workflowVersion: text("workflow_version").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("processing_runs_case_idx").on(table.caseId)]);

export const processingRunTransitions = pgTable("processing_run_transitions", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  priorStatus: text("prior_status"),
  newStatus: text("new_status").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("run_transition_idx").on(table.runId, table.createdAt)]);

export const logicalDocumentRevisions = pgTable("logical_document_revisions", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  startPage: integer("start_page").notNull(),
  endPage: integer("end_page").notNull(),
  documentType: text("document_type").notNull(),
  uncertain: boolean("uncertain").notNull(),
  groupingMethod: text("grouping_method").notNull(),
  groupingVersion: text("grouping_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("logical_document_range_uq").on(table.runId, table.documentVersionId, table.startPage, table.endPage)]);

export const logicalDocumentPages = pgTable("logical_document_pages", {
  id: uuid("id").primaryKey(),
  logicalDocumentRevisionId: uuid("logical_document_revision_id").notNull().references(() => logicalDocumentRevisions.id),
  pageId: uuid("page_id").notNull().references(() => pages.id),
}, (table) => [
  uniqueIndex("logical_document_page_uq").on(table.logicalDocumentRevisionId, table.pageId),
  uniqueIndex("machine_grouped_page_uq").on(table.pageId),
]);

export const resultRevisions = pgTable("result_revisions", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  inputRevisionId: uuid("input_revision_id").notNull().references(() => inputRevisions.id),
  revision: integer("revision").notNull(),
  revisionType: text("revision_type").notNull(),
  sealedAt: timestamp("sealed_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("result_revision_run_number_uq").on(table.runId, table.revision)]);

export const evidenceRecords = pgTable("evidence_records", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  evidenceType: text("evidence_type").notNull(),
  applicationSnapshotId: uuid("application_snapshot_id").references(() => applicationSnapshots.id),
  jsonPointer: text("json_pointer"),
  documentVersionId: uuid("document_version_id").references(() => documentVersions.id),
  pageNumber: integer("page_number"),
  extractionMethod: text("extraction_method").notNull(),
  processorVersion: text("processor_version").notNull(),
}, (table) => [index("evidence_run_idx").on(table.runId)]);

export const extractionCandidates = pgTable("extraction_candidates", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  fieldSchemaId: text("field_schema_id").notNull(),
  fieldSchemaVersion: text("field_schema_version").notNull(),
  valueType: text("value_type").notNull(),
  rawValue: text("raw_value").notNull(),
  normalizedValue: jsonb("normalized_value").notNull(),
  extractionMethod: text("extraction_method").notNull(),
  processorVersion: text("processor_version").notNull(),
  qualityStatus: text("quality_status").notNull(),
  applicationSnapshotId: uuid("application_snapshot_id").references(() => applicationSnapshots.id),
  jsonPointer: text("json_pointer"),
  logicalDocumentRevisionId: uuid("logical_document_revision_id").references(() => logicalDocumentRevisions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("candidate_run_idx").on(table.runId),
  check("candidate_source_ck", sql`(
    ${table.applicationSnapshotId} is not null and ${table.jsonPointer} is not null and ${table.logicalDocumentRevisionId} is null
  ) or (
    ${table.applicationSnapshotId} is null and ${table.jsonPointer} is null and ${table.logicalDocumentRevisionId} is not null
  )`),
]);

export const candidateEvidenceLinks = pgTable("candidate_evidence_links", {
  id: uuid("id").primaryKey(),
  candidateId: uuid("candidate_id").notNull().references(() => extractionCandidates.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidenceRecords.id),
  relationship: text("relationship").notNull(),
}, (table) => [uniqueIndex("candidate_evidence_uq").on(table.candidateId, table.evidenceId)]);

export const claimRecords = pgTable("claim_records", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  fieldSchemaId: text("field_schema_id").notNull(),
  valueType: text("value_type").notNull(),
  rawValue: text("raw_value").notNull(),
  normalizedValue: jsonb("normalized_value").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
}, (table) => [index("claim_run_idx").on(table.runId)]);

export const claimEvidenceLinks = pgTable("claim_evidence_links", {
  id: uuid("id").primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => claimRecords.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidenceRecords.id),
  relationship: text("relationship").notNull(),
}, (table) => [uniqueIndex("claim_evidence_uq").on(table.claimId, table.evidenceId)]);

export const reconciliationDecisions = pgTable("reconciliation_decisions", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  fieldSchemaId: text("field_schema_id").notNull(),
  method: text("method").notNull(),
  methodVersion: text("method_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  selectedCandidateId: uuid("selected_candidate_id").references(() => extractionCandidates.id),
  resultingClaimId: uuid("resulting_claim_id").references(() => claimRecords.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("reconciliation_run_idx").on(table.runId)]);

export const reconciliationCandidateLinks = pgTable("reconciliation_candidate_links", {
  id: uuid("id").primaryKey(),
  reconciliationId: uuid("reconciliation_id").notNull().references(() => reconciliationDecisions.id),
  candidateId: uuid("candidate_id").notNull().references(() => extractionCandidates.id),
  status: text("status").notNull(),
}, (table) => [uniqueIndex("reconciliation_candidate_uq").on(table.reconciliationId, table.candidateId)]);

export const claimCandidateLinks = pgTable("claim_candidate_links", {
  id: uuid("id").primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => claimRecords.id),
  candidateId: uuid("candidate_id").notNull().references(() => extractionCandidates.id),
  relationship: text("relationship").notNull(),
}, (table) => [uniqueIndex("claim_candidate_uq").on(table.claimId, table.candidateId)]);

export const validationFindings = pgTable("validation_findings", {
  id: uuid("id").primaryKey(),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  ruleId: text("rule_id").notNull(),
  ruleVersion: text("rule_version").notNull(),
  ruleSetId: text("rule_set_id").notNull(),
  ruleSetVersion: text("rule_set_version").notNull(),
  status: text("status").notNull(),
  reasonCode: text("reason_code").notNull(),
  materialInputRefs: jsonb("material_input_refs").notNull(),
}, (table) => [uniqueIndex("finding_result_rule_uq").on(table.resultRevisionId, table.ruleId)]);

export const recommendedDispositions = pgTable("recommended_dispositions", {
  id: uuid("id").primaryKey(),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  policyId: text("policy_id").notNull(),
  policyVersion: text("policy_version").notNull(),
  disposition: text("disposition").notNull(),
  reasonCodes: jsonb("reason_codes").notNull(),
}, (table) => [uniqueIndex("disposition_result_uq").on(table.resultRevisionId)]);

export const stageExecutions = pgTable("stage_executions", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  stageType: text("stage_type").notNull(),
  status: text("status").notNull(),
  sequence: integer("sequence").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("stage_run_type_uq").on(table.runId, table.stageType)]);

export const reviewIssues = pgTable("review_issues", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  origin: text("origin").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  reviewState: text("review_state").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("review_issue_run_code_uq").on(table.runId, table.code)]);

export const reviewIssueActions = pgTable("review_issue_actions", {
  id: uuid("id").primaryKey(),
  issueId: uuid("issue_id").notNull().references(() => reviewIssues.id),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  action: text("action").notNull(),
  reason: text("reason"),
  actorId: text("actor_id").notNull(),
  commandId: text("command_id").notNull(),
  resultingVersion: integer("resulting_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("review_issue_action_command_uq").on(table.actorId, table.commandId)]);

export const reviewIssueEditRevisions = pgTable("review_issue_edit_revisions", {
  id: uuid("id").primaryKey(),
  issueId: uuid("issue_id").notNull().references(() => reviewIssues.id),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  supportingReferences: jsonb("supporting_references").notNull(),
  noReferenceReason: text("no_reference_reason"),
  actorId: text("actor_id").notNull(),
  commandId: text("command_id").notNull(),
  resultingIssueVersion: integer("resulting_issue_version").notNull(),
  resultingCaseVersion: integer("resulting_case_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("review_issue_edit_revision_uq").on(table.issueId, table.revision),
  uniqueIndex("review_issue_edit_command_uq").on(table.actorId, table.commandId),
]);

export const requestedChangeRevisions = pgTable("requested_change_revisions", {
  id: uuid("id").primaryKey(),
  issueId: uuid("issue_id").notNull().references(() => reviewIssues.id),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  revision: integer("revision").notNull(),
  agentProposedText: text("agent_proposed_text"),
  currentText: text("current_text").notNull(),
  included: boolean("included").notNull(),
  actorId: text("actor_id").notNull(),
  commandId: text("command_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("requested_change_issue_revision_uq").on(table.issueId, table.revision),
  uniqueIndex("requested_change_command_uq").on(table.actorId, table.commandId),
]);

export const finalReviews = pgTable("final_reviews", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  resultRevisionId: uuid("result_revision_id").notNull().references(() => resultRevisions.id),
  action: text("action").notNull(),
  selectedDraftRevisionIds: jsonb("selected_draft_revision_ids").notNull(),
  internalNote: text("internal_note"),
  actorId: text("actor_id").notNull(),
  commandId: text("command_id").notNull(),
  resultingCaseVersion: integer("resulting_case_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("final_review_case_uq").on(table.caseId),
  uniqueIndex("final_review_command_uq").on(table.actorId, table.commandId),
]);

export const extractionGaps = pgTable("extraction_gaps", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  fieldSchemaId: text("field_schema_id").notNull(),
  fieldSchemaVersion: text("field_schema_version").notNull(),
  valueType: text("value_type").notNull(),
  required: boolean("required").notNull(),
  originatingStage: text("originating_stage").notNull(),
  reasonCode: text("reason_code").notNull(),
  attemptedPaths: jsonb("attempted_paths").notNull(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  logicalDocumentRevisionId: uuid("logical_document_revision_id").notNull().references(() => logicalDocumentRevisions.id),
  pageNumber: integer("page_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("extraction_gap_run_idx").on(table.runId)]);

export const gapResolutions = pgTable("gap_resolutions", {
  id: uuid("id").primaryKey(),
  gapId: uuid("gap_id").notNull().references(() => extractionGaps.id),
  resolutionType: text("resolution_type").notNull(),
  reference: text("reference").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("gap_resolution_gap_idx").on(table.gapId)]);

export const agentEligibilityDecisions = pgTable("agent_eligibility_decisions", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  policyVersion: text("policy_version").notNull(),
  gapIds: jsonb("gap_ids").notNull(),
  decision: text("decision").notNull(),
  reasonCodes: jsonb("reason_codes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("agent_eligibility_run_idx").on(table.runId)]);

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  resultRevisionId: uuid("result_revision_id").references(() => resultRevisions.id),
  mode: text("mode").notNull(),
  harnessId: text("harness_id").notNull(),
  harnessVersion: text("harness_version").notNull(),
  modelLabel: text("model_label").notNull(),
  modelRoute: text("model_route").notNull(),
  promptVersion: text("prompt_version").notNull(),
  promptHash: text("prompt_hash").notNull(),
  configurationVersion: text("configuration_version").notNull(),
  toolRegistryVersion: text("tool_registry_version").notNull(),
  offeredTools: jsonb("offered_tools").notNull(),
  budget: jsonb("budget").notNull(),
  iterations: integer("iterations").notNull(),
  toolCalls: integer("tool_calls").notNull(),
  usage: jsonb("usage").notNull(),
  estimatedCost: text("estimated_cost"),
  terminalReason: text("terminal_reason").notNull(),
  boundGapIds: jsonb("bound_gap_ids"),
  submittedCandidateIds: jsonb("submitted_candidate_ids"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("agent_session_run_idx").on(table.runId), index("agent_session_case_idx").on(table.caseId)]);

export const agentSteps = pgTable("agent_steps", {
  id: uuid("id").primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => agentSessions.id),
  sequence: integer("sequence").notNull(),
  toolName: text("tool_name").notNull(),
  toolVersion: text("tool_version"),
  argumentHash: text("argument_hash").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  budgetState: jsonb("budget_state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("agent_step_sequence_uq").on(table.sessionId, table.sequence)]);

export const agentReports = pgTable("agent_reports", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  resultRevisionId: uuid("result_revision_id").references(() => resultRevisions.id),
  sessionId: uuid("session_id").references(() => agentSessions.id),
  availability: text("availability").notNull(),
  verificationStatus: text("verification_status"),
  verificationFailureReason: text("verification_failure_reason"),
  summary: text("summary").notNull(),
  issueLinks: jsonb("issue_links").notNull(),
  checkedFacts: jsonb("checked_facts").notNull(),
  originalSubmission: jsonb("original_submission"),
  modelLabel: text("model_label").notNull(),
  estimatedCost: text("estimated_cost"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("agent_report_run_uq").on(table.runId)]);

export const idempotencyRecords = pgTable("idempotency_records", {
  id: uuid("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  commandType: text("command_type").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idempotency_actor_command_key_uq").on(table.actorId, table.commandType, table.key)]);

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [index("outbox_unpublished_idx").on(table.publishedAt, table.createdAt)]);
