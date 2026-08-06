import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPClient, ServerState } from "../../src/harness/mcp-client.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_TOOL_RESULT_LIMITS,
  admitMcpToolResult,
  isMcpToolResultAdmissionError,
  resolveMcpToolResultLimits,
} from "../../src/lib/mcp-tool-result.js";

const clients = new Set();
const RESULT_CANARY = "MCP_TOOL_RESULT_SECRET_CANARY";

function nestedResult(depth) {
  let value = { text: "leaf" };
  for (let index = 1; index < depth; index += 1) {
    value = { nested: value };
  }
  return value;
}

function addStdioEntry(client, config = {}) {
  const process = {
    kill: vi.fn(),
    stdin: { write: vi.fn(() => true) },
  };
  const entry = {
    config: { longRunning: true, requestTimeoutMs: 0, ...config },
    state: ServerState.CONNECTED,
    transportKind: "stdio",
    process,
    socket: null,
    _pending: new Map(),
    _buffer: "",
    _bufferBytes: 0,
    _stdioFrameError: null,
    _malformedFrameBytes: 0,
    _malformedFrameCount: 0,
    _stderrBytes: 0,
    _stderrNotified: false,
  };
  client.servers.set("stdio", entry);
  return { entry, process };
}

async function captureError(promise) {
  try {
    await promise;
    throw new Error("expected MCP tool result rejection");
  } catch (error) {
    return error;
  }
}

afterEach(async () => {
  for (const client of clients) await client.disconnectAll();
  clients.clear();
  vi.restoreAllMocks();
});

describe("MCP tool result host admission", () => {
  it("returns an independent, deeply frozen snapshot with exact byte metrics", () => {
    const source = {
      content: [
        { type: "text", text: "天气" },
        { type: "text", text: "ok" },
      ],
      structuredContent: { count: 2 },
    };
    const expectedBytes = Buffer.byteLength(JSON.stringify(source), "utf8");
    const admitted = admitMcpToolResult("srv", source, {
      maxToolResultBytes: expectedBytes,
    });

    source.content[0].text = "mutated";
    source.structuredContent.count = 3;

    expect(admitted.bytes).toBe(expectedBytes);
    expect(admitted.result.content[0].text).toBe("天气");
    expect(admitted.result.structuredContent.count).toBe(2);
    expect(Object.isFrozen(admitted.result)).toBe(true);
    expect(Object.isFrozen(admitted.result.content)).toBe(true);
    expect(Object.isFrozen(admitted.result.content[0])).toBe(true);
    expect(() =>
      admitMcpToolResult("srv", source, {
        maxToolResultBytes: expectedBytes - 1,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_RESULT_TOO_LARGE",
        limitBytes: expectedBytes - 1,
      }),
    );
  });

  it("enforces UTF-8 bytes without copying peer content into diagnostics", () => {
    const result = { content: `天气${RESULT_CANARY}` };
    const error = (() => {
      try {
        admitMcpToolResult("srv", result, { maxToolResultBytes: 32 });
      } catch (cause) {
        return cause;
      }
      return null;
    })();

    expect(error).toMatchObject({
      code: "CC_MCP_TOOL_RESULT_TOO_LARGE",
      limitBytes: 32,
      dispatched: true,
      outcomeUnknown: true,
      retryable: false,
    });
    expect(isMcpToolResultAdmissionError(error)).toBe(true);
    expect(error.message).not.toContain(RESULT_CANARY);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])("does not let config value %s bypass the hard byte ceiling", (value) => {
    expect(() =>
      admitMcpToolResult(
        "srv",
        { content: "x".repeat(MCP_TOOL_RESULT_LIMITS.maxBytes) },
        { maxToolResultBytes: value },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_RESULT_TOO_LARGE",
        limitBytes: MCP_TOOL_RESULT_LIMITS.maxBytes,
      }),
    );
  });

  it("enforces independent depth and node budgets", () => {
    expect(() =>
      admitMcpToolResult("srv", nestedResult(4), {
        maxToolResultDepth: 3,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_RESULT_DEPTH_EXCEEDED",
        limitDepth: 3,
      }),
    );

    expect(() =>
      admitMcpToolResult(
        "srv",
        { content: [{ type: "text", text: "one" }, { type: "text" }] },
        { maxToolResultNodes: 8 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_RESULT_NODES_EXCEEDED",
        limitNodes: 8,
      }),
    );
  });

  it.each(["proxy", "accessor", "cycle", "shared"])(
    "rejects %s results without executing peer code",
    (kind) => {
      let trapReads = 0;
      let result;
      if (kind === "proxy") {
        result = new Proxy(
          { content: [] },
          {
            get() {
              trapReads += 1;
              throw new Error(RESULT_CANARY);
            },
            ownKeys() {
              trapReads += 1;
              throw new Error(RESULT_CANARY);
            },
          },
        );
      } else if (kind === "accessor") {
        result = {};
        Object.defineProperty(result, "content", {
          enumerable: true,
          get() {
            trapReads += 1;
            throw new Error(RESULT_CANARY);
          },
        });
      } else if (kind === "cycle") {
        result = { content: [] };
        result.self = result;
      } else {
        const shared = { text: RESULT_CANARY };
        result = { first: shared, second: shared };
      }

      let error;
      try {
        admitMcpToolResult("srv", result);
      } catch (cause) {
        error = cause;
      }
      expect(trapReads).toBe(0);
      expect(error).toMatchObject({ code: "CC_MCP_TOOL_RESULT_INVALID" });
      expect(error.message).not.toContain(RESULT_CANARY);
    },
  );

  it("rejects non-object protocol results and clamps every tuning", () => {
    expect(() => admitMcpToolResult("srv", "not-an-object")).toThrow(
      expect.objectContaining({ code: "CC_MCP_TOOL_RESULT_INVALID" }),
    );
    expect(
      resolveMcpToolResultLimits({
        maxToolResultBytes: 64,
        maxToolResultDepth: Number.MAX_SAFE_INTEGER,
        maxToolResultNodes: 100,
      }),
    ).toEqual({
      maxBytes: 64,
      maxDepth: MCP_TOOL_RESULT_LIMITS.maxDepth,
      maxNodes: 100,
    });
  });

  it.each([
    ["maxToolResultBytes", "maxBytes", MCP_TOOL_RESULT_LIMITS.maxBytes],
    ["maxToolResultDepth", "maxDepth", MCP_TOOL_RESULT_LIMITS.maxDepth],
    ["maxToolResultNodes", "maxNodes", MCP_TOOL_RESULT_LIMITS.maxNodes],
  ])(
    "does not let invalid %s values disable or raise the host ceiling",
    (configKey, limitKey, ceiling) => {
      for (const value of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER,
      ]) {
        expect(
          resolveMcpToolResultLimits({ [configKey]: value })[limitKey],
        ).toBe(ceiling);
      }
    },
  );
});

describe("MCPClient final tools/call result budget", () => {
  it("rejects an oversized stdio result after dispatch without killing or reconnecting", async () => {
    const client = new MCPClient();
    clients.add(client);
    const { entry, process } = addStdioEntry(client, {
      maxToolResultBytes: 64,
    });
    const reconnector = vi.fn(async () => entry.config);
    client.setReconnector("stdio", reconnector);
    const pending = client.callTool("stdio", "mutate", {});
    const request = JSON.parse(process.stdin.write.mock.calls[0][0]);
    const wire = JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: RESULT_CANARY.repeat(16) },
    });

    client._handleData("stdio", `${wire}\n`);
    const error = await captureError(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_TOOL_RESULT_TOO_LARGE",
      limitBytes: 64,
      dispatched: true,
      outcomeUnknown: true,
      retryable: false,
    });
    expect(error.message).not.toContain(RESULT_CANARY);
    expect(entry.state).toBe(ServerState.CONNECTED);
    expect(entry._pending.size).toBe(0);
    expect(process.kill).not.toHaveBeenCalled();
    expect(reconnector).not.toHaveBeenCalled();
  });
});

describe("MCP call ledger result admission", () => {
  it("does not digest or persist an oversized output", async () => {
    const persisted = [];
    const ledger = createMcpCallLedger({
      toolResultConfig: { maxToolResultBytes: 64 },
      sink: async (record, { phase }) => persisted.push({ record, phase }),
      randomUUID: () => "result-budget",
    });
    const ticket = await ledger.begin({
      serverName: "srv",
      toolName: "mutate",
      input: {},
      effectContract: { effect: "write" },
    });

    await expect(
      ticket.settle({
        status: "completed",
        output: { content: RESULT_CANARY.repeat(16) },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_TOOL_RESULT_TOO_LARGE",
      limitBytes: 64,
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].phase).toBe("started");
    expect(JSON.stringify(persisted)).not.toContain(RESULT_CANARY);
    expect(ledger.get(ticket.ledgerId)).toMatchObject({ status: "started" });
  });
});
