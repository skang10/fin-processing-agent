import { randomUUID } from "node:crypto";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, SessionManager, SettingsManager, VERSION, convertToLlm, createExtensionRuntime, type LoadExtensionsResult, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";
import { AGENT_BUDGET_CONFIGURATION_VERSION, DEFAULT_AGENT_BUDGET, hashArguments, type CaseReviewHarnessDescriptor } from "@findoc/agent";
import type { AgentBudgetEnvelope, AgentSessionMode, AgentSessionTrace, AgentStepOutcome, AgentStepTrace, AgentTerminalReason } from "@findoc/core";
import { FAKE_MODEL, createFakeStreamFn, type FakeModelScript } from "./fake-model.js";

export const PI_HARNESS_VERSION = `pi-coding-agent@${VERSION}`;
export const PI_HARNESS_CONFIGURATION_VERSION = `pi-harness-1.1.0;${AGENT_BUDGET_CONFIGURATION_VERSION}`;

export type ToolCostClass = "read" | "ocr" | "render" | "vlm" | "submit";

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
  /** Returns a stable rejection reason when validated arguments fall outside the session scope. */
  authorize(args: Static<TParams>, scope: TScope, state: TState): string | undefined;
  execute(args: Static<TParams>, scope: TScope, state: TState): Promise<ToolExecutionOutput>;
}

export type AnyToolSpec<TScope, TState> = RegisteredToolSpec<any, TScope, TState>;

export type PiModelRoute =
  | { readonly route: "fake"; readonly script?: FakeModelScript; readonly scriptLabel?: string }
  | { readonly route: "live"; readonly provider: string; readonly modelId: string; readonly apiKey: string };

export interface PiHarnessSafeEvent {
  readonly type: "session_started" | "tool_step" | "session_ended";
  readonly sessionId: string;
  readonly mode: AgentSessionMode;
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
  timeout: boolean; iteration: boolean; tool: boolean; model: boolean; token: boolean; cost: boolean; vlm: boolean; ocr: boolean; noProgress: boolean; modelUnavailable: boolean;
}

/** Trusted control plane for one session: authorization chain, budget reservation, idempotency, progress, and step records (AGT-REQ-032, AGT-REQ-123). */
export class SessionControlPlane<TScope, TState> {
  readonly steps: AgentStepTrace[] = [];
  readonly flags: BudgetFlags = { timeout: false, iteration: false, tool: false, model: false, token: false, cost: false, vlm: false, ocr: false, noProgress: false, modelUnavailable: false };
  iterations = 0;
  toolCalls = 0;
  modelCalls = 0;
  vlmCalls = 0;
  ocrPages = 0;
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  usageAvailable = true;
  private consecutiveNoProgress = 0;
  private readonly committed = new Map<string, { output: unknown; terminate: boolean }>();
  private readonly handledToolCallIds = new Set<string>();
  private readonly startedAt = new Map<string, string>();

  constructor(
    private readonly scope: TScope,
    readonly state: TState,
    readonly budget: AgentBudgetEnvelope,
    private readonly tools: ReadonlyMap<string, AnyToolSpec<TScope, TState>>,
    private readonly isComplete: (state: TState) => boolean,
    private readonly emit: (step: AgentStepTrace) => void,
  ) {}

  hardStopRequested(): boolean {
    const { flags } = this;
    return flags.timeout || flags.iteration || flags.tool || flags.model || flags.token || flags.cost || flags.vlm || flags.ocr || flags.noProgress || this.isComplete(this.state);
  }

  noteToolStart(toolCallId: string): void {
    this.startedAt.set(toolCallId, new Date().toISOString());
  }

  /** Record calls the Pi loop rejected before reaching a registered tool (unknown name or schema-invalid arguments). */
  noteLoopRejectedCall(toolCallId: string, toolName: string): void {
    if (this.handledToolCallIds.has(toolCallId)) return;
    const spec = this.tools.get(toolName);
    const outcome: AgentStepOutcome = spec ? "schema_rejected" : "unknown_tool_rejected";
    this.consecutiveNoProgress += 1;
    this.record(toolCallId, toolName, null, outcome, spec ? `Rejected schema-invalid arguments for ${toolName}` : `Rejected unregistered tool ${toolName}`, spec?.version);
    this.checkNoProgress();
  }

  /** Ordered chain: registry lookup, schema validation, scope authorization, budget reservation, idempotency, execution, output validation. */
  async execute(toolCallId: string, toolName: string, args: unknown): Promise<{ content: string; isError: boolean; terminate: boolean }> {
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
    const authorization = spec.authorize(args, this.scope, this.state);
    if (authorization) {
      this.consecutiveNoProgress += 1;
      this.record(toolCallId, toolName, args, "authorization_rejected", `Rejected ${toolName}: ${authorization.replace(/_/g, " ")}`, spec.version);
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
    const budgetRejection = this.reserve(spec.costClass);
    if (budgetRejection) {
      this.record(toolCallId, toolName, args, "budget_rejected", `Rejected ${toolName}: ${budgetRejection.replace(/_/g, " ")} budget exhausted`, spec.version);
      return { content: JSON.stringify({ error: "budget_exhausted", budget: budgetRejection }), isError: true, terminate: true };
    }
    try {
      const result = await spec.execute(args, this.scope, this.state);
      this.consecutiveNoProgress = 0;
      this.committed.set(idempotencyKey, { output: result.output, terminate: result.terminate ?? false });
      this.record(toolCallId, toolName, args, "succeeded", result.summary, spec.version);
      return { content: JSON.stringify(result.output), isError: false, terminate: result.terminate ?? false };
    } catch {
      this.consecutiveNoProgress += 1;
      this.record(toolCallId, toolName, args, "failed", `${toolName} failed`, spec.version);
      this.checkNoProgress();
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
    const complete = this.isComplete(this.state);
    if (this.iterations >= this.budget.maxIterations && !complete) this.flags.iteration = true;
    if (this.modelCalls >= this.budget.maxModelCalls && !complete) this.flags.model = true;
    if (this.inputTokens > this.budget.maxInputTokens || this.outputTokens > this.budget.maxOutputTokens) this.flags.token = true;
    if (this.costUsd > this.budget.maxEstimatedCostUsd) this.flags.cost = true;
  }

  terminalReason(completeReason: AgentTerminalReason, incompleteReason: AgentTerminalReason): AgentTerminalReason {
    if (this.isComplete(this.state)) return completeReason;
    const { flags } = this;
    if (flags.timeout) return "timeout";
    if (flags.modelUnavailable) return "model_unavailable";
    if (flags.tool || flags.vlm || flags.ocr) return "tool_budget_exhausted";
    if (flags.token) return "token_budget_exhausted";
    if (flags.cost) return "cost_budget_exhausted";
    if (flags.iteration) return "iteration_budget_exhausted";
    if (flags.model) return "model_budget_exhausted";
    if (flags.noProgress) return "no_progress";
    return incompleteReason;
  }

  private reserve(costClass: ToolCostClass): string | undefined {
    if (this.toolCalls >= this.budget.maxToolCalls) { this.flags.tool = true; return "tool_calls"; }
    if (costClass === "vlm" && this.vlmCalls >= this.budget.maxVlmCalls) { this.flags.vlm = true; return "vlm_calls"; }
    if (costClass === "ocr" && this.ocrPages >= this.budget.maxOcrPages) { this.flags.ocr = true; return "ocr_pages"; }
    this.toolCalls += 1;
    if (costClass === "vlm") this.vlmCalls += 1;
    if (costClass === "ocr") this.ocrPages += 1;
    return undefined;
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

export interface BoundedSessionSpec<TScope, TState> {
  readonly mode: AgentSessionMode;
  readonly systemPrompt: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly userMessage: string;
  readonly tools: readonly AnyToolSpec<TScope, TState>[];
  readonly toolRegistryVersion: string;
  readonly scope: TScope;
  readonly state: TState;
  readonly isComplete: (state: TState) => boolean;
  readonly completeReason: AgentTerminalReason;
  readonly incompleteReason: AgentTerminalReason;
  readonly boundGapIds?: readonly string[];
}

/** Shared Pi model resolution and session execution for every bounded mode (ADR-001). */
export class PiSessionRunner {
  readonly descriptor: CaseReviewHarnessDescriptor;
  readonly budget: AgentBudgetEnvelope;
  private runtimePromise: Promise<ModelRuntime> | undefined;

  constructor(readonly options: PiHarnessOptions, harnessId: string) {
    this.budget = options.budget ?? DEFAULT_AGENT_BUDGET;
    this.descriptor = {
      harnessId, harnessVersion: PI_HARNESS_VERSION, modelRoute: options.model.route,
      modelLabel: options.model.route === "fake"
        ? `${FAKE_MODEL.provider}/${FAKE_MODEL.id}${options.model.scriptLabel ? `#${options.model.scriptLabel}` : ""}`
        : `${options.model.provider}/${options.model.modelId}`,
    };
  }

  async run<TScope, TState>(spec: BoundedSessionSpec<TScope, TState>): Promise<{ trace: AgentSessionTrace; state: TState }> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const tools = new Map<string, AnyToolSpec<TScope, TState>>(spec.tools.map((tool) => [tool.name, tool]));
    const control = new SessionControlPlane<TScope, TState>(spec.scope, spec.state, this.budget, tools, spec.isComplete, (step) => {
      this.options.onEvent?.({ type: "tool_step", sessionId, mode: spec.mode, toolName: step.toolName, outcome: step.outcome });
    });
    this.options.onEvent?.({ type: "session_started", sessionId, mode: spec.mode });
    const runtime = await this.modelRuntime();
    const resolved = await this.resolveModel(runtime);
    let session: AgentSession | undefined;
    if (resolved) {
      const agent = new Agent({
        initialState: { systemPrompt: "", model: resolved.model, thinkingLevel: "off", tools: [] },
        convertToLlm, streamFn: resolved.streamFn, sessionId, toolExecution: "sequential",
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
      session.subscribe((event) => {
        if (event.type === "tool_execution_start") control.noteToolStart(event.toolCallId);
        else if (event.type === "tool_execution_end" && event.isError) control.noteLoopRejectedCall(event.toolCallId, event.toolName);
        else if (event.type === "turn_end" && event.message.role === "assistant") {
          if (event.message.stopReason === "error") control.flags.modelUnavailable = true;
          control.noteTurn(event.message.stopReason === "aborted" ? undefined : event.message.usage);
        }
      });
      const timer = setTimeout(() => { control.flags.timeout = true; void session?.abort(); }, this.budget.maxWallClockMs);
      try {
        await session.prompt(spec.userMessage);
      } catch {
        control.flags.modelUnavailable = true;
      } finally {
        clearTimeout(timer);
        session.dispose();
      }
    } else {
      control.flags.modelUnavailable = true;
    }
    const terminalReason = control.terminalReason(spec.completeReason, spec.incompleteReason);
    const trace: AgentSessionTrace = {
      sessionId, mode: spec.mode,
      harnessId: this.descriptor.harnessId, harnessVersion: this.descriptor.harnessVersion,
      modelLabel: this.descriptor.modelLabel, modelRoute: this.descriptor.modelRoute,
      promptVersion: spec.promptVersion, promptHash: spec.promptHash,
      configurationVersion: PI_HARNESS_CONFIGURATION_VERSION, toolRegistryVersion: spec.toolRegistryVersion,
      offeredTools: session?.getActiveToolNames() ?? [],
      budget: this.budget, iterations: control.iterations, toolCalls: control.toolCalls,
      usage: { available: control.usageAvailable, modelCalls: control.modelCalls, inputTokens: control.inputTokens, outputTokens: control.outputTokens },
      ...(this.options.model.route === "fake" ? { estimatedCost: { amount: "0.0000", currency: "EUR" } } : {}),
      terminalReason, steps: control.steps, startedAt, completedAt: new Date().toISOString(),
      ...(spec.boundGapIds ? { boundGapIds: spec.boundGapIds } : {}),
    };
    this.options.onEvent?.({ type: "session_ended", sessionId, mode: spec.mode, terminalReason, iterations: trace.iterations, toolCalls: trace.toolCalls });
    return { trace, state: spec.state };
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
