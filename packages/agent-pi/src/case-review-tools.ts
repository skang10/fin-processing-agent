import { Type } from "typebox";
import type {
  AgentLedCaseReviewContext,
  CaseReviewContext,
  CaseReviewProcessingPorts,
  SubmittedExtractionCandidate,
} from "@findoc/agent";
import type { RegisteredToolSpec } from "./session.js";
import {
  createRecoveryToolState,
  getExtractionGapsTool,
  inspectPageTool,
  getNativeTextTool,
  runOcrTool,
  renderPageRegionTool,
  classifyPageTool,
  detectDocumentBoundariesTool,
  extractLocalTableTool,
  extractWithVlmTool,
  submitExtractionCandidatesTool,
  type RecoveryScope,
  type RecoveryToolState,
} from "./recovery-tools.js";

export const CASE_REVIEW_TOOL_REGISTRY_VERSION = "case-review-tools-2.0.0";

export interface AgentLedScope extends RecoveryScope {
  readonly context: AgentLedCaseReviewContext;
  readonly ports: CaseReviewProcessingPorts;
}

export interface AgentLedToolState extends RecoveryToolState {
  reconciliationReference?: string;
  result?: CaseReviewContext;
  submission?: unknown;
}

export function createAgentLedToolState(): AgentLedToolState {
  return { ...createRecoveryToolState() };
}

type Tool = RegisteredToolSpec<any, AgentLedScope, AgentLedToolState>;
type SubmitBriefArguments = { brief: { result_revision_id: string } & Record<string, unknown> };

function recoveryTool(tool: RegisteredToolSpec<any, RecoveryScope, RecoveryToolState>): Tool {
  return tool as Tool;
}

const Empty = Type.Object({}, { additionalProperties: false });

const requestReconciliationTool: Tool = {
  name: "request_reconciliation", version: "1.0.0", label: "Request reconciliation", costClass: "submit",
  description: "Request deterministic reconciliation of the committed extraction candidates for this run.",
  promptSnippet: "request deterministic reconciliation after candidate submission",
  parameters: Empty,
  authorize: (_args, _scope, state) => state.reconciliationReference ? "reconciliation_already_requested" : undefined,
  execute: async (_args, scope, state) => {
    const result = await scope.ports.requestReconciliation(state.candidates);
    state.reconciliationReference = result.reference;
    return { summary: `Sent ${state.candidates.length} Agent-proposed ${state.candidates.length === 1 ? "value" : "values"} to deterministic reconciliation`, output: { reference: result.reference } };
  },
};

const requestValidationTool: Tool = {
  name: "request_validation", version: "1.0.0", label: "Request validation", costClass: "submit",
  description: "Request the registered deterministic validation rules and disposition mapping for the reconciled run.",
  promptSnippet: "request deterministic validation after reconciliation",
  parameters: Empty,
  authorize: (_args, _scope, state) => !state.reconciliationReference ? "reconciliation_required" : state.result ? "validation_already_requested" : undefined,
  execute: async (_args, scope, state) => {
    state.result = await scope.ports.requestValidation();
    const attentionCount = state.result.findings.filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable").length;
    return { summary: `Ran registered validation checks; ${attentionCount} ${attentionCount === 1 ? "finding requires" : "findings require"} attention`, output: { result_revision_id: state.result.resultRevisionId } };
  },
};

const getCurrentResultTool: Tool = {
  name: "get_current_result", version: "1.0.0", label: "Get current result", costClass: "read",
  description: "Return the current committed deterministic findings and document-processing disposition.",
  promptSnippet: "read the current deterministic result before writing the report",
  parameters: Empty,
  authorize: (_args, _scope, state) => state.result ? undefined : "validation_required",
  execute: async (_args, _scope, state) => {
    if (!state.result) throw new Error("Validated result is unavailable");
    return {
      summary: "Reviewed deterministic findings and document-processing disposition",
      output: {
        result_revision_id: state.result.resultRevisionId,
        recommended_disposition: state.result.recommendedDisposition,
        findings: state.result.findings.map((finding) => ({
          rule_id: finding.ruleId, rule_version: finding.ruleVersion, status: finding.status,
          reason_code: finding.reasonCode, reference_key: `finding:${finding.ruleId}`,
          references: [...(finding.references ?? [])],
        })),
      },
    };
  },
};

const BriefAttentionItem = Type.Object({
  signal: Type.String({ minLength: 1, maxLength: 64 }), suggested_action: Type.String({ minLength: 1, maxLength: 64 }),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  references: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 10 }),
}, { additionalProperties: false });
const SubmitBrief = Type.Object({ brief: Type.Object({
  schema_version: Type.Literal("1.0.0"), result_revision_id: Type.String({ minLength: 1, maxLength: 64 }),
  report_status: Type.Literal("ready"), summary: Type.String({ minLength: 1, maxLength: 500 }),
  attention_items: Type.Array(BriefAttentionItem, { maxItems: 20 }),
}, { additionalProperties: false }) }, { additionalProperties: false });

const submitBriefTool: Tool = {
  name: "submit_case_review_brief", version: "1.0.0", label: "Submit Case Review Brief", costClass: "submit",
  description: "Submit one Case Review Brief for deterministic verification.", promptSnippet: "submit the report after reading the current result",
  parameters: SubmitBrief,
  authorize: (args, _scope, state) => !state.result ? "validation_required"
    : (args as SubmitBriefArguments).brief.result_revision_id !== state.result.resultRevisionId ? "result_revision_mismatch"
      : state.submission !== undefined ? "report_already_submitted" : undefined,
  execute: async (args, _scope, state) => {
    state.submission = (args as SubmitBriefArguments).brief;
    return { summary: "Submitted a Case Review Brief", output: { accepted: true }, terminate: true };
  },
};

export const CASE_REVIEW_TOOLS: readonly Tool[] = Object.freeze([
  recoveryTool(getExtractionGapsTool), recoveryTool(inspectPageTool), recoveryTool(getNativeTextTool),
  recoveryTool(runOcrTool), recoveryTool(renderPageRegionTool), recoveryTool(classifyPageTool),
  recoveryTool(detectDocumentBoundariesTool), recoveryTool(extractLocalTableTool),
  recoveryTool(extractWithVlmTool), recoveryTool(submitExtractionCandidatesTool),
  requestReconciliationTool, requestValidationTool, getCurrentResultTool, submitBriefTool,
]);

export const CASE_REVIEW_TOOL_NAMES = Object.freeze(CASE_REVIEW_TOOLS.map((tool) => tool.name));

export function submittedCandidates(state: AgentLedToolState): readonly SubmittedExtractionCandidate[] {
  return state.candidates;
}
