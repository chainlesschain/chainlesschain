import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPClient, _deps } from "../../src/harness/mcp-client.js";
import {
  MCP_TOOL_METADATA_LIMITS,
  admitMcpToolList,
  isMcpToolMetadataError,
  resolveMcpToolMetadataLimits,
} from "../../src/lib/mcp-tool-metadata.js";

const originalWebSocket = _deps.WebSocket;
const clients = new Set();
const METADATA_CANARY = "MCP_TOOL_METADATA_SECRET_CANARY";

function schemaAtDepth(depth) {
  let schema = { type: "string" };
  for (let index = 1; index < depth; index += 1) {
    schema = { nested: schema };
  }
  return schema;
}

function handshakeResult(method) {
  return {
    initialize: {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "metadata-fixture", version: "1" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
    "tools/list": { tools: MetadataWebSocket.tools },
    "resources/list": { resources: [] },
    "resources/templates/list": { resourceTemplates: [] },
    "prompts/list": { prompts: [] },
  }[method];
}

class MetadataWebSocket extends EventEmitter {
  static instances = [];
  static tools = [];

  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    MetadataWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }

  send(wire, callback) {
    const message = JSON.parse(String(wire));
    this.sent.push(message);
    callback?.();
    if (message.id == null) return;
    const result = handshakeResult(message.method);
    queueMicrotask(() => {
      this.emit(
        "message",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })),
        false,
      );
    });
  }

  close(code = 1000) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    queueMicrotask(() => {
      this.readyState = 3;
      this.emit("close", code);
    });
  }

  terminate() {
    this.close(1006);
  }
}

beforeEach(() => {
  _deps.WebSocket = originalWebSocket;
  MetadataWebSocket.instances = [];
  MetadataWebSocket.tools = [];
});

afterEach(async () => {
  for (const client of clients) await client.disconnectAll();
  clients.clear();
  _deps.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("admitMcpToolList host metadata budgets", () => {
  it("returns an independent JSON snapshot for a healthy inventory", () => {
    const source = [
      {
        name: "weather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
        annotations: { readOnlyHint: true },
      },
    ];

    const admitted = admitMcpToolList("srv", source);
    source[0].description = "mutated";
    source[0].inputSchema.properties.city.type = "number";

    expect(admitted.tools).toEqual([
      {
        name: "weather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
        annotations: { readOnlyHint: true },
      },
    ]);
    expect(admitted.metadataBytes).toBeGreaterThan(0);
    expect(Object.isFrozen(admitted.tools)).toBe(true);
    expect(Object.isFrozen(admitted.tools[0].inputSchema.properties)).toBe(
      true,
    );
  });

  it("enforces a tightened UTF-8 description byte budget", () => {
    const description = `天气${METADATA_CANARY}`;
    const error = (() => {
      try {
        admitMcpToolList("srv", [{ name: "weather", description }], {
          maxToolDescriptionBytes: 4,
        });
      } catch (cause) {
        return cause;
      }
      return null;
    })();

    expect(error).toMatchObject({
      code: "CC_MCP_TOOL_DESCRIPTION_TOO_LARGE",
      limitBytes: 4,
    });
    expect(isMcpToolMetadataError(error)).toBe(true);
    expect(error.message).not.toContain(METADATA_CANARY);
  });

  it("rejects terminal control characters while allowing readable whitespace", () => {
    expect(
      admitMcpToolList("srv", [
        { name: "readable", description: "line one\n\tline two" },
      ]).tools,
    ).toHaveLength(1);
    expect(() =>
      admitMcpToolList("srv", [
        { name: "terminal", description: "color\u001b[31m" },
      ]),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_TOOL_METADATA_INVALID" }),
    );
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])(
    "does not let config value %s disable or raise description limits",
    (value) => {
      expect(() =>
        admitMcpToolList(
          "srv",
          [
            {
              name: "oversized",
              description: METADATA_CANARY.repeat(1024),
            },
          ],
          { maxToolDescriptionBytes: value },
        ),
      ).toThrow(
        expect.objectContaining({
          code: "CC_MCP_TOOL_DESCRIPTION_TOO_LARGE",
          limitBytes: MCP_TOOL_METADATA_LIMITS.maxDescriptionBytes,
        }),
      );
    },
  );

  it("enforces schema bytes before the definition reaches a consumer", () => {
    expect(() =>
      admitMcpToolList(
        "srv",
        [
          {
            name: "wide",
            inputSchema: {
              type: "object",
              description: METADATA_CANARY,
            },
          },
        ],
        { maxToolSchemaBytes: 32 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_SCHEMA_TOO_LARGE",
        limitBytes: 32,
      }),
    );
  });

  it("enforces schema depth without recursive traversal", () => {
    expect(() =>
      admitMcpToolList(
        "srv",
        [{ name: "deep", inputSchema: schemaAtDepth(5) }],
        { maxToolSchemaDepth: 4 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_SCHEMA_DEPTH_EXCEEDED",
        limitDepth: 4,
      }),
    );
  });

  it("enforces schema node and server aggregate budgets", () => {
    expect(() =>
      admitMcpToolList(
        "srv",
        [
          {
            name: "nodes",
            inputSchema: { one: 1, two: 2, three: 3 },
          },
        ],
        { maxToolSchemaNodes: 4 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_SCHEMA_NODES_EXCEEDED",
        limitNodes: 4,
      }),
    );

    expect(() =>
      admitMcpToolList(
        "srv",
        [
          { name: "one", description: "x".repeat(80) },
          { name: "two", description: "y".repeat(80) },
        ],
        { maxToolMetadataBytes: 128 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_METADATA_TOO_LARGE",
        limitBytes: 128,
      }),
    );
  });

  it("allows exactly 1000 tools and rejects the next one", () => {
    const exact = Array.from({ length: 1000 }, (_, index) => ({
      name: `tool_${index}`,
    }));

    expect(admitMcpToolList("srv", exact).tools).toHaveLength(1000);
    expect(() =>
      admitMcpToolList("srv", [...exact, { name: "overflow" }]),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_COUNT_EXCEEDED",
        limitTools: 1000,
      }),
    );
  });

  it("rejects duplicate names and client-wide aggregate overflow", () => {
    expect(() =>
      admitMcpToolList("srv", [{ name: "same" }, { name: "same" }]),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_TOOL_METADATA_INVALID" }),
    );

    expect(() =>
      admitMcpToolList(
        "srv",
        [{ name: "one" }],
        {},
        {
          clientBytesUsed: MCP_TOOL_METADATA_LIMITS.maxClientBytes,
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_CLIENT_METADATA_TOO_LARGE",
        limitBytes: MCP_TOOL_METADATA_LIMITS.maxClientBytes,
      }),
    );
  });

  it.each(["proxy", "accessor", "cycle"])(
    "rejects %s metadata without executing peer code",
    (kind) => {
      let trapReads = 0;
      let tool;
      if (kind === "proxy") {
        tool = new Proxy(
          { name: "hostile" },
          {
            get() {
              trapReads += 1;
              throw new Error(METADATA_CANARY);
            },
            ownKeys() {
              trapReads += 1;
              throw new Error(METADATA_CANARY);
            },
          },
        );
      } else if (kind === "accessor") {
        tool = { name: "hostile" };
        Object.defineProperty(tool, "description", {
          enumerable: true,
          get() {
            trapReads += 1;
            throw new Error(METADATA_CANARY);
          },
        });
      } else {
        tool = { name: "hostile", inputSchema: { type: "object" } };
        tool.inputSchema.self = tool.inputSchema;
      }

      let error;
      try {
        admitMcpToolList("srv", [tool]);
      } catch (cause) {
        error = cause;
      }
      expect(trapReads).toBe(0);
      expect(error).toMatchObject({
        code: "CC_MCP_TOOL_METADATA_INVALID",
      });
      expect(error.message).not.toContain(METADATA_CANARY);
    },
  );

  it("resolves positive finite tightenings while clamping oversized values", () => {
    expect(
      resolveMcpToolMetadataLimits({
        maxTools: 5,
        maxToolDescriptionBytes: 64,
        maxToolSchemaBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({
      maxTools: 5,
      maxDescriptionBytes: 64,
      maxSchemaBytes: MCP_TOOL_METADATA_LIMITS.maxSchemaBytes,
    });
  });
});

describe("MCPClient tool inventory admission", () => {
  it("keeps a connection but exposes no tool when initial metadata is oversized", async () => {
    _deps.WebSocket = MetadataWebSocket;
    MetadataWebSocket.tools = [
      {
        name: "hostile",
        description: METADATA_CANARY.repeat(1024),
      },
    ];
    const client = new MCPClient();
    clients.add(client);

    const result = await client.connect("ws", {
      transport: "ws",
      url: "ws://metadata.example.test/rpc",
      maxToolDescriptionBytes: 64,
    });

    expect(result.state).toBe("connected");
    expect(result.tools).toEqual([]);
    expect(result.toolsError).toMatch(/64-byte host budget/);
    expect(result.toolsError).not.toContain(METADATA_CANARY);
    expect(client.listTools("ws")).toEqual([]);
    expect(client._toolMetadataBytes).toBe(0);
  });

  it("retains the last valid list when a list_changed refresh is rejected", async () => {
    _deps.WebSocket = MetadataWebSocket;
    MetadataWebSocket.tools = [
      {
        name: "safe",
        description: "safe tool",
        inputSchema: { type: "object" },
      },
    ];
    const client = new MCPClient();
    clients.add(client);
    await client.connect("ws", {
      transport: "ws",
      url: "ws://metadata.example.test/rpc",
      maxToolDescriptionBytes: 64,
    });
    const bytesBefore = client._toolMetadataBytes;
    const serverErrors = [];
    const changed = [];
    client.on("server-error", (event) => serverErrors.push(event));
    client.on("tools-changed", (event) => changed.push(event));
    MetadataWebSocket.tools = [
      {
        name: "hostile",
        description: METADATA_CANARY.repeat(1024),
      },
    ];

    await client._refreshServerList("ws", "tools");

    expect(client.listTools("ws")).toEqual([
      expect.objectContaining({ name: "safe", description: "safe tool" }),
    ]);
    expect(client._toolMetadataBytes).toBe(bytesBefore);
    expect(changed).toEqual([]);
    expect(serverErrors).toEqual([
      expect.objectContaining({
        code: "CC_MCP_TOOL_DESCRIPTION_TOO_LARGE",
        limitBytes: 64,
      }),
    ]);
    expect(JSON.stringify(serverErrors)).not.toContain(METADATA_CANARY);

    await client.disconnect("ws");
    expect(client._toolMetadataBytes).toBe(0);
  });
});
