/**
 * Parity Harness — MCP tool invocation
 *
 * Phase 7 Step 4. Drives `agentLoop` with the mock LLM provider to assert
 * the deterministic event stream when the model invokes a tool that is
 * registered via `externalToolExecutors` with `kind: "mcp"`. The real
 * `executeTool` path is exercised; only the LLM and the MCP client are
 * mocked. Coverage:
 *
 *   - SUCCESS: mcpClient.callTool is invoked with (serverName, toolName,
 *     args) and its return value is surfaced in the tool-result event
 *   - ERROR: mcpClient.callTool rejects → error is serialized into
 *     an outcome-unknown result that cannot be retried automatically
 *   - UNAVAILABLE: mcpClient is null → executor falls through to an
 *     `MCP client is unavailable` error WITHOUT crashing the loop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { PlanModeManager } from "../../src/lib/plan-mode.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (event.type === "run-started" || event.type === "run-ended") continue;
    out.push(event);
  }
  return out;
}

/**
 * Bespoke tool name chosen to avoid any collision with the builtin switch
 * cases in `executeToolInner`. The executor's `kind: "mcp"` marker routes
 * it through the default branch → mcpClient.callTool path.
 */
const TOOL_NAME = "mcp__weather__get";

function buildMcpScript(args, finalText = "acknowledged") {
  return createMockLLMProvider([
    {
      response: {
        message: mockToolCallMessage(TOOL_NAME, args, "call_mcp_1"),
      },
    },
    {
      expect: (messages) =>
        messages.some(
          (m) => m.role === "tool" && m.tool_call_id === "call_mcp_1",
        ),
      response: { message: mockTextMessage(finalText) },
    },
  ]);
}

function buildLoopOptions({ mock, mcpClient, workDir }) {
  return {
    provider: "mock",
    model: "mock-1",
    cwd: workDir,
    chatFn: mock.chatFn,
    // Fresh PlanModeManager per test — the default singleton can leak
    // state between tests and between the real runtime and the harness.
    planManager: new PlanModeManager(),
    extraToolDefinitions: [
      {
        type: "function",
        function: {
          name: TOOL_NAME,
          description: "Mock weather MCP tool",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    externalToolDescriptors: {
      [TOOL_NAME]: {
        name: TOOL_NAME,
        kind: "mcp",
        category: "mcp",
        description: "Mock weather MCP tool",
        isReadOnly: true,
      },
    },
    externalToolExecutors: {
      [TOOL_NAME]: {
        kind: "mcp",
        serverName: "weather",
        toolName: "get",
      },
    },
    mcpClient,
    // This parity suite targets transport/result behavior after the request
    // has been approved; default-ask denial is covered by the adversarial MCP
    // admission matrix.
    permissionConfirm: vi.fn(async () => true),
  };
}

describe("Phase 7 parity: MCP tool invocation", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-mcp-"));
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("SUCCESS: callTool is invoked with (serverName, toolName, args) and result surfaces in tool-result", async () => {
    const args = { city: "Shanghai", units: "metric" };
    const mcpReturn = {
      temperature: 18.4,
      condition: "cloudy",
      city: "Shanghai",
    };
    const mcpClient = {
      callTool: vi.fn().mockResolvedValue(mcpReturn),
    };

    const mock = buildMcpScript(args, "weather reported");

    const events = await drain(
      agentLoop([{ role: "user", content: "weather please" }], {
        ...buildLoopOptions({ mock, mcpClient, workDir }),
      }),
    );

    // Event stream parity: tool-executing, tool-result, response-complete
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "tool-executing",
      tool: TOOL_NAME,
      args,
    });

    expect(events[1].type).toBe("tool-result");
    expect(events[1].tool).toBe(TOOL_NAME);
    expect(events[1].error).toBeNull();
    // Result payload from mcpClient must be surfaced verbatim
    expect(events[1].result.temperature).toBe(18.4);
    expect(events[1].result.condition).toBe("cloudy");
    expect(events[1].result.city).toBe("Shanghai");

    expect(events[2]).toEqual({
      type: "response-complete",
      content: "weather reported",
    });

    // callTool was called exactly once with the canonical 3-arg shape
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledWith("weather", "get", args);

    mock.assertDrained();
  });

  it("ERROR: an untrusted call rejection becomes outcome-unknown", async () => {
    const mcpClient = {
      callTool: vi.fn().mockRejectedValue(new Error("upstream 503")),
    };

    const mock = buildMcpScript({ city: "Paris" }, "failure handled");

    const events = await drain(
      agentLoop([{ role: "user", content: "weather please" }], {
        ...buildLoopOptions({ mock, mcpClient, workDir }),
      }),
    );

    expect(events[1].type).toBe("tool-result");
    // `executeToolInner` contains the rejection in the result payload. Because
    // this tool has no trusted read-only contract, the transport could have
    // completed its side effect before rejecting and must not be retried.
    expect(events[1].error).toBeNull();
    expect(events[1].result).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      status: "outcome_unknown",
      outcomeUnknown: true,
      retryable: false,
      mcpLedgerIncident: {
        phase: "call",
        code: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
      },
    });
    expect(events[1].result.error).not.toContain("upstream 503");
    expect(events[2].content).toBe("failure handled");
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
  });

  it("UNAVAILABLE: mcpClient=null produces an 'MCP client is unavailable' error without crashing", async () => {
    const mock = buildMcpScript({ city: "Tokyo" }, "unavailable noted");

    const events = await drain(
      agentLoop([{ role: "user", content: "weather please" }], {
        ...buildLoopOptions({ mock, mcpClient: null, workDir }),
      }),
    );

    expect(events[1].type).toBe("tool-result");
    expect(events[1].error).toBeNull();
    expect(events[1].result.error).toMatch(
      new RegExp(`MCP client is unavailable for tool: ${TOOL_NAME}`),
    );
    expect(events[2].content).toBe("unavailable noted");
  });

  it("treats a non-object MCP result as an invalid outcome", async () => {
    // The host-owned result contract accepts structured MCP result graphs.
    // A bare scalar is not silently reinterpreted after dispatch because the
    // remote outcome may already have occurred.
    const mcpClient = {
      callTool: vi.fn().mockResolvedValue("raw-string-payload"),
    };

    const mock = buildMcpScript({ city: "Berlin" }, "scalar wrapped");

    const events = await drain(
      agentLoop([{ role: "user", content: "weather please" }], {
        ...buildLoopOptions({ mock, mcpClient, workDir }),
      }),
    );

    expect(events[1].result).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      status: "outcome_unknown",
      outcomeUnknown: true,
      retryable: false,
      mcpLedgerIncident: {
        phase: "result",
        code: "CC_MCP_TOOL_RESULT_INVALID",
      },
    });
    expect(JSON.stringify(events[1].result)).not.toContain(
      "raw-string-payload",
    );
  });
});
