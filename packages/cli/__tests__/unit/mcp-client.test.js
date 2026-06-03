import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  MCPClient,
  MCPServerConfig,
  ServerState,
  inferTransport,
  isHttpTransport,
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

  // ─── URL / HTTP transport support ─────────────────────────────

  describe("inferTransport", () => {
    it("returns explicit transport verbatim (lowercased)", () => {
      expect(inferTransport({ transport: "HTTP" })).toBe("http");
      expect(inferTransport({ transport: "stdio" })).toBe("stdio");
    });

    it("derives http from http:// url", () => {
      expect(inferTransport({ url: "http://example.com/mcp" })).toBe("http");
    });

    it("derives https from https:// url", () => {
      expect(inferTransport({ url: "https://example.com/mcp" })).toBe("https");
    });

    it("derives ws / wss from websocket URLs", () => {
      expect(inferTransport({ url: "ws://example.com/mcp" })).toBe("ws");
      expect(inferTransport({ url: "wss://example.com/mcp" })).toBe("wss");
    });

    it("falls back to stdio when neither transport nor url given", () => {
      expect(inferTransport({ command: "node" })).toBe("stdio");
      expect(inferTransport({})).toBe("stdio");
      expect(inferTransport(null)).toBe("stdio");
    });

    it("ignores malformed URLs and falls back to stdio", () => {
      expect(inferTransport({ url: "not a url" })).toBe("stdio");
    });
  });

  describe("isHttpTransport", () => {
    it("accepts http, https, sse", () => {
      expect(isHttpTransport("http")).toBe(true);
      expect(isHttpTransport("https")).toBe(true);
      expect(isHttpTransport("sse")).toBe(true);
    });
    it("rejects stdio and websocket", () => {
      expect(isHttpTransport("stdio")).toBe(false);
      expect(isHttpTransport("ws")).toBe(false);
      expect(isHttpTransport("wss")).toBe(false);
    });
  });

  describe("MCPServerConfig (url transport)", () => {
    let db;
    let config;

    beforeEach(() => {
      db = new MockDatabase();
      config = new MCPServerConfig(db);
    });

    it("stores a URL-based server with inferred transport", () => {
      config.add("github-remote", {
        url: "https://api.githubcopilot.com/mcp",
      });
      const s = config.get("github-remote");
      expect(s.url).toBe("https://api.githubcopilot.com/mcp");
      expect(s.transport).toBe("https");
      expect(s.command).toBeNull();
    });

    it("honors explicit transport field", () => {
      config.add("s1", { url: "https://example.com/mcp", transport: "sse" });
      expect(config.get("s1").transport).toBe("sse");
    });

    it("stores a stdio server with transport='stdio' default", () => {
      config.add("local", { command: "npx", args: ["-y", "foo"] });
      const s = config.get("local");
      expect(s.transport).toBe("stdio");
      expect(s.url).toBeNull();
    });

    it("rejects config with neither command nor url", () => {
      expect(() => config.add("bad", {})).toThrow(/command or url/i);
    });

    it("round-trips url + transport through list()", () => {
      config.add("a", { url: "http://localhost:3000/mcp" });
      config.add("b", { command: "node", args: ["./server.js"] });
      const all = config.list();
      expect(all).toHaveLength(2);
      const byName = Object.fromEntries(all.map((s) => [s.name, s]));
      expect(byName.a.url).toBe("http://localhost:3000/mcp");
      expect(byName.a.transport).toBe("http");
      expect(byName.b.transport).toBe("stdio");
    });

    it("round-trips url + transport through getAutoConnect()", () => {
      config.add("auto", {
        url: "https://x.example/mcp",
        autoConnect: true,
      });
      const [s] = config.getAutoConnect();
      expect(s.url).toBe("https://x.example/mcp");
      expect(s.transport).toBe("https");
    });
  });

  // ─── HTTP transport (fetch-mocked) ────────────────────────────

  describe("MCPClient HTTP transport", () => {
    let client;
    let calls;
    let fetchQueue;

    // Helper: create a Response-like object returned by our mocked fetch.
    function makeResponse({
      ok = true,
      status = 200,
      contentType = "application/json",
      body = "",
      sessionId = null,
    } = {}) {
      const headers = new Map();
      headers.set("content-type", contentType);
      if (sessionId) headers.set("mcp-session-id", sessionId);
      return {
        ok,
        status,
        headers: {
          get: (k) => headers.get(String(k).toLowerCase()) ?? null,
        },
        async text() {
          return body;
        },
        async json() {
          return JSON.parse(body);
        },
      };
    }

    beforeEach(async () => {
      const mod = await import("../../src/lib/mcp-client.js");
      client = new MCPClient();
      calls = [];
      fetchQueue = [];
      mod._deps.fetch = async (url, opts) => {
        calls.push({ url, opts });
        if (fetchQueue.length === 0) {
          throw new Error(`unexpected fetch to ${url}`);
        }
        return fetchQueue.shift();
      };
    });

    it("connects over HTTPS, issues initialize, and captures session id", async () => {
      // Queue: initialize response, initialized notification, tools/list, resources/list
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              serverInfo: { name: "remote", version: "1" },
              capabilities: {},
            },
          }),
          sessionId: "sess-abc",
        }),
      );
      // notifications/initialized — fire-and-forget, still resolved
      fetchQueue.push(makeResponse({ body: "" }));
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "hello" }] },
          }),
        }),
      );
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: { resources: [] },
          }),
        }),
      );

      const result = await client.connect("remote", {
        url: "https://api.example.com/mcp",
      });
      expect(result.tools).toEqual([{ name: "hello" }]);
      // First POST goes to the configured URL with JSON-RPC body.
      expect(calls[0].url).toBe("https://api.example.com/mcp");
      expect(calls[0].opts.method).toBe("POST");
      const body = JSON.parse(calls[0].opts.body);
      expect(body.method).toBe("initialize");
      // Session id propagates to subsequent calls.
      const toolsCall = calls.find((c) => {
        const b = JSON.parse(c.opts.body);
        return b.method === "tools/list";
      });
      expect(toolsCall.opts.headers["Mcp-Session-Id"]).toBe("sess-abc");
    });

    it("parses a text/event-stream response for a matching id", async () => {
      const sseBody = [
        ":keep-alive",
        "",
        'data: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"sse"}}}',
        "",
        "",
      ].join("\n");
      fetchQueue.push(
        makeResponse({
          contentType: "text/event-stream",
          body: sseBody,
          sessionId: "sess-sse",
        }),
      );
      // initialized notification + tools/list + resources/list
      fetchQueue.push(makeResponse({ body: "" }));
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [] },
          }),
        }),
      );
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: { resources: [] },
          }),
        }),
      );

      const result = await client.connect("sse-srv", {
        url: "https://sse.example.com/mcp",
        transport: "sse",
      });
      expect(result.serverInfo).toEqual({ name: "sse" });
    });

    it("throws a readable error on HTTP non-2xx response", async () => {
      fetchQueue.push(
        makeResponse({ ok: false, status: 401, body: "Unauthorized" }),
      );
      await expect(
        client.connect("auth", { url: "https://auth.example.com/mcp" }),
      ).rejects.toThrow(/401/);
      // Failed connect cleans up the entry.
      expect(client.servers.has("auth")).toBe(false);
    });

    it("throws on JSON-RPC error envelope", async () => {
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32000, message: "boom" },
          }),
        }),
      );
      await expect(
        client.connect("err", { url: "https://err.example.com/mcp" }),
      ).rejects.toThrow(/boom/);
    });

    it("rejects HTTP config that is missing a URL", async () => {
      await expect(
        client.connect("no-url", { transport: "http" }),
      ).rejects.toThrow(/requires a url/i);
    });

    it("rejects stdio config that is missing a command", async () => {
      await expect(
        client.connect("no-cmd", { transport: "stdio" }),
      ).rejects.toThrow(/requires a command/i);
    });

    it("rejects unsupported transport kinds", async () => {
      await expect(
        client.connect("bad", { transport: "grpc", url: "grpc://x" }),
      ).rejects.toThrow(/not supported/i);
    });

    it("disconnect issues a best-effort DELETE with session id", async () => {
      // connect
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
          sessionId: "sess-del",
        }),
      );
      fetchQueue.push(makeResponse({ body: "" })); // initialized
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [] },
          }),
        }),
      );
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: { resources: [] },
          }),
        }),
      );
      await client.connect("d", { url: "https://d.example.com/mcp" });

      // disconnect → DELETE expected
      fetchQueue.push(makeResponse({ body: "" }));
      const ok = await client.disconnect("d");
      expect(ok).toBe(true);
      const deleteCall = calls[calls.length - 1];
      expect(deleteCall.opts.method).toBe("DELETE");
      expect(deleteCall.opts.headers["Mcp-Session-Id"]).toBe("sess-del");
    });

    it("callTool on an HTTP server returns the result payload", async () => {
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
          sessionId: "s-call",
        }),
      );
      fetchQueue.push(makeResponse({ body: "" }));
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "echo" }] },
          }),
        }),
      );
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: { resources: [] },
          }),
        }),
      );
      await client.connect("srv", { url: "https://srv.example.com/mcp" });

      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            result: { content: [{ type: "text", text: "pong" }] },
          }),
        }),
      );
      const res = await client.callTool("srv", "echo", { msg: "ping" });
      expect(res.content[0].text).toBe("pong");
    });

    it("forwards custom headers on every request", async () => {
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
        }),
      );
      fetchQueue.push(makeResponse({ body: "" }));
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [] },
          }),
        }),
      );
      fetchQueue.push(
        makeResponse({
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: { resources: [] },
          }),
        }),
      );
      await client.connect("hdr", {
        url: "https://h.example.com/mcp",
        headers: { Authorization: "Bearer xyz" },
      });
      for (const call of calls) {
        expect(call.opts.headers.Authorization).toBe("Bearer xyz");
      }
    });
  });
});
