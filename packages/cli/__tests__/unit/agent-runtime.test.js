import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("AgentRuntime MCP bootstrap", () => {
  let processOnSpy;

  beforeEach(() => {
    vi.resetModules();
    processOnSpy = vi.spyOn(process, "on").mockReturnValue(process);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

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
  });

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
        project: "C:/repo",
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
        logger,
      },
    });

    const result = await runtime.startServer();

    expect(createSessionManager).toHaveBeenCalledWith(
      expect.objectContaining({
        db: rawDb,
        defaultProjectRoot: "C:/repo",
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
      }),
    );
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(result).toBe(server);
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
    const wsServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const httpServer = {
      listen: vi.fn((port, host, cb) => cb()),
      on: vi.fn(),
      close: vi.fn((cb) => cb && cb()),
    };

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
      }),
    );
    expect(runtime.deps.createWebServer).toHaveBeenCalledWith(
      expect.objectContaining({
        wsPort: 18800,
        wsToken: "secret",
        wsHost: "127.0.0.1",
      }),
    );
    expect(result.uiUrl).toBe("http://127.0.0.1:18810");
  });
});
