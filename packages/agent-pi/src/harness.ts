import { randomUUID } from "node:crypto";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, SessionManager, SettingsManager, VERSION, convertToLlm, createExtensionRuntime, type LoadExtensionsResult, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { AGENT_BUDGET_CONFIGURATION_VERSION, DEFAULT_AGENT_BUDGET, canonicalJson, hashArguments, type CaseReviewAgentHarness, type CaseReviewContext, type CaseReviewHarnessDescriptor, type CaseReviewSessionOutcome } from "@findoc/agent";
import type { AgentBudgetEnvelope, AgentSessionTrace, AgentStepOutcome, AgentStepTrace, AgentTerminalReason } from "@findoc/core";
import { FAKE_MODEL, createFakeStreamFn, standardReportScript, type FakeModelScript } from "./fake-model.js";
import { CASE_REVIEW_REPORT_PROMPT, CASE_REVIEW_REPORT_PROMPT_HASH, CASE_REVIEW_REPORT_PROMPT_VERSION } from "./prompt.js";
import { CASE_REVIEW_REPORT_TOOLS, TOOL_REGISTRY_VERSION, type RegisteredToolSpec, type ToolSessionState } from "./tools.js";

export const PI_HARNESS_ID = "pi-case-review-harness";
export const PI_HARNESS_VERSION = `pi-coding-agent@${VERSION}`;
export const PI_HARNESS_CONFIGURATION_VERSION = `pi-harness-1.0.0;${AGENT_BUDGET_CONFIGURATION_VERSION}`;

export type PiModelRoute =
  | { readonly route: "fake"; readonly script?: FakeModelScript; readonly scriptLabel?: string }
  | { readonly route: "live"; readonly provider: string; readonly modelId: string; readonly apiKey: string };

export interface PiHarnessSafeEvent {
  readonly type: "session_started" | "tool_step" | "session_ended";
  readonly sessionId: string;
  readonly toolName?: string;
  readonly outcome?: AgentStepOutcome;
  readonly terminalReason?: AgentTerminalReason;
  readonly iterations?: number;
  readonly toolCalls?: number;
}

export interface PiHarnessOptions {
  readonly model: PiModelRoute;
  readonly budget?: AgentBudgetEnvelope;
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
  timeout: boolean; iteration: boolean; tool: boolean; model: boolean; token: boolean; cost: boolean; noProgress: boolean; modelUnavailable: boolean;
}

/** Trusted control plane for one session: authorization chain, budget reservation, idempotency, progress, and step records (AGT-REQ-032, AGT-REQ-123). */
class SessionControlPlane {
  readonly steps: AgentStepTrace[] = [];
  readonly state: ToolSessionState = { submission: undefined };
  readonly flags: BudgetFlags = { timeout: false, iteration: false, tool: false, model: false, token: false, cost: false, noProgress: false, modelUnavailable: false };
  iterations = 0;
  toolCalls = 0;
  modelCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  usageAvailable = true;
  private consecutiveNoProgress = 0;
  private readonly committed = new Map<string, { output: unknown; summary: string; terminate: boolean }>();
  private readonly handledToolCallIds = new Set<string>();
  private readonly startedAt = new Map<string, string>();

  constructor(
    private readonly context: CaseReviewContext,
    readonly budget: AgentBudgetEnvelope,
    private readonly tools: ReadonlyMap<string, RegisteredToolSpec>,
    private readonly emit: (step: AgentStepTrace) => void,
  ) {}

  hardStopRequested(): boolean {
    const { flags } = this;
    return flags.timeout || flags.iteration || flags.tool || flags.model || flags.token || flags.cost || flags.noProgress || this.state.submission !== undefined;
  }

  noteToolStart(toolCallId: string): void {
    this.startedAt.set(toolCallId, new Date().toISOString());
  }

  /** Record calls the Pi loop rejected before reaching a registered tool (unknown name or schema-invalid arguments). */
  noteLoopRejectedCall(toolCallId: string, toolName: string, args: unknown): void {
    if (this.handledToolCallIds.has(toolCallId)) return;
    const outcome: AgentStepOutcome = this.tools.has(toolName) ? "schema_rejected" : "unknown_tool_rejected";
    this.consecutiveNoProgress += 1;
    this.record(toolCallId, toolName, args, outcome, outcome === "unknown_tool_rejected" ? `Rejected unregistered tool ${toolName}` : `Rejected schema-invalid arguments for ${toolName}`, this.tools.get(toolName)?.version);
    this.checkNoProgress();
  }

  /** Ordered chain: registry lookup, schema validation, scope authorization, budget reservation, idempotency, execution. */
  execute(toolCallId: string, toolName: string, args: unknown): { content: string; isError: boolean; terminate: boolean } {
    this.handledToolCallIds.add(toolCallId);
    const spec = this.tools.get(toolName);
    if (!spec) {
      this.record(toolCallId, toolName, args, "unknown_tool_rejected", `Rejected unregistered tool ${toolName}`);
      return { content: JSON.stringify({ error: "unknown_tool" }), isError: true, terminate: false };
    }
    if (!Value.Check(spec.parameters, args)) {
      this.consecutiveNoProgress += 1;
      this.record(toolCallId, toolName, args, "schema_rejected", `Rejected schema-invalid arguments for ${toolName}`, spec.version);
      this.checkNoProgress();
      return { content: JSON.stringify({ error: "schema_invalid" }), isError: true, terminate: false };
    }
    const authorization = spec.authorize(args, this.context);
    if (authorization) {
      this.consecutiveNoProgress += 1;
      this.record(toolCallId, toolName, args, "authorization_rejected", `Rejected ${toolName} for an out-of-scope reference`, spec.version);
      this.checkNoProgress();
      return { content: JSON.stringify({ error: "not_authorized", reason: authorization }), isError: true, terminate: false };
    }
    const idempotencyKey = `${toolName}@${spec.version}:${hashArguments(args)}`;
    const committed = this.committed.get(idempotencyKey);
    if (committed) {
      this.consecutiveNoProgress += 1;
      this.record(toolCallId, toolName, args, "duplicate_resolved", `Returned the committed result of an identical ${toolName} call`, spec.version);
      this.checkNoProgress();
      return { content: JSON.stringify(committed.output), isError: false, terminate: committed.terminate || this.flags.noProgress };
    }
    if (this.toolCalls >= this.budget.maxToolCalls) {
      this.flags.tool = true;
      this.record(toolCallId, toolName, args, "budget_rejected", `Rejected ${toolName}: tool-call budget exhausted`, spec.version);
      return { content: JSON.stringify({ error: "budget_exhausted", budget: "tool_calls" }), isError: true, terminate: true };
    }
    this.toolCalls += 1;
    try {
      const result = spec.execute(args, this.context, this.state);
      this.consecutiveNoProgress = 0;
      this.committed.set(idempotencyKey, { output: result.output, summary: result.summary, terminate: result.terminate ?? false });
      this.record(toolCallId, toolName, args, "succeeded", result.summary, spec.version);
      return { content: JSON.stringify(result.output), isError: false, terminate: result.terminate ?? false };
    } catch {
      this.record(toolCallId, toolName, args, "failed", `${toolName} failed`, spec.version);
      return { content: JSON.stringify({ error: "tool_failed" }), isError: true, terminate: false };
    }
  }

  noteTurn(usage: { input: number; output: number; cost: { total: number } } | undefined): void {
    this.iterations += 1;
    this.modelCalls += 1;
    if (usage) {
      this.inputTokens += usage.input;
      this.outputTokens += usage.output;
      this.costUsd += usage.cost.total;
    } else {
      this.usageAvailable = false;
    }
    if (this.iterations >= this.budget.maxIterations && this.state.submission === undefined) this.flags.iteration = true;
    if (this.modelCalls >= this.budget.maxModelCalls && this.state.submission === undefined) this.flags.model = true;
    if (this.inputTokens > this.budget.maxInputTokens || this.outputTokens > this.budget.maxOutputTokens) this.flags.token = true;
    if (this.costUsd > this.budget.maxEstimatedCostUsd) this.flags.cost = true;
  }

  terminalReason(): AgentTerminalReason {
    if (this.state.submission !== undefined) return "report_submitted";
    const { flags } = this;
    if (flags.timeout) return "timeout";
    if (flags.modelUnavailable) return "model_unavailable";
    if (flags.tool) return "tool_budget_exhausted";
    if (flags.token) return "token_budget_exhausted";
    if (flags.cost) return "cost_budget_exhausted";
    if (flags.iteration) return "iteration_budget_exhausted";
    if (flags.model) return "model_budget_exhausted";
    if (flags.noProgress) return "no_progress";
    return "report_not_submitted";
  }

  private checkNoProgress(): void {
    if (this.consecutiveNoProgress >= this.budget.maxConsecutiveNoProgressSteps) this.flags.noProgress = true;
  }

  private record(toolCallId: string, toolName: string, args: unknown, outcome: AgentStepOutcome, summary: string, toolVersion?: string): void {
    const step: AgentStepTrace = {
      sequence: this.steps.length + 1, toolName, ...(toolVersion ? { toolVersion } : {}),
      argumentHash: hashArguments(args ?? null), outcome, summary,
      startedAt: this.startedAt.get(toolCallId) ?? new Date().toISOString(), completedAt: new Date().toISOString(),
      budgetState: { iterationsUsed: this.iterations, toolCallsUsed: this.toolCalls },
    };
    this.steps.push(step);
    this.emit(step);
  }
}

/**
 * Embeds pi-coding-agent as the bounded Case Review Agent for report mode (ADR-001, AGT-REQ-001).
 * The session receives no built-in tools, no resource discovery, no credentials, and only the registered report tools.
 */
export class PiCaseReviewAgentHarness implements CaseReviewAgentHarness {
  readonly descriptor: CaseReviewHarnessDescriptor;
  private readonly budget: AgentBudgetEnvelope;
  private runtimePromise: Promise<ModelRuntime> | undefined;

  constructor(private readonly options: PiHarnessOptions) {
    this.budget = options.budget ?? DEFAULT_AGENT_BUDGET;
    this.descriptor = {
      harnessId: PI_HARNESS_ID, harnessVersion: PI_HARNESS_VERSION, modelRoute: options.model.route,
      modelLabel: options.model.route === "fake"
        ? `${FAKE_MODEL.provider}/${FAKE_MODEL.id}${options.model.scriptLabel ? `#${options.model.scriptLabel}` : ""}`
        : `${options.model.provider}/${options.model.modelId}`,
    };
  }

  async generate(context: CaseReviewContext): Promise<CaseReviewSessionOutcome> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const tools = new Map<string, RegisteredToolSpec>(CASE_REVIEW_REPORT_TOOLS.map((tool) => [tool.name, tool]));
    const control = new SessionControlPlane(context, this.budget, tools, (step) => {
      this.options.onEvent?.({ type: "tool_step", sessionId, toolName: step.toolName, outcome: step.outcome });
    });
    this.options.onEvent?.({ type: "session_started", sessionId });
    const runtime = await this.modelRuntime();
    const resolved = await this.resolveModel(runtime);
    let session: AgentSession | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (resolved) {
      const agent = new Agent({
        initialState: { systemPrompt: "", model: resolved.model, thinkingLevel: "off", tools: [] },
        convertToLlm,
        streamFn: resolved.streamFn,
        sessionId,
        toolExecution: "sequential",
        shouldStopAfterTurn: () => control.hardStopRequested(),
      });
      const customTools = CASE_REVIEW_REPORT_TOOLS.map((spec): ToolDefinition => ({
        name: spec.name, label: spec.label, description: spec.description, promptSnippet: spec.promptSnippet,
        parameters: spec.parameters, executionMode: "sequential",
        execute: async (toolCallId, params) => {
          const result = control.execute(toolCallId, spec.name, params);
          return { content: [{ type: "text", text: result.content }], details: { outcome: result.isError ? "error" : "ok" }, ...(result.terminate ? { terminate: true } : {}) };
        },
      }));
      const toolNames = CASE_REVIEW_REPORT_TOOLS.map((tool) => tool.name);
      session = new AgentSession({
        agent, cwd: "/",
        sessionManager: SessionManager.inMemory("/"),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, images: { blockImages: true } }),
        resourceLoader: new BoundedResourceLoader(CASE_REVIEW_REPORT_PROMPT),
        customTools, modelRuntime: runtime,
        initialActiveToolNames: toolNames, allowedToolNames: toolNames, baseToolsOverride: {},
      });
      session.subscribe((event) => {
        if (event.type === "tool_execution_start") control.noteToolStart(event.toolCallId);
        else if (event.type === "tool_execution_end" && event.isError) control.noteLoopRejectedCall(event.toolCallId, event.toolName, undefined);
        else if (event.type === "turn_end" && event.message.role === "assistant") {
          if (event.message.stopReason === "error") control.flags.modelUnavailable = true;
          control.noteTurn(event.message.stopReason === "aborted" ? undefined : event.message.usage);
        }
      });
      timer = setTimeout(() => { control.flags.timeout = true; void session?.abort(); }, this.budget.maxWallClockMs);
      try {
        await session.prompt(buildUserMessage(context));
      } catch {
        control.flags.modelUnavailable = true;
      } finally {
        clearTimeout(timer);
        session.dispose();
      }
    } else {
      control.flags.modelUnavailable = true;
    }
    const trace = this.buildTrace(sessionId, startedAt, control, session);
    this.options.onEvent?.({ type: "session_ended", sessionId, terminalReason: trace.terminalReason, iterations: trace.iterations, toolCalls: trace.toolCalls });
    return { ...(control.state.submission !== undefined ? { submission: control.state.submission } : {}), trace };
  }

  /** Names of the tools a session exposes to the model; used by acceptance tests (AGT-REQ-095). */
  static registeredToolNames(): readonly string[] {
    return CASE_REVIEW_REPORT_TOOLS.map((tool) => tool.name);
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
    if (route.route === "fake") return { model: FAKE_MODEL, streamFn: createFakeStreamFn(route.script ?? standardReportScript) };
    const model = runtime.getModel(route.provider, route.modelId);
    if (!model) return undefined;
    await runtime.setRuntimeApiKey(route.provider, route.apiKey);
    return { model, streamFn: (selected, context, options) => runtime.streamSimple(selected, context, { ...options, maxRetries: 1 }) };
  }

  private buildTrace(sessionId: string, startedAt: string, control: SessionControlPlane, session: AgentSession | undefined): AgentSessionTrace {
    const fake = this.options.model.route === "fake";
    return {
      sessionId, mode: "case_review_report",
      harnessId: this.descriptor.harnessId, harnessVersion: this.descriptor.harnessVersion,
      modelLabel: this.descriptor.modelLabel, modelRoute: this.descriptor.modelRoute,
      promptVersion: CASE_REVIEW_REPORT_PROMPT_VERSION, promptHash: CASE_REVIEW_REPORT_PROMPT_HASH,
      configurationVersion: PI_HARNESS_CONFIGURATION_VERSION, toolRegistryVersion: TOOL_REGISTRY_VERSION,
      offeredTools: session?.getActiveToolNames() ?? [],
      budget: this.budget, iterations: control.iterations, toolCalls: control.toolCalls,
      usage: { available: control.usageAvailable, modelCalls: control.modelCalls, inputTokens: control.inputTokens, outputTokens: control.outputTokens },
      ...(fake ? { estimatedCost: { amount: "0.0000", currency: "EUR" } } : {}),
      terminalReason: control.terminalReason(), steps: control.steps, startedAt, completedAt: new Date().toISOString(),
    };
  }
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
