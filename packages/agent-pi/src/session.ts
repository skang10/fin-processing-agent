import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, SessionManager, SettingsManager, VERSION, convertToLlm, createExtensionRuntime, type LoadExtensionsResult, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";
import { AGENT_BUDGET_CONFIGURATION_VERSION, DEFAULT_AGENT_BUDGET, InMemoryAgentSessionLifecycle, canonicalJson, hashArguments, type CaseReviewHarnessDescriptor } from "@findoc/agent";
import {
  AgentSessionTerminalError, EMPTY_AGENT_CONSUMED_BUDGET, addConsumedBudget,
  type AgentBudgetEnvelope, type AgentCommittedToolResult, type AgentConsumedBudget, type AgentProducedReference,
  type AgentRecoverySnapshot, type AgentSessionConfiguration, type AgentSessionLifecyclePort, type AgentSessionMode,
  type AgentSessionStart, type AgentSessionTrace, type AgentStepOutcome, type AgentStepPhase, type AgentStepTrace,
  type AgentTerminalReason, type CommitAgentStepResult,
} from "@findoc/core";
import { FAKE_MODEL, createFakeStreamFn, type FakeModelScript } from "./fake-model.js";

export const PI_HARNESS_VERSION = `pi-coding-agent@${VERSION}`;
export const PI_HARNESS_CONFIGURATION_VERSION = `pi-harness-2.0.0;${AGENT_BUDGET_CONFIGURATION_VERSION}`;

export type ToolCostClass = "read" | "ocr" | "render" | "vlm" | "submit";

/**
 * How a committed tool result is reused after durable re-entry (AGT-REQ-078, AGT-REQ-135).
 *
 * `safe_output` retains a bounded structured payload and never re-invokes the adapter, so a paid
 * or otherwise non-idempotent operation cannot repeat. `reexecute` retains only an integrity hash
 * because the payload carries document text; the adapter re-reads its committed artifact instead.
 */
export type ToolReuseMode = "safe_output" | "reexecute";

export interface ToolExecutionOutput {
  readonly output: unknown;
  readonly summary: string;
  readonly terminate?: boolean;
}

/** One registered tool: stable name, version, schemas, authorization policy, cost class, and implementation (AGT-REQ-030). */
export interface RegisteredToolSpec<TParams extends TSchema, TScope, TState> {
  readonly name: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly costClass: ToolCostClass;
  readonly parameters: TParams;
  /** Defaults to the tool version when omitted. */
  readonly outputSchemaVersion?: string;
  /** Defaults to `safe_output`; declare `reexecute` when the output carries document text. */
  readonly reuse?: ToolReuseMode;
  /** Returns a stable rejection reason when validated arguments fall outside the session scope. */
  authorize(args: Static<TParams>, scope: TScope, state: TState): string | undefined;
  execute(args: Static<TParams>, scope: TScope, state: TState): Promise<ToolExecutionOutput>;
  /** Rebuild in-memory tool state from a committed result during durable re-entry. */
  restore?(output: unknown, scope: TScope, state: TState): void;
  /** Immutable domain records this output produced (DAT-REQ-132). */
  producedReferences?(output: unknown, scope: TScope, state: TState): readonly AgentProducedReference[];
}

export type AnyToolSpec<TScope, TState> = RegisteredToolSpec<any, TScope, TState>;

export type PiModelRoute =
  | { readonly route: "fake"; readonly script?: FakeModelScript; readonly scriptLabel?: string }
  | { readonly route: "live"; readonly provider: string; readonly modelId: string; readonly apiKey: string };

export interface PiHarnessSafeEvent {
  readonly type: "session_started" | "session_resumed" | "tool_step" | "session_ended";
  readonly sessionId: string;
  readonly mode: AgentSessionMode;
  readonly attemptNumber?: number;
  readonly toolName?: string;
  readonly outcome?: AgentStepOutcome;
  readonly terminalReason?: AgentTerminalReason;
  readonly iterations?: number;
  readonly toolCalls?: number;
}

export interface PiHarnessOptions {
  readonly model: PiModelRoute;
  readonly budget?: AgentBudgetEnvelope;
  /** Durable owner of session identity, steps, invocation results, and budgets (AGT-REQ-072). */
  readonly lifecycle?: AgentSessionLifecyclePort;
  /** Safe telemetry sink: receives no arguments, document content, prompts, or credentials (AGT-REQ-089). */
  readonly onEvent?: (event: PiHarnessSafeEvent) => void;
}

/** Resource loader that discovers nothing: no extensions, skills, prompt templates, themes, or context files (AGT-REQ-024, AGT-REQ-025). */
class BoundedResourceLoader implements ResourceLoader {
  private readonly extensions: LoadExtensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  constructor(private readonly systemPrompt: string) {}
  getExtensions() { return this.extensions; }
  getSkills() { return { skills: [], diagnostics: [] }; }
  getPrompts() { return { prompts: [], diagnostics: [] }; }
  getThemes() { return { themes: [], diagnostics: [] }; }
  getAgentsFiles() { return { agentsFiles: [] }; }
  getSystemPrompt() { return this.systemPrompt; }
  getSystemPromptSource() { return undefined; }
  getAppendSystemPrompt() { return []; }
  getAppendSystemPromptSources() { return []; }
  extendResources() { /* discovery is disabled by design */ }
  async reload() { /* nothing to reload */ }
}

interface BudgetFlags {
  timeout: boolean; iteration: boolean; tool: boolean; model: boolean; token: boolean; cost: boolean;
  vlm: boolean; ocr: boolean; noProgress: boolean; modelUnavailable: boolean; integrity: boolean;
}

/**
 * Trusted control plane for one session attempt. It owns the ordered authorization chain and
 * commits every completed step to the durable lifecycle before the result reaches the model
 * (AGT-REQ-032, AGT-REQ-074, AGT-REQ-123).
 */
export class SessionControlPlane<TScope, TState> {
  readonly flags: BudgetFlags = {
    timeout: false, iteration: false, tool: false, model: false, token: false, cost: false,
    vlm: false, ocr: false, noProgress: false, modelUnavailable: false, integrity: false,
  };
  private sequence: number;
  private consumed: AgentConsumedBudget;
  private pending: Partial<AgentConsumedBudget> = {};
  private consecutiveNoProgress = 0;
  private readonly committedByKey = new Map<string, AgentCommittedToolResult>();
  private readonly replayedKeys = new Set<string>();
  private readonly handledToolCallIds = new Set<string>();
  private readonly startedAt = new Map<string, string>();

  constructor(
    private readonly scope: TScope,
    readonly state: TState,
    readonly budget: AgentBudgetEnvelope,
    private readonly tools: ReadonlyMap<string, AnyToolSpec<TScope, TState>>,
    private readonly isComplete: (state: TState) => boolean,
    private readonly lifecycle: AgentSessionLifecyclePort,
    private readonly sessionId: string,
    private readonly attemptId: string,
    snapshot: AgentRecoverySnapshot | undefined,
    private readonly emit: (step: AgentStepTrace) => void,
  ) {
    this.sequence = snapshot?.lastSequence ?? 0;
    this.consumed = snapshot?.consumed ?? EMPTY_AGENT_CONSUMED_BUDGET;
    for (const result of snapshot?.committedToolResults ?? []) this.committedByKey.set(result.idempotencyKey, result);
  }

  /** Rebuild tool state from committed results so a resumed attempt sees its own prior progress. */
  restoreCommittedState(): void {
    for (const result of this.committedByKey.values()) {
      if (result.safeOutput === undefined) continue;
      this.tools.get(result.toolName)?.restore?.(result.safeOutput, this.scope, this.state);
    }
  }

  /** Committed results whose bounded payload may seed a resumed model continuation. */
  resumeDigest(): Readonly<Record<string, unknown>> {
    const digest: Record<string, unknown> = {};
    for (const result of this.committedByKey.values()) {
      if (result.safeOutput !== undefined) digest[result.toolName] = result.safeOutput;
    }
    return digest;
  }

  used(): AgentConsumedBudget {
    return addConsumedBudget(this.consumed, this.pending);
  }

  hardStopRequested(): boolean {
    const { flags } = this;
    return flags.timeout || flags.iteration || flags.tool || flags.model || flags.token || flags.cost
      || flags.vlm || flags.ocr || flags.noProgress || flags.integrity || this.isComplete(this.state);
  }

  noteToolStart(toolCallId: string): void {
    this.startedAt.set(toolCallId, new Date().toISOString());
  }

  /** Record calls the Pi loop rejected before reaching a registered tool (unknown name or schema-invalid arguments). */
  async noteLoopRejectedCall(toolCallId: string, toolName: string): Promise<void> {
    if (this.handledToolCallIds.has(toolCallId)) return;
    this.handledToolCallIds.add(toolCallId);
    const spec = this.tools.get(toolName);
    const outcome: AgentStepOutcome = spec ? "schema_rejected" : "unknown_tool_rejected";
    this.consecutiveNoProgress += 1;
    this.checkNoProgress();
    await this.commit(toolCallId, toolName, null, outcome,
      spec ? `Rejected schema-invalid arguments for ${toolName}` : `Rejected unregistered tool ${toolName}`,
      spec?.version, "planning");
  }

  /** Registry lookup, schema validation, scope authorization, reuse, budget reservation, execution, durable commit. */
  async execute(toolCallId: string, toolName: string, args: unknown): Promise<{ content: string; isError: boolean; terminate: boolean }> {
    this.handledToolCallIds.add(toolCallId);
    const spec = this.tools.get(toolName);
    const phase = phaseForTool(toolName);
    if (!spec) {
      await this.commit(toolCallId, toolName, args, "unknown_tool_rejected", `Rejected unregistered tool ${toolName}`, undefined, phase);
      return { content: JSON.stringify({ error: "unknown_tool" }), isError: true, terminate: false };
    }
    if (!Value.Check(spec.parameters, args)) {
      this.consecutiveNoProgress += 1;
      this.checkNoProgress();
      await this.commit(toolCallId, toolName, args, "schema_rejected", `Rejected schema-invalid arguments for ${toolName}`, spec.version, phase);
      return { content: JSON.stringify({ error: "schema_invalid" }), isError: true, terminate: false };
    }
    const authorization = spec.authorize(args, this.scope, this.state);
    if (authorization) {
      this.consecutiveNoProgress += 1;
      this.checkNoProgress();
      await this.commit(toolCallId, toolName, args, "authorization_rejected", `Rejected ${toolName}: ${authorization.replace(/_/g, " ")}`, spec.version, phase);
      return { content: JSON.stringify({ error: "not_authorized", reason: authorization }), isError: true, terminate: false };
    }
    const idempotencyKey = `${toolName}@${spec.version}:${hashArguments(args)}`;
    const committed = this.committedByKey.get(idempotencyKey);
    if (committed) return this.resolveCommitted(toolCallId, spec, args, phase, committed);

    const budgetRejection = this.reserve(spec.costClass);
    if (budgetRejection) {
      await this.commit(toolCallId, toolName, args, "budget_rejected", `Rejected ${toolName}: ${budgetRejection.replace(/_/g, " ")} budget exhausted`, spec.version, phase);
      return { content: JSON.stringify({ error: "budget_exhausted", budget: budgetRejection }), isError: true, terminate: true };
    }
    let result: ToolExecutionOutput;
    try {
      result = await spec.execute(args, this.scope, this.state);
    } catch {
      this.consecutiveNoProgress += 1;
      this.checkNoProgress();
      await this.commit(toolCallId, toolName, args, "failed", `${toolName} failed`, spec.version, phase);
      return { content: JSON.stringify({ error: "tool_failed" }), isError: true, terminate: false };
    }
    this.consecutiveNoProgress = 0;
    const reuse = spec.reuse ?? "safe_output";
    const invocation = {
      idempotencyKey,
      outputSchemaVersion: spec.outputSchemaVersion ?? spec.version,
      outputHash: hashArguments(result.output),
      ...(reuse === "safe_output" ? { safeOutput: result.output } : {}),
      producedReferences: spec.producedReferences?.(result.output, this.scope, this.state) ?? [],
      authorizedInputVersions: { toolVersion: spec.version, argumentHash: hashArguments(args) },
      terminatesSession: result.terminate ?? false,
    };
    const committedStep = await this.commit(toolCallId, toolName, args, "succeeded", result.summary, spec.version, phase, { invocation });
    if (!committedStep.invocationId) throw new Error("A committed Agent tool step has no invocation identity");
    this.committedByKey.set(idempotencyKey, {
      invocationId: committedStep.invocationId, idempotencyKey, toolName, toolVersion: spec.version, outcome: "succeeded",
      outputSchemaVersion: invocation.outputSchemaVersion, outputHash: invocation.outputHash,
      ...(reuse === "safe_output" ? { safeOutput: result.output } : {}),
      producedReferences: invocation.producedReferences,
      authorizedInputVersions: invocation.authorizedInputVersions, terminatesSession: invocation.terminatesSession,
    });
    this.replayedKeys.add(idempotencyKey);
    return { content: JSON.stringify(result.output), isError: false, terminate: result.terminate ?? false };
  }

  /**
   * Resolve a request whose idempotency key already has a committed result. A key first seen in an
   * earlier attempt is durable-recovery reuse and counts as progress; repeating it inside the same
   * attempt is a duplicate that feeds the no-progress policy (AGT-REQ-067, AGT-REQ-126).
   */
  private async resolveCommitted(
    toolCallId: string, spec: AnyToolSpec<TScope, TState>, args: unknown,
    phase: AgentStepPhase, committed: AgentCommittedToolResult,
  ): Promise<{ content: string; isError: boolean; terminate: boolean }> {
    const sameAttempt = this.replayedKeys.has(committed.idempotencyKey);
    const reuse = spec.reuse ?? "safe_output";
    let output = committed.safeOutput;
    let integrityCheck: "hash_match" | "hash_mismatch" = "hash_match";
    if (reuse === "reexecute" && !sameAttempt) {
      try {
        output = (await spec.execute(args, this.scope, this.state)).output;
      } catch {
        integrityCheck = "hash_mismatch";
      }
      if (integrityCheck === "hash_match" && hashArguments(output) !== committed.outputHash) integrityCheck = "hash_mismatch";
    } else if (output !== undefined && hashArguments(output) !== committed.outputHash) {
      integrityCheck = "hash_mismatch";
    }
    if (integrityCheck === "hash_mismatch") {
      this.flags.integrity = true;
      await this.commit(toolCallId, spec.name, args, "failed", `Rejected ${spec.name}: the committed result failed its integrity check`, spec.version, phase,
        { reusedInvocationId: committed.invocationId, integrityCheck });
      return { content: JSON.stringify({ error: "committed_result_integrity_failed" }), isError: true, terminate: true };
    }
    if (sameAttempt) {
      this.consecutiveNoProgress += 1;
      this.checkNoProgress();
    } else {
      this.consecutiveNoProgress = 0;
      this.replayedKeys.add(committed.idempotencyKey);
      if (reuse === "safe_output" && output !== undefined) spec.restore?.(output, this.scope, this.state);
    }
    await this.commit(toolCallId, spec.name, args,
      "duplicate_resolved",
      sameAttempt
        ? `Returned the committed result of an identical ${spec.name} call`
        : `Reused the committed ${spec.name} result after processing resumed`,
      spec.version, phase, { reusedInvocationId: committed.invocationId, integrityCheck });
    return {
      content: JSON.stringify(output ?? { reused: true }),
      isError: false,
      terminate: committed.terminatesSession || this.flags.noProgress,
    };
  }

  noteTurn(usage: { input: number; output: number; cost: { total: number } } | undefined): void {
    this.pending = addConsumedBudget(EMPTY_AGENT_CONSUMED_BUDGET, {
      ...this.pending, iterations: (this.pending.iterations ?? 0) + 1, modelCalls: (this.pending.modelCalls ?? 0) + 1,
      inputTokens: (this.pending.inputTokens ?? 0) + (usage?.input ?? 0),
      outputTokens: (this.pending.outputTokens ?? 0) + (usage?.output ?? 0),
      costUsd: (this.pending.costUsd ?? 0) + (usage?.cost.total ?? 0),
      usageAvailable: usage !== undefined && (this.pending.usageAvailable ?? true),
    });
    const used = this.used();
    const complete = this.isComplete(this.state);
    if (used.iterations >= this.budget.maxIterations && !complete) this.flags.iteration = true;
    if (used.modelCalls >= this.budget.maxModelCalls && !complete) this.flags.model = true;
    if (used.inputTokens > this.budget.maxInputTokens || used.outputTokens > this.budget.maxOutputTokens) this.flags.token = true;
    if (used.costUsd > this.budget.maxEstimatedCostUsd) this.flags.cost = true;
  }

  terminalReason(completeReason: AgentTerminalReason, incompleteReason: AgentTerminalReason): AgentTerminalReason {
    if (this.isComplete(this.state)) return completeReason;
    const { flags } = this;
    if (flags.timeout) return "timeout";
    if (flags.modelUnavailable) return "model_unavailable";
    if (flags.integrity) return "tool_failure";
    if (flags.tool || flags.vlm || flags.ocr) return "tool_budget_exhausted";
    if (flags.token) return "token_budget_exhausted";
    if (flags.cost) return "cost_budget_exhausted";
    if (flags.iteration) return "iteration_budget_exhausted";
    if (flags.model) return "model_budget_exhausted";
    if (flags.noProgress) return "no_progress";
    return incompleteReason;
  }

  /** Flush the last model-turn consumption and record exactly one terminal reason (AGT-REQ-070). */
  async terminalize(terminalReason: AgentTerminalReason, offeredTools: readonly string[]): Promise<AgentTerminalReason> {
    const budgetDelta = this.pending;
    this.pending = {};
    this.consumed = addConsumedBudget(this.consumed, budgetDelta);
    const result = await this.lifecycle.terminalizeSession({
      sessionId: this.sessionId, attemptId: this.attemptId, terminalReason,
      completedAt: new Date().toISOString(), offeredTools, budgetDelta,
    });
    return result.terminalReason;
  }

  private reserve(costClass: ToolCostClass): string | undefined {
    const used = this.used();
    if (used.toolCalls >= this.budget.maxToolCalls) { this.flags.tool = true; return "tool_calls"; }
    if (costClass === "vlm" && used.vlmCalls >= this.budget.maxVlmCalls) { this.flags.vlm = true; return "vlm_calls"; }
    if (costClass === "ocr" && used.ocrPages >= this.budget.maxOcrPages) { this.flags.ocr = true; return "ocr_pages"; }
    this.pending = {
      ...this.pending,
      toolCalls: (this.pending.toolCalls ?? 0) + 1,
      ...(costClass === "vlm" ? { vlmCalls: (this.pending.vlmCalls ?? 0) + 1 } : {}),
      ...(costClass === "ocr" ? { ocrPages: (this.pending.ocrPages ?? 0) + 1 } : {}),
    };
    return undefined;
  }

  private checkNoProgress(): void {
    if (this.consecutiveNoProgress >= this.budget.maxConsecutiveNoProgressSteps) this.flags.noProgress = true;
  }

  /** Durably append the completed step, its invocation or reuse lineage, and cumulative budget. */
  private async commit(
    toolCallId: string, toolName: string, args: unknown, outcome: AgentStepOutcome, summary: string,
    toolVersion: string | undefined, phase: AgentStepPhase,
    lineage: { invocation?: Parameters<AgentSessionLifecyclePort["commitStep"]>[0]["invocation"]; reusedInvocationId?: string; integrityCheck?: "hash_match" | "hash_mismatch" } = {},
  ): Promise<CommitAgentStepResult> {
    this.sequence += 1;
    const budgetDelta = this.pending;
    this.pending = {};
    const used = addConsumedBudget(this.consumed, budgetDelta);
    const step: AgentStepTrace = {
      sequence: this.sequence, phase, toolName, ...(toolVersion ? { toolVersion } : {}),
      argumentHash: hashArguments(args ?? null), outcome, summary,
      startedAt: this.startedAt.get(toolCallId) ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      budgetState: { iterationsUsed: used.iterations, toolCallsUsed: used.toolCalls },
    };
    const result = await this.lifecycle.commitStep({
      sessionId: this.sessionId, attemptId: this.attemptId, sequence: step.sequence, phase, toolName,
      ...(toolVersion ? { toolVersion } : {}),
      argumentHash: step.argumentHash, outcome, summary,
      startedAt: step.startedAt, completedAt: step.completedAt,
      budgetDelta, budgetState: step.budgetState,
      ...(lineage.invocation ? { invocation: lineage.invocation } : {}),
      ...(lineage.reusedInvocationId ? { reusedInvocationId: lineage.reusedInvocationId } : {}),
      ...(lineage.integrityCheck ? { integrityCheck: lineage.integrityCheck } : {}),
    });
    this.consumed = result.consumed;
    if (lineage.invocation && result.invocationId) {
      const stored = this.committedByKey.get(lineage.invocation.idempotencyKey);
      if (stored) this.committedByKey.set(lineage.invocation.idempotencyKey, { ...stored, invocationId: result.invocationId });
    }
    this.emit(step);
    return result;
  }
}

function phaseForTool(toolName: string): AgentStepPhase {
  if (toolName === "request_reconciliation") return "reconciliation";
  if (toolName === "request_validation" || toolName === "get_current_result") return "validation";
  if (toolName === "submit_case_review_brief") return "report_submission";
  if (["run_ocr", "extract_with_vlm", "submit_extraction_candidates", "extract_local_table"].includes(toolName)) return "extraction";
  if (["inspect_page", "get_native_text", "render_page_region", "classify_page", "detect_document_boundaries"].includes(toolName)) return "document_inspection";
  return "planning";
}

export interface BoundedSessionSpec<TScope, TState> {
  readonly mode: AgentSessionMode;
  readonly caseId: string;
  readonly runId: string;
  readonly systemPrompt: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly contextManifestVersion: string;
  /** Builds the deterministic data-channel message, optionally seeded with committed progress. */
  readonly userMessage: (resume?: { readonly attemptNumber: number; readonly committedToolResults: Readonly<Record<string, unknown>> }) => string;
  readonly tools: readonly AnyToolSpec<TScope, TState>[];
  readonly toolRegistryVersion: string;
  readonly scope: TScope;
  readonly state: TState;
  readonly isComplete: (state: TState) => boolean;
  readonly completeReason: AgentTerminalReason;
  readonly incompleteReason: AgentTerminalReason;
  readonly boundGapIds?: readonly string[];
}

export interface BoundedSessionResult<TState> {
  readonly trace: AgentSessionTrace;
  readonly state: TState;
  readonly resumed: boolean;
  readonly attemptNumber: number;
}

/** Shared Pi model resolution and durable session execution (ADR-001). */
export class PiSessionRunner {
  readonly descriptor: CaseReviewHarnessDescriptor;
  readonly budget: AgentBudgetEnvelope;
  private readonly lifecycle: AgentSessionLifecyclePort;
  private runtimePromise: Promise<ModelRuntime> | undefined;

  constructor(readonly options: PiHarnessOptions, harnessId: string) {
    this.budget = options.budget ?? DEFAULT_AGENT_BUDGET;
    this.lifecycle = options.lifecycle ?? new InMemoryAgentSessionLifecycle();
    this.descriptor = {
      harnessId, harnessVersion: PI_HARNESS_VERSION, modelRoute: options.model.route,
      modelLabel: options.model.route === "fake"
        ? `${FAKE_MODEL.provider}/${FAKE_MODEL.id}${options.model.scriptLabel ? `#${options.model.scriptLabel}` : ""}`
        : `${options.model.provider}/${options.model.modelId}`,
    };
  }

  async run<TScope, TState>(spec: BoundedSessionSpec<TScope, TState>): Promise<BoundedSessionResult<TState>> {
    const configuration: AgentSessionConfiguration = {
      mode: spec.mode, harnessId: this.descriptor.harnessId, harnessVersion: this.descriptor.harnessVersion,
      modelLabel: this.descriptor.modelLabel, modelRoute: this.descriptor.modelRoute,
      promptVersion: spec.promptVersion, promptHash: spec.promptHash,
      configurationVersion: PI_HARNESS_CONFIGURATION_VERSION, toolRegistryVersion: spec.toolRegistryVersion,
      contextManifestVersion: spec.contextManifestVersion,
      offeredTools: spec.tools.map((tool) => tool.name), budget: this.budget,
    };
    let start: AgentSessionStart;
    try {
      start = await this.lifecycle.beginSession({
        caseId: spec.caseId, runId: spec.runId, configuration, startedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof AgentSessionTerminalError)) throw error;
      // The authoritative session already recorded a terminal reason; replay its committed outcome
      // instead of opening a second attempt (AGT-REQ-070, AGT-REQ-079).
      return this.replayTerminalSession(spec);
    }
    const tools = new Map<string, AnyToolSpec<TScope, TState>>(spec.tools.map((tool) => [tool.name, tool]));
    const control = new SessionControlPlane<TScope, TState>(
      spec.scope, spec.state, this.budget, tools, spec.isComplete,
      this.lifecycle, start.sessionId, start.attemptId, start.snapshot,
      (step) => this.options.onEvent?.({ type: "tool_step", sessionId: start.sessionId, mode: spec.mode, toolName: step.toolName, outcome: step.outcome }),
    );
    this.options.onEvent?.({
      type: start.resumed ? "session_resumed" : "session_started",
      sessionId: start.sessionId, mode: spec.mode, attemptNumber: start.attemptNumber,
    });
    control.restoreCommittedState();

    let session: AgentSession | undefined;
    if (spec.isComplete(spec.state)) {
      // The committed work already satisfies the session contract; no model call may repeat it.
      const terminalReason = await control.terminalize(spec.completeReason, configuration.offeredTools);
      return this.finish(spec, start, control, terminalReason, session);
    }
    if (start.attemptNumber > this.budget.maxAttempts) {
      const terminalReason = await control.terminalize("cancelled_by_workflow", configuration.offeredTools);
      return this.finish(spec, start, control, terminalReason, session);
    }
    const runtime = await this.modelRuntime();
    const resolved = await this.resolveModel(runtime);
    if (resolved) {
      const agent = new Agent({
        initialState: { systemPrompt: "", model: resolved.model, thinkingLevel: "off", tools: [] },
        convertToLlm, streamFn: resolved.streamFn, sessionId: start.sessionId, toolExecution: "sequential",
        shouldStopAfterTurn: () => control.hardStopRequested(),
      });
      const customTools = spec.tools.map((tool): ToolDefinition => ({
        name: tool.name, label: tool.label, description: tool.description, promptSnippet: tool.promptSnippet,
        parameters: tool.parameters, executionMode: "sequential",
        execute: async (toolCallId, params) => {
          const result = await control.execute(toolCallId, tool.name, params);
          return { content: [{ type: "text", text: result.content }], details: { outcome: result.isError ? "error" : "ok" }, ...(result.terminate ? { terminate: true } : {}) };
        },
      }));
      const toolNames = spec.tools.map((tool) => tool.name);
      session = new AgentSession({
        agent, cwd: "/",
        sessionManager: SessionManager.inMemory("/"),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, images: { blockImages: true } }),
        resourceLoader: new BoundedResourceLoader(spec.systemPrompt),
        customTools, modelRuntime: runtime,
        initialActiveToolNames: toolNames, allowedToolNames: toolNames, baseToolsOverride: {},
      });
      const pendingCommits: Promise<void>[] = [];
      session.subscribe((event) => {
        if (event.type === "tool_execution_start") control.noteToolStart(event.toolCallId);
        else if (event.type === "tool_execution_end" && event.isError) pendingCommits.push(control.noteLoopRejectedCall(event.toolCallId, event.toolName));
        else if (event.type === "turn_end" && event.message.role === "assistant") {
          if (event.message.stopReason === "error") control.flags.modelUnavailable = true;
          control.noteTurn(event.message.stopReason === "aborted" ? undefined : event.message.usage);
        }
      });
      const timer = setTimeout(() => { control.flags.timeout = true; void session?.abort(); }, this.budget.maxWallClockMs);
      try {
        await session.prompt(spec.userMessage(start.resumed ? { attemptNumber: start.attemptNumber, committedToolResults: control.resumeDigest() } : undefined));
      } catch {
        control.flags.modelUnavailable = true;
      } finally {
        clearTimeout(timer);
        await Promise.allSettled(pendingCommits);
        session.dispose();
      }
    } else {
      control.flags.modelUnavailable = true;
    }
    const terminalReason = await control.terminalize(
      control.terminalReason(spec.completeReason, spec.incompleteReason),
      session?.getActiveToolNames() ?? [],
    );
    return this.finish(spec, start, control, terminalReason, session);
  }

  /** Rebuild the committed outcome of an already terminal session without any model call. */
  private async replayTerminalSession<TScope, TState>(spec: BoundedSessionSpec<TScope, TState>): Promise<BoundedSessionResult<TState>> {
    const snapshot = await this.lifecycle.loadSnapshot(spec.runId);
    if (!snapshot) throw new Error("A terminal Agent session has no durable snapshot");
    const tools = new Map<string, AnyToolSpec<TScope, TState>>(spec.tools.map((tool) => [tool.name, tool]));
    for (const result of snapshot.committedToolResults) {
      if (result.safeOutput === undefined) continue;
      tools.get(result.toolName)?.restore?.(result.safeOutput, spec.scope, spec.state);
    }
    const terminalReason = snapshot.terminalReason ?? spec.incompleteReason;
    const trace: AgentSessionTrace = {
      sessionId: snapshot.sessionId, mode: spec.mode,
      harnessId: this.descriptor.harnessId, harnessVersion: this.descriptor.harnessVersion,
      modelLabel: this.descriptor.modelLabel, modelRoute: this.descriptor.modelRoute,
      promptVersion: spec.promptVersion, promptHash: spec.promptHash,
      configurationVersion: PI_HARNESS_CONFIGURATION_VERSION, toolRegistryVersion: spec.toolRegistryVersion,
      offeredTools: snapshot.configuration.offeredTools,
      budget: this.budget, iterations: snapshot.consumed.iterations, toolCalls: snapshot.consumed.toolCalls,
      usage: { available: snapshot.consumed.usageAvailable, modelCalls: snapshot.consumed.modelCalls, inputTokens: snapshot.consumed.inputTokens, outputTokens: snapshot.consumed.outputTokens },
      ...(this.options.model.route === "fake" ? { estimatedCost: { amount: "0.0000", currency: "EUR" } } : {}),
      terminalReason, steps: snapshot.steps,
      startedAt: snapshot.startedAt, completedAt: new Date().toISOString(),
      ...(spec.boundGapIds ? { boundGapIds: spec.boundGapIds } : {}),
    };
    this.options.onEvent?.({
      type: "session_ended", sessionId: snapshot.sessionId, mode: spec.mode,
      attemptNumber: snapshot.attempts, terminalReason, iterations: trace.iterations, toolCalls: trace.toolCalls,
    });
    return { trace, state: spec.state, resumed: true, attemptNumber: snapshot.attempts };
  }

  /** Build the reviewer-facing trace from durable records rather than an end-of-session blob. */
  private async finish<TScope, TState>(
    spec: BoundedSessionSpec<TScope, TState>,
    start: { sessionId: string; attemptNumber: number; resumed: boolean },
    control: SessionControlPlane<TScope, TState>,
    terminalReason: AgentTerminalReason,
    session: AgentSession | undefined,
  ): Promise<BoundedSessionResult<TState>> {
    const snapshot = await this.lifecycle.loadSnapshot(spec.runId);
    const consumed = snapshot?.consumed ?? control.used();
    const trace: AgentSessionTrace = {
      sessionId: start.sessionId, mode: spec.mode,
      harnessId: this.descriptor.harnessId, harnessVersion: this.descriptor.harnessVersion,
      modelLabel: this.descriptor.modelLabel, modelRoute: this.descriptor.modelRoute,
      promptVersion: spec.promptVersion, promptHash: spec.promptHash,
      configurationVersion: PI_HARNESS_CONFIGURATION_VERSION, toolRegistryVersion: spec.toolRegistryVersion,
      offeredTools: snapshot?.configuration.offeredTools ?? session?.getActiveToolNames() ?? [],
      budget: this.budget, iterations: consumed.iterations, toolCalls: consumed.toolCalls,
      usage: { available: consumed.usageAvailable, modelCalls: consumed.modelCalls, inputTokens: consumed.inputTokens, outputTokens: consumed.outputTokens },
      ...(this.options.model.route === "fake" ? { estimatedCost: { amount: "0.0000", currency: "EUR" } } : {}),
      terminalReason, steps: snapshot?.steps ?? [],
      startedAt: snapshot?.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(),
      ...(spec.boundGapIds ? { boundGapIds: spec.boundGapIds } : {}),
    };
    this.options.onEvent?.({
      type: "session_ended", sessionId: start.sessionId, mode: spec.mode,
      attemptNumber: start.attemptNumber, terminalReason, iterations: trace.iterations, toolCalls: trace.toolCalls,
    });
    return { trace, state: spec.state, resumed: start.resumed, attemptNumber: start.attemptNumber };
  }

  /** In-memory model runtime: no auth.json, models.json, or network refresh; the fake provider is registered with a literal offline key. */
  private modelRuntime(): Promise<ModelRuntime> {
    this.runtimePromise ??= ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false }).then((runtime) => {
      if (this.options.model.route === "fake") {
        runtime.registerProvider(FAKE_MODEL.provider, {
          name: FAKE_MODEL.name, baseUrl: "http://findoc-fake.invalid", apiKey: "offline-fake-key", api: FAKE_MODEL.api,
          streamSimple: () => { throw new Error("The fake provider streams only through the session stream function"); },
          models: [{ id: FAKE_MODEL.id, name: FAKE_MODEL.name, reasoning: false, input: ["text"], cost: FAKE_MODEL.cost, contextWindow: FAKE_MODEL.contextWindow, maxTokens: FAKE_MODEL.maxTokens }],
        });
      }
      return runtime;
    });
    return this.runtimePromise;
  }

  private async resolveModel(runtime: ModelRuntime): Promise<{ model: Model<any>; streamFn: StreamFn } | undefined> {
    const route = this.options.model;
    if (route.route === "fake") {
      if (!route.script) throw new Error("A fake model route requires a script");
      return { model: FAKE_MODEL, streamFn: createFakeStreamFn(route.script) };
    }
    const model = runtime.getModel(route.provider, route.modelId);
    if (!model) return undefined;
    await runtime.setRuntimeApiKey(route.provider, route.apiKey);
    return { model, streamFn: (selected, context, options) => runtime.streamSimple(selected, context, { ...options, maxRetries: 1 }) };
  }
}

/** Stable context-manifest identity for compatible durable re-entry (DAT-REQ-131, AGT-REQ-111). */
export function contextManifestVersion(selectorVersion: string, manifest: unknown): string {
  return `${selectorVersion}:${hashArguments(canonicalJson(manifest)).slice(0, 16)}`;
}
