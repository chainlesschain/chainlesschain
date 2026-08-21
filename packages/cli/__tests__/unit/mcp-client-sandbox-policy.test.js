import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCPClient, _deps } from "../../src/lib/mcp-client.js";
import { MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES } from "../../src/lib/mcp-stdio-executable-identity.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import {
  issuePluginWorkspaceAuthority,
  resolvePluginWorkspaceAuthority,
} from "../../src/lib/plugin-runtime/sandbox-policy.js";
import {
  registerHostHooksV2Workspace,
  releaseRegisteredHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";

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
              protocolVersion: "2025-11-25",
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
const originalPrepareIdentity = _deps.prepareMcpStdioExecutableIdentity;
const originalVerifyWorkingDirectory =
  _deps.verifyMcpStdioApprovedWorkingDirectory;

beforeEach(() => {
  _deps.consumeMcpStdioExecutionAuthority = () => ({
    approvalKind: "test-fixture",
  });
  _deps.materializeApprovedMcpStdioInvocation = (_approval, { config }) =>
    config;
  _deps.prepareMcpStdioExecutableIdentity = ({ config }) => ({
    command: config.command,
    args: config.args || [],
    identity: null,
    authority: Object.freeze({}),
  });
  _deps.verifyMcpStdioApprovedWorkingDirectory = () => true;
});

afterEach(() => {
  _deps.spawn = originalSpawn;
  _deps.consumeMcpStdioExecutionAuthority = originalConsume;
  _deps.materializeApprovedMcpStdioInvocation = originalMaterialize;
  _deps.prepareMcpStdioExecutableIdentity = originalPrepareIdentity;
  _deps.verifyMcpStdioApprovedWorkingDirectory = originalVerifyWorkingDirectory;
  vi.restoreAllMocks();
});

describe("MCPClient plugin sandbox policy", () => {
  it("prioritizes a materialized capsule snapshot contract at spawn", async () => {
    const proc = makeFakeMcpProcess();
    _deps.spawn = vi.fn(() => proc);
    const contract = Object.freeze({ kind: "strict-mcp-node-capsule" });
    const identityAuthority = Object.freeze({});
    _deps.prepareMcpStdioExecutableIdentity = () => ({
      command: process.execPath,
      args: ["C:\\capsule\\server.cjs", "--stdio"],
      identity: Object.freeze({}),
      identityDigest: "a".repeat(64),
      authority: identityAuthority,
      env: { PATH: "trusted" },
      workingDirectory: "C:\\capsule",
      sandboxExecutionContract: contract,
    });
    const issueAuthority = vi.spyOn(
      executionBroker,
      "issueLinuxWorkspaceSandboxExecutionContract",
    );
    const client = new MCPClient({
      workspaceBinding: registerHostHooksV2Workspace(process.cwd()),
    });

    await client.connect("materialized-package", {
      command: "npx",
      args: ["server@1.0.0"],
      origin: "mcp:configured",
    });

    expect(_deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      ["C:\\capsule\\server.cjs", "--stdio"],
      expect.objectContaining({
        cwd: "C:\\capsule",
        shell: false,
        env: { PATH: "trusted" },
        requiredBoundaries: MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
        sandboxExecutionContract: contract,
        mcpStdioExecutableIdentityAuthority: identityAuthority,
        mcpStdioExecutableIdentityDigest: "a".repeat(64),
      }),
    );
    const launchOptions = _deps.spawn.mock.calls[0][2];
    expect(
      new Set([
        ...launchOptions.requiredBoundaries,
        ...launchOptions.sandboxPolicy.requiredBoundaries,
      ]),
    ).toEqual(new Set(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES));
    expect(Object.isFrozen(launchOptions.requiredBoundaries)).toBe(true);
    expect(Object.isFrozen(launchOptions.sandboxPolicy)).toBe(true);
    expect(
      Object.isFrozen(launchOptions.sandboxPolicy.requiredBoundaries),
    ).toBe(true);
    expect(
      client.servers.get("materialized-package").config,
    ).not.toHaveProperty("sandboxPolicy");
    expect(issueAuthority).not.toHaveBeenCalled();
    await client.disconnectAll();
  });

  it("does not let an explicit policy subset weaken the capsule host floor", async () => {
    const proc = makeFakeMcpProcess();
    _deps.spawn = vi.fn(() => proc);
    const contract = Object.freeze({ kind: "strict-mcp-node-capsule" });
    const prepare = vi.fn(() => ({
      command: process.execPath,
      args: ["C:\\capsule\\server.cjs", "--stdio"],
      identity: Object.freeze({}),
      identityDigest: "b".repeat(64),
      authority: Object.freeze({}),
      env: { PATH: "trusted" },
      workingDirectory: "C:\\capsule",
      sandboxExecutionContract: contract,
    }));
    _deps.prepareMcpStdioExecutableIdentity = prepare;
    const client = new MCPClient({
      workspaceBinding: registerHostHooksV2Workspace(process.cwd()),
    });

    await client.connect("strict-materialized-package", {
      command: "npx",
      args: ["server@1.0.0"],
      origin: "mcp:configured",
      sandboxPolicy: {
        requiredBoundaries: ["network"],
      },
    });

    expect(_deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      ["C:\\capsule\\server.cjs", "--stdio"],
      expect.objectContaining({
        requiredBoundaries: MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
        sandboxExecutionContract: contract,
      }),
    );
    const launchOptions = _deps.spawn.mock.calls[0][2];
    const connection = client.servers.get("strict-materialized-package");
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          sandboxPolicy: { requiredBoundaries: ["network"] },
        }),
      }),
    );
    expect(connection.config.sandboxPolicy).toEqual({
      requiredBoundaries: ["network"],
    });
    expect(
      new Set([
        ...launchOptions.requiredBoundaries,
        ...launchOptions.sandboxPolicy.requiredBoundaries,
      ]),
    ).toEqual(new Set(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES));
    if (!["darwin", "linux", "win32"].includes(process.platform)) {
      expect(launchOptions.detached).toBe(true);
      expect(connection._stdioTreeMode).toBe("posix-group");
    } else {
      expect(launchOptions.detached).toBe(false);
      expect(connection._stdioTreeMode).toBe("sandbox");
    }
    await client.disconnectAll();
  });

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
    const launchOptions = _deps.spawn.mock.calls[0][2];
    expect(launchOptions.requiredBoundaries || []).not.toContain(
      "code-snapshot",
    );
    expect(launchOptions.sandboxPolicy.requiredBoundaries).toEqual([
      "filesystem",
      "network",
    ]);
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

  it("binds public strict policy and cwd to the host workspace before identity preparation", async () => {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-client-workspace-")),
    );
    const nested = path.join(root, "packages", "server");
    fs.mkdirSync(nested, { recursive: true });
    const workspaceBinding = registerHostHooksV2Workspace(root);
    const proc = makeFakeMcpProcess();
    _deps.spawn = vi.fn(() => proc);
    const prepare = vi.fn(({ config, cwd }) => ({
      command: config.command,
      args: config.args || [],
      identity: null,
      authority: Object.freeze({}),
      workingDirectory: cwd,
    }));
    _deps.prepareMcpStdioExecutableIdentity = prepare;
    vi.spyOn(
      executionBroker,
      "issueLinuxWorkspaceSandboxExecutionContract",
    ).mockReturnValue(Object.freeze({ kind: "test-workspace-contract" }));
    const client = new MCPClient({ workspaceBinding });

    try {
      await client.connect("strict-public", {
        command: "strict-mcp",
        cwd: path.join("packages", "server"),
        configScope: "managed",
        sandboxPolicy: {
          requiredBoundaries: ["network", "filesystem", "network"],
        },
      });

      expect(prepare).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: fs.realpathSync.native(nested) }),
      );
      expect(_deps.spawn).toHaveBeenCalledWith(
        "strict-mcp",
        [],
        expect.objectContaining({
          cwd: fs.realpathSync.native(nested),
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
        }),
      );
      expect(Object.isFrozen(_deps.spawn.mock.calls[0][2].sandboxPolicy)).toBe(
        true,
      );
    } finally {
      await client.disconnectAll();
      releaseRegisteredHostHooksV2Workspace(workspaceBinding.bindingId);
      fs.rmSync(root, { recursive: true, force: true });
    }
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
