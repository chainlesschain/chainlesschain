import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { MCPClient, _deps } from "../../src/harness/mcp-client.js";

const originalDeps = { ..._deps };
const clients = [];
const servers = [];

function resultFor(method, callResult = { content: [] }) {
  return {
    initialize: {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "fixture", version: "1" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
    "tools/list": { tools: [{ name: "echo", inputSchema: {} }] },
    "resources/list": { resources: [] },
    "resources/templates/list": { resourceTemplates: [] },
    "prompts/list": { prompts: [] },
    "tools/call": callResult,
  }[method];
}

function response(message, { status = 200, result, text = "" } = {}) {
  const body =
    status >= 400
      ? text
      : JSON.stringify({
          jsonrpc: "2.0",
          id: message?.id,
          result: result ?? resultFor(message?.method),
        });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === "content-type") return "application/json";
        if (key === "mcp-session-id") return "helper-session";
        return null;
      },
    },
    text: vi.fn(async () => body),
  };
}

function helperConfig(overrides = {}) {
  return {
    url: "https://mcp.example.test/rpc",
    transport: "https",
    headers: { Authorization: "Bearer static", "X-Static": "yes" },
    headersHelper: "get-mcp-headers",
    configScope: "user",
    ...overrides,
  };
}

beforeEach(() => {
  _deps.resolveMcpHeadersHelperContext = vi.fn(() => ({
    cwd: process.cwd(),
    pluginRoot: null,
  }));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.disconnectAll()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  Object.assign(_deps, originalDeps);
});

describe("MCPClient headersHelper transport lifecycle", () => {
  it("runs at initial HTTP connection and overrides static headers case-insensitively", async () => {
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      authorization: "Bearer dynamic",
      "X-Dynamic": "yes",
    }));
    const calls = [];
    _deps.fetch = vi.fn(async (_url, options) => {
      calls.push(options);
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);

    await client.connect("remote", helperConfig());
    await client.callTool("remote", "echo", {});

    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(1);
    for (const options of calls.filter((call) => call.method === "POST")) {
      expect(options.headers.authorization).toBe("Bearer dynamic");
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.headers["X-Static"]).toBe("yes");
      expect(options.headers["X-Dynamic"]).toBe("yes");
    }
  });

  it("refreshes once on a tool 401 and retries the operation exactly once", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    const toolHeaders = [];
    let toolCalls = 0;
    let rejectedBodyRead = null;
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      if (message.method === "tools/call") {
        toolHeaders.push(options.headers.Authorization);
        toolCalls += 1;
        if (toolCalls === 1) {
          const rejected = response(message, {
            status: 401,
            text: "Bearer must-never-be-read",
          });
          rejectedBodyRead = rejected.text;
          return rejected;
        }
      }
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);
    await client.connect("remote", helperConfig());

    await expect(client.callTool("remote", "echo", {})).resolves.toEqual({
      content: [],
    });
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(2);
    expect(toolHeaders).toEqual(["Bearer dynamic-1", "Bearer dynamic-2"]);
    expect(rejectedBodyRead).not.toHaveBeenCalled();
  });

  it("never reads a non-auth error body that could echo helper credentials", async () => {
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: "Bearer dynamic-secret",
    }));
    let rejectedBodyRead;
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      if (message.method === "tools/call") {
        const rejected = response(message, {
          status: 400,
          text: "debug: Bearer dynamic-secret",
        });
        rejectedBodyRead = rejected.text;
        return rejected;
      }
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);
    await client.connect("remote", helperConfig());

    const error = await client
      .callTool("remote", "echo", {})
      .catch((cause) => cause);
    expect(error).toMatchObject({
      code: "CC_MCP_HTTP_STATUS",
      status: 400,
    });
    expect(error.message).not.toContain("dynamic-secret");
    expect(rejectedBodyRead).not.toHaveBeenCalled();
  });

  it("does not multiply retries when the refreshed credential is also rejected", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    let toolCalls = 0;
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      if (message.method === "tools/call") {
        toolCalls += 1;
        return response(message, { status: 403 });
      }
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);
    await client.connect("remote", helperConfig());

    await expect(client.callTool("remote", "echo", {})).rejects.toMatchObject({
      code: "CC_MCP_HTTP_STATUS",
      status: 403,
    });
    expect(toolCalls).toBe(2);
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(2);
  });

  it("does not mint a nested auth retry when reconnect initialize is rejected", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    let initializeCalls = 0;
    let toolCalls = 0;
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      if (message.method === "initialize") {
        initializeCalls += 1;
        return initializeCalls === 1
          ? response(message)
          : response(message, { status: 401 });
      }
      if (message.method === "tools/call") {
        toolCalls += 1;
        return response(message, { status: 401 });
      }
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);
    await client.connect("remote", helperConfig());

    await expect(client.callTool("remote", "echo", {})).rejects.toMatchObject({
      code: "CC_MCP_HTTP_STATUS",
      status: 401,
    });
    expect(initializeCalls).toBe(2);
    expect(toolCalls).toBe(1);
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(2);
  });

  it("reruns once when initialize itself rejects the first credential", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    let initializeCalls = 0;
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      if (message.method === "initialize" && initializeCalls++ === 0) {
        return response(message, { status: 401 });
      }
      return response(message);
    });
    const client = new MCPClient();
    clients.push(client);

    await expect(
      client.connect("remote", helperConfig()),
    ).resolves.toMatchObject({ state: "connected" });
    expect(initializeCalls).toBe(2);
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(2);
  });

  it("runs on each SSE stream connection and stops after one auth refresh", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    let getCalls = 0;
    let resolveAuthFailure;
    const authFailure = new Promise((resolve) => {
      resolveAuthFailure = resolve;
    });
    _deps.fetch = vi.fn(async (_url, options) => {
      if (options.method === "GET") {
        getCalls += 1;
        return response(null, { status: 401 });
      }
      if (options.method === "DELETE") return response(null);
      const message = JSON.parse(options.body);
      if (message.id == null) return response(message, { result: {} });
      return response(message);
    });
    const client = new MCPClient({
      elicitationHandler: async () => ({ action: "decline" }),
    });
    clients.push(client);
    client.on("server-stream-error", (event) => {
      if (event.code === "CC_MCP_AUTH_RETRY_EXHAUSTED") {
        resolveAuthFailure(event);
      }
    });

    await client.connect("remote", helperConfig());
    await expect(
      Promise.race([
        authFailure,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SSE auth retry timed out")), 1000),
        ),
      ]),
    ).resolves.toMatchObject({ code: "CC_MCP_AUTH_RETRY_EXHAUSTED" });
    expect(getCalls).toBe(2);
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(3);
  });

  it("reruns for one WebSocket 401 handshake retry and then stops", async () => {
    let helperRun = 0;
    _deps.runMcpHeadersHelper = vi.fn(async () => ({
      Authorization: `Bearer dynamic-${++helperRun}`,
    }));
    const authorization = [];
    const server = createServer();
    servers.push(server);
    server.on("upgrade", (request, socket) => {
      authorization.push(request.headers.authorization);
      socket.end(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(0, "127.0.0.1");
    });
    const address = server.address();
    const client = new MCPClient();
    clients.push(client);

    await expect(
      client.connect(
        "socket",
        helperConfig({
          url: `ws://127.0.0.1:${address.port}/mcp`,
          transport: "ws",
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_WS_HANDSHAKE_REJECTED",
      status: 401,
    });
    expect(authorization).toEqual(["Bearer dynamic-1", "Bearer dynamic-2"]);
    expect(_deps.runMcpHeadersHelper).toHaveBeenCalledTimes(2);
  });
});
