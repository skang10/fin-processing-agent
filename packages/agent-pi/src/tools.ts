import { Type, type Static } from "typebox";
import type { CaseReviewContext } from "@findoc/agent";

/** Immutable, versioned report-mode tool catalog assembled by trusted code (AGT-REQ-029, AGT-REQ-120). */
export const TOOL_REGISTRY_VERSION = "case-review-tools-1.0.0";

export type ToolCostClass = "read" | "submit";

export interface RegisteredToolSpec<TParams extends Type.TSchema = Type.TSchema> {
  readonly name: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly costClass: ToolCostClass;
  readonly parameters: TParams;
  /** Returns a stable rejection reason when the validated arguments fall outside the session scope. */
  authorize(args: Static<TParams>, context: CaseReviewContext): string | undefined;
  execute(args: Static<TParams>, context: CaseReviewContext, session: ToolSessionState): ToolExecutionOutput;
}

export interface ToolSessionState {
  submission: unknown;
}

export interface ToolExecutionOutput {
  readonly output: unknown;
  readonly summary: string;
  readonly terminate?: boolean;
}

const ListFindingsParameters = Type.Object({}, { additionalProperties: false });

const GetFindingReferencesParameters = Type.Object({
  rule_id: Type.String({ minLength: 1, maxLength: 64, description: "Registered validation rule identifier from list_findings" }),
}, { additionalProperties: false });

const BriefAttentionItem = Type.Object({
  signal: Type.String({ minLength: 1, maxLength: 64 }),
  suggested_action: Type.String({ minLength: 1, maxLength: 64 }),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  references: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 10 }),
}, { additionalProperties: false });

const SubmitBriefParameters = Type.Object({
  brief: Type.Object({
    schema_version: Type.Literal("1.0.0"),
    result_revision_id: Type.String({ minLength: 1, maxLength: 64 }),
    report_status: Type.Literal("ready"),
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    attention_items: Type.Array(BriefAttentionItem, { maxItems: 20 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const listFindingsTool: RegisteredToolSpec<typeof ListFindingsParameters> = {
  name: "list_findings", version: "1.0.0", label: "List findings", costClass: "read",
  description: "Return the deterministic validation findings and recommended document-processing disposition for the bound result revision.",
  promptSnippet: "list the deterministic findings and disposition for the bound result revision",
  parameters: ListFindingsParameters,
  authorize: () => undefined,
  execute: (_args, context) => ({
    summary: "Listed deterministic findings",
    output: {
      result_revision_id: context.resultRevisionId,
      recommended_disposition: context.recommendedDisposition,
      findings: context.findings.map((finding) => ({
        rule_id: finding.ruleId,
        ...(finding.ruleVersion ? { rule_version: finding.ruleVersion } : {}),
        status: finding.status,
        reason_code: finding.reasonCode,
        reference_key: `finding:${finding.ruleId}`,
      })),
    },
  }),
};

export const getFindingReferencesTool: RegisteredToolSpec<typeof GetFindingReferencesParameters> = {
  name: "get_finding_references", version: "1.0.0", label: "Get finding references", costClass: "read",
  description: "Return the persisted claim and evidence record identifiers that materially determined one finding of the bound result revision.",
  promptSnippet: "return the persisted record identifiers behind one finding",
  parameters: GetFindingReferencesParameters,
  authorize: (args, context) => context.findings.some((finding) => finding.ruleId === args.rule_id) ? undefined : "reference_outside_result_revision",
  execute: (args, context) => {
    const finding = context.findings.find((item) => item.ruleId === args.rule_id);
    if (!finding) throw new Error("Authorized finding is missing");
    return {
      summary: `Read references of ${finding.ruleId}`,
      output: { rule_id: finding.ruleId, reference_key: `finding:${finding.ruleId}`, references: [...(finding.references ?? [])] },
    };
  },
};

export const submitCaseReviewBriefTool: RegisteredToolSpec<typeof SubmitBriefParameters> = {
  name: "submit_case_review_brief", version: "1.0.0", label: "Submit Case Review Brief", costClass: "submit",
  description: "Submit the single Case Review Brief for the bound result revision. The brief is verified outside the Agent before display.",
  promptSnippet: "submit the Case Review Brief and end the session",
  parameters: SubmitBriefParameters,
  authorize: (args, context) => args.brief.result_revision_id === context.resultRevisionId ? undefined : "result_revision_mismatch",
  execute: (args, _context, session) => {
    if (session.submission !== undefined) return { summary: "Ignored a second brief submission", output: { accepted: false, reason: "already_submitted" }, terminate: true };
    session.submission = args.brief;
    return { summary: "Submitted a Case Review Brief", output: { accepted: true, note: "The brief will be verified before display." }, terminate: true };
  },
};

export const CASE_REVIEW_REPORT_TOOLS: readonly RegisteredToolSpec<any>[] = Object.freeze([
  listFindingsTool, getFindingReferencesTool, submitCaseReviewBriefTool,
]);

export const CASE_REVIEW_REPORT_TOOL_NAMES: readonly string[] = Object.freeze(CASE_REVIEW_REPORT_TOOLS.map((tool) => tool.name));
