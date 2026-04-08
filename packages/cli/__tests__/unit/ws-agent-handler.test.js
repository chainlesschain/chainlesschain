import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock agent-core
vi.mock("../../src/lib/agent-core.js", () => ({
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
import { agentLoop } from "../../src/lib/agent-core.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../../src/lib/task-model-selector.js";

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
  });

  describe("handleMessage", () => {
    it("adds user message to session", async () => {
      agentLoop.mockReturnValue(fakeAgentLoop([]));
      await handler.handleMessage("Hello agent", "req-1");
      expect(session.messages).toContainEqual({
        role: "user",
        content: "Hello agent",
      });
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

    it("returns busy error when already processing", async () => {
      // Simulate a long-running loop
      let resolveLoop;
      const blockingLoop = (async function* () {
        await new Promise((r) => {
          resolveLoop = r;
        });
      })();
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
