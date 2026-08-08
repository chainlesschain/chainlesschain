import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  _deps as clientDeps,
} from "../../src/harness/mcp-client.js";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  renewMcpStdioExecutionAuthority,
  MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED_CODE,
  MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
  MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  loadManagedMcp,
  loadMcpConfig,
  loadPluginMcp,
  loadProjectMcp,
  loadRegisteredMcp,
} from "../../src/runtime/mcp-config.js";

const originalSpawn = clientDeps.spawn;
const originalConsume = clientDeps.consumeMcpStdioExecutionAuthority;

function config(overrides = {}) {
  return {
    command: "node",
    args: ["server.mjs"],
    env: { MODE: "test" },
    transport: "stdio",
    ...overrides,
  };
}

function issue(serverName, value, overrides = {}) {
  return issueMcpStdioExecutionAuthority({
    serverName,
    config: value,
    approvalKind: "explicit-config",
    approvalSource: "C:/approved/mcp.json",
    ...overrides,
  });
}

function consumingClient(records) {
  return {
    servers: new Map(),
    async connect(name, value) {
      const approval = consumeMcpStdioExecutionAuthority(
        value.mcpStdioExecutionAuthority,
        { serverName: name, config: value },
      );
      records.push({ name, approval });
      this.servers.set(name, {});
      return { tools: [] };
    },
  };
}

beforeEach(() => {
  clientDeps.spawn = originalSpawn;
  clientDeps.consumeMcpStdioExecutionAuthority = originalConsume;
});

describe("MCP stdio local-code execution authority", () => {
  it("rejects a direct stdio connection before spawn without a loader-issued capability", async () => {
    const spawn = vi.fn();
    clientDeps.spawn = spawn;
    const client = new MCPClient();

    await expect(client.connect("untrusted", config())).rejects.toMatchObject({
      code: MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(client.servers.has("untrusted")).toBe(false);
  });

  it("binds one approval to the exact invocation and private source authorities", () => {
    const pluginWorkspaceAuthority = Object.freeze({});
    const approved = config({
      origin: "plugin:mcp",
      pluginId: "reviewed",
      pluginVersion: "1.2.3",
      pluginSource: "C:/plugins/reviewed/.mcp.json",
      pluginWorkspaceAuthority,
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    });
    const token = issue("reviewed", approved, {
      approvalKind: "trusted-plugin",
      approvalSource: "reviewed@1.2.3",
    });
    approved.args = ["replacement.mjs"];

    expect(() =>
      consumeMcpStdioExecutionAuthority(token, {
        serverName: "reviewed",
        config: approved,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      }),
    );
    expect(() =>
      consumeMcpStdioExecutionAuthority(token, {
        serverName: "reviewed",
        config: approved,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED_CODE,
      }),
    );
  });

  it("binds declared runtime semantics into the one-shot approval", () => {
    const approved = config({ runtimeKind: "node" });
    const token = issue("runtime-bound", approved);
    approved.runtimeKind = "native";

    expect(() =>
      consumeMcpStdioExecutionAuthority(token, {
        serverName: "runtime-bound",
        config: approved,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      }),
    );
  });

  it("renews the same approved invocation for reconnect but rejects drift", () => {
    const approved = config();
    const approval = consumeMcpStdioExecutionAuthority(
      issue("reconnect", approved),
      { serverName: "reconnect", config: approved },
    );
    const reconnect = { ...approved };
    reconnect.mcpStdioExecutionAuthority = renewMcpStdioExecutionAuthority(
      approval,
      { serverName: "reconnect", config: reconnect },
    );
    expect(
      consumeMcpStdioExecutionAuthority(reconnect.mcpStdioExecutionAuthority, {
        serverName: "reconnect",
        config: reconnect,
      }),
    ).toMatchObject({ approvalKind: "explicit-config" });

    expect(() =>
      renewMcpStdioExecutionAuthority(approval, {
        serverName: "reconnect",
        config: { ...approved, command: "replacement" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      }),
    );
  });

  it("materializes detached launch arguments and environment from the approved snapshot", () => {
    const approved = config();
    const approval = consumeMcpStdioExecutionAuthority(
      issue("detached", approved),
      { serverName: "detached", config: approved },
    );
    approved.args[0] = "mutated.mjs";
    approved.env.MODE = "mutated";

    expect(materializeApprovedMcpStdioInvocation(approval)).toMatchObject({
      command: "node",
      args: ["server.mjs"],
      env: { MODE: "test" },
      runtimeKind: null,
    });
  });

  it("does not execute config getters or Proxy traps while issuing authority", () => {
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "command", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "node";
      },
    });
    expect(() => issue("accessor", accessor)).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    let proxyCalls = 0;
    const proxy = new Proxy(config(), {
      get() {
        proxyCalls += 1;
        return "node";
      },
    });
    expect(() => issue("proxy", proxy)).toThrow(TypeError);
    expect(proxyCalls).toBe(0);
  });

  it("issues source-scoped one-shot capabilities from every production stdio loader", async () => {
    const records = [];
    const createClient = () => consumingClient(records);

    await loadMcpConfig("C:/explicit/mcp.json", {
      readFile: () => JSON.stringify({ mcpServers: { explicit: config() } }),
      createClient,
    });
    await loadManagedMcp(
      { managedMcpServers: { managed: config() } },
      { managedFile: "managed-policy.json", createClient },
    );
    await loadRegisteredMcp(
      {},
      {
        all: true,
        makeServerConfig: () => ({
          list: () => [
            {
              name: "registered",
              ...config(),
              configScope: "user",
              configSource: "user-database",
            },
          ],
        }),
        createClient,
      },
    );
    await loadProjectMcp(
      { cwd: "C:/workspace", env: { CC_PROJECT_MCP: "1" } },
      {
        fileExists: () => true,
        readFile: () => JSON.stringify({ mcpServers: { project: config() } }),
        projectMcpTrust: {
          checkProjectMcpTrust: () => ({ status: "trusted" }),
          projectMcpRetrustRequested: () => false,
          issueProjectMcpWorkspaceAuthority: () => Object.freeze({}),
        },
        createClient,
      },
    );
    await loadPluginMcp(
      { cwd: "C:/workspace" },
      {
        collect: () => ({
          servers: {
            plugin: config({
              origin: "plugin:mcp",
              pluginId: "plugin-a",
              pluginVersion: "1.0.0",
              pluginSource: "C:/plugin/.mcp.json",
              pluginWorkspaceAuthority: Object.freeze({}),
            }),
          },
        }),
        createClient,
      },
    );

    expect(records.map(({ name }) => name).sort()).toEqual([
      "explicit",
      "managed",
      "plugin",
      "project",
      "registered",
    ]);
    expect(records.map(({ approval }) => approval.approvalKind).sort()).toEqual(
      [
        "explicit-config",
        "managed-settings",
        "project-config",
        "registered-config",
        "trusted-plugin",
      ],
    );
  });
});
