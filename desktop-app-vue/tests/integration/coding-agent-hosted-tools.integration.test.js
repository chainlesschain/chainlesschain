import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CODING_AGENT_EVENT_CHANNEL,
} = require("../../src/main/ai-engine/code-agent/coding-agent-events.js");
const {
  CodingAgentSessionService,
} = require("../../src/main/ai-engine/code-agent/coding-agent-session-service.js");
const {
  registerCodingAgentIPCV3,
} = require("../../src/main/ai-engine/code-agent/coding-agent-ipc-v3.js");

class MockBridge extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.host = "127.0.0.1";
    this.port = 4317;
    this.sentMessages = [];
    this.updatedPolicies = [];
  }

  async ensureReady() {
    return { host: this.host, port: this.port };
  }

  async createSession() {
    const message = {
      id: "create-request",
      type: "session-created",
      sessionId: "session-1",
      record: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
    };
    this.emit("message", message);
    return message;
  }

  async resumeSession(sessionId) {
    const message = {
      id: "resume-request",
      type: "session-resumed",
      sessionId,
      history: [{ role: "assistant", content: "restored hosted session" }],
      record: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
    };
    this.emit("message", message);
    return message;
  }

  async updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    this.updatedPolicies.push({ sessionId, hostManagedToolPolicy });
    return {
      id: "policy-request",
      type: "session-policy-updated",
      success: true,
      sessionId,
    };
  }

  send(message) {
    this.sentMessages.push(message);
  }

  async shutdown() {
    return undefined;
  }
}

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Coding agent hosted tool integration", () => {
  let bridge;
  let ipcMainMock;
  let mainWindow;
  let mcpManager;
  let service;

  beforeEach(() => {
    bridge = new MockBridge();
    ipcMainMock = createMockIpcMain();
    mainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };
    mcpManager = {
      servers: new Map([["weather", { state: "connected" }]]),
      listTools: vi.fn().mockResolvedValue([
        {
          name: "get_forecast",
          description: "Get the local weather forecast",
          inputSchema: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
          },
        },
      ]),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Sunny" }],
        isError: false,
      }),
    };

    service = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      mcpManager,
    });

    registerCodingAgentIPCV3({
      service,
      ipcMain: ipcMainMock,
    });
  });

  it("drives IPC, session events, and hosted MCP execution through one desktop flow", async () => {
    const createResult = await ipcMainMock.handlers[
      "coding-agent:create-session"
    ]({}, {});
    expect(createResult).toMatchObject({
      success: true,
      sessionId: "session-1",
    });

    const statusResult = await ipcMainMock.handlers["coding-agent:get-status"](
      {},
    );
    expect(statusResult.success).toBe(true);
    expect(
      statusResult.tools.find(
        (tool) => tool.name === "mcp_weather_get_forecast",
      ),
    ).toMatchObject({
      source: "mcp:weather",
      riskLevel: "low",
      isReadOnly: true,
    });

    const sendResult = await ipcMainMock.handlers["coding-agent:send-message"](
      {},
      {
        sessionId: "session-1",
        content: "Get the Shanghai forecast through the hosted MCP tool.",
      },
    );
    expect(sendResult).toMatchObject({
      success: true,
      sessionId: "session-1",
    });

    bridge.emit("message", {
      id: sendResult.requestId,
      type: "tool-executing",
      sessionId: "session-1",
      tool: "mcp_weather_get_forecast",
      args: { city: "Shanghai" },
    });

    bridge.emit("message", {
      type: "host-tool-call",
      sessionId: "session-1",
      requestId: "host-tool-1",
      toolName: "mcp_weather_get_forecast",
      args: { city: "Shanghai" },
    });

    await flushMicrotasks();

    expect(mcpManager.callTool).toHaveBeenCalledWith(
      "weather",
      "get_forecast",
      {
        city: "Shanghai",
      },
    );
    expect(bridge.sentMessages).toContainEqual(
      expect.objectContaining({
        type: "host-tool-result",
        sessionId: "session-1",
        requestId: "host-tool-1",
        toolName: "mcp_weather_get_forecast",
        success: true,
        result: {
          content: [{ type: "text", text: "Sunny" }],
          isError: false,
          toolName: "mcp_weather_get_forecast",
        },
      }),
    );

    bridge.emit("message", {
      id: sendResult.requestId,
      type: "tool-result",
      sessionId: "session-1",
      tool: "mcp_weather_get_forecast",
      result: {
        content: [{ type: "text", text: "Sunny" }],
        isError: false,
        toolName: "mcp_weather_get_forecast",
      },
    });
    bridge.emit("message", {
      id: sendResult.requestId,
      type: "response-complete",
      sessionId: "session-1",
      content: "Shanghai forecast: Sunny.",
    });

    const eventsResult = await ipcMainMock.handlers[
      "coding-agent:get-session-events"
    ]({}, "session-1");
    expect(eventsResult.success).toBe(true);
    expect(
      eventsResult.events.some((event) => event.type === "session.started"),
    ).toBe(true);
    expect(
      eventsResult.events.some((event) => event.type === "tool.call.started"),
    ).toBe(true);
    expect(
      eventsResult.events.some((event) => event.type === "tool.call.completed"),
    ).toBe(true);
    expect(
      eventsResult.events.some((event) => event.type === "assistant.final"),
    ).toBe(true);

    const stateResult = await ipcMainMock.handlers[
      "coding-agent:get-session-state"
    ]({}, "session-1");
    expect(stateResult).toMatchObject({
      success: true,
      session: {
        sessionId: "session-1",
        status: "ready",
      },
    });
    expect(stateResult.session.history.at(-1)).toMatchObject({
      role: "assistant",
      content: "Shanghai forecast: Sunny.",
    });

    const emittedEvents = mainWindow.webContents.send.mock.calls
      .filter(([channel]) => channel === CODING_AGENT_EVENT_CHANNEL)
      .map(([, event]) => event.type);
    expect(emittedEvents).toEqual(
      expect.arrayContaining([
        "session.started",
        "request.accepted",
        "tool.call.started",
        "tool.call.completed",
        "assistant.final",
      ]),
    );
  });

  it("blocks hosted high-risk tool calls when the session has not been confirmed", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    // CLI requests a high-risk core tool (run_shell) over the host bridge.
    // Even though the CLI asked for it, the host permission gate must reject
    // because the session has neither an approved plan nor a high-risk
    // confirmation. The MCP manager must NOT be invoked.
    bridge.emit("message", {
      type: "host-tool-call",
      sessionId: "session-1",
      requestId: "host-tool-blocked",
      toolName: "run_shell",
      args: { command: "rm -rf /" },
    });

    await flushMicrotasks();

    expect(mcpManager.callTool).not.toHaveBeenCalled();
    const blockedResponse = bridge.sentMessages.find(
      (msg) =>
        msg.type === "host-tool-result" &&
        msg.requestId === "host-tool-blocked",
    );
    expect(blockedResponse).toBeDefined();
    expect(blockedResponse.success).toBe(false);
    expect(blockedResponse.toolName).toBe("run_shell");
    expect(blockedResponse.error).toMatch(/\[Host Policy\]/);
    expect(blockedResponse.error).toMatch(/run_shell/);
  });

  it("re-syncs hosted MCP tool policy when a session is resumed through IPC", async () => {
    const result = await ipcMainMock.handlers["coding-agent:resume-session"](
      {},
      "session-1",
    );
    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
    });

    const latestPolicy = bridge.updatedPolicies.at(-1);
    expect(latestPolicy?.sessionId).toBe("session-1");
    expect(
      latestPolicy?.hostManagedToolPolicy?.toolDefinitions?.some(
        (definition) =>
          definition?.function?.name === "mcp_weather_get_forecast",
      ),
    ).toBe(true);
    expect(
      latestPolicy?.hostManagedToolPolicy?.tools?.mcp_weather_get_forecast,
    ).toMatchObject({
      allowed: true,
      riskLevel: "low",
      requiresPlanApproval: false,
    });

    const stateResult = await ipcMainMock.handlers[
      "coding-agent:get-session-state"
    ]({}, "session-1");
    expect(stateResult.session.history.at(-1)).toMatchObject({
      role: "assistant",
      content: "restored hosted session",
    });
  });
});
