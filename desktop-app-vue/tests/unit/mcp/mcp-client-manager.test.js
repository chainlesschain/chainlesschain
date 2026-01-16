/**
 * MCP Client Manager Unit Tests
 *
 * Tests for server connection, tool management, and performance tracking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    listResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ text: "result" }] }),
    readResource: vi
      .fn()
      .mockResolvedValue({ contents: [{ text: "content" }] }),
    setNotificationHandler: vi.fn(),
    setLoggingHandler: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the HTTP+SSE transport
vi.mock("../../../src/main/mcp/transports/http-sse-transport", () => ({
  HttpSseTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ tools: [] }),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

// Import after mocking
const MCPClientManager = require("../../../src/main/mcp/mcp-client-manager");

describe("MCPClientManager", () => {
  let manager;

  beforeEach(() => {
    manager = new MCPClientManager({});
  });

  afterEach(async () => {
    if (manager) {
      await manager.shutdown();
    }
    manager = null;
    vi.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.servers).toBeDefined();
      expect(manager.servers instanceof Map).toBe(true);
      expect(manager.metrics).toBeDefined();
      expect(manager.metrics.totalCalls).toBe(0);
    });

    it("should accept configuration", () => {
      const customManager = new MCPClientManager({ customOption: true });
      expect(customManager.config.customOption).toBe(true);
    });
  });

  describe("Server Connection", () => {
    it("should connect to a stdio server", async () => {
      const serverConfig = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
        transport: "stdio",
      };

      const capabilities = await manager.connectServer(
        "filesystem",
        serverConfig,
      );

      expect(capabilities).toBeDefined();
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
    });

    it("should store server info after connection", async () => {
      const serverConfig = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      };

      await manager.connectServer("filesystem", serverConfig);

      const serverInfo = manager.getServerInfo("filesystem");
      expect(serverInfo.state).toBe("connected");
      expect(serverInfo.name).toBe("filesystem");
    });

    it("should track connection time", async () => {
      const serverConfig = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      };

      await manager.connectServer("filesystem", serverConfig);

      const connectionTime = manager.metrics.connectionTimes.get("filesystem");
      expect(connectionTime).toBeDefined();
      expect(typeof connectionTime).toBe("number");
    });

    it("should emit server-connected event", async () => {
      const serverConfig = {
        command: "npx",
        args: [],
      };

      const eventPromise = new Promise((resolve) => {
        manager.once("server-connected", resolve);
      });

      await manager.connectServer("test-server", serverConfig);

      const event = await eventPromise;
      expect(event.serverName).toBe("test-server");
      expect(event.capabilities).toBeDefined();
    });

    it("should return existing connection if already connected", async () => {
      const serverConfig = {
        command: "npx",
        args: [],
      };

      await manager.connectServer("test-server", serverConfig);
      const secondResult = await manager.connectServer(
        "test-server",
        serverConfig,
      );

      // Should return capabilities from existing connection
      expect(secondResult.tools).toBeDefined();
    });
  });

  describe("Server Disconnection", () => {
    it("should disconnect from a server", async () => {
      const serverConfig = {
        command: "npx",
        args: [],
      };

      await manager.connectServer("test-server", serverConfig);
      await manager.disconnectServer("test-server");

      expect(manager.servers.has("test-server")).toBe(false);
    });

    it("should emit server-disconnected event", async () => {
      const serverConfig = {
        command: "npx",
        args: [],
      };

      await manager.connectServer("test-server", serverConfig);

      const eventPromise = new Promise((resolve) => {
        manager.once("server-disconnected", resolve);
      });

      await manager.disconnectServer("test-server");

      const event = await eventPromise;
      expect(event.serverName).toBe("test-server");
    });

    it("should handle disconnecting non-existent server", async () => {
      // Should not throw
      await manager.disconnectServer("non-existent");
    });
  });

  describe("Tool Operations", () => {
    beforeEach(async () => {
      await manager.connectServer("test-server", { command: "npx", args: [] });
    });

    it("should list tools from a server", async () => {
      const tools = await manager.listTools("test-server");
      expect(Array.isArray(tools)).toBe(true);
    });

    it("should call a tool", async () => {
      const result = await manager.callTool("test-server", "read_file", {
        path: "/test.txt",
      });

      expect(result).toBeDefined();
    });

    it("should track tool call metrics", async () => {
      await manager.callTool("test-server", "read_file", { path: "/test.txt" });

      expect(manager.metrics.totalCalls).toBe(1);
      expect(manager.metrics.successfulCalls).toBe(1);
    });

    it("should track tool call latency", async () => {
      await manager.callTool("test-server", "read_file", { path: "/test.txt" });

      const latencies = manager.metrics.toolCallLatencies.get("read_file");
      expect(latencies).toBeDefined();
      expect(latencies.length).toBe(1);
    });

    it("should emit tool-called event", async () => {
      const eventPromise = new Promise((resolve) => {
        manager.once("tool-called", resolve);
      });

      await manager.callTool("test-server", "read_file", { path: "/test.txt" });

      const event = await eventPromise;
      expect(event.serverName).toBe("test-server");
      expect(event.toolName).toBe("read_file");
      expect(event.latency).toBeDefined();
    });

    it("should throw error for disconnected server", async () => {
      await manager.disconnectServer("test-server");

      await expect(
        manager.callTool("test-server", "read_file", {}),
      ).rejects.toThrow("Server not found");
    });
  });

  describe("Resource Operations", () => {
    beforeEach(async () => {
      await manager.connectServer("test-server", { command: "npx", args: [] });
    });

    it("should list resources from a server", async () => {
      const resources = await manager.listResources("test-server");
      expect(Array.isArray(resources)).toBe(true);
    });

    it("should read a resource", async () => {
      const result = await manager.readResource(
        "test-server",
        "file:///test.txt",
      );
      expect(result).toBeDefined();
    });
  });

  describe("Connected Servers", () => {
    it("should return list of connected servers", async () => {
      await manager.connectServer("server1", { command: "npx", args: [] });
      await manager.connectServer("server2", { command: "npx", args: [] });

      const connected = manager.getConnectedServers();

      expect(connected).toContain("server1");
      expect(connected).toContain("server2");
      expect(connected.length).toBe(2);
    });

    it("should not include disconnected servers", async () => {
      await manager.connectServer("server1", { command: "npx", args: [] });
      await manager.connectServer("server2", { command: "npx", args: [] });
      await manager.disconnectServer("server1");

      const connected = manager.getConnectedServers();

      expect(connected).not.toContain("server1");
      expect(connected).toContain("server2");
    });
  });

  describe("Metrics", () => {
    beforeEach(async () => {
      await manager.connectServer("test-server", { command: "npx", args: [] });
    });

    it("should return metrics", () => {
      const metrics = manager.getMetrics();

      expect(metrics.totalCalls).toBeDefined();
      expect(metrics.successfulCalls).toBeDefined();
      expect(metrics.failedCalls).toBeDefined();
      expect(metrics.successRate).toBeDefined();
      expect(metrics.connectionTimes).toBeDefined();
      expect(metrics.toolLatencies).toBeDefined();
    });

    it("should calculate success rate", async () => {
      await manager.callTool("test-server", "tool1", {});
      await manager.callTool("test-server", "tool2", {});

      const metrics = manager.getMetrics();

      expect(metrics.successRate).toBe("100.00%");
    });

    it("should calculate average latency", async () => {
      await manager.callTool("test-server", "read_file", {});
      await manager.callTool("test-server", "read_file", {});

      const metrics = manager.getMetrics();
      const latency = metrics.toolLatencies["read_file"];

      expect(latency).toBeDefined();
      expect(latency.count).toBe(2);
      expect(parseFloat(latency.avg)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Shutdown", () => {
    it("should disconnect all servers on shutdown", async () => {
      await manager.connectServer("server1", { command: "npx", args: [] });
      await manager.connectServer("server2", { command: "npx", args: [] });

      await manager.shutdown();

      expect(manager.servers.size).toBe(0);
    });

    it("should handle errors during shutdown gracefully", async () => {
      await manager.connectServer("server1", { command: "npx", args: [] });

      // Should not throw even if disconnect fails
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe("Transport Types", () => {
    it("should expose transport types", () => {
      expect(MCPClientManager.TRANSPORT_TYPES).toBeDefined();
      expect(MCPClientManager.TRANSPORT_TYPES.STDIO).toBe("stdio");
      expect(MCPClientManager.TRANSPORT_TYPES.HTTP_SSE).toBe("http-sse");
    });

    it("should identify remote servers", async () => {
      await manager.connectServer("local-server", {
        command: "npx",
        args: [],
        transport: "stdio",
      });

      expect(manager.isRemoteServer("local-server")).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for unknown server on getServerInfo", () => {
      expect(() => manager.getServerInfo("unknown")).toThrow(
        "Server not found",
      );
    });

    it("should track error counts", async () => {
      // Mock a failing client
      const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
      Client.mockImplementationOnce(() => ({
        connect: vi.fn().mockRejectedValue(new Error("Connection failed")),
        setNotificationHandler: vi.fn(),
        setLoggingHandler: vi.fn(),
      }));

      try {
        await manager.connectServer("failing-server", {
          command: "npx",
          args: [],
        });
      } catch (e) {
        // Expected
      }

      expect(manager.metrics.errorCounts.get("failing-server")).toBe(1);
    });

    it("should emit server-error event on connection failure", async () => {
      const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
      Client.mockImplementationOnce(() => ({
        connect: vi.fn().mockRejectedValue(new Error("Connection failed")),
        setNotificationHandler: vi.fn(),
        setLoggingHandler: vi.fn(),
      }));

      const eventPromise = new Promise((resolve) => {
        manager.once("server-error", resolve);
      });

      try {
        await manager.connectServer("failing-server", {
          command: "npx",
          args: [],
        });
      } catch (e) {
        // Expected
      }

      const event = await eventPromise;
      expect(event.serverName).toBe("failing-server");
      expect(event.error).toBeDefined();
    });
  });
});
