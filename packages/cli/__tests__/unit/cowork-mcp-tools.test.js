import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildToolName,
  toAgentTool,
  mountTemplateMcpTools,
  _deps,
} from "../../src/lib/cowork-mcp-tools.js";
import {
  consumeMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  verifyMcpStdioApprovedWorkingDirectory,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import { resolveMcpStdioSandboxContext } from "../../src/lib/mcp-stdio-workspace-authority.js";
import { releaseRegisteredHostHooksV2Workspace } from "../../src/lib/hooks-v2-workspace-context.js";

// ─── Fake MCPClient ──────────────────────────────────────────────────────────

function makeFakeClient({ connectFail = {}, tools = {} } = {}) {
  const connected = new Set();
  const configs = new Map();
  const disconnected = [];
  return {
    connected,
    configs,
    disconnected,
    async connect(name, config) {
      if (connectFail[name]) throw new Error(connectFail[name]);
      connected.add(name);
      configs.set(name, config);
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
        annotations: { readOnlyHint: true, openWorldHint: true },
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
        isReadOnly: true,
        effectContract: {
          declaredEffect: "read",
          authorizedEffect: null,
          sourceTrusted: false,
        },
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
      _deps.importMcpClient = async () =>
        function MockClient() {
          return fake;
        };

      const res = await mountTemplateMcpTools(
        {
          id: "approved-template",
          mcpServers: [
            { name: "fetch", command: "npx", args: ["-y", "@mcp/fetch"] },
          ],
        },
        { approveLocalCodeExecution: async () => true },
      );

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

    it("propagates sandbox requirements through approval and connect", async () => {
      const fake = makeFakeClient({ tools: { strict: [{ name: "ping" }] } });
      _deps.importMcpClient = async () =>
        function MockClient() {
          return fake;
        };
      const approveLocalCodeExecution = vi.fn(async () => true);

      const result = await mountTemplateMcpTools(
        {
          id: "strict-template",
          mcpServers: [
            {
              name: "strict",
              command: "node",
              cwd: process.cwd(),
              sandboxPolicy: {
                requiredBoundaries: ["network", "filesystem", "network"],
              },
            },
          ],
        },
        { approveLocalCodeExecution },
      );

      expect(result.mounted).toEqual(["strict"]);
      expect(approveLocalCodeExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: process.cwd(),
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
        }),
      );
      expect(fake.configs.get("strict")).toMatchObject({
        cwd: process.cwd(),
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      });
    });

    it("binds policy-bearing Cowork MCP to the task cwd outside host ALS", async () => {
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-cowork-mcp-workspace-")),
      );
      const service = path.join(root, "service");
      fs.mkdirSync(service);
      let observedContext = null;
      let observedOptions = null;
      _deps.importMcpClient = async () =>
        class AuthorityCheckingClient {
          constructor(options) {
            observedOptions = options;
          }

          async connect(name, config) {
            const approval = consumeMcpStdioExecutionAuthority(
              config.mcpStdioExecutionAuthority,
              { serverName: name, config },
            );
            const invocation = materializeApprovedMcpStdioInvocation(approval);
            observedContext = resolveMcpStdioSandboxContext({
              serverName: name,
              config: invocation,
              workspaceBinding: observedOptions.workspaceBinding,
            });
            verifyMcpStdioApprovedWorkingDirectory(
              approval,
              observedContext.workingDirectory,
            );
          }

          listTools() {
            return [];
          }

          async disconnectAll() {}
        };

      try {
        const result = await mountTemplateMcpTools(
          {
            id: "strict-cowork",
            mcpServers: [
              {
                name: "strict",
                command: "node",
                cwd: "service",
                sandboxPolicy: { requiredBoundaries: ["filesystem"] },
              },
            ],
          },
          {
            workspaceRoot: root,
            approveLocalCodeExecution: async () => true,
          },
        );

        expect(result.mounted).toEqual(["strict"]);
        expect(observedOptions.roots).toEqual([root]);
        expect(observedContext.workingDirectory).toBe(
          fs.realpathSync.native(service),
        );
      } finally {
        if (observedOptions?.workspaceBinding?.bindingId) {
          releaseRegisteredHostHooksV2Workspace(
            observedOptions.workspaceBinding.bindingId,
          );
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("warns and refuses invalid policy without creating a client", async () => {
      const onWarn = vi.fn();
      const approveLocalCodeExecution = vi.fn(async () => true);
      const result = await mountTemplateMcpTools(
        {
          mcpServers: [
            {
              name: "unsafe",
              command: "node",
              sandboxPolicy: { requiredBoundaries: ["process-tree"] },
            },
          ],
        },
        { onWarn, approveLocalCodeExecution },
      );

      expect(result.mcpClient).toBeNull();
      expect(result.mounted).toEqual([]);
      expect(result.skipped[0]).toMatchObject({ name: "unsafe" });
      expect(result.skipped[0].error).toMatch(/unsupported boundary/);
      expect(approveLocalCodeExecution).not.toHaveBeenCalled();
      expect(onWarn).toHaveBeenCalledOnce();
    });

    it("tolerates server connect failures (skipped list) and continues", async () => {
      const fake = makeFakeClient({
        connectFail: { broken: "spawn failed" },
        tools: { good: [{ name: "ping" }] },
      });
      _deps.importMcpClient = async () =>
        function MockClient() {
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
        { onWarn, approveLocalCodeExecution: async () => true },
      );

      expect(res.mounted).toEqual(["good"]);
      expect(res.skipped).toEqual([{ name: "broken", error: "spawn failed" }]);
      expect(res.extraToolDefinitions).toHaveLength(1);
      expect(res.extraToolDefinitions[0].function.name).toBe("mcp__good__ping");
      expect(onWarn).toHaveBeenCalledOnce();
    });

    it("cleanup() disconnects mounted servers", async () => {
      const fake = makeFakeClient({ tools: { a: [{ name: "t1" }] } });
      _deps.importMcpClient = async () =>
        function MockClient() {
          return fake;
        };

      const res = await mountTemplateMcpTools(
        { mcpServers: [{ name: "a", command: "echo" }] },
        { approveLocalCodeExecution: async () => true },
      );

      await res.cleanup();
      expect(fake.disconnected).toEqual(["a"]);
    });

    it("cleanup() prefers disconnectAll when available", async () => {
      const disconnectAll = vi.fn(async () => {});
      const fake = {
        ...makeFakeClient({ tools: { a: [{ name: "t1" }] } }),
        disconnectAll,
      };
      _deps.importMcpClient = async () =>
        function MockClient() {
          return fake;
        };

      const res = await mountTemplateMcpTools(
        { mcpServers: [{ name: "a", command: "echo" }] },
        { approveLocalCodeExecution: async () => true },
      );

      await res.cleanup();
      expect(disconnectAll).toHaveBeenCalledOnce();
    });

    it("cleanup() swallows disconnect errors", async () => {
      const fake = makeFakeClient({ tools: { a: [{ name: "t1" }] } });
      fake.disconnect = async () => {
        throw new Error("boom");
      };
      _deps.importMcpClient = async () =>
        function MockClient() {
          return fake;
        };

      const res = await mountTemplateMcpTools(
        { mcpServers: [{ name: "a", command: "echo" }] },
        { approveLocalCodeExecution: async () => true },
      );

      await expect(res.cleanup()).resolves.toBeUndefined();
    });

    it("fails closed before creating a client without explicit local-code approval", async () => {
      const onWarn = vi.fn();
      const res = await mountTemplateMcpTools(
        { mcpServers: [{ name: "a", command: "echo" }] },
        { onWarn },
      );

      expect(res.mcpClient).toBeNull();
      expect(res.mounted).toEqual([]);
      expect(res.skipped[0]).toMatchObject({ name: "a" });
      expect(res.skipped[0].error).toContain(
        "CC_MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED",
      );
      expect(onWarn).toHaveBeenCalledOnce();
    });
  });
});
