import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const FunctionCaller = require("../../src/main/ai-engine/function-caller.js");
const {
  CodingAgentSessionService,
} = require("../../src/main/ai-engine/code-agent/coding-agent-session-service.js");
const {
  CodingAgentToolAdapter,
} = require("../../src/main/ai-engine/code-agent/coding-agent-tool-adapter.js");
const {
  CodingAgentToolBroker,
} = require("../../src/main/ai-engine/code-agent/coding-agent-tool-broker.js");
const sessionCore = require("@chainlesschain/session-core");

class ContractBridge extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }

  send(message) {
    this.sent.push(message);
  }

  async closeSession(sessionId) {
    return { success: true, id: `close-${sessionId}` };
  }
}

function createSession(sessionId) {
  const now = new Date().toISOString();
  return {
    sessionId,
    agentId: "contract-agent",
    status: "ready",
    planModeState: "approved",
    createdAt: now,
    updatedAt: now,
    history: [],
    events: [],
    pendingRequests: [],
    lastPlanSummary: "Execute the contract tool",
    lastPlanItems: [],
    requiresHighRiskConfirmation: false,
    highRiskConfirmationGranted: false,
    highRiskToolNames: [],
  };
}

describe("Coding Agent real object contracts", () => {
  it("runs plan-approved FunctionCaller work and consolidates real TraceStore events into memory", async () => {
    const functionCaller = new FunctionCaller({
      enableToolMasking: false,
      enableCache: false,
    });
    functionCaller.registerTool(
      "contract_echo",
      async ({ value }) => ({ success: true, echoed: value }),
      {
        name: "contract_echo",
        description: "Echo a value through the real FunctionCaller",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        riskLevel: "medium",
        isReadOnly: false,
        category: "write",
        requiresPlanApproval: true,
      },
    );

    const managedTool = {
      id: "contract-tool",
      name: "contract_echo",
      description: "Echo a value through the real FunctionCaller",
      input_schema: JSON.stringify({
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      }),
      risk_level: "medium",
      is_read_only: false,
    };
    const toolManager = {
      functionCaller,
      getAllTools: vi.fn().mockResolvedValue([managedTool]),
      getToolByName: vi.fn().mockResolvedValue(managedTool),
    };
    const toolAdapter = new CodingAgentToolAdapter({
      toolManager,
      allowedManagedToolNames: ["contract_echo"],
    });
    await toolAdapter.listAvailableTools();

    const decisions = [];
    const approvalGate = new sessionCore.ApprovalGate({
      defaultPolicy: sessionCore.APPROVAL_POLICY.STRICT,
      confirm: async () => true,
      onDecision: (_ctx, decision) => decisions.push(decision),
    });
    const memoryStore = new sessionCore.MemoryStore();
    const bridge = new ContractBridge();
    const service = new CodingAgentSessionService({
      bridge,
      toolManager,
      toolAdapter,
      toolBroker: new CodingAgentToolBroker({ toolManager }),
      approvalGate,
      useSessionCoreApprovalGate: false,
      sessionCore,
      memoryStore,
    });
    const sessionId = "real-contract-session";
    service.sessions.set(sessionId, createSession(sessionId));

    await service.sendMessage(sessionId, "I prefer concise contract reports");
    const toolResult = await service._executeHostedTool(
      sessionId,
      "contract_echo",
      { value: "observed" },
    );
    service._storeEvent(
      sessionId,
      service._createEvent(
        "tool.call.completed",
        {
          toolName: "contract_echo",
          success: true,
          result: toolResult.echoed,
        },
        { sessionId, requestId: "contract-tool-call" },
      ),
    );

    const closed = await service.closeSession(sessionId);
    const memories = memoryStore.recall({
      scope: "session",
      scopeId: sessionId,
      limit: 10,
    });

    expect(toolResult).toEqual({ success: true, echoed: "observed" });
    expect(decisions.at(-1)).toMatchObject({ decision: "allow" });
    expect(closed).toMatchObject({
      success: true,
      sessionId,
      consolidation: {
        sessionId,
        eventCount: 2,
        writtenCount: 2,
      },
    });
    expect(memories.map((memory) => memory.category).sort()).toEqual([
      "preference",
      "task",
    ]);
  });

  it("routes a descriptor from the real MCP adapter through the broker", async () => {
    const mcpManager = {
      servers: new Map([
        [
          "filesystem",
          {
            state: "ready",
            tools: [
              {
                name: "read_file",
                description: "Read a file",
                inputSchema: {
                  type: "object",
                  properties: { path: { type: "string" } },
                },
                isReadOnly: true,
                risk_level: "low",
              },
            ],
          },
        ],
      ]),
      listTools: vi.fn(),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "contract data" }],
        isError: false,
      }),
    };
    const adapter = new CodingAgentToolAdapter({
      mcpManager,
      allowedMcpServerNames: ["filesystem"],
    });
    const tools = await adapter.listAvailableTools();
    const descriptor = tools.find(
      (tool) => tool.name === "mcp_filesystem_read_file",
    );
    const mcpSecurityPolicy = {
      validateToolExecution: vi.fn().mockResolvedValue(undefined),
    };
    const broker = new CodingAgentToolBroker({
      mcpManager,
      mcpSecurityPolicy,
    });

    const result = await broker.execute(
      descriptor,
      { path: "README.md" },
      { sessionId: "mcp-contract-session" },
    );

    expect(mcpManager.callTool).toHaveBeenCalledWith(
      "filesystem",
      "read_file",
      { path: "README.md" },
    );
    expect(mcpSecurityPolicy.validateToolExecution).toHaveBeenCalledWith(
      "filesystem",
      "read_file",
      { path: "README.md" },
      { sessionId: "mcp-contract-session" },
    );
    expect(result).toMatchObject({
      toolName: "mcp_filesystem_read_file",
      isError: false,
    });
  });
});
