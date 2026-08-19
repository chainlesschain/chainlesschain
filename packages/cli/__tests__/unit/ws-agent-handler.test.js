import { afterAll, describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock agent-core (canonical runtime path — Phase 6b)
vi.mock("../../src/runtime/agent-core.js", () => ({
  agentLoop: vi.fn(),
  formatToolArgs: vi.fn((tool, args) => `${tool}(${JSON.stringify(args)})`),
}));

// Mock task-model-selector
vi.mock("../../src/lib/task-model-selector.js", () => ({
  detectTaskType: vi.fn(() => ({
    confidence: 0.1,
    taskType: "general",
    name: "general",
  })),
  selectModelForTask: vi.fn(() => null),
}));

// Mock plan-mode
vi.mock("../../src/lib/plan-mode.js", () => ({
  PlanState: {
    INACTIVE: "inactive",
    ANALYZING: "analyzing",
    APPROVED: "approved",
    REJECTED: "rejected",
  },
}));

import { WSAgentHandler } from "../../src/lib/ws-agent-handler.js";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../../src/lib/task-model-selector.js";
import {
  currentHostHooksV2WorkspaceRoot,
  registerHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

const wsAgentWorkspaceParent = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-hooks-v2-ws-agent-"),
);

function createWsAgentWorkspace(name) {
  const workspaceRoot = path.join(wsAgentWorkspaceParent, name);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return fs.realpathSync.native(workspaceRoot);
}

afterAll(() => {
  fs.rmSync(wsAgentWorkspaceParent, { recursive: true, force: true });
});

function createMockSession(overrides = {}) {
  return {
    id: "test-session-1",
    type: "agent",
    status: "active",
    messages: [{ role: "system", content: "You are helpful." }],
    provider: "ollama",
    model: "qwen2.5:7b",
    apiKey: null,
    baseUrl: "http://localhost:11434",
    projectRoot: "/test/project",
    rulesContent: null,
    enabledToolNames: ["read_file", "search_files", "list_dir"],
    planManager: {
      isActive: vi.fn(() => false),
      enterPlanMode: vi.fn(),
      generatePlanSummary: vi.fn(() => "Plan summary"),
      getRiskAssessment: vi.fn(() => ({ level: "low" })),
      currentPlan: { items: [] },
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      exitPlanMode: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    contextEngine: {
      setTask: vi.fn(),
      clearTask: vi.fn(),
      recordError: vi.fn(),
      getStats: vi.fn(() => ({})),
      smartCompact: vi.fn((msgs) => [msgs[0], ...msgs.slice(-4)]),
      taskContext: { objective: "Build feature X" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    lastActivity: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockInteraction() {
  return {
    emit: vi.fn(),
    askInput: vi.fn(),
    rejectAllPending: vi.fn(),
  };
}

/**
 * Helper: create an async generator from an array of events.
 */
async function* fakeAgentLoop(events) {
  for (const event of events) {
    yield event;
  }
}

describe("WSAgentHandler", () => {
  let handler;
  let session;
  let interaction;

  beforeEach(() => {
    vi.clearAllMocks();
    session = createMockSession();
    interaction = createMockInteraction();
    handler = new WSAgentHandler({ session, interaction, db: null });
  });

  describe("constructor", () => {
    it("sets session and interaction", () => {
      expect(handler.session).toBe(session);
      expect(handler.interaction).toBe(interaction);
      expect(handler._processing).toBe(false);
    });

    it("checks and releases the session host lease", async () => {
      const controller = new AbortController();
      const sessionHostLease = {
        signal: controller.signal,
        assert: vi.fn(),
        release: vi.fn(),
      };
      const leased = new WSAgentHandler({
        session,
        interaction,
        db: null,
        sessionHostLease,
      });
      agentLoop.mockReturnValue(
        fakeAgentLoop([{ type: "response-complete", content: "done" }]),
      );

      await leased.handleMessage("leased request", "req-lease");
      expect(sessionHostLease.assert).toHaveBeenCalled();

      leased.destroy();
      expect(sessionHostLease.release).toHaveBeenCalledOnce();
    });

    it("shares the production budget with the loop and closes it before the lease", async () => {
      const order = [];
      const leaseController = new AbortController();
      const budgetController = new AbortController();
      const sessionHostLease = {
        signal: leaseController.signal,
        assert: vi.fn(),
        release: vi.fn(() => order.push("lease")),
      };
      const sessionBudget = {
        signal: budgetController.signal,
        reason: vi.fn(() => null),
        recordUsage: vi.fn(() => ({ aborted: false })),
      };
      const sessionBudgetRoot = {
        budget: sessionBudget,
        options: {
          sessionBudget,
          signal: budgetController.signal,
        },
        close: vi.fn(() => order.push("budget")),
      };
      let loopOptions = null;
      const budgeted = new WSAgentHandler({
        session,
        interaction,
        db: null,
        sessionHostLease,
        sessionBudgetRoot,
        agentLoop: vi.fn(async function* (_messages, options) {
          loopOptions = options;
          yield {
            type: "token-usage",
            provider: "ollama",
            model: "qwen2.5:7b",
            usage: { input_tokens: 5, output_tokens: 2 },
          };
          yield {
            type: "token-usage",
            provider: "ollama",
            model: "qwen2.5:7b",
            usage: { input_tokens: 1, output_tokens: 1 },
            attribution: { kind: "subagent" },
          };
          yield { type: "response-complete", content: "done" };
        }),
      });

      await budgeted.handleMessage("budgeted request", "req-budget");

      expect(loopOptions.sessionBudget).toBe(sessionBudget);
      expect(loopOptions.signal).not.toBe(budgetController.signal);
      expect(sessionBudget.recordUsage).toHaveBeenCalledOnce();
      expect(sessionBudget.recordUsage).toHaveBeenCalledWith({
        provider: "ollama",
        model: "qwen2.5:7b",
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      budgeted.destroy();
      expect(order).toEqual(["budget", "lease"]);
    });

    it("fails the WS turn and retains recovery for unknown provider usage", async () => {
      const budget = new SessionResourceBudget({ maxTokens: 20 });
      const budgeted = new WSAgentHandler({
        session,
        interaction,
        db: null,
        sessionBudgetRoot: {
          budget,
          options: { sessionBudget: budget, signal: budget.signal },
          close: vi.fn(),
        },
        agentLoop: vi.fn(async function* () {
          yield {
            type: "model-usage-started",
            callId: "ws-unknown-call",
            provider: "openai",
            model: "gpt-test",
            source: "model",
          };
          yield {
            type: "model-usage-unknown",
            callId: "ws-unknown-call",
            provider: "openai",
            model: "gpt-test",
            source: "model",
            code: "provider_usage_missing",
          };
          yield { type: "response-complete", content: "must not succeed" };
        }),
      });

      await budgeted.handleMessage("budgeted request", "req-unknown");

      expect(interaction.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          requestId: "req-unknown",
          code: "CC_SESSION_BUDGET_USAGE_UNKNOWN",
        }),
      );
      expect(budget.status()).toMatchObject({
        tokens: 0,
        recoveryRequired: true,
        pendingRecovery: 1,
        reason: "recovery-required",
      });
      budgeted.destroy();
      budget.dispose();
    });

    it("reattaches a resumed transport without replacing session authority", () => {
      const previous = interaction;
      const next = createMockInteraction();

      expect(handler.attachInteraction(next)).toBe(true);

      expect(handler.interaction).toBe(next);
      expect(session.interaction).toBe(next);
      expect(previous.rejectAllPending).toHaveBeenCalledOnce();
    });
  });

  describe("handleMessage", () => {
    it("scopes a turn only from the session's host-owned Hooks root", async () => {
      const trustedRoot = createWsAgentWorkspace("host-project");
      session.hooksV2WorkspaceBindingId =
        registerHostHooksV2Workspace(trustedRoot).bindingId;
      let observedRoot = null;
      agentLoop.mockImplementation(() =>
        fakeAgentLoop([
          {
            type: "response-complete",
            get content() {
              observedRoot = currentHostHooksV2WorkspaceRoot();
              return "done";
            },
          },
        ]),
      );

      await handler.handleMessage("Run in the host project", "req-1");

      expect(observedRoot).toBe(trustedRoot);
      expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
    });

    it("does not derive a Hooks root from session.projectRoot", async () => {
      session.projectRoot = path.resolve("ws-request-project");
      session.hooksV2WorkspaceRoot = path.resolve("forged-hooks-root");
      session.hooksV2WorkspaceBindingId = "0".repeat(64);
      let observedRoot = "not-observed";
      agentLoop.mockImplementation(() =>
        fakeAgentLoop([
          {
            type: "response-complete",
            get content() {
              observedRoot = currentHostHooksV2WorkspaceRoot();
              return "done";
            },
          },
        ]),
      );

      await handler.handleMessage("Keep strong hooks closed", "req-1");

      expect(observedRoot).toBeNull();
    });

    it("adds user message to session", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));
      await handler.handleMessage("Hello agent", "req-1");
      expect(session.messages).toContainEqual({
        role: "user",
        content: "Hello agent",
      });
    });

    it("records run lifecycle and the committed TODO revision", async () => {
      session._recordSessionStateEvent = vi.fn();
      agentLoop.mockReturnValue(
        fakeAgentLoop([
          {
            type: "tool-executing",
            tool: "todo_write",
            args: {
              todos: [
                { id: "todo-1", content: "Persist", status: "in_progress" },
              ],
            },
          },
          {
            type: "tool-result",
            tool: "todo_write",
            result: { success: true, revision: 6 },
          },
        ]),
      );

      await handler.handleMessage("Track this", "req-state");

      expect(session._recordSessionStateEvent.mock.calls).toEqual([
        ["run.started", expect.objectContaining({ requestId: "req-state" })],
        [
          "todo.snapshot",
          {
            todo: {
              sessionId: session.id,
              revision: 6,
              todos: [
                { id: "todo-1", content: "Persist", status: "in_progress" },
              ],
            },
          },
        ],
        ["run.settled", expect.objectContaining({ requestId: "req-state" })],
      ]);
    });

    it("passes host-managed tool policy into the agent loop", async () => {
      session.hostManagedToolPolicy = {
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      };
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Run a command", "req-1");

      expect(agentLoop).toHaveBeenCalledWith(
        session.messages,
        expect.objectContaining({
          hostManagedToolPolicy: session.hostManagedToolPolicy,
        }),
      );
    });

    it("passes the session plan manager into the agent loop", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Plan this change", "req-1");

      expect(agentLoop).toHaveBeenCalledWith(
        session.messages,
        expect.objectContaining({
          planManager: session.planManager,
        }),
      );
    });

    it("passes the session enabledToolNames into the agent loop", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage(
        "Use the coding session tool policy",
        "req-1",
      );

      expect(agentLoop).toHaveBeenCalledWith(
        session.messages,
        expect.objectContaining({
          enabledToolNames: session.enabledToolNames,
        }),
      );
    });

    it("passes direct external tool definitions and executors into the agent loop", async () => {
      session.externalToolDefinitions = [
        {
          type: "function",
          function: {
            name: "mcp_weather_get_forecast",
            description: "Get weather forecast",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
            },
          },
        },
      ];
      session.externalToolDescriptors = {
        mcp_weather_get_forecast: {
          name: "mcp_weather_get_forecast",
          riskLevel: "low",
          isReadOnly: true,
        },
      };
      session.externalToolExecutors = {
        mcp_weather_get_forecast: {
          kind: "mcp",
          serverName: "weather",
          toolName: "get_forecast",
        },
      };
      session.mcpClient = { callTool: vi.fn() };
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Use direct MCP tools", "req-1");

      expect(agentLoop).toHaveBeenCalledWith(
        session.messages,
        expect.objectContaining({
          extraToolDefinitions: session.externalToolDefinitions,
          externalToolDescriptors: session.externalToolDescriptors,
          externalToolExecutors: session.externalToolExecutors,
          mcpClient: session.mcpClient,
        }),
      );
    });

    it("passes the session id into the agent loop for telemetry correlation", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Trace this turn", "req-1");

      expect(agentLoop).toHaveBeenCalledWith(
        session.messages,
        expect.objectContaining({
          sessionId: session.id,
          mcpCallLedger: expect.objectContaining({
            begin: expect.any(Function),
          }),
        }),
      );
    });

    it("passes an abort signal into the agent loop", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Interruptible turn", "req-1");

      const loopOptions = agentLoop.mock.calls.at(-1)?.[1];
      expect(loopOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(loopOptions?.signal?.aborted).toBe(false);
    });

    // P0 authority: permission-gate-over-WS is opt-in — the default path
    // carries approvalGate: null into the loop, byte-identical to before.
    it("passes approvalGate: null by default (env unset, nothing injected)", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await handler.handleMessage("Default turn", "req-1");

      const loopOptions = agentLoop.mock.calls.at(-1)?.[1];
      expect(loopOptions.approvalGate).toBeNull();
    });

    it("passes an explicitly injected approval gate into the loop", async () => {
      const gate = { decide: vi.fn(), hasConfirmer: () => true };
      const gated = new WSAgentHandler({
        session,
        interaction,
        db: null,
        approvalGate: gate,
      });
      agentLoop.mockReturnValue(fakeAgentLoop([]));

      await gated.handleMessage("Gated turn", "req-1");

      const loopOptions = agentLoop.mock.calls.at(-1)?.[1];
      expect(loopOptions.approvalGate).toBe(gate);
    });

    it("returns busy error when already processing", async () => {
      // Simulate a long-running loop
      let resolveLoop;
      /* eslint-disable require-yield */
      const blockingLoop = (async function* () {
        await new Promise((r) => {
          resolveLoop = r;
        });
      })();
      /* eslint-enable require-yield */
      agentLoop.mockReturnValue(blockingLoop);

      // Start first message (will block)
      const p1 = handler.handleMessage("first", "req-1");

      // Try second message while first is still processing
      await handler.handleMessage("second", "req-2");

      expect(interaction.emit).toHaveBeenCalledWith("error", {
        requestId: "req-2",
        code: "BUSY",
        message: "Session is currently processing a message",
      });

      // Clean up: resolve the blocking loop
      resolveLoop();
      await p1;
    });

    it("emits tool-executing events", async () => {
      agentLoop.mockReturnValue(
        fakeAgentLoop([
          {
            type: "tool-executing",
            tool: "read_file",
            args: { path: "/a.txt" },
          },
        ]),
      );

      await handler.handleMessage("Read a file", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith(
        "tool-executing",
        expect.objectContaining({
          requestId: "req-1",
          tool: "read_file",
          args: { path: "/a.txt" },
        }),
      );
    });

    it("emits response-complete event", async () => {
      agentLoop.mockReturnValue(
        fakeAgentLoop([{ type: "response-complete", content: "Done!" }]),
      );

      await handler.handleMessage("Do something", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith(
        "response-complete",
        expect.objectContaining({
          requestId: "req-1",
          content: "Done!",
        }),
      );
    });

    it("appends assistant response to messages on response-complete", async () => {
      agentLoop.mockReturnValue(
        fakeAgentLoop([
          { type: "response-complete", content: "Here is the answer." },
        ]),
      );

      await handler.handleMessage("question", "req-1");

      expect(session.messages).toContainEqual({
        role: "assistant",
        content: "Here is the answer.",
      });
    });

    it("handles LLM errors gracefully", async () => {
      agentLoop.mockImplementation(() => {
        throw new Error("LLM connection failed");
      });

      await handler.handleMessage("fail please", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith("error", {
        requestId: "req-1",
        code: "AGENT_ERROR",
        message: "LLM connection failed",
      });
    });

    it("records errors in context engine", async () => {
      agentLoop.mockImplementation(() => {
        throw new Error("Something went wrong");
      });

      await handler.handleMessage("oops", "req-1");

      expect(session.contextEngine.recordError).toHaveBeenCalledWith({
        step: "ws-agent-loop",
        message: "Something went wrong",
      });
    });

    it("resets _processing flag after error", async () => {
      agentLoop.mockImplementation(() => {
        throw new Error("fail");
      });

      await handler.handleMessage("err", "req-1");
      expect(handler._processing).toBe(false);
    });

    it("surfaces a session-budget terminal instead of swallowing it as an interrupt", async () => {
      const budgetController = new AbortController();
      const sessionBudget = {
        signal: budgetController.signal,
        reason: vi.fn(() => "max-tokens"),
        recordUsage: vi.fn(() => ({
          aborted: true,
          reason: "max-tokens",
        })),
      };
      const budgeted = new WSAgentHandler({
        session,
        interaction,
        db: null,
        sessionBudgetRoot: {
          budget: sessionBudget,
          options: { sessionBudget, signal: budgetController.signal },
          close: vi.fn(),
        },
        agentLoop: vi.fn(async function* () {
          yield {
            type: "token-usage",
            provider: "ollama",
            model: "qwen2.5:7b",
            usage: { input_tokens: 10, output_tokens: 1 },
          };
        }),
      });

      await budgeted.handleMessage("exhaust budget", "req-budget-error");

      expect(interaction.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          requestId: "req-budget-error",
          code: "CC_SESSION_BUDGET_EXHAUSTED",
        }),
      );
      budgeted.destroy();
    });

    it("interrupts an active turn without emitting an AGENT_ERROR", async () => {
      /* eslint-disable require-yield */
      agentLoop.mockImplementation((_messages, options) =>
        (async function* () {
          await new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
          });
        })(),
      );
      /* eslint-enable require-yield */

      const pending = handler.handleMessage("long running", "req-1");
      await Promise.resolve();

      const result = await handler.interrupt();
      await pending;

      expect(result).toMatchObject({
        sessionId: "test-session-1",
        interrupted: true,
        wasProcessing: true,
        interruptedRequestId: "req-1",
      });
      expect(interaction.rejectAllPending).toHaveBeenCalled();
      expect(interaction.emit).not.toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          code: "AGENT_ERROR",
        }),
      );
      expect(handler._processing).toBe(false);
    });
  });

  describe("canonical JSONL turns", () => {
    const INPUT_DIGEST = `sha256:${"a".repeat(64)}`;

    function canonicalState(overrides = {}) {
      return {
        headHash: "head-1",
        eventCount: 1,
        status: "none",
        inputDigest: INPUT_DIGEST,
        messages: [
          { role: "user", content: "previous question" },
          { role: "assistant", content: "previous answer" },
        ],
        turn: null,
        ...overrides,
      };
    }

    function canonicalStore(overrides = {}) {
      const readState = overrides.readState || canonicalState();
      const store = {
        computeWsTurnInputDigest: vi.fn(() => INPUT_DIGEST),
        createWsTurnClaimId: vi.fn(() => "claim-test-owner"),
        readVerifiedWsTurnState: vi.fn(() => readState),
        claimWsTurnIfHead: vi.fn(() => ({
          ...canonicalState(),
          status: "pending",
          acquired: true,
          claim: {
            requestId: "req",
            inputDigest: INPUT_DIGEST,
            opaqueClaimId: "claim-test-owner",
          },
        })),
        settleWsTurnClaim: vi.fn((_sessionId, settlement) => {
          if (settlement.outcome === "failed") {
            return {
              ...canonicalState(),
              status: "failed",
              settlement: {
                outcome: "failed",
                failure: { code: settlement.failureCode },
              },
            };
          }
          const turn = {
            outcome: "completed",
            user: { role: "user", content: settlement.user },
            assistant: { role: "assistant", content: settlement.assistant },
          };
          return {
            ...canonicalState(),
            status: "completed",
            turn,
            settlement: turn,
            messages: [...canonicalState().messages, turn.user, turn.assistant],
            deduplicated: false,
          };
        }),
        ...overrides.store,
      };
      return store;
    }

    function usageProjection(sessionStartData) {
      return vi.fn((_sessionId, createProjection) => {
        const projection = createProjection();
        projection.accept({
          type: "session_start",
          data: sessionStartData,
        });
        return projection.finish({ headHash: "head-1", eventCount: 1 });
      });
    }

    it("persists canonical usage before settling the shared WS budget", async () => {
      const order = [];
      const budgetController = new AbortController();
      const sessionBudget = {
        signal: budgetController.signal,
        reason: vi.fn(() => null),
        recordUsage: vi.fn(() => {
          order.push("budget");
          return { aborted: false };
        }),
      };
      const store = canonicalStore({
        store: {
          appendTokenUsage: vi.fn(() => order.push("ledger")),
        },
      });
      const canonicalHandler = new WSAgentHandler({
        session: createMockSession({ canonicalJsonlSession: true }),
        interaction: createMockInteraction(),
        db: null,
        canonicalSessionStore: store,
        sessionBudgetRoot: {
          budget: sessionBudget,
          options: {
            sessionBudget,
            signal: budgetController.signal,
          },
          close: vi.fn(),
        },
        agentLoop: vi.fn(async function* () {
          yield {
            type: "token-usage",
            callId: "model-call-budgeted",
            provider: "ollama",
            model: "qwen2.5:7b",
            usage: { input_tokens: 8, output_tokens: 2 },
          };
          yield { type: "response-complete", content: "done" };
        }),
      });

      await canonicalHandler.handleMessage("inspect", "req-budget-ledger");

      expect(order).toEqual(["ledger", "budget"]);
      canonicalHandler.destroy();
    });

    it("persists strict model, retry, and tool ledgers for a scoped WS turn", async () => {
      const writes = {
        events: [],
        usage: [],
        retries: [],
        tools: [],
      };
      let loopOptions = null;
      const store = canonicalStore({
        store: {
          readVerifiedProjection: usageProjection({
            observabilityScope: { workspaceId: "workspace-1" },
            usageTelemetryProtocol: "call-ledger",
            usageTelemetryVersion: 1,
          }),
          appendEvent: vi.fn((...args) => writes.events.push(args)),
          appendTokenUsage: vi.fn((...args) => writes.usage.push(args)),
          appendLlmRetryCompact: vi.fn((...args) => writes.retries.push(args)),
          appendToolCallCompact: vi.fn((...args) => writes.tools.push(args)),
        },
      });
      const canonicalHandler = new WSAgentHandler({
        session: createMockSession({ canonicalJsonlSession: true }),
        interaction: createMockInteraction(),
        db: null,
        canonicalSessionStore: store,
        agentLoop: vi.fn(async function* (_messages, options) {
          loopOptions = options;
          options.onUsageBoundary({
            type: "model-usage-started",
            callId: "subagent-call-1",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "subagent",
          });
          const childKnown = {
            type: "token-usage",
            callId: "subagent-call-1",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "subagent",
            usage: { input_tokens: 4, output_tokens: 1 },
          };
          options.onUsageSettlement(childKnown);
          yield { ...childKnown, ledgerPersisted: true };
          options.onUsageBoundary({
            type: "model-usage-started",
            callId: "subagent-call-2",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "subagent",
          });
          const childUnknown = {
            type: "model-usage-unknown",
            callId: "subagent-call-2",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "subagent",
            code: "provider_usage_missing",
          };
          options.onUsageSettlement(childUnknown);
          yield { ...childUnknown, ledgerPersisted: true };
          yield {
            type: "model-usage-started",
            callId: "model-call-1",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "model",
          };
          options.onStreamRetry(1, { code: "ECONNRESET" }, { durationMs: 7 });
          yield {
            type: "token-usage",
            callId: "model-call-1",
            provider: "ollama",
            model: "qwen2.5:7b",
            usage: { input_tokens: 12, output_tokens: 3 },
          };
          yield {
            type: "tool-executing",
            tool: "read_file",
            args: { path: "README.md" },
            tool_use_id: "tool-call-1",
          };
          yield {
            type: "tool-result",
            tool: "read_file",
            result: { content: "ok", toolTelemetryRecord: { durationMs: 9 } },
            tool_use_id: "tool-call-1",
          };
          yield { type: "response-complete", content: "done" };
        }),
      });

      await canonicalHandler.handleMessage("inspect", "req-ledger-1");

      expect(loopOptions).toEqual(
        expect.objectContaining({
          strictUsageTelemetry: true,
          onUsageBoundary: expect.any(Function),
          onUsageSettlement: expect.any(Function),
          onStreamRetry: expect.any(Function),
        }),
      );
      expect(writes.events).toEqual(
        expect.arrayContaining([
          [
            "test-session-1",
            "model_usage_started",
            expect.objectContaining({ callId: "subagent-call-1" }),
          ],
          [
            "test-session-1",
            "model_usage_started",
            expect.objectContaining({ callId: "subagent-call-2" }),
          ],
          [
            "test-session-1",
            "model_usage_unknown",
            expect.objectContaining({
              callId: "subagent-call-2",
              code: "provider_usage_missing",
            }),
          ],
          [
            "test-session-1",
            "model_usage_started",
            expect.objectContaining({ callId: "model-call-1" }),
          ],
          [
            "test-session-1",
            "tool_call_started",
            { id: "tool-call-1", tool: "read_file" },
          ],
        ]),
      );
      expect(writes.usage).toEqual([
        [
          "test-session-1",
          expect.objectContaining({
            callId: "subagent-call-1",
            usage: expect.objectContaining({
              input_tokens: 4,
              output_tokens: 1,
            }),
          }),
        ],
        [
          "test-session-1",
          expect.objectContaining({
            callId: "model-call-1",
            usage: expect.objectContaining({
              input_tokens: 12,
              output_tokens: 3,
            }),
          }),
        ],
      ]);
      expect(writes.retries[0][1]).toEqual(
        expect.objectContaining({ attempt: 1, reason: "connection_reset" }),
      );
      expect(writes.tools).toEqual([
        [
          "test-session-1",
          expect.objectContaining({
            id: "tool-call-1",
            tool: "read_file",
            isError: false,
            durationMs: 9,
          }),
        ],
      ]);
    });

    it("stops before provider execution when the strict start row cannot persist", async () => {
      let providerEntered = false;
      const store = canonicalStore({
        store: {
          readVerifiedProjection: usageProjection({
            observabilityScope: { workspaceId: "workspace-1" },
            usageTelemetryProtocol: "call-ledger",
            usageTelemetryVersion: 1,
          }),
          appendEvent: vi.fn(() => {
            throw new Error("disk detail must not surface");
          }),
          appendTokenUsage: vi.fn(),
          appendLlmRetryCompact: vi.fn(),
          appendToolCallCompact: vi.fn(),
        },
      });
      const interaction = createMockInteraction();
      const canonicalHandler = new WSAgentHandler({
        session: createMockSession({ canonicalJsonlSession: true }),
        interaction,
        db: null,
        canonicalSessionStore: store,
        agentLoop: vi.fn(async function* () {
          yield {
            type: "model-usage-started",
            callId: "model-call-fail",
            provider: "ollama",
            model: "qwen2.5:7b",
            source: "model",
          };
          providerEntered = true;
          yield { type: "response-complete", content: "must not happen" };
        }),
      });

      await canonicalHandler.handleMessage("inspect", "req-ledger-fail");

      expect(providerEntered).toBe(false);
      expect(interaction.emit).toHaveBeenCalledWith("error", {
        requestId: "req-ledger-fail",
        code: "CC_USAGE_LEDGER_PERSISTENCE_FAILED",
        message:
          "Canonical usage ledger persistence failed; model and tool execution is blocked",
      });
      expect(JSON.stringify(interaction.emit.mock.calls)).not.toContain(
        "disk detail",
      );
    });

    it("refuses a scoped canonical session with no call-ledger marker", async () => {
      const loop = vi.fn();
      const store = canonicalStore({
        store: {
          readVerifiedProjection: usageProjection({
            observabilityScope: { workspaceId: "workspace-1" },
          }),
        },
      });
      const interaction = createMockInteraction();
      const canonicalHandler = new WSAgentHandler({
        session: createMockSession({ canonicalJsonlSession: true }),
        interaction,
        db: null,
        agentLoop: loop,
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("inspect", "req-protocol-fail");

      expect(loop).not.toHaveBeenCalled();
      expect(store.claimWsTurnIfHead).not.toHaveBeenCalled();
      expect(interaction.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          requestId: "req-protocol-fail",
          code: "CC_USAGE_LEDGER_PROTOCOL_REQUIRED",
        }),
      );
    });

    it.each([
      [
        "model throw",
        () => {
          throw new Error("model failed");
        },
        "AGENT_ERROR",
      ],
      [
        "empty completion",
        () => fakeAgentLoop([]),
        "CC_WS_EMPTY_ASSISTANT_RESPONSE",
      ],
    ])(
      "does not append or retain a staged user after %s",
      async (_name, loop, code) => {
        const store = canonicalStore();
        const canonicalSession = createMockSession({
          canonicalJsonlSession: true,
        });
        const canonicalInteraction = createMockInteraction();
        const canonicalHandler = new WSAgentHandler({
          session: canonicalSession,
          interaction: canonicalInteraction,
          db: null,
          agentLoop: vi.fn(loop),
          canonicalSessionStore: store,
        });

        await canonicalHandler.handleMessage(
          "must not persist",
          "req-failed-1",
        );

        expect(store.claimWsTurnIfHead).toHaveBeenCalledTimes(1);
        expect(store.settleWsTurnClaim).toHaveBeenCalledTimes(1);
        expect(store.settleWsTurnClaim).toHaveBeenCalledWith(
          "test-session-1",
          expect.objectContaining({ outcome: "failed" }),
        );
        expect(canonicalSession.messages).toEqual([
          { role: "system", content: "You are helpful." },
          { role: "user", content: "previous question" },
          { role: "assistant", content: "previous answer" },
        ]);
        expect(canonicalInteraction.emit).toHaveBeenCalledWith(
          "error",
          expect.objectContaining({ requestId: "req-failed-1", code }),
        );
      },
    );

    it("replays an already-settled request without invoking the model", async () => {
      const loop = vi.fn();
      const canonicalSession = createMockSession({
        canonicalJsonlSession: true,
      });
      const canonicalInteraction = createMockInteraction();
      const settledState = canonicalState({
        status: "completed",
        messages: [
          { role: "user", content: "same question" },
          { role: "assistant", content: "durable answer" },
        ],
        turn: {
          requestId: "req-replay-1",
          user: { role: "user", content: "same question" },
          assistant: { role: "assistant", content: "durable answer" },
        },
      });
      const store = canonicalStore({ readState: settledState });
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        agentLoop: loop,
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("same question", "req-replay-1");

      expect(loop).not.toHaveBeenCalled();
      expect(store.claimWsTurnIfHead).not.toHaveBeenCalled();
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "response-complete",
        {
          requestId: "req-replay-1",
          content: "durable answer",
          replayed: true,
        },
      );
    });

    it("preserves leading host recovery notices across canonical refresh", async () => {
      const canonicalSession = createMockSession({
        canonicalJsonlSession: true,
        messages: [
          { role: "system", content: "You are helpful." },
          {
            role: "system",
            content:
              "Recovery notice: inspect prior side effects before replay.",
          },
          { role: "user", content: "stale host history" },
        ],
      });
      const canonicalInteraction = createMockInteraction();
      const store = canonicalStore();
      let modelMessages = null;
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        agentLoop: async function* (messages) {
          modelMessages = messages.map((message) => ({ ...message }));
          yield { type: "response-complete", content: "safe answer" };
        },
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("new question", "req-recovery-1");

      expect(modelMessages.slice(0, 2)).toEqual([
        { role: "system", content: "You are helpful." },
        {
          role: "system",
          content: "Recovery notice: inspect prior side effects before replay.",
        },
      ]);
      expect(modelMessages).not.toContainEqual({
        role: "user",
        content: "stale host history",
      });
    });

    it("uses the original durable response when settlement deduplicates", async () => {
      const canonicalSession = createMockSession({
        canonicalJsonlSession: true,
      });
      const canonicalInteraction = createMockInteraction();
      const store = canonicalStore({
        store: {
          settleWsTurnClaim: vi.fn((_sessionId, settlement) => {
            const turn = {
              outcome: "completed",
              user: { role: "user", content: settlement.user },
              assistant: {
                role: "assistant",
                content: "original durable answer",
              },
            };
            return {
              ...canonicalState(),
              status: "completed",
              turn,
              settlement: turn,
              messages: [
                ...canonicalState().messages,
                turn.user,
                turn.assistant,
              ],
              deduplicated: true,
            };
          }),
        },
      });
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        agentLoop: vi.fn(() =>
          fakeAgentLoop([
            { type: "response-complete", content: "racing answer" },
          ]),
        ),
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("same question", "req-race-1");

      expect(store.claimWsTurnIfHead).toHaveBeenCalledTimes(1);
      expect(store.settleWsTurnClaim).toHaveBeenCalledTimes(1);
      expect(canonicalSession.messages.at(-1)).toEqual({
        role: "assistant",
        content: "original durable answer",
      });
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "response-complete",
        {
          requestId: "req-race-1",
          content: "original durable answer",
          replayed: true,
        },
      );
    });

    it("preserves a canonical system summary exactly once across claim and settlement refresh", async () => {
      const hostPrompt = "WS_FRESH_HOST_SYSTEM_PRIVATE_10f6c4";
      const summary = "WS_CANONICAL_SUMMARY_PRIVATE_c4701a";
      const durableMessages = [
        { role: "system", content: summary },
        { role: "user", content: "previous question" },
        { role: "assistant", content: "previous answer" },
      ];
      const hostMessage = Object.freeze({
        role: "system",
        content: hostPrompt,
      });
      const canonicalSession = createMockSession({
        canonicalJsonlSession: true,
        messages: [hostMessage, ...durableMessages],
      });
      Object.defineProperty(canonicalSession, "_canonicalHostSystemPrefix", {
        value: Object.freeze([hostMessage]),
      });
      const claimedState = {
        ...canonicalState({ messages: durableMessages }),
        status: "pending",
        acquired: true,
        claim: {
          requestId: "req-summary-1",
          inputDigest: INPUT_DIGEST,
          opaqueClaimId: "claim-test-owner",
        },
      };
      const store = canonicalStore({
        readState: canonicalState({ messages: durableMessages }),
        store: {
          claimWsTurnIfHead: vi.fn(() => claimedState),
          settleWsTurnClaim: vi.fn((_sessionId, settlement) => {
            const turn = {
              outcome: "completed",
              user: { role: "user", content: settlement.user },
              assistant: { role: "assistant", content: settlement.assistant },
            };
            return {
              ...canonicalState({ messages: durableMessages }),
              status: "completed",
              turn,
              settlement: turn,
              messages: [...durableMessages, turn.user, turn.assistant],
              deduplicated: false,
            };
          }),
        },
      });
      const modelInputs = [];
      const canonicalInteraction = createMockInteraction();
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        agentLoop: vi.fn((messages) => {
          modelInputs.push(structuredClone(messages));
          return fakeAgentLoop([
            { type: "response-complete", content: "current answer" },
            { type: "run-ended", reason: "complete" },
          ]);
        }),
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("current question", "req-summary-1");

      expect(modelInputs).toHaveLength(1);
      expect(modelInputs[0][0]).toEqual({
        role: "system",
        content: hostPrompt,
      });
      expect(
        modelInputs[0].filter((message) => message.content === summary),
      ).toHaveLength(1);
      expect(
        canonicalSession.messages.filter(
          (message) => message.content === summary,
        ),
      ).toHaveLength(1);
      expect(canonicalSession.messages[0]?.content).toBe(hostPrompt);
      expect(
        JSON.stringify(canonicalInteraction.emit.mock.calls),
      ).not.toContain(summary);
    });

    it("auto-compacts verified history before claim and excludes the pending user", async () => {
      const durableMessages = [
        { role: "user", content: "A".repeat(2000) },
        { role: "assistant", content: "B".repeat(2000) },
        { role: "user", content: "C".repeat(2000) },
        { role: "assistant", content: "D".repeat(2000) },
        { role: "user", content: "E".repeat(2000) },
        { role: "assistant", content: "F".repeat(2000) },
      ];
      let authoritativeMessages = [...durableMessages];
      const appendCompactEventIfMessagesMatch = vi.fn((_id, data) => {
        authoritativeMessages = [...data.messages];
        return { hash: "compact-head" };
      });
      const claimWsTurnIfHead = vi.fn((_id, claim) => ({
        ...canonicalState({ messages: authoritativeMessages }),
        status: "pending",
        acquired: true,
        claim,
      }));
      const settleWsTurnClaim = vi.fn((_id, settlement) => {
        const turn = {
          outcome: "completed",
          user: { role: "user", content: settlement.user },
          assistant: { role: "assistant", content: settlement.assistant },
        };
        return {
          ...canonicalState({ messages: authoritativeMessages }),
          status: "completed",
          turn,
          settlement: turn,
          messages: [...authoritativeMessages, turn.user, turn.assistant],
        };
      });
      const store = canonicalStore({
        store: {
          readVerifiedWsTurnState: vi.fn(() =>
            canonicalState({ messages: authoritativeMessages }),
          ),
          appendCompactEventIfMessagesMatch,
          claimWsTurnIfHead,
          settleWsTurnClaim,
        },
      });
      const compactionLlmQuery = vi.fn(async () => ({
        summary: JSON.stringify({
          objective: "Preserve only verified prior history",
          constraints: [],
          keyDecisions: [],
          changedFiles: [],
          tests: [],
          unresolvedSideEffects: [],
          checkpoints: [],
          blockers: [],
          nextSteps: ["Claim the new turn after compaction"],
        }),
        usage: { input_tokens: 30, output_tokens: 12 },
      }));
      const canonicalSession = createMockSession({
        id: "test-session-preclaim-compaction",
        canonicalJsonlSession: true,
        compactionMaxMessages: 4,
        messages: [
          { role: "system", content: "You are helpful." },
          ...durableMessages,
        ],
      });
      const canonicalInteraction = createMockInteraction();
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: store,
      });

      const requestId = "req-preclaim-compact";
      const userMessage = "current pending question";
      const inputDigest = store.computeWsTurnInputDigest(userMessage);
      const preflight = store.readVerifiedWsTurnState(
        canonicalSession.id,
        requestId,
        { inputDigest },
      );
      expect(
        canonicalHandler._canonicalTurnFromAuthority(
          preflight,
          requestId,
          userMessage,
          inputDigest,
        ),
      ).toBeNull();
      expect(
        await canonicalHandler._compactCanonicalHistoryBeforeClaim(requestId),
      ).toBe(true);
      const claimed = canonicalHandler._claimCanonicalTurn(
        userMessage,
        requestId,
      );

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(compactionLlmQuery.mock.calls[0][0]).not.toContain(
        "current pending question",
      );
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(appendCompactEventIfMessagesMatch.mock.calls[0][1]),
      ).not.toContain("current pending question");
      expect(
        appendCompactEventIfMessagesMatch.mock.invocationCallOrder[0],
      ).toBeLessThan(claimWsTurnIfHead.mock.invocationCallOrder[0]);
      expect(claimed.status).toBe("pending");
      expect(canonicalSession.messages.at(-1)).toEqual({
        role: "user",
        content: "current pending question",
      });
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "token-usage",
        expect.objectContaining({
          requestId: "req-preclaim-compact",
          source: "semantic-compaction",
        }),
      );
    });

    it("does not claim or retry after a paid pre-claim compaction CAS goes stale", async () => {
      const durableMessages = Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: String.fromCharCode(65 + index).repeat(2000),
      }));
      const stale = Object.assign(new Error("external turn committed"), {
        code: "SESSION_REVISION_STALE",
      });
      const appendCompactEventIfMessagesMatch = vi.fn(() => {
        throw stale;
      });
      const claimWsTurnIfHead = vi.fn();
      const readVerifiedMessages = vi.fn(() => [
        ...durableMessages,
        { role: "user", content: "external turn" },
        { role: "assistant", content: "external answer" },
      ]);
      const store = canonicalStore({
        readState: canonicalState({ messages: durableMessages }),
        store: {
          appendCompactEventIfMessagesMatch,
          claimWsTurnIfHead,
          readVerifiedMessages,
        },
      });
      const compactionLlmQuery = vi.fn(async () => ({
        summary: JSON.stringify({
          objective: "This candidate must lose the CAS",
          constraints: [],
          keyDecisions: [],
          changedFiles: [],
          tests: [],
          unresolvedSideEffects: [],
          checkpoints: [],
          blockers: [],
          nextSteps: [],
        }),
        usage: { input_tokens: 20, output_tokens: 8 },
      }));
      const canonicalInteraction = createMockInteraction();
      const canonicalSession = createMockSession({
        id: "test-session-preclaim-stale",
        canonicalJsonlSession: true,
        compactionMaxMessages: 4,
        messages: [
          { role: "system", content: "You are helpful." },
          ...durableMessages,
        ],
      });
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: store,
      });

      const requestId = "req-preclaim-stale";
      const userMessage = "new pending question";
      const inputDigest = store.computeWsTurnInputDigest(userMessage);
      const preflight = store.readVerifiedWsTurnState(
        canonicalSession.id,
        requestId,
        { inputDigest },
      );
      canonicalHandler._canonicalTurnFromAuthority(
        preflight,
        requestId,
        userMessage,
        inputDigest,
      );
      expect(
        await canonicalHandler._compactCanonicalHistoryBeforeClaim(requestId),
      ).toBe(false);

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(readVerifiedMessages).toHaveBeenCalledOnce();
      expect(claimWsTurnIfHead).not.toHaveBeenCalled();
      expect(
        canonicalInteraction.emit.mock.calls.filter(
          ([type]) => type === "token-usage",
        ),
      ).toHaveLength(1);
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          requestId: "req-preclaim-stale",
          code: "CC_COMPACTION_REVISION_STALE",
        }),
      );
    });

    it("returns pending without invoking model or tools when another claim owns the request", async () => {
      const loop = vi.fn();
      const store = canonicalStore({
        readState: canonicalState({
          status: "pending",
          claim: {
            requestId: "req-pending-1",
            inputDigest: INPUT_DIGEST,
            opaqueClaimId: "claim-other-owner",
          },
        }),
      });
      const canonicalInteraction = createMockInteraction();
      const canonicalHandler = new WSAgentHandler({
        session: createMockSession({ canonicalJsonlSession: true }),
        interaction: canonicalInteraction,
        db: null,
        agentLoop: loop,
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("same question", "req-pending-1");

      expect(loop).not.toHaveBeenCalled();
      expect(store.claimWsTurnIfHead).not.toHaveBeenCalled();
      expect(store.settleWsTurnClaim).not.toHaveBeenCalled();
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "response-pending",
        {
          requestId: "req-pending-1",
          status: "pending",
          code: "CC_WS_TURN_PENDING",
          remediation: "adjudicate_or_use_new_request_id",
        },
      );
    });

    it("never retries an outcome-unknown success settlement", async () => {
      const store = canonicalStore({
        store: {
          settleWsTurnClaim: vi.fn(() => {
            const error = new Error("synthetic append uncertainty");
            error.commitState = "unknown";
            throw error;
          }),
        },
      });
      const canonicalInteraction = createMockInteraction();
      const canonicalSession = createMockSession({
        canonicalJsonlSession: true,
      });
      const canonicalHandler = new WSAgentHandler({
        session: canonicalSession,
        interaction: canonicalInteraction,
        db: null,
        agentLoop: vi.fn(() =>
          fakeAgentLoop([{ type: "response-complete", content: "answer" }]),
        ),
        canonicalSessionStore: store,
      });

      await canonicalHandler.handleMessage("question", "req-unknown-1");

      expect(store.settleWsTurnClaim).toHaveBeenCalledTimes(1);
      expect(canonicalInteraction.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          requestId: "req-unknown-1",
          code: "CC_WS_TURN_SETTLEMENT_UNKNOWN",
        }),
      );
      expect(canonicalSession.messages).toEqual([
        { role: "system", content: "You are helpful." },
        ...canonicalState().messages,
      ]);
    });

    it("restores a canonical manual compact before the first post-restart turn", async () => {
      const initialMessages = [
        { role: "user", content: "start" },
        { role: "assistant", content: "one" },
        { role: "user", content: "preserve constraints" },
        { role: "assistant", content: "two" },
        { role: "user", content: "finish persistence" },
        { role: "assistant", content: "three" },
      ];
      let persistedMessages = null;
      const appendCompactEventIfMessagesMatch = vi.fn((_id, data) => {
        persistedMessages = [...data.messages];
        return { hash: "head-compact" };
      });
      const compactSession = createMockSession({
        canonicalJsonlSession: true,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        messages: [
          { role: "system", content: "You are helpful." },
          ...initialMessages,
        ],
      });
      const compactHandler = new WSAgentHandler({
        session: compactSession,
        interaction: createMockInteraction(),
        db: null,
        compactionLlmQuery: vi.fn(async () => ({
          summary: JSON.stringify({
            objective: "Resume the WebSocket compact checkpoint",
            constraints: ["Keep the canonical summary"],
            keyDecisions: [],
            changedFiles: [],
            tests: ["Restart before next turn"],
            unresolvedSideEffects: [],
            checkpoints: [],
            blockers: [],
            nextSteps: ["Continue"],
          }),
          usage: { input_tokens: 20, output_tokens: 8 },
        })),
        canonicalSessionStore: canonicalStore({
          store: { appendCompactEventIfMessagesMatch },
        }),
      });

      await compactHandler.handleSlashCommand("/compact", "req-compact");
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(persistedMessages).toEqual(compactSession.messages.slice(1));

      const restartState = canonicalState({
        headHash: "head-compact",
        messages: persistedMessages,
      });
      const restartStore = canonicalStore({
        readState: restartState,
        store: {
          claimWsTurnIfHead: vi.fn((_id, claim) => ({
            ...restartState,
            status: "pending",
            acquired: true,
            claim,
          })),
          settleWsTurnClaim: vi.fn((_id, settlement) => {
            const turn = {
              outcome: "completed",
              user: { role: "user", content: settlement.user },
              assistant: {
                role: "assistant",
                content: settlement.assistant,
              },
            };
            return {
              ...restartState,
              status: "completed",
              turn,
              settlement: turn,
              messages: [...persistedMessages, turn.user, turn.assistant],
            };
          }),
        },
      });
      let postRestartMessages = null;
      const restartedSession = createMockSession({
        canonicalJsonlSession: true,
      });
      const restartedHandler = new WSAgentHandler({
        session: restartedSession,
        interaction: createMockInteraction(),
        db: null,
        agentLoop: async function* (messages) {
          postRestartMessages = messages.map((message) => ({ ...message }));
          yield { type: "response-complete", content: "continued" };
        },
        canonicalSessionStore: restartStore,
      });

      await restartedHandler.handleMessage("continue", "req-after-restart");

      expect(
        postRestartMessages.some((message) =>
          String(message.content).includes(
            "Resume the WebSocket compact checkpoint",
          ),
        ),
      ).toBe(true);
      expect(postRestartMessages.at(-1)).toEqual({
        role: "user",
        content: "continue",
      });
    });
  });

  describe("handleSlashCommand", () => {
    it("/model shows current model when no arg", async () => {
      await handler.handleSlashCommand("/model", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/model",
        result: { model: "qwen2.5:7b" },
      });
    });

    it("/model changes model when arg given", async () => {
      await handler.handleSlashCommand("/model gpt-4", "req-1");
      expect(session.model).toBe("gpt-4");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/model",
        result: { model: "gpt-4" },
      });
    });

    it("/provider changes provider", async () => {
      await handler.handleSlashCommand("/provider anthropic", "req-1");
      expect(session.provider).toBe("anthropic");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/provider",
        result: { provider: "anthropic" },
      });
    });

    it("/clear resets messages keeping system prompt", async () => {
      session.messages.push({ role: "user", content: "hi" });
      session.messages.push({ role: "assistant", content: "hey" });
      expect(session.messages.length).toBe(3);

      await handler.handleSlashCommand("/clear", "req-1");
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].role).toBe("system");
    });

    it("/compact returns the resulting message count", async () => {
      // Add enough messages to trigger compaction (>5)
      for (let i = 0; i < 6; i++) {
        session.messages.push({ role: "user", content: `msg ${i}` });
      }
      expect(session.messages.length).toBe(7);

      await handler.handleSlashCommand("/compact", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          command: "/compact",
          result: expect.objectContaining({
            messageCount: expect.any(Number),
          }),
        }),
      );
    });

    it("/compact emits a provider-backed structured handoff and usage", async () => {
      const persistedCompacts = [];
      const settlementOrder = [];
      const budgetController = new AbortController();
      const sessionBudget = {
        signal: budgetController.signal,
        reason: vi.fn(() => null),
        consumeTurn: vi.fn(() => {
          settlementOrder.push("budget-turn");
          return { ok: true };
        }),
        recordUsage: vi.fn(() => {
          settlementOrder.push("budget-usage");
          return { aborted: false };
        }),
      };
      const appendCompactEventIfMessagesMatch = vi.fn((_id, data) => {
        persistedCompacts.push(data);
        return { hash: "compact-head" };
      });
      const compactionLlmQuery = vi.fn(async () => ({
        summary: JSON.stringify({
          objective: "Preserve the WebSocket session objective",
          constraints: ["Keep provider tools disabled"],
          keyDecisions: ["Use shared semantic compaction"],
          changedFiles: [],
          tests: [],
          unresolvedSideEffects: [],
          checkpoints: [],
          blockers: [],
          nextSteps: ["Resume the next WebSocket turn"],
        }),
        usage: { input_tokens: 64, output_tokens: 20 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      }));
      session = createMockSession({
        canonicalJsonlSession: true,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Start the task." },
          { role: "assistant", content: "I inspected the code." },
          { role: "user", content: "Keep the constraints." },
          { role: "assistant", content: "The constraints are recorded." },
          { role: "user", content: "Compact and continue." },
          { role: "assistant", content: "The session is ready to continue." },
        ],
      });
      handler = new WSAgentHandler({
        session,
        interaction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: {
          appendCompactEventIfMessagesMatch,
          appendEvent: vi.fn(() => settlementOrder.push("ledger-start")),
          appendTokenUsage: vi.fn(() =>
            settlementOrder.push("ledger-usage"),
          ),
        },
        sessionBudgetRoot: {
          budget: sessionBudget,
          options: { sessionBudget, signal: budgetController.signal },
          close: vi.fn(),
        },
      });

      await handler.handleSlashCommand("/compact", "req-semantic");
      await handler.handleSlashCommand("/compact", "req-semantic-retry");

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(sessionBudget.consumeTurn).toHaveBeenCalledOnce();
      expect(settlementOrder).toEqual([
        "budget-turn",
        "ledger-start",
        "ledger-usage",
        "budget-usage",
      ]);
      expect(persistedCompacts).toHaveLength(1);
      expect(persistedCompacts[0]).toMatchObject({
        trigger: "manual",
        summaryMode: "llm-structured",
        messages: expect.any(Array),
      });
      expect(interaction.emit).toHaveBeenCalledWith(
        "compaction",
        expect.objectContaining({
          requestId: "req-semantic",
          stats: expect.objectContaining({
            summaryMode: "llm-structured",
            degraded: false,
          }),
        }),
      );
      expect(interaction.emit).toHaveBeenCalledWith(
        "token-usage",
        expect.objectContaining({
          requestId: "req-semantic",
          callId: expect.stringMatching(/^ws-cmp-/),
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 64,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          source: "semantic-compaction",
        }),
      );
      expect(
        interaction.emit.mock.calls.filter(([type]) => type === "token-usage"),
      ).toHaveLength(1);
      expect(
        session.messages.some((message) =>
          String(message.content).includes(
            "Preserve the WebSocket session objective",
          ),
        ),
      ).toBe(true);
      expect(session.messages.slice(-2).map((message) => message.role)).toEqual(
        ["user", "assistant"],
      );
      handler.destroy();
    });

    it("/compact never overwrites a turn that arrives during the provider call", async () => {
      let resolveSummary;
      const appendCompactEventIfMessagesMatch = vi.fn();
      const compactionLlmQuery = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSummary = () =>
              resolve({
                summary: JSON.stringify({
                  objective: "Compact without losing a concurrent turn",
                  constraints: [],
                  keyDecisions: [],
                  changedFiles: [],
                  tests: [],
                  unresolvedSideEffects: [],
                  checkpoints: [],
                  blockers: [],
                  nextSteps: [],
                }),
                usage: { input_tokens: 10, output_tokens: 5 },
              });
          }),
      );
      session = createMockSession({
        canonicalJsonlSession: true,
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "first" },
          { role: "assistant", content: "one" },
          { role: "user", content: "second" },
          { role: "assistant", content: "two" },
          { role: "user", content: "third" },
          { role: "assistant", content: "three" },
        ],
      });
      handler = new WSAgentHandler({
        session,
        interaction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: { appendCompactEventIfMessagesMatch },
      });

      const compacting = handler.handleSlashCommand("/compact", "req-race");
      await vi.waitFor(() => expect(compactionLlmQuery).toHaveBeenCalledOnce());
      const concurrent = { role: "user", content: "concurrent turn" };
      session.messages.push(concurrent);
      resolveSummary();
      await compacting;

      expect(session.messages.at(-1)).toBe(concurrent);
      expect(appendCompactEventIfMessagesMatch).not.toHaveBeenCalled();
      expect(interaction.emit).toHaveBeenCalledWith(
        "compaction-degraded",
        expect.objectContaining({
          requestId: "req-race",
          reason: "session_messages_changed_during_compaction",
        }),
      );
      expect(interaction.emit).not.toHaveBeenCalledWith(
        "compaction",
        expect.anything(),
      );
      expect(interaction.emit).toHaveBeenCalledWith(
        "token-usage",
        expect.objectContaining({
          requestId: "req-race",
          source: "semantic-compaction",
        }),
      );
    });

    it("/compact rejects an externally stale message CAS and refreshes authority", async () => {
      const stale = new Error("external turn committed");
      stale.code = "SESSION_REVISION_STALE";
      const appendCompactEventIfMessagesMatch = vi.fn(() => {
        throw stale;
      });
      const authoritativeMessages = [
        { role: "user", content: "first" },
        { role: "assistant", content: "one" },
        { role: "user", content: "external concurrent turn" },
        { role: "assistant", content: "external answer" },
      ];
      const readVerifiedMessages = vi.fn(() => authoritativeMessages);
      const compactionLlmQuery = vi.fn(async () => ({
        summary: JSON.stringify({
          objective: "This stale candidate must not overwrite authority",
          constraints: [],
          keyDecisions: [],
          changedFiles: [],
          tests: [],
          unresolvedSideEffects: [],
          checkpoints: [],
          blockers: [],
          nextSteps: [],
        }),
        usage: { input_tokens: 12, output_tokens: 6 },
      }));
      session = createMockSession({
        canonicalJsonlSession: true,
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "first" },
          { role: "assistant", content: "one" },
          { role: "user", content: "second" },
          { role: "assistant", content: "two" },
          { role: "user", content: "third" },
          { role: "assistant", content: "three" },
        ],
      });
      handler = new WSAgentHandler({
        session,
        interaction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: {
          appendCompactEventIfMessagesMatch,
          readVerifiedMessages,
        },
      });

      await handler.handleSlashCommand("/compact", "req-external-race");

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(readVerifiedMessages).toHaveBeenCalledOnce();
      expect(session.messages).toEqual([
        { role: "system", content: "You are helpful." },
        ...authoritativeMessages,
      ]);
      expect(interaction.emit).not.toHaveBeenCalledWith(
        "compaction",
        expect.anything(),
      );
      expect(
        interaction.emit.mock.calls.filter(([type]) => type === "token-usage"),
      ).toHaveLength(1);
    });

    it("/compact latches an outcome-unknown settlement and exposes the error", async () => {
      const settlementFailure = Object.assign(
        new Error("fsync outcome unknown"),
        {
          code: "CC_SESSION_PERSISTENCE_FAILED",
          commitState: "unknown",
        },
      );
      const appendCompactEventIfMessagesMatch = vi.fn(() => {
        throw settlementFailure;
      });
      const compactionLlmQuery = vi.fn(async () => ({
        summary: JSON.stringify({
          objective: "Do not retry this paid summary",
          constraints: [],
          keyDecisions: [],
          changedFiles: [],
          tests: [],
          unresolvedSideEffects: [],
          checkpoints: [],
          blockers: [],
          nextSteps: [],
        }),
        usage: { input_tokens: 18, output_tokens: 7 },
      }));
      session = createMockSession({
        canonicalJsonlSession: true,
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "first" },
          { role: "assistant", content: "one" },
          { role: "user", content: "second" },
          { role: "assistant", content: "two" },
          { role: "user", content: "third" },
          { role: "assistant", content: "three" },
        ],
      });
      handler = new WSAgentHandler({
        session,
        interaction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: { appendCompactEventIfMessagesMatch },
      });

      await handler.handleSlashCommand("/compact", "req-unknown");
      await handler.handleSlashCommand("/compact", "req-unknown-retry");

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
      expect(
        interaction.emit.mock.calls.filter(([type]) => type === "token-usage"),
      ).toHaveLength(1);
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          requestId: "req-unknown-retry",
          result: expect.objectContaining({
            error: expect.objectContaining({
              code: "CC_SESSION_PERSISTENCE_FAILED",
              commitState: "unknown",
            }),
          }),
        }),
      );
      expect(interaction.emit).not.toHaveBeenCalledWith(
        "compaction",
        expect.anything(),
      );
    });

    it("/compact blocks retry and does not persist fallback when provider usage is unknown", async () => {
      const appendCompactEventIfMessagesMatch = vi.fn(() => ({
        hash: "degraded-compact-head",
      }));
      const compactionLlmQuery = vi.fn(async () => {
        throw new Error("provider unavailable");
      });
      session = createMockSession({
        canonicalJsonlSession: true,
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "first" },
          { role: "assistant", content: "one" },
          { role: "user", content: "second" },
          { role: "assistant", content: "two" },
          { role: "user", content: "third" },
          { role: "assistant", content: "three" },
        ],
      });
      handler = new WSAgentHandler({
        session,
        interaction,
        db: null,
        compactionLlmQuery,
        canonicalSessionStore: { appendCompactEventIfMessagesMatch },
      });

      await handler.handleSlashCommand("/compact", "req-degraded");
      await handler.handleSlashCommand("/compact", "req-degraded-retry");

      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(appendCompactEventIfMessagesMatch).not.toHaveBeenCalled();
      expect(interaction.emit).toHaveBeenCalledWith(
        "compaction-degraded",
        expect.objectContaining({
          requestId: "req-degraded",
          summaryMode: "extractive-fallback",
        }),
      );
      expect(
        interaction.emit.mock.calls.filter(([type]) => type === "token-usage"),
      ).toHaveLength(0);
      expect(interaction.emit).toHaveBeenCalledWith(
        "compaction-usage-unknown",
        expect.objectContaining({
          requestId: "req-degraded",
          code: "CC_COMPACTION_USAGE_UNKNOWN",
          usageOutcome: "unknown",
        }),
      );
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          requestId: "req-degraded-retry",
          result: expect.objectContaining({
            error: expect.objectContaining({
              code: "CC_COMPACTION_USAGE_UNKNOWN",
              commitState: "provider-usage-unknown",
            }),
          }),
        }),
      );
      expect(interaction.emit).not.toHaveBeenCalledWith(
        "compaction",
        expect.anything(),
      );
    });

    it("/task sets task on context engine", async () => {
      await handler.handleSlashCommand("/task Build a REST API", "req-1");
      expect(session.contextEngine.setTask).toHaveBeenCalledWith(
        "Build a REST API",
      );
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/task",
        result: { task: "Build a REST API" },
      });
    });

    it("/session returns session info", async () => {
      await handler.handleSlashCommand("/session", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          command: "/session",
          result: expect.objectContaining({
            id: "test-session-1",
            type: "agent",
            provider: "ollama",
            model: "qwen2.5:7b",
          }),
        }),
      );
    });

    it("/plan enter enters plan mode", async () => {
      session.planManager.isActive.mockReturnValue(false);
      await handler.handleSlashCommand("/plan enter", "req-1");
      expect(session.planManager.enterPlanMode).toHaveBeenCalledWith({
        title: "Agent Plan",
      });
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          command: "/plan",
          result: expect.objectContaining({
            state: "analyzing",
            message: "Entered plan mode",
          }),
        }),
      );
    });

    it("/plan show returns plan summary when active", async () => {
      session.planManager.isActive.mockReturnValue(true);
      await handler.handleSlashCommand("/plan show", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith(
        "plan-ready",
        expect.objectContaining({
          requestId: "req-1",
          summary: "Plan summary",
        }),
      );
    });

    it("/plan approve approves the plan", async () => {
      session.planManager.isActive.mockReturnValue(true);
      session.planManager.currentPlan = {
        items: [{ id: 1, description: "Step 1" }],
      };
      await handler.handleSlashCommand("/plan approve", "req-1");
      expect(session.planManager.approvePlan).toHaveBeenCalled();
      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          command: "/plan approve",
          result: expect.objectContaining({
            state: "approved",
            itemCount: 1,
          }),
        }),
      );
    });

    it("unknown command returns error", async () => {
      await handler.handleSlashCommand("/foobar", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/foobar",
        result: { error: "Unknown command: /foobar" },
      });
    });
  });
});
