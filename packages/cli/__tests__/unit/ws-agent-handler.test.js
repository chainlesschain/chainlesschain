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

    it("/compact compacts messages", async () => {
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
          result: { messageCount: expect.any(Number) },
        }),
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
