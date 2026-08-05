import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MCPClient, _deps } from "../../src/lib/mcp-client.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import {
  issuePluginWorkspaceAuthority,
  resolvePluginWorkspaceAuthority,
} from "../../src/lib/plugin-runtime/sandbox-policy.js";

function makeFakeMcpProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.stdin = {
    write(data) {
      const message = JSON.parse(String(data).trim());
      if (message.id === undefined) return true;
      const result =
        message.method === "initialize"
          ? {
              serverInfo: { name: "fake", version: "1" },
              capabilities: {},
            }
          : message.method === "tools/list"
            ? { tools: [] }
            : message.method === "resources/list"
              ? { resources: [] }
              : message.method === "prompts/list"
                ? { prompts: [] }
                : {};
      setImmediate(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
          ),
        );
      });
      return true;
    },
  };
  return proc;
}

const originalSpawn = _deps.spawn;
const originalConsume = _deps.consumeMcpStdioExecutionAuthority;
const originalMaterialize = _deps.materializeApprovedMcpStdioInvocation;

beforeEach(() => {
  _deps.consumeMcpStdioExecutionAuthority = () => ({
    approvalKind: "test-fixture",
  });
  _deps.materializeApprovedMcpStdioInvocation = (_approval, { config }) =>
    config;
});

afterEach(() => {
  _deps.spawn = originalSpawn;
  _deps.consumeMcpStdioExecutionAuthority = originalConsume;
  _deps.materializeApprovedMcpStdioInvocation = originalMaterialize;
  vi.restoreAllMocks();
});

describe("MCPClient plugin sandbox policy", () => {
  it("forwards explicit stdio requirements to the process broker boundary", async () => {
    const proc = makeFakeMcpProcess();
    _deps.spawn = vi.fn(() => proc);
    const contract = Object.freeze({ kind: "test-workspace-contract" });
    const issueAuthority = vi
      .spyOn(executionBroker, "issueLinuxWorkspaceSandboxExecutionContract")
      .mockReturnValue(contract);
    const client = new MCPClient();
    const provenance = {
      origin: "plugin:mcp",
      pluginId: "strict-plugin",
      pluginVersion: "1.0.0",
      pluginSource: "trusted-test-source",
    };
    const pluginWorkspaceAuthority = issuePluginWorkspaceAuthority({
      root: process.cwd(),
      ...provenance,
    });
    const trustedRoot = resolvePluginWorkspaceAuthority(
      pluginWorkspaceAuthority,
      provenance,
    );

    await client.connect("strict-plugin", {
      command: "strict-mcp",
      ...provenance,
      pluginWorkspaceAuthority,
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
    });

    expect(_deps.spawn).toHaveBeenCalledWith(
      "strict-mcp",
      [],
      expect.objectContaining({
        origin: "plugin:mcp",
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
        sandboxExecutionContract: contract,
      }),
    );
    expect(issueAuthority).toHaveBeenCalledWith(
      "strict-mcp",
      [],
      expect.objectContaining({
        cwd: trustedRoot,
        shell: false,
        origin: "plugin:mcp",
      }),
      trustedRoot,
    );
    await client.disconnectAll();
  });

  it("rejects a lookalike manifest authority before spawning a strict plugin server", async () => {
    _deps.spawn = vi.fn(() => makeFakeMcpProcess());
    const issueAuthority = vi.spyOn(
      executionBroker,
      "issueLinuxWorkspaceSandboxExecutionContract",
    );
    const client = new MCPClient();

    await expect(
      client.connect("forged-plugin", {
        command: "forged-mcp",
        origin: "plugin:mcp",
        pluginId: "forged-plugin",
        pluginVersion: "1.0.0",
        pluginSource: "manifest-controlled",
        pluginWorkspaceAuthority: {
          contractVersion: 1,
          kind: "trusted-plugin-workspace",
        },
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
    ).rejects.toThrow(/missing its trusted workspace authority/);

    expect(issueAuthority).not.toHaveBeenCalled();
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it("keeps legacy stdio spawn options free of sandboxPolicy", async () => {
    const proc = makeFakeMcpProcess();
    _deps.spawn = vi.fn(() => proc);
    const client = new MCPClient();

    await client.connect("legacy-plugin", {
      command: "legacy-mcp",
      origin: "plugin:mcp",
    });

    expect(_deps.spawn.mock.calls[0][2]).not.toHaveProperty("sandboxPolicy");
    await client.disconnectAll();
  });
});
