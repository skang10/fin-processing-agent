import { canonicalJson, type AgentLedCaseReviewContext, type AgentLedCaseReviewHarness, type AgentLedCaseReviewOutcome, type CaseReviewHarnessDescriptor, type CaseReviewProcessingPorts } from "@findoc/agent";
import { standardCaseReviewScript } from "./fake-model.js";
import { CASE_REVIEW_PROMPT, CASE_REVIEW_PROMPT_HASH, CASE_REVIEW_PROMPT_VERSION } from "./prompt.js";
import { CASE_REVIEW_TOOLS, CASE_REVIEW_TOOL_REGISTRY_VERSION, createAgentLedToolState, type AgentLedScope, type AgentLedToolState } from "./case-review-tools.js";
import { PiSessionRunner, type PiHarnessOptions } from "./session.js";
import type { FakeModelScript } from "./fake-model.js";
export const PI_AGENT_LED_HARNESS_ID = "pi-agent-led-case-review-harness";

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
export function buildAgentLedUserMessage(context: AgentLedCaseReviewContext): string {
  const payload = canonicalJson({
    run_id: context.runId,
    authorized_pages: context.pages.map((page) => `${page.documentVersionId}:${page.pageNumber}`).sort(),
    gap_ids: context.gaps.map((gap) => gap.gapId).sort(),
    field_schema_ids: context.fieldSchemas.map((schema) => schema.fieldSchemaId).sort(),
  });
  return `<case_review_context trust="trusted_control_metadata">\n${payload}\n</case_review_context>\n\nReview this case with registered tools. Request deterministic reconciliation and validation, read the current result, then submit one Case Review Brief.`;
}
