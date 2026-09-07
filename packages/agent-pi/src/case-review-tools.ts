import { Type } from "typebox";
import { CaseReviewBriefCandidateSchema } from "@findoc/contracts";
import type {
  AgentLedCaseReviewContext,
  CaseReviewContext,
  CaseReviewProcessingPorts,
  SubmittedExtractionCandidate,
} from "@findoc/agent";
import type { RegisteredToolSpec } from "./session.js";
import {
  createRecoveryToolState,
  getCaseManifestTool,
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

export const CASE_REVIEW_TOOL_REGISTRY_VERSION = "case-review-tools-3.8.0";

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
    return {
      summary: state.candidates.length === 0
        ? "No document value could be extracted for reconciliation"
        : `Sent ${state.candidates.length} extracted ${state.candidates.length === 1 ? "value" : "values"} to deterministic reconciliation`,
      output: { reference: result.reference },
    };
  },
  restore: (output, _scope, state) => { state.reconciliationReference = (output as { reference: string }).reference; },
  producedReferences: (output) => [{ kind: "reconciliation", id: (output as { reference: string }).reference }],
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
    return {
      summary: attentionCount === 0
        ? `Checked ${state.result.findings.length} validation rules; no issues found`
        : `Checked ${state.result.findings.length} validation rules; ${attentionCount} ${attentionCount === 1 ? "issue requires" : "issues require"} review`,
      output: projectResult(state.result),
    };
  },
  restore: (output, _scope, state) => { state.result = restoreResult(output); },
  producedReferences: (output) => [{ kind: "result_revision", id: (output as { result_revision_id: string }).result_revision_id }],
};

function projectResult(result: CaseReviewContext) {
  return {
    result_revision_id: result.resultRevisionId,
    recommended_disposition: result.recommendedDisposition,
    findings: result.findings.map((finding) => ({
      rule_id: finding.ruleId, ...(finding.ruleVersion ? { rule_version: finding.ruleVersion } : {}),
      status: finding.status, reason_code: finding.reasonCode, reference_key: `finding:${finding.ruleId}`,
      references: [...(finding.references ?? [])],
    })),
  };
}

/** Rebuild the committed deterministic projection after durable re-entry; it never re-runs a rule. */
function restoreResult(output: unknown): CaseReviewContext {
  const committed = output as ReturnType<typeof projectResult>;
  return {
    resultRevisionId: committed.result_revision_id,
    recommendedDisposition: committed.recommended_disposition,
    findings: committed.findings.map((finding) => ({
      ruleId: finding.rule_id, ...(finding.rule_version ? { ruleVersion: finding.rule_version } : {}),
      status: finding.status, reasonCode: finding.reason_code, references: finding.references,
    })),
    allowedReferences: new Set(committed.findings
      .filter((finding) => finding.status !== "passed" && finding.status !== "not_applicable")
      .map((finding) => finding.reference_key)),
  };
}

const getCurrentResultTool: Tool = {
  name: "get_current_result", version: "1.0.0", label: "Get current result", costClass: "read",
  description: "Return the current committed deterministic findings and document-processing disposition.",
  promptSnippet: "read the current deterministic result before writing the report",
  parameters: Empty,
  authorize: (_args, _scope, state) => state.result ? undefined : "validation_required",
  execute: async (_args, _scope, state) => {
    if (!state.result) throw new Error("Validated result is unavailable");
    return { summary: "Reviewed the case results before preparing the report", output: projectResult(state.result) };
  },
};

// The tool boundary and the deterministic Report Verifier deliberately share one schema. If the
// model invents a signal or action, Pi receives a repairable tool error instead of terminating with
// a submission that the external verifier must reject.
const SubmitBrief = Type.Object({ brief: CaseReviewBriefCandidateSchema }, { additionalProperties: false });

const submitBriefTool: Tool = {
  name: "submit_case_review_brief", version: "2.0.0", label: "Submit Case Review Brief", costClass: "submit",
  description: "Submit one Case Review Brief for deterministic verification.", promptSnippet: "submit the report after reading the current result",
  parameters: SubmitBrief,
  authorize: (args, _scope, state) => {
    if (!state.result) return "validation_required";
    const brief = (args as SubmitBriefArguments).brief;
    if (brief.result_revision_id !== state.result.resultRevisionId) return "result_revision_mismatch";
    if (state.submission !== undefined) return "report_already_submitted";
    if ((brief.attention_items as { references: string[] }[]).some((item) => item.references.some((reference) => !state.result?.allowedReferences.has(reference)))) {
      return "report_reference_outside_current_result";
    }
    return undefined;
  },
  execute: async (args, _scope, state) => {
    state.submission = (args as SubmitBriefArguments).brief;
    return { summary: "Submitted a Case Review Brief", output: { accepted: true, brief: state.submission }, terminate: true };
  },
  restore: (output, _scope, state) => { state.submission = (output as { brief: unknown }).brief; },
  producedReferences: (output) => {
    const brief = (output as { brief?: { result_revision_id?: string } }).brief;
    return brief?.result_revision_id ? [{ kind: "report_submission", id: brief.result_revision_id }] : [];
  },
};

export const CASE_REVIEW_TOOLS: readonly Tool[] = Object.freeze([
  recoveryTool(getCaseManifestTool), recoveryTool(inspectPageTool), recoveryTool(getNativeTextTool),
  recoveryTool(runOcrTool), recoveryTool(renderPageRegionTool), recoveryTool(classifyPageTool),
  recoveryTool(detectDocumentBoundariesTool), recoveryTool(extractLocalTableTool),
  recoveryTool(extractWithVlmTool), recoveryTool(submitExtractionCandidatesTool),
  requestReconciliationTool, requestValidationTool, getCurrentResultTool, submitBriefTool,
]);

export const CASE_REVIEW_TOOL_NAMES = Object.freeze(CASE_REVIEW_TOOLS.map((tool) => tool.name));

export function submittedCandidates(state: AgentLedToolState): readonly SubmittedExtractionCandidate[] {
  return state.candidates;
}
