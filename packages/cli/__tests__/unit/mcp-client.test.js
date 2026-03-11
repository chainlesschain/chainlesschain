import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  MCPClient,
  MCPServerConfig,
  ServerState,
} from "../../src/lib/mcp-client.js";

describe("MCP Client", () => {
  // ─── MCPClient core ───────────────────────────────────────────

  describe("MCPClient", () => {
    let client;

    beforeEach(() => {
      client = new MCPClient();
    });

    it("should initialize with empty servers", () => {
      expect(client.listServers()).toHaveLength(0);
    });

    it("should list no tools when no servers connected", () => {
      expect(client.listTools()).toHaveLength(0);
    });

    it("should throw when listing tools for unknown server", () => {
      expect(() => client.listTools("unknown")).toThrow("not found");
    });

    it("should return false when disconnecting unknown server", async () => {
      const result = await client.disconnect("unknown");
      expect(result).toBe(false);
    });

    it("should throw when calling tool on unknown server", async () => {
      await expect(client.callTool("unknown", "tool")).rejects.toThrow(
        "not found",
      );
    });

    it("should throw when connecting duplicate server", async () => {
      // Manually add a server entry
      client.servers.set("test", { state: ServerState.CONNECTED });
      await expect(client.connect("test", { command: "echo" })).rejects.toThrow(
        "already connected",
      );
    });

    it("should have correct ServerState values", () => {
      expect(ServerState.DISCONNECTED).toBe("disconnected");
      expect(ServerState.CONNECTING).toBe("connecting");
      expect(ServerState.CONNECTED).toBe("connected");
      expect(ServerState.ERROR).toBe("error");
    });

    it("should emit events", () => {
      const events = [];
      client.on("notification", (data) => events.push(data));
      client.emit("notification", { server: "test", method: "test" });
      expect(events).toHaveLength(1);
    });

    it("should disconnect all servers", async () => {
      client.servers.set("s1", {
        state: ServerState.CONNECTED,
        process: { kill: () => {} },
      });
      client.servers.set("s2", {
        state: ServerState.CONNECTED,
        process: { kill: () => {} },
      });
      await client.disconnectAll();
      expect(client.servers.size).toBe(0);
    });

    it("should handle _handleMessage for response", () => {
      client.servers.set("test", {
        state: ServerState.CONNECTED,
        _pending: new Map(),
      });

      let resolved = null;
      client.servers.get("test")._pending.set(1, {
        resolve: (v) => {
          resolved = v;
        },
        reject: () => {},
        timeout: null,
      });

      client._handleMessage("test", { id: 1, result: { tools: [] } });
      expect(resolved).toEqual({ tools: [] });
    });

    it("should handle _handleMessage for error response", () => {
      client.servers.set("test", {
        state: ServerState.CONNECTED,
        _pending: new Map(),
      });

      let rejected = null;
      client.servers.get("test")._pending.set(2, {
        resolve: () => {},
        reject: (e) => {
          rejected = e;
        },
        timeout: null,
      });

      client._handleMessage("test", { id: 2, error: { message: "Not found" } });
      expect(rejected).toBeTruthy();
      expect(rejected.message).toBe("Not found");
    });

    it("should handle _handleMessage for notifications", () => {
      client.servers.set("test", {
        state: ServerState.CONNECTED,
        _pending: new Map(),
      });

      const notifications = [];
      client.on("notification", (n) => notifications.push(n));

      client._handleMessage("test", { method: "tools/changed", params: {} });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].method).toBe("tools/changed");
    });

    it("should parse JSON lines in _handleData", () => {
      client.servers.set("test", {
        state: ServerState.CONNECTED,
        _pending: new Map(),
        _buffer: "",
      });

      let resolved = null;
      client.servers.get("test")._pending.set(1, {
        resolve: (v) => {
          resolved = v;
        },
        reject: () => {},
        timeout: null,
      });

      client._handleData("test", '{"jsonrpc":"2.0","id":1,"result":"ok"}\n');
      expect(resolved).toBe("ok");
    });

    it("should buffer incomplete JSON lines", () => {
      client.servers.set("test", {
        state: ServerState.CONNECTED,
        _pending: new Map(),
        _buffer: "",
      });

      client._handleData("test", '{"incomplete":');
      expect(client.servers.get("test")._buffer).toBe('{"incomplete":');
    });
  });

  // ─── MCPServerConfig ──────────────────────────────────────────

  describe("MCPServerConfig", () => {
    let db;
    let config;

    beforeEach(() => {
      db = new MockDatabase();
      config = new MCPServerConfig(db);
    });

    it("should create mcp_servers table", () => {
      expect(db.tables.has("mcp_servers")).toBe(true);
    });

    it("should add a server config", () => {
      config.add("filesystem", {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        autoConnect: true,
      });

      const server = config.get("filesystem");
      expect(server).toBeTruthy();
      expect(server.name).toBe("filesystem");
      expect(server.command).toBe("npx");
      expect(server.args).toEqual([
        "-y",
        "@modelcontextprotocol/server-filesystem",
      ]);
      expect(server.autoConnect).toBe(true);
    });

    it("should list all servers", () => {
      config.add("s1", { command: "cmd1" });
      config.add("s2", { command: "cmd2" });

      const servers = config.list();
      expect(servers).toHaveLength(2);
    });

    it("should remove a server", () => {
      config.add("test", { command: "echo" });
      const removed = config.remove("test");
      expect(removed).toBe(true);
      expect(config.get("test")).toBeNull();
    });

    it("should return false when removing non-existent server", () => {
      expect(config.remove("nonexistent")).toBe(false);
    });

    it("should return null for unknown server", () => {
      expect(config.get("unknown")).toBeNull();
    });

    it("should get auto-connect servers", () => {
      config.add("auto1", { command: "cmd1", autoConnect: true });
      config.add("manual1", { command: "cmd2", autoConnect: false });

      const autoServers = config.getAutoConnect();
      expect(autoServers).toHaveLength(1);
      expect(autoServers[0].name).toBe("auto1");
    });

    it("should update existing server config", () => {
      config.add("test", { command: "old-cmd" });
      config.add("test", { command: "new-cmd", args: ["--new"] });

      const server = config.get("test");
      expect(server.command).toBe("new-cmd");
      expect(server.args).toEqual(["--new"]);
    });

    it("should handle server config with env", () => {
      config.add("test", {
        command: "node",
        env: { API_KEY: "secret" },
      });

      const server = config.get("test");
      expect(server.env).toEqual({ API_KEY: "secret" });
    });

    it("should default autoConnect to false", () => {
      config.add("test", { command: "node" });
      const server = config.get("test");
      expect(server.autoConnect).toBe(false);
    });

    it("should default args to empty array", () => {
      config.add("test", { command: "node" });
      const server = config.get("test");
      expect(server.args).toEqual([]);
    });

    it("should default env to empty object", () => {
      config.add("test", { command: "node" });
      const server = config.get("test");
      expect(server.env).toEqual({});
    });

    it("should return empty list when no servers", () => {
      expect(config.list()).toHaveLength(0);
    });

    it("should return empty auto-connect list when none configured", () => {
      config.add("manual", { command: "echo", autoConnect: false });
      expect(config.getAutoConnect()).toHaveLength(0);
    });
  });
});
