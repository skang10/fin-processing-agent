import { Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CaseLifecycleSchema = Type.Union([
  Type.Literal("processing"),
  Type.Literal("ready_for_review"),
  Type.Literal("review_complete"),
  Type.Literal("processing_exception"),
]);

export const CaseAcceptedSchema = Type.Object({
  case_id: Type.String({ minLength: 1 }),
  run_id: Type.String({ minLength: 1 }),
  lifecycle: CaseLifecycleSchema,
  status_url: Type.String({ minLength: 1 }),
  request_id: Type.String({ minLength: 1 }),
});

export const CaseProjectionSchema = Type.Object({
  case_id: Type.String({ minLength: 1 }),
  applicant_display_name: Type.String({ minLength: 1 }),
  lifecycle: CaseLifecycleSchema,
  progress: Type.Union([
    Type.Literal("submitted"),
    Type.Literal("extracted"),
    Type.Literal("agent_checked"),
    Type.Literal("human_review"),
    Type.Literal("outcome"),
  ]),
  result_availability: Type.Union([
    Type.Literal("pending"),
    Type.Literal("ready"),
    Type.Literal("unavailable"),
  ]),
  version: Type.Integer({ minimum: 1 }),
  links: Type.Object({
    agent_report: Type.String(),
    application_data: Type.String(),
    documents: Type.String(),
    findings: Type.String(),
    issues: Type.String(),
    final_review: Type.String(),
  }),
});

export const ProblemDetailsSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  request_id: Type.String(),
  detail: Type.Optional(Type.String()),
});

export type CaseAccepted = Static<typeof CaseAcceptedSchema>;
export type CaseProjection = Static<typeof CaseProjectionSchema>;

export const CaseProcessingJobSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  run_id: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export type CaseProcessingJob = Static<typeof CaseProcessingJobSchema>;

const CaseProcessingJobValueSchema = Type.Object({
  case_id: Type.String(),
  run_id: Type.String(),
}, { additionalProperties: false });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCaseProcessingJob(value: unknown): value is CaseProcessingJob {
  return Value.Check(CaseProcessingJobValueSchema, value)
    && UUID_PATTERN.test(value.case_id)
    && UUID_PATTERN.test(value.run_id);
}

export const AgentReportSchema = Type.Object({
  availability: Type.Union([Type.Literal("ready"), Type.Literal("pending"), Type.Literal("unavailable")]),
  result_revision: Type.Optional(Type.Object({
    id: Type.String({ format: "uuid" }), revision: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false })),
  summary: Type.Optional(Type.String()),
  issue_links: Type.Array(Type.String()),
  checked_facts: Type.Array(Type.Object({
    statement: Type.String(),
    source_type: Type.Literal("deterministic_check"),
    status: Type.Literal("passed"),
    references: Type.Array(Type.String()),
  })),
});

const EvidenceBase = {
  evidence_id: Type.String({ format: "uuid" }),
  extraction_method: Type.String(),
  processor_version: Type.String(),
};

export const EvidenceProjectionSchema = Type.Union([
  Type.Object({
    ...EvidenceBase,
    evidence_type: Type.Literal("structured_input"),
    json_pointer: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    ...EvidenceBase,
    evidence_type: Type.Literal("page_level"),
    document_version_id: Type.String({ format: "uuid" }),
    page_number: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }),
]);

export const FindingsProjectionSchema = Type.Object({
  findings: Type.Array(Type.Object({
    finding_id: Type.String({ format: "uuid" }),
    rule_id: Type.String(),
    rule_version: Type.String(),
    status: Type.Union([
      Type.Literal("passed"), Type.Literal("warning"), Type.Literal("failed"),
      Type.Literal("inconclusive"), Type.Literal("not_applicable"),
    ]),
    reason_code: Type.String(),
    references: Type.Array(Type.String()),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const ApplicationDataProjectionSchema = Type.Object({
  groups: Type.Array(Type.Object({
    group: Type.Union([Type.Literal("applicant"), Type.Literal("contact"), Type.Literal("employment"), Type.Literal("income")]),
    fields: Type.Array(Type.Object({
      key: Type.String(), display_value: Type.String(), json_pointer: Type.String(),
    }, { additionalProperties: false })),
  }, { additionalProperties: false })),
  submission_history: Type.Object({
    initial_submitted_at: Type.String(),
    latest_submitted_at: Type.String(),
    application_data_updated_at: Type.String(),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const DocumentsProjectionSchema = Type.Object({
  documents: Type.Array(Type.Object({
    document_id: Type.String({ format: "uuid" }),
    physical_document_id: Type.String({ format: "uuid" }),
    version: Type.Integer({ minimum: 1 }),
    submitted_filename: Type.String(),
    media_type: Type.String(),
    page_count: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const DocumentPageProjectionSchema = Type.Object({
  document_id: Type.String({ format: "uuid" }),
  page_number: Type.Integer({ minimum: 1 }),
  needs_ocr: Type.Boolean(),
  ocr_reason: Type.Optional(Type.String()),
  has_table: Type.Boolean(),
  has_columns: Type.Boolean(),
  native_character_count: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const ReviewIssueSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  origin: Type.Union([Type.Literal("agent"), Type.Literal("human")]),
  code: Type.String(),
  description: Type.String(),
  recommended_action: Type.String(),
  review_state: Type.Union([Type.Literal("pending"), Type.Literal("confirmed"), Type.Literal("ignored")]),
  version: Type.Integer({ minimum: 1 }),
});

export const ReviewIssuesSchema = Type.Object({ issues: Type.Array(ReviewIssueSchema) });

export const ReviewSignalSchema = Type.Union([
  Type.Literal("document_missing"), Type.Literal("document_type_uncertain"),
  Type.Literal("document_boundary_uncertain"), Type.Literal("field_missing"),
  Type.Literal("field_low_confidence"), Type.Literal("evidence_missing"),
  Type.Literal("evidence_ambiguous"), Type.Literal("conflicting_candidates"),
  Type.Literal("validation_finding_requires_attention"), Type.Literal("instruction_like_content_observed"),
  Type.Literal("processing_failure"), Type.Literal("agent_budget_exhausted"),
  Type.Literal("agent_report_unavailable"),
]);

export const SuggestedActionSchema = Type.Union([
  Type.Literal("inspect_evidence"), Type.Literal("compare_claims"),
  Type.Literal("verify_extracted_value"), Type.Literal("review_document_boundary"),
  Type.Literal("review_missing_document"), Type.Literal("review_conflicting_candidates"),
  Type.Literal("review_agent_recovery"), Type.Literal("rerun_bounded_extraction"),
  Type.Literal("edit_issue"), Type.Literal("request_changes"), Type.Literal("escalate_review"),
]);

export const CaseReviewBriefCandidateSchema = Type.Object({
  schema_version: Type.Literal("1.0.0"),
  result_revision_id: Type.String({ minLength: 1 }),
  report_status: Type.Literal("ready"),
  summary: Type.String({ minLength: 1, maxLength: 500 }),
  attention_items: Type.Array(Type.Object({
    signal: ReviewSignalSchema,
    suggested_action: SuggestedActionSchema,
    description: Type.String({ minLength: 1, maxLength: 500 }),
    references: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 }),
  }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false });

export type CaseReviewBriefCandidate = Static<typeof CaseReviewBriefCandidateSchema>;
