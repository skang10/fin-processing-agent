import { canonicalJson, type AgentLedCaseReviewContext, type AgentLedCaseReviewHarness, type AgentLedCaseReviewOutcome, type CaseReviewHarnessDescriptor, type CaseReviewProcessingPorts } from "@findoc/agent";
import { standardCaseReviewScript } from "./fake-model.js";
import { CASE_REVIEW_PROMPT, CASE_REVIEW_PROMPT_HASH, CASE_REVIEW_PROMPT_VERSION } from "./prompt.js";
import { CASE_REVIEW_TOOLS, CASE_REVIEW_TOOL_REGISTRY_VERSION, createAgentLedToolState, type AgentLedScope, type AgentLedToolState } from "./case-review-tools.js";
import { PiSessionRunner, contextManifestVersion, type PiHarnessOptions } from "./session.js";
import type { FakeModelScript } from "./fake-model.js";

export const PI_AGENT_LED_HARNESS_ID = "pi-agent-led-case-review-harness";
export const CASE_REVIEW_CONTEXT_SELECTOR_VERSION = "case-review-context-1.0.0";

function withDefaultScript(options: PiHarnessOptions, script: FakeModelScript): PiHarnessOptions {
  return options.model.route === "fake" && !options.model.script ? { ...options, model: { ...options.model, script } } : options;
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
    const { trace, state, resumed, attemptNumber } = await this.runner.run<AgentLedScope, AgentLedToolState>({
      mode: "case_review",
      caseId: context.caseId ?? context.runId,
      runId: context.runId,
      systemPrompt: CASE_REVIEW_PROMPT, promptVersion: CASE_REVIEW_PROMPT_VERSION, promptHash: CASE_REVIEW_PROMPT_HASH,
      contextManifestVersion: caseReviewContextManifestVersion(context),
      userMessage: (resume) => buildAgentLedUserMessage(context, resume),
      tools: CASE_REVIEW_TOOLS, toolRegistryVersion: CASE_REVIEW_TOOL_REGISTRY_VERSION,
      scope: { context, ports }, state: createAgentLedToolState(),
      isComplete: (current) => current.submission !== undefined,
      completeReason: "report_submitted", incompleteReason: "report_not_submitted",
      boundGapIds: context.gaps.map((gap) => gap.gapId),
    });
    return {
      candidates: state.candidates,
      ...(state.result ? { result: state.result } : {}),
      ...(state.submission !== undefined ? { submission: state.submission } : {}),
      resumed, attemptNumber, trace,
    };
  }

  static registeredToolNames(): readonly string[] { return CASE_REVIEW_TOOLS.map((tool) => tool.name); }
}

/** Deterministic selection identity over the bound case scope (AGT-REQ-019, DAT-REQ-131). */
export function caseReviewContextManifestVersion(context: AgentLedCaseReviewContext): string {
  return contextManifestVersion(CASE_REVIEW_CONTEXT_SELECTOR_VERSION, {
    run_id: context.runId,
    pages: context.pages.map((page) => `${page.documentVersionId}:${page.pageNumber}`).sort(),
    gaps: context.gaps.map((gap) => `${gap.gapId}:${gap.fieldSchemaId}`).sort(),
    field_schemas: context.fieldSchemas.map((schema) => `${schema.fieldSchemaId}@${schema.fieldSchemaVersion}`).sort(),
  });
}

export interface AgentLedResumeInput {
  readonly attemptNumber: number;
  readonly committedToolResults: Readonly<Record<string, unknown>>;
}

/**
 * Deterministic data-channel message (AGT-REQ-019, AGT-REQ-053): control metadata only, never document text.
 * A resumed attempt additionally receives the committed results it may rely on. It never claims that
 * earlier model conversation survived (AGT-REQ-119).
 */
export function buildAgentLedUserMessage(context: AgentLedCaseReviewContext, resume?: AgentLedResumeInput): string {
  const payload = canonicalJson({
    run_id: context.runId,
    authorized_pages: context.pages.map((page) => `${page.documentVersionId}:${page.pageNumber}`).sort(),
    gap_ids: context.gaps.map((gap) => gap.gapId).sort(),
    field_schema_ids: context.fieldSchemas.map((schema) => schema.fieldSchemaId).sort(),
  });
  const header = `<case_review_context trust="trusted_control_metadata">\n${payload}\n</case_review_context>`;
  if (!resume) {
    return `${header}\n\nReview this case with registered tools. Request deterministic reconciliation and validation, read the current result, then submit one Case Review Brief.`;
  }
  const committed = canonicalJson({ attempt: resume.attemptNumber, committed_tool_results: resume.committedToolResults });
  return `${header}\n\n<resumed_progress trust="trusted_control_metadata">\n${committed}\n</resumed_progress>\n\n`
    + "Processing resumed from saved progress. Earlier conversation is gone; the committed results above are the only prior work you may rely on."
    + " Continue from there with registered tools, request any deterministic step that is still missing, and submit one Case Review Brief.";
}
