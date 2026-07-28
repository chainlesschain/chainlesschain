import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MCPClient, _deps } from "../../src/lib/mcp-client.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

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

afterEach(() => {
  _deps.spawn = originalSpawn;
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

    await client.connect("strict-plugin", {
      command: "strict-mcp",
      origin: "plugin:mcp",
      pluginWorkspaceRoot: "/plugins/strict-plugin",
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
        cwd: "/plugins/strict-plugin",
        shell: false,
        origin: "plugin:mcp",
      }),
      "/plugins/strict-plugin",
    );
    await client.disconnectAll();
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
