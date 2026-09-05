import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey(),
  applicantDisplayName: text("applicant_display_name").notNull(),
  lifecycle: text("lifecycle").notNull(),
  version: integer("version").notNull().default(1),
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
}, (table) => [uniqueIndex("page_inspection_number_uq").on(table.documentInspectionId, table.pageNumber)]);

export const processingRuns = pgTable("processing_runs", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  inputRevisionId: uuid("input_revision_id").notNull().references(() => inputRevisions.id),
  workflowVersion: text("workflow_version").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("processing_runs_case_idx").on(table.caseId)]);

export const resultRevisions = pgTable("result_revisions", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  inputRevisionId: uuid("input_revision_id").notNull().references(() => inputRevisions.id),
  revision: integer("revision").notNull(),
  revisionType: text("revision_type").notNull(),
  sealedAt: timestamp("sealed_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("result_revision_run_number_uq").on(table.runId, table.revision)]);

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

export const agentReports = pgTable("agent_reports", {
  id: uuid("id").primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  runId: uuid("run_id").notNull().references(() => processingRuns.id),
  availability: text("availability").notNull(),
  summary: text("summary").notNull(),
  issueLinks: jsonb("issue_links").notNull(),
  checkedFacts: jsonb("checked_facts").notNull(),
  modelLabel: text("model_label").notNull(),
  estimatedCost: text("estimated_cost").notNull(),
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
