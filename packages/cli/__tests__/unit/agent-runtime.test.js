import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("AgentRuntime MCP bootstrap", () => {
  let processOnSpy;
  let tempDirs;

  beforeEach(() => {
    vi.resetModules();
    tempDirs = [];
    processOnSpy = vi.spyOn(process, "on").mockReturnValue(process);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createWorkspace() {
    const workspace = mkdtempSync(
      path.join(os.tmpdir(), "cc-agent-runtime-mcp-"),
    );
    tempDirs.push(workspace);
    return workspace;
  }

  it("returns null when MCP bootstrap has no database", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");

    const createMcpClient = vi.fn();
    const createMcpServerConfig = vi.fn();
    const runtime = new AgentRuntime({
      kind: "server",
      policy: {},
      deps: {
        createMcpClient,
        createMcpServerConfig,
      },
    });

    await expect(
      runtime._initializeCodingAgentMcpClient(null),
    ).resolves.toBeNull();
    expect(createMcpClient).not.toHaveBeenCalled();
    expect(createMcpServerConfig).not.toHaveBeenCalled();
  }, 15_000);

  it("auto-connects only trusted allowlisted MCP servers", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");

    const db = { name: "raw-db" };
    const mcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const createMcpServerConfig = vi.fn().mockReturnValue({
      getAutoConnect: vi.fn(() => [
        { name: "weather", command: "node", args: ["weather.js"] },
        { name: "filesystem", command: "node", args: ["fs.js"] },
      ]),
    });

    const runtime = new AgentRuntime({
      kind: "server",
      policy: {},
      deps: {
        createMcpClient: vi.fn(() => mcpClient),
        createMcpServerConfig,
        mcpServerRegistry: {
          trustedServers: [
            { id: "weather", securityLevel: "low" },
            { id: "filesystem", securityLevel: "low" },
          ],
        },
      },
    });

    const result = await runtime._initializeCodingAgentMcpClient(db);

    expect(createMcpServerConfig).toHaveBeenCalledWith(db);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect).toHaveBeenCalledWith(
      "weather",
      expect.objectContaining({
        name: "weather",
        command: "node",
      }),
    );
    expect(result).toBe(mcpClient);
  });

  it("binds policy-bearing registered stdio servers to the selected project without ambient workspace storage", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const { MCPClient } = await import("../../src/harness/mcp-client.js");
    const { resolveHostHooksV2WorkspaceBinding } =
      await import("../../src/lib/hooks-v2-workspace-context.js");
    const {
      consumeMcpStdioExecutionAuthority,
      materializeApprovedMcpStdioInvocation,
      verifyMcpStdioApprovedWorkingDirectory,
    } = await import("../../src/lib/mcp-stdio-execution-authority.js");
    const { resolveMcpStdioSandboxContext } =
      await import("../../src/lib/mcp-stdio-workspace-authority.js");

    const workspace = createWorkspace();
    const serverCwd = `registered-${Date.now()}`;
    mkdirSync(path.join(workspace, serverCwd));
    const db = { name: "raw-db" };
    const connectSpy = vi
      .spyOn(MCPClient.prototype, "connect")
      .mockResolvedValue(undefined);
    const runtime = new AgentRuntime({
      kind: "server",
      policy: { project: workspace },
      deps: {
        createMcpServerConfig: vi.fn(() => ({
          getAutoConnect: vi.fn(() => [
            {
              name: "weather",
              command: "node",
              args: ["weather.js"],
              cwd: serverCwd,
              sandboxPolicy: { requiredBoundaries: ["filesystem"] },
            },
          ]),
        })),
      },
    });

    const mcpClient = await runtime._initializeCodingAgentMcpClient(db);

    expect(mcpClient).toBeInstanceOf(MCPClient);
    const clientOptions = {
      workspaceBinding: mcpClient._workspaceBinding,
      roots: mcpClient._roots,
    };
    const resolvedBinding = resolveHostHooksV2WorkspaceBinding(
      clientOptions.workspaceBinding,
    );
    const canonicalWorkspace = realpathSync.native(workspace);
    expect(resolvedBinding?.workspaceRoot).toBe(canonicalWorkspace);
    expect(clientOptions.roots).toEqual([canonicalWorkspace]);
    expect(connectSpy).toHaveBeenCalledWith(
      "weather",
      expect.objectContaining({
        cwd: serverCwd,
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        mcpStdioExecutionAuthority: expect.any(Object),
      }),
    );

    const connectedConfig = connectSpy.mock.calls[0][1];
    const approval = consumeMcpStdioExecutionAuthority(
      connectedConfig.mcpStdioExecutionAuthority,
      { serverName: "weather", config: connectedConfig },
    );
    const approvedInvocation = materializeApprovedMcpStdioInvocation(approval);
    const sourceConfig = { ...connectedConfig };
    delete sourceConfig.mcpStdioExecutionAuthority;
    const sandboxContext = resolveMcpStdioSandboxContext({
      serverName: "weather",
      config: { ...sourceConfig, ...approvedInvocation },
      workspaceBinding: clientOptions.workspaceBinding,
    });
    expect(sandboxContext.workingDirectory).toBe(
      realpathSync.native(path.join(workspace, serverCwd)),
    );
    expect(() =>
      verifyMcpStdioApprovedWorkingDirectory(
        approval,
        sandboxContext.workingDirectory,
      ),
    ).not.toThrow();
  });

  it.each(["local", "project"])(
    "selects the target project's %s MCP row ahead of a same-name user row",
    async (configScope) => {
      const { AgentRuntime } =
        await import("../../src/runtime/agent-runtime.js");
      const { MCPServerConfig } =
        await import("../../src/harness/mcp-client.js");
      const { MockDatabase } = await import("../helpers/mock-db.js");

      const workspace = realpathSync.native(createWorkspace());
      expect(path.resolve(process.cwd())).not.toBe(path.resolve(workspace));

      const configStore = new MCPServerConfig(new MockDatabase());
      configStore.add("weather", {
        command: "user-weather-command",
        autoConnect: true,
        configScope: "user",
      });
      configStore.add("weather", {
        command: `${configScope}-weather-command`,
        autoConnect: true,
        configScope,
        projectPath: workspace,
      });
      const getAutoConnect = vi.spyOn(configStore, "getAutoConnect");
      const mcpClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnectAll: vi.fn().mockResolvedValue(undefined),
      };
      const runtimeLogger = { log: vi.fn() };
      const runtime = new AgentRuntime({
        kind: "server",
        policy: { project: workspace },
        deps: {
          createMcpServerConfig: vi.fn(() => configStore),
          createMcpClient: vi.fn(() => mcpClient),
        },
      });

      await expect(
        runtime._initializeCodingAgentMcpClient(
          { name: "raw-db" },
          { logger: runtimeLogger },
        ),
      ).resolves.toBe(mcpClient);

      const visibility = getAutoConnect.mock.calls[0][0];
      expect(visibility.cwd).toBe(workspace);
      expect(visibility.onInvalidRow).toEqual(expect.any(Function));
      expect(mcpClient.connect).toHaveBeenCalledOnce();
      expect(mcpClient.connect).toHaveBeenCalledWith(
        "weather",
        expect.objectContaining({
          command: `${configScope}-weather-command`,
          configScope,
          projectPath: workspace,
        }),
      );
      expect(mcpClient.connect.mock.calls[0][1].command).not.toBe(
        "user-weather-command",
      );

      visibility.onInvalidRow(
        { code: "CC_MCP_SANDBOX_POLICY_INVALID" },
        { name: "bad\nrow" },
      );
      expect(runtimeLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'MCP server "bad row" was skipped: CC_MCP_SANDBOX_POLICY_INVALID',
        ),
      );
    },
  );

  it("disconnects the MCP client when every eligible auto-connect fails", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");

    const db = { name: "raw-db" };
    const mcpClient = {
      connect: vi.fn().mockRejectedValue(new Error("boom")),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { log: vi.fn() };

    const runtime = new AgentRuntime({
      kind: "server",
      policy: {},
      deps: {
        createMcpClient: vi.fn(() => mcpClient),
        createMcpServerConfig: vi.fn(() => ({
          getAutoConnect: vi.fn(() => [
            { name: "weather", command: "node", args: ["weather.js"] },
          ]),
        })),
        logger,
      },
    });

    const result = await runtime._initializeCodingAgentMcpClient(db, {
      logger,
    });

    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(mcpClient.disconnectAll).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('MCP server "weather" auto-connect failed'),
    );
    expect(result).toBeNull();
  });

  it("startServer injects the auto-connected MCP client into the session manager", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");

    const rawDb = { type: "sqlite" };
    const logger = { log: vi.fn() };
    const mcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const createSessionManager = vi.fn(() => ({ kind: "session-manager" }));
    const evolutionCompositionFactory = vi.fn();
    const server = {
      on: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = new AgentRuntime({
      kind: "server",
      policy: {
        port: 18800,
        host: "127.0.0.1",
        token: "secret",
        maxConnections: 8,
        timeout: 30000,
        allowRemote: false,
        project: process.cwd(),
      },
      deps: {
        bootstrap: vi.fn().mockResolvedValue({
          db: { getDatabase: () => rawDb },
        }),
        createMcpClient: vi.fn(() => mcpClient),
        createMcpServerConfig: vi.fn(() => ({
          getAutoConnect: vi.fn(() => [
            { name: "weather", command: "node", args: ["weather.js"] },
          ]),
        })),
        createSessionManager,
        createServer: vi.fn(() => server),
        evolutionCompositionFactory,
        logger,
      },
    });

    const result = await runtime.startServer();

    expect(createSessionManager).toHaveBeenCalledWith(
      expect.objectContaining({
        db: rawDb,
        defaultProjectRoot: process.cwd(),
        mcpClient,
        allowedMcpServerNames: ["weather"],
      }),
    );
    expect(runtime.deps.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 18800,
        host: "127.0.0.1",
        token: "secret",
        sessionManager: { kind: "session-manager" },
        evolutionCompositionFactory,
      }),
    );
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(result).toBe(server);
  });

  it("binds policy-bearing bundle MCP servers to the server project workspace", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");
    const { resolveHostHooksV2WorkspaceBinding } =
      await import("../../src/lib/hooks-v2-workspace-context.js");

    const workspace = createWorkspace();
    const serverCwd = `bundle-${Date.now()}`;
    mkdirSync(path.join(workspace, serverCwd));
    const logger = { log: vi.fn() };
    const mcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const createMcpClient = vi.fn(() => mcpClient);
    const createSessionManager = vi.fn(() => ({ kind: "session-manager" }));
    const server = {
      on: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const bundlePath = path.join(workspace, "agent-bundle");
    const runtime = new AgentRuntime({
      kind: "server",
      policy: {
        port: 18800,
        host: "127.0.0.1",
        maxConnections: 8,
        timeout: 30000,
        allowRemote: false,
        project: workspace,
        bundlePath,
      },
      deps: {
        bootstrap: vi.fn().mockResolvedValue({
          db: { getDatabase: () => null },
        }),
        createMcpClient,
        createSessionManager,
        createServer: vi.fn(() => server),
        loadConfig: vi.fn(() => ({})),
        loadAgentBundle: vi.fn(() => ({ source: "bundle" })),
        resolveAgentBundle: vi.fn(() => ({
          manifest: { id: "workspace-bundle" },
          mcpConfig: {
            servers: {
              bundled: {
                command: "node",
                args: ["bundle-server.js"],
                cwd: serverCwd,
                sandboxPolicy: { requiredBoundaries: ["filesystem"] },
              },
            },
          },
        })),
        logger,
      },
    });

    await expect(runtime.startServer()).resolves.toBe(server);

    const clientOptions = createMcpClient.mock.calls[0][0];
    const resolvedBinding = resolveHostHooksV2WorkspaceBinding(
      clientOptions.workspaceBinding,
    );
    const canonicalWorkspace = realpathSync.native(workspace);
    expect(resolvedBinding?.workspaceRoot).toBe(canonicalWorkspace);
    expect(clientOptions.roots).toEqual([canonicalWorkspace]);
    expect(mcpClient.connect).toHaveBeenCalledWith(
      "bundled",
      expect.objectContaining({
        cwd: serverCwd,
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        mcpStdioExecutionAuthority: expect.any(Object),
      }),
    );
    expect(createSessionManager).toHaveBeenCalledWith(
      expect.objectContaining({ mcpClient }),
    );
  });

  it("startUiServer injects the auto-connected MCP client into the UI session manager", async () => {
    const { AgentRuntime } = await import("../../src/runtime/agent-runtime.js");

    const rawDb = { type: "sqlite" };
    const logger = { log: vi.fn() };
    const mcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const createSessionManager = vi.fn(() => ({ kind: "ui-session-manager" }));
    const ptyManager = Object.assign(new EventEmitter(), {
      shutdown: vi.fn(),
    });
    const createPtyManager = vi.fn(() => ptyManager);
    const wsServer = Object.assign(new EventEmitter(), {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      port: 18800,
    });
    const httpServer = Object.assign(new EventEmitter(), {
      listen: vi.fn(function listenMock() {
        setImmediate(() => httpServer.emit("listening"));
      }),
      address: vi.fn(() => ({ port: 18810 })),
      close: vi.fn((cb) => cb && cb()),
    });

    const runtime = new AgentRuntime({
      kind: "ui",
      policy: {
        port: 18810,
        wsPort: 18800,
        host: "127.0.0.1",
        open: false,
        token: "secret",
        webPanelDir: "C:/panel",
      },
      deps: {
        bootstrap: vi.fn().mockResolvedValue({
          db: { getDb: () => rawDb },
        }),
        createMcpClient: vi.fn(() => mcpClient),
        createMcpServerConfig: vi.fn(() => ({
          getAutoConnect: vi.fn(() => [
            { name: "weather", command: "node", args: ["weather.js"] },
          ]),
        })),
        createSessionManager,
        createPtyManager,
        createServer: vi.fn(() => wsServer),
        createWebServer: vi.fn(() => httpServer),
        findProjectRoot: vi.fn(() => null),
        loadProjectConfig: vi.fn(() => null),
        loadConfig: vi.fn(() => ({ ui: true })),
        logger,
      },
    });

    const result = await runtime.startUiServer();

    expect(createSessionManager).toHaveBeenCalledWith(
      expect.objectContaining({
        db: rawDb,
        config: { ui: true },
        defaultProjectRoot: process.cwd(),
        mcpClient,
        allowedMcpServerNames: ["weather"],
      }),
    );
    expect(runtime.deps.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 18800,
        host: "127.0.0.1",
        token: "secret",
        sessionManager: { kind: "ui-session-manager" },
        projectRoot: process.cwd(),
      }),
    );
    expect(runtime.deps.createWebServer).toHaveBeenCalledWith(
      expect.objectContaining({
        wsPort: 18800,
        wsToken: "secret",
        wsHost: "127.0.0.1",
      }),
    );
    expect(createPtyManager).toHaveBeenCalledOnce();
    expect(createPtyManager.mock.calls[0][0]).toMatchObject({
      policyCwd: process.cwd(),
      resolveSandboxPolicy: expect.any(Function),
    });
    expect(result.uiUrl).toBe("http://127.0.0.1:18810");
  });
});
