import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildToolName,
  toAgentTool,
  mountTemplateMcpTools,
  _deps,
} from "../../src/lib/cowork-mcp-tools.js";

// ─── Fake MCPClient ──────────────────────────────────────────────────────────

function makeFakeClient({ connectFail = {}, tools = {} } = {}) {
  const connected = new Set();
  const disconnected = [];
  return {
    connected,
    disconnected,
    async connect(name) {
      if (connectFail[name]) throw new Error(connectFail[name]);
      connected.add(name);
    },
    listTools(name) {
      return tools[name] || [];
    },
    async disconnect(name) {
      disconnected.push(name);
      connected.delete(name);
    },
  };
}

describe("cowork-mcp-tools", () => {
  describe("buildToolName", () => {
    it("namespaces server and tool names", () => {
      expect(buildToolName("fetch", "get")).toBe("mcp__fetch__get");
    });
  });

  describe("toAgentTool", () => {
    it("produces canonical definition/descriptor/executor triple", () => {
      const { definition, descriptor, executor } = toAgentTool("fetch", {
        name: "get",
        description: "Fetch a URL",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      });

      expect(definition).toEqual({
        type: "function",
        function: {
          name: "mcp__fetch__get",
          description: "Fetch a URL",
          parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
      });
      expect(descriptor).toMatchObject({
        name: "mcp__fetch__get",
        kind: "mcp",
        category: "mcp",
        serverName: "fetch",
        originalName: "get",
      });
      expect(executor).toEqual({
        kind: "mcp",
        serverName: "fetch",
        toolName: "get",
      });
    });

    it("falls back to empty schema when inputSchema missing", () => {
      const { definition } = toAgentTool("srv", { name: "ping" });
      expect(definition.function.parameters).toEqual({
        type: "object",
        properties: {},
      });
      expect(definition.function.description).toMatch(/MCP tool "ping"/);
    });
  });

  describe("mountTemplateMcpTools", () => {
    beforeEach(() => {
      // Reset importMcpClient override between tests
      _deps.importMcpClient = async () => {
        throw new Error("test must install a fake client");
      };
    });

    it("returns empty shape when template has no mcpServers", async () => {
      const res = await mountTemplateMcpTools({});
      expect(res.mcpClient).toBeNull();
      expect(res.mounted).toEqual([]);
      expect(res.extraToolDefinitions).toEqual([]);
      expect(res.externalToolDescriptors).toEqual({});
      expect(res.externalToolExecutors).toEqual({});
      await res.cleanup(); // no-op
    });

    it("returns empty shape when mcpServers is not an array", async () => {
      const res = await mountTemplateMcpTools({ mcpServers: "nope" });
      expect(res.mounted).toEqual([]);
    });

    it("returns empty shape when all configs are invalid", async () => {
      const res = await mountTemplateMcpTools({
        mcpServers: [{ name: "" }, { command: "x" }],
      });
      expect(res.mcpClient).toBeNull();
      expect(res.mounted).toEqual([]);
    });

    it("connects servers and exposes their tools as extraToolDefinitions", async () => {
      const fake = makeFakeClient({
        tools: {
          fetch: [
            {
              name: "get",
              description: "GET a URL",
              inputSchema: {
                type: "object",
                properties: { url: { type: "string" } },
              },
            },
            { name: "post" },
          ],
        },
      });
      _deps.importMcpClient = async () => function MockClient() {
        return fake;
      };

      const res = await mountTemplateMcpTools({
        mcpServers: [
          { name: "fetch", command: "npx", args: ["-y", "@mcp/fetch"] },
        ],
      });

      expect(res.mounted).toEqual(["fetch"]);
      expect(res.skipped).toEqual([]);
      expect(res.extraToolDefinitions).toHaveLength(2);
      expect(res.extraToolDefinitions[0].function.name).toBe("mcp__fetch__get");
      expect(res.extraToolDefinitions[1].function.name).toBe(
        "mcp__fetch__post",
      );
      expect(res.externalToolExecutors["mcp__fetch__get"]).toEqual({
        kind: "mcp",
        serverName: "fetch",
        toolName: "get",
      });
      expect(res.externalToolDescriptors["mcp__fetch__post"].serverName).toBe(
        "fetch",
      );
      expect(fake.connected.has("fetch")).toBe(true);
    });

    it("tolerates server connect failures (skipped list) and continues", async () => {
      const fake = makeFakeClient({
        connectFail: { broken: "spawn failed" },
        tools: { good: [{ name: "ping" }] },
      });
      _deps.importMcpClient = async () => function MockClient() {
        return fake;
      };

      const onWarn = vi.fn();
      const res = await mountTemplateMcpTools(
        {
          mcpServers: [
            { name: "broken", command: "nonexistent" },
            { name: "good", command: "echo" },
          ],
        },
        { onWarn },
      );

      expect(res.mounted).toEqual(["good"]);
      expect(res.skipped).toEqual([
        { name: "broken", error: "spawn failed" },
      ]);
      expect(res.extraToolDefinitions).toHaveLength(1);
      expect(res.extraToolDefinitions[0].function.name).toBe("mcp__good__ping");
      expect(onWarn).toHaveBeenCalledOnce();
    });

    it("cleanup() disconnects mounted servers", async () => {
      const fake = makeFakeClient({ tools: { a: [{ name: "t1" }] } });
      _deps.importMcpClient = async () => function MockClient() {
        return fake;
      };

      const res = await mountTemplateMcpTools({
        mcpServers: [{ name: "a", command: "echo" }],
      });

      await res.cleanup();
      expect(fake.disconnected).toEqual(["a"]);
    });

    it("cleanup() prefers disconnectAll when available", async () => {
      const disconnectAll = vi.fn(async () => {});
      const fake = {
        ...makeFakeClient({ tools: { a: [{ name: "t1" }] } }),
        disconnectAll,
      };
      _deps.importMcpClient = async () => function MockClient() {
        return fake;
      };

      const res = await mountTemplateMcpTools({
        mcpServers: [{ name: "a", command: "echo" }],
      });

      await res.cleanup();
      expect(disconnectAll).toHaveBeenCalledOnce();
    });

    it("cleanup() swallows disconnect errors", async () => {
      const fake = makeFakeClient({ tools: { a: [{ name: "t1" }] } });
      fake.disconnect = async () => {
        throw new Error("boom");
      };
      _deps.importMcpClient = async () => function MockClient() {
        return fake;
      };

      const res = await mountTemplateMcpTools({
        mcpServers: [{ name: "a", command: "echo" }],
      });

      await expect(res.cleanup()).resolves.toBeUndefined();
    });
  });
});
