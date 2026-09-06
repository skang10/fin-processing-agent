import { canonicalJson, verifyCaseReviewBrief, type AdaptiveRecoveryContext, type AdaptiveRecoveryHarness, type AdaptiveRecoveryOutcome, type AgentLedCaseReviewContext, type AgentLedCaseReviewHarness, type AgentLedCaseReviewOutcome, type CaseReviewAgentHarness, type CaseReviewContext, type CaseReviewHarnessDescriptor, type CaseReviewProcessingPorts, type CaseReviewSessionOutcome, type RecoveryToolPorts } from "@findoc/agent";
import { standardCaseReviewScript, standardRecoveryScript, standardReportScript } from "./fake-model.js";
import { ADAPTIVE_RECOVERY_PROMPT, ADAPTIVE_RECOVERY_PROMPT_HASH, ADAPTIVE_RECOVERY_PROMPT_VERSION, CASE_REVIEW_PROMPT, CASE_REVIEW_PROMPT_HASH, CASE_REVIEW_PROMPT_VERSION, CASE_REVIEW_REPORT_PROMPT, CASE_REVIEW_REPORT_PROMPT_HASH, CASE_REVIEW_REPORT_PROMPT_VERSION } from "./prompt.js";
import { ADAPTIVE_RECOVERY_TOOLS, RECOVERY_TOOL_REGISTRY_VERSION, createRecoveryToolState, type RecoveryScope, type RecoveryToolState } from "./recovery-tools.js";
import { CASE_REVIEW_TOOLS, CASE_REVIEW_TOOL_REGISTRY_VERSION, createAgentLedToolState, type AgentLedScope, type AgentLedToolState } from "./case-review-tools.js";
import { PiSessionRunner, type PiHarnessOptions } from "./session.js";
import { CASE_REVIEW_REPORT_TOOLS, TOOL_REGISTRY_VERSION, type ReportToolState } from "./tools.js";

export const PI_HARNESS_ID = "pi-case-review-harness";
export const PI_RECOVERY_HARNESS_ID = "pi-adaptive-recovery-harness";
export const PI_AGENT_LED_HARNESS_ID = "pi-agent-led-case-review-harness";

function withDefaultScript(options: PiHarnessOptions, script: typeof standardReportScript): PiHarnessOptions {
  return options.model.route === "fake" && !options.model.script ? { ...options, model: { ...options.model, script } } : options;
}

/**
 * Embeds pi-coding-agent as the bounded Case Review Agent for report mode (ADR-001, AGT-REQ-001).
 * The session receives no built-in tools, no resource discovery, no credentials, and only the registered report tools.
 */
export class PiCaseReviewAgentHarness implements CaseReviewAgentHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  private readonly runner: PiSessionRunner;

  constructor(options: PiHarnessOptions) {
    this.runner = new PiSessionRunner(withDefaultScript(options, standardReportScript), PI_HARNESS_ID);
    this.descriptor = this.runner.descriptor;
  }

  async generate(context: CaseReviewContext): Promise<CaseReviewSessionOutcome> {
    const { trace, state } = await this.runner.run<CaseReviewContext, ReportToolState>({
      mode: "case_review",
      systemPrompt: CASE_REVIEW_REPORT_PROMPT, promptVersion: CASE_REVIEW_REPORT_PROMPT_VERSION, promptHash: CASE_REVIEW_REPORT_PROMPT_HASH,
      userMessage: buildUserMessage(context),
      tools: CASE_REVIEW_REPORT_TOOLS, toolRegistryVersion: TOOL_REGISTRY_VERSION,
      scope: context, state: { submission: undefined },
      isComplete: (state) => state.submission !== undefined,
      completeReason: "report_submitted", incompleteReason: "report_not_submitted",
    });
    return { ...(state.submission !== undefined ? { submission: state.submission } : {}), trace };
  }

  /** Names of the tools a session exposes to the model; used by acceptance tests (AGT-REQ-095). */
  static registeredToolNames(): readonly string[] {
    return CASE_REVIEW_REPORT_TOOLS.map((tool) => tool.name);
  }
}

/** Embeds pi-coding-agent as the bounded Adaptive Extraction Loop for eligible gaps (AGT sections 3, 6, 7). */
export class PiAdaptiveRecoveryHarness implements AdaptiveRecoveryHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  private readonly runner: PiSessionRunner;

  constructor(options: PiHarnessOptions) {
    this.runner = new PiSessionRunner(withDefaultScript(options, standardRecoveryScript), PI_RECOVERY_HARNESS_ID);
    this.descriptor = this.runner.descriptor;
  }

  async recover(context: AdaptiveRecoveryContext, ports: RecoveryToolPorts): Promise<AdaptiveRecoveryOutcome> {
    const requiredGapIds = context.gaps.filter((gap) => gap.required).map((gap) => gap.gapId);
    const { trace, state } = await this.runner.run<RecoveryScope, RecoveryToolState>({
      mode: "case_review",
      systemPrompt: ADAPTIVE_RECOVERY_PROMPT, promptVersion: ADAPTIVE_RECOVERY_PROMPT_VERSION, promptHash: ADAPTIVE_RECOVERY_PROMPT_HASH,
      userMessage: buildRecoveryUserMessage(context),
      tools: ADAPTIVE_RECOVERY_TOOLS, toolRegistryVersion: RECOVERY_TOOL_REGISTRY_VERSION,
      scope: { context, ports }, state: createRecoveryToolState(),
      isComplete: (state) => requiredGapIds.length > 0 && requiredGapIds.every((gapId) => state.candidates.some((candidate) => candidate.gapId === gapId)),
      completeReason: "report_not_submitted", incompleteReason: "no_progress",
      boundGapIds: context.gaps.map((gap) => gap.gapId),
    });
    return { candidates: state.candidates, trace };
  }

  static registeredToolNames(): readonly string[] {
    return ADAPTIVE_RECOVERY_TOOLS.map((tool) => tool.name);
  }
}

/** One real Pi loop spanning bounded extraction, deterministic result requests, and report submission. */
export class PiAgentLedCaseReviewHarness implements AgentLedCaseReviewHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  private readonly runner: PiSessionRunner;

  constructor(options: PiHarnessOptions) {
    this.runner = new PiSessionRunner(withDefaultScript(options, standardCaseReviewScript), PI_AGENT_LED_HARNESS_ID);
    this.descriptor = this.runner.descriptor;
  }

  async review(context: AgentLedCaseReviewContext, ports: CaseReviewProcessingPorts): Promise<AgentLedCaseReviewOutcome> {
    const { trace, state } = await this.runner.run<AgentLedScope, AgentLedToolState>({
      mode: "case_review",
      systemPrompt: CASE_REVIEW_PROMPT, promptVersion: CASE_REVIEW_PROMPT_VERSION, promptHash: CASE_REVIEW_PROMPT_HASH,
      userMessage: buildAgentLedUserMessage(context),
      tools: CASE_REVIEW_TOOLS, toolRegistryVersion: CASE_REVIEW_TOOL_REGISTRY_VERSION,
      scope: { context, ports }, state: createAgentLedToolState(),
      isComplete: (current) => current.submission !== undefined,
      completeReason: "report_submitted", incompleteReason: "report_not_submitted",
      boundGapIds: context.gaps.map((gap) => gap.gapId),
    });
    if (state.submission !== undefined && state.result) verifyCaseReviewBrief(state.submission, state.result);
    return {
      candidates: state.candidates,
      ...(state.result ? { result: state.result } : {}),
      ...(state.submission !== undefined ? { submission: state.submission } : {}),
      trace,
    };
  }

  static registeredToolNames(): readonly string[] { return CASE_REVIEW_TOOLS.map((tool) => tool.name); }
}

/** Deterministic data-channel message (AGT-REQ-019, AGT-REQ-053): control metadata only, never document text. */
export function buildUserMessage(context: CaseReviewContext): string {
  const payload = canonicalJson({
    result_revision_id: context.resultRevisionId,
    recommended_disposition: context.recommendedDisposition,
    finding_count: context.findings.length,
    allowed_reference_keys: [...context.allowedReferences].sort(),
  });
  return `<case_review_context trust="trusted_control_metadata">\n${payload}\n</case_review_context>\n\nProduce the Case Review Brief for this result revision. Start by calling list_findings, then submit the brief with submit_case_review_brief.`;
}

export function buildRecoveryUserMessage(context: AdaptiveRecoveryContext): string {
  const payload = canonicalJson({
    run_id: context.runId,
    gap_ids: context.gaps.map((gap) => gap.gapId).sort(),
    authorized_pages: context.pages.map((page) => `${page.documentVersionId}:${page.pageNumber}`).sort(),
    field_schema_ids: context.fieldSchemas.map((schema) => schema.fieldSchemaId).sort(),
  });
  return `<recovery_context trust="trusted_control_metadata">\n${payload}\n</recovery_context>\n\nRecover the bound extraction gaps. Start by calling get_extraction_gaps, then inspect the gap page, run OCR or VLM extraction, and submit candidates with submit_extraction_candidates.`;
}

export function buildAgentLedUserMessage(context: AgentLedCaseReviewContext): string {
  const payload = canonicalJson({
    run_id: context.runId,
    authorized_pages: context.pages.map((page) => `${page.documentVersionId}:${page.pageNumber}`).sort(),
    gap_ids: context.gaps.map((gap) => gap.gapId).sort(),
    field_schema_ids: context.fieldSchemas.map((schema) => schema.fieldSchemaId).sort(),
  });
  return `<case_review_context trust="trusted_control_metadata">\n${payload}\n</case_review_context>\n\nReview this case with registered tools. Request deterministic reconciliation and validation, read the current result, then submit one Case Review Brief.`;
}
