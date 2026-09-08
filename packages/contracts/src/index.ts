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
  case_code: Type.String({ pattern: "^FD-[0-9]{4}-[0-9]{4,}$" }),
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
  final_review_action: Type.Optional(Type.Union([
    Type.Literal("request_changes"), Type.Literal("escalate_review"), Type.Literal("clear_for_downstream"),
  ])),
  links: Type.Object({
    agent_report: Type.String(),
    application_data: Type.String(),
    documents: Type.String(),
    findings: Type.String(),
    issues: Type.String(),
    final_review: Type.String(),
    downstream_handoff: Type.String(),
    agent_log: Type.String(),
  }),
});

export const DownstreamHandoffSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  status: Type.Literal("ready_for_handoff"),
  result_revision: Type.Object({
    id: Type.String({ format: "uuid" }), revision: Type.Integer({ minimum: 1 }), sealed_at: Type.String(),
  }, { additionalProperties: false }),
  final_review: Type.Object({
    id: Type.String({ format: "uuid" }), action: Type.Literal("clear_for_downstream"),
    reviewer_id: Type.String(), completed_at: Type.String(), resulting_case_version: Type.Integer({ minimum: 2 }),
  }, { additionalProperties: false }),
  recommended_disposition: Type.Object({
    value: Type.Union([Type.Literal("ready_for_downstream_processing"), Type.Literal("additional_documents_needed"), Type.Literal("human_review_required")]),
    policy_id: Type.String(), policy_version: Type.String(),
  }, { additionalProperties: false }),
  claims: Type.Array(Type.Object({
    claim_id: Type.String({ format: "uuid" }), field_schema_id: Type.String(), value_type: Type.String(),
    normalized_value: Type.Unknown(), normalization_version: Type.String(), evidence_references: Type.Array(Type.String()),
  }, { additionalProperties: false })),
  findings: Type.Array(Type.Object({
    finding_id: Type.String({ format: "uuid" }), rule_id: Type.String(), rule_version: Type.String(),
    status: Type.Union([Type.Literal("passed"), Type.Literal("warning"), Type.Literal("failed"), Type.Literal("inconclusive"), Type.Literal("not_applicable")]),
    reason_code: Type.String(), references: Type.Array(Type.String()),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

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

export const CaseQueueViewSchema = Type.Union([
  Type.Literal("review"), Type.Literal("changes_requested"), Type.Literal("completed"),
]);

export const CaseQueueQuerySchema = Type.Object({
  view: Type.Optional(CaseQueueViewSchema),
}, { additionalProperties: false });

export const CaseQueueSchema = Type.Object({
  view: CaseQueueViewSchema,
  cases: Type.Array(Type.Object({
    case_id: Type.String({ format: "uuid" }),
    case_code: Type.String({ pattern: "^FD-[0-9]{4}-[0-9]{4,}$" }),
    applicant_display_name: Type.String(),
    summary: Type.String(),
    review_method: Type.Union([Type.Literal("manual"), Type.Literal("deterministic"), Type.Literal("agent"), Type.Literal("agent_vlm")]),
    agent_model_label: Type.Optional(Type.String()),
    vlm_model_label: Type.Optional(Type.String()),
    issue_count: Type.Integer({ minimum: 0 }),
    workflow_status: Type.Union([
      Type.Literal("processing"), Type.Literal("ready_for_review"), Type.Literal("escalated"),
      Type.Literal("changes_requested"), Type.Literal("ready_for_handoff"),
    ]),
    lifecycle: CaseLifecycleSchema,
    waiting_since: Type.String(),
    version: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const CaseProcessingJobSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  run_id: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export type CaseProcessingJob = Static<typeof CaseProcessingJobSchema>;

export const DemoAgentModelsSchema = Type.Object({
  default_model: Type.String(),
  models: Type.Array(Type.Object({
    id: Type.String(),
    label: Type.String(),
    paid: Type.Boolean(),
    maximum_case_cost_usd: Type.Optional(Type.String()),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

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
  failure_reason: Type.Optional(Type.String()),
  result_revision: Type.Optional(Type.Object({
    id: Type.String({ format: "uuid" }), revision: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false })),
  summary: Type.Optional(Type.String()),
  issue_links: Type.Array(Type.String()),
  checked_facts: Type.Array(Type.Object({
    rule_id: Type.String(),
    statement: Type.String(),
    source_type: Type.Literal("deterministic_check"),
    status: Type.Literal("passed"),
    references: Type.Array(Type.String()),
  })),
});

export const AgentTerminalReasonSchema = Type.Union([
  Type.Literal("report_submitted"), Type.Literal("report_not_submitted"), Type.Literal("no_progress"),
  Type.Literal("conflicting_candidates"), Type.Literal("iteration_budget_exhausted"), Type.Literal("tool_budget_exhausted"),
  Type.Literal("model_budget_exhausted"), Type.Literal("token_budget_exhausted"), Type.Literal("cost_budget_exhausted"),
  Type.Literal("timeout"), Type.Literal("tool_failure"), Type.Literal("model_unavailable"), Type.Literal("schema_failure"),
  Type.Literal("cancelled_by_workflow"), Type.Literal("internal_error"),
]);

const AgentLogSessionFields = {
  harness_label: Type.String(),
  mode: Type.Literal("case_review"),
  status: Type.Union([Type.Literal("running"), Type.Literal("terminal")]),
  terminal_reason: Type.Optional(AgentTerminalReasonSchema),
  attempts: Type.Integer({ minimum: 1 }),
  iterations: Type.Integer({ minimum: 0 }),
  tool_calls: Type.Integer({ minimum: 0 }),
  model_calls: Type.Integer({ minimum: 0 }),
  usage_available: Type.Boolean(),
  input_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
  output_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
  duration_ms: Type.Optional(Type.Integer({ minimum: 0 })),
};

export const AgentLogSessionSchema = Type.Object(AgentLogSessionFields, { additionalProperties: false });

export const AgentLogSchema = Type.Object({
  availability: Type.Union([Type.Literal("pending"), Type.Literal("ready"), Type.Literal("unavailable")]),
  model_label: Type.Optional(Type.String()),
  estimated_cost: Type.Optional(Type.Object({
    amount: Type.String(), currency: Type.Union([Type.Literal("EUR"), Type.Literal("USD")]),
  }, { additionalProperties: false })),
  current_step: Type.Union([Type.Literal("processing"), Type.Literal("awaiting_human_review"), Type.Literal("review_completed")]),
  session: Type.Optional(AgentLogSessionSchema),
  events: Type.Array(Type.Object({
    timestamp: Type.String(), activity: Type.String(), tool_label: Type.Optional(Type.String()),
    actor: Type.Optional(Type.Union([Type.Literal("system"), Type.Literal("agent"), Type.Literal("agent_document_tool")])),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export const StopAgentReviewResultSchema = Type.Object({
  case_id: Type.String(),
  run_id: Type.String(),
  stopped: Type.Boolean(),
}, { additionalProperties: false });

const EvidenceBase = {
  evidence_id: Type.String({ format: "uuid" }),
  extraction_method: Type.String(),
  processor_version: Type.String(),
  recognized_values: Type.Array(Type.Object({
    field_schema_id: Type.String(), value_type: Type.String(), normalized_value: Type.Unknown(),
  }, { additionalProperties: false })),
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
  Type.Object({
    ...EvidenceBase,
    evidence_type: Type.Literal("page_region"),
    document_version_id: Type.String({ format: "uuid" }),
    page_number: Type.Integer({ minimum: 1 }),
    page_width: Type.Integer({ minimum: 1 }),
    page_height: Type.Integer({ minimum: 1 }),
    page_rotation: Type.Integer(),
    normalized_region: Type.Object({
      x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
      width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }), height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    }, { additionalProperties: false }),
    original_region: Type.Object({
      left: Type.Number({ minimum: 0 }), top: Type.Number({ minimum: 0 }),
      width: Type.Number({ exclusiveMinimum: 0 }), height: Type.Number({ exclusiveMinimum: 0 }),
    }, { additionalProperties: false }),
    coordinate_unit: Type.Literal("render_pixel"),
    coordinate_origin: Type.Literal("top_left"),
  }, { additionalProperties: false }),
]);

export const EvidenceListProjectionSchema = Type.Object({
  evidence: Type.Array(EvidenceProjectionSchema),
}, { additionalProperties: false });

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
    content_url: Type.String(),
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
  native_text_available: Type.Boolean(),
  render_available: Type.Boolean(),
  render_url: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const ReviewIssueSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  origin: Type.Union([Type.Literal("agent"), Type.Literal("system"), Type.Literal("human")]),
  code: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.String(),
  recommended_action: Type.String(),
  review_state: Type.Union([Type.Literal("pending"), Type.Literal("confirmed"), Type.Literal("ignored")]),
  version: Type.Integer({ minimum: 1 }),
  supporting_references: Type.Array(Type.String()),
  no_reference_reason: Type.Optional(Type.String()),
  edit_revision: Type.Integer({ minimum: 0 }),
  requested_change: Type.Optional(Type.Object({
    draft_revision_id: Type.String({ format: "uuid" }),
    revision: Type.Integer({ minimum: 1 }),
    text: Type.String(),
    included: Type.Boolean(),
  }, { additionalProperties: false })),
});

export const RestartAgentReviewResultSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  run_id: Type.String({ format: "uuid" }),
  restarted: Type.Boolean(),
  status_url: Type.String(),
});

export const StartAgentReviewCommandSchema = Type.Object({
  agent_model: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const StartAgentReviewResultSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  run_id: Type.String({ format: "uuid" }),
  started: Type.Boolean(),
  status_url: Type.String(),
});

export const ReviewIssuesSchema = Type.Object({ issues: Type.Array(ReviewIssueSchema) });

const ReviewCommandBase = {
  result_revision_id: Type.String({ format: "uuid" }),
  command_id: Type.String({ minLength: 1, maxLength: 100 }),
};

const IssueContentCommand = {
  ...ReviewCommandBase,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  recommended_action: Type.String({ minLength: 1, maxLength: 2000 }),
  supporting_references: Type.Array(Type.String(), { maxItems: 20 }),
  no_reference_reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
};

export const CreateIssueCommandSchema = Type.Object({
  ...IssueContentCommand,
  expected_case_version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const CreateIssueResultSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  version: Type.Integer({ minimum: 1 }),
  case_version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const EditIssueCommandSchema = Type.Object({
  ...IssueContentCommand,
  expected_issue_version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const EditIssueResultSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  version: Type.Integer({ minimum: 2 }),
}, { additionalProperties: false });

export const ResolveIssueCommandSchema = Type.Object({
  ...ReviewCommandBase,
  expected_issue_version: Type.Integer({ minimum: 1 }),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
}, { additionalProperties: false });

export const ResolveIssueResultSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  review_state: Type.Union([Type.Literal("confirmed"), Type.Literal("ignored")]),
  version: Type.Integer({ minimum: 2 }),
}, { additionalProperties: false });

export const ReopenIssueResultSchema = Type.Object({
  issue_id: Type.String({ format: "uuid" }),
  review_state: Type.Literal("pending"),
  version: Type.Integer({ minimum: 2 }),
}, { additionalProperties: false });

export const RequestedChangeCommandSchema = Type.Object({
  ...ReviewCommandBase,
  text: Type.String({ minLength: 1, maxLength: 2000 }),
  included: Type.Boolean(),
}, { additionalProperties: false });

export const RequestedChangeResultSchema = Type.Object({
  draft_revision_id: Type.String({ format: "uuid" }),
  revision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const FinalReviewCommandSchema = Type.Object({
  ...ReviewCommandBase,
  expected_case_version: Type.Integer({ minimum: 1 }),
  action: Type.Union([Type.Literal("request_changes"), Type.Literal("escalate_review"), Type.Literal("clear_for_downstream")]),
  selected_draft_revision_ids: Type.Array(Type.String({ format: "uuid" })),
  internal_note: Type.Optional(Type.String({ maxLength: 4000 })),
}, { additionalProperties: false });

export const FinalReviewResultSchema = Type.Object({
  final_review_id: Type.String({ format: "uuid" }),
  action: Type.Union([Type.Literal("request_changes"), Type.Literal("escalate_review"), Type.Literal("clear_for_downstream")]),
  case_version: Type.Integer({ minimum: 2 }),
}, { additionalProperties: false });

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
