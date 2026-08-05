import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPClient, _deps } from "../../src/harness/mcp-client.js";

const originalDeps = { ..._deps };
const clients = new Set();
const servers = new Set();

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function listen(handler) {
  const server = createServer(handler);
  servers.add(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

function addHttpEntry(client, name, url, config = {}) {
  const entry = {
    config: { url, ...config },
    httpHeaders: {},
    httpSessionId: config.sessionId || null,
    httpUrl: url,
    protocolVersion: "2025-11-25",
    state: "connected",
    transportKind: "http",
    _httpMessageStream: null,
    _httpRequestControllers: new Set(),
    _httpDiscardControllers: new Set(),
    _httpDiscardStopping: false,
    _disconnectPromise: null,
    _pending: new Map(),
  };
  client.servers.set(name, entry);
  clients.add(client);
  return entry;
}

function abortingFetchCall(options, calls) {
  calls.push(options);
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener(
      "abort",
      () => {
        const error = new Error("fixture transport aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    );
  });
}

beforeEach(() => {
  Object.assign(_deps, originalDeps);
});

afterEach(async () => {
  await Promise.all(
    [...clients].map((client) => client.disconnectAll().catch(() => {})),
  );
  clients.clear();
  Object.assign(_deps, originalDeps);
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    ),
  );
  servers.clear();
});

describe("MCPClient HTTP request cancellation lifecycle", () => {
  it.each([
    ["longRunning", { longRunning: true, requestTimeoutMs: 10 }],
    ["requestTimeoutMs=0", { requestTimeoutMs: 0 }],
  ])(
    "disconnect aborts a %s request without reconnect or a late success",
    async (_label, config) => {
      const calls = [];
      _deps.fetch = vi.fn((_url, options) => abortingFetchCall(options, calls));
      const client = new MCPClient();
      const entry = addHttpEntry(
        client,
        "remote",
        "https://mcp.test/rpc",
        config,
      );
      const reconnector = vi.fn();
      client.setReconnector("remote", reconnector);

      const pending = client.callTool("remote", "mutate", {});
      const rejected = expect(pending).rejects.toMatchObject({
        code: "CC_MCP_SERVER_DISCONNECTING",
        dispatched: true,
        outcomeUnknown: true,
      });
      await waitFor(() => calls.length === 1, "request dispatch");
      expect(calls[0].signal).toBeInstanceOf(AbortSignal);
      expect(calls[0].signal.aborted).toBe(false);
      expect(entry._httpRequestControllers.size).toBe(1);

      await client.disconnect("remote");
      await rejected;

      expect(calls[0].signal.aborted).toBe(true);
      expect(entry._httpRequestControllers.size).toBe(0);
      expect(reconnector).not.toHaveBeenCalled();
      expect(_deps.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an already-aborted caller before dispatch without leaking its reason", async () => {
    _deps.fetch = vi.fn();
    const client = new MCPClient();
    addHttpEntry(client, "remote", "https://mcp.test/rpc");
    const controller = new AbortController();
    controller.abort("CALLER_SECRET_CANARY");

    let error;
    try {
      await client.callTool(
        "remote",
        "mutate",
        {},
        {
          signal: controller.signal,
        },
      );
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      code: "CC_MCP_REQUEST_ABORTED",
      dispatched: false,
      outcomeUnknown: false,
    });
    expect(error.message).not.toContain("CALLER_SECRET_CANARY");
    expect(_deps.fetch).not.toHaveBeenCalled();
  });

  it("keeps disconnect as the first abort cause when a finite deadline is armed", async () => {
    const messages = [];
    _deps.fetch = vi.fn((_url, options) => {
      messages.push(JSON.parse(options.body));
      return abortingFetchCall(options, []);
    });
    const client = new MCPClient();
    addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      requestTimeoutMs: 40,
    });

    const pending = client.callTool("remote", "mutate", {});
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      outcomeUnknown: true,
    });
    await waitFor(() => messages.length === 1, "request dispatch");
    await client.disconnect("remote");
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 55));

    expect(
      messages.filter(({ method }) => method === "notifications/cancelled"),
    ).toHaveLength(0);
  });

  it("propagates caller abort after dispatch and sends one independent cancellation", async () => {
    const calls = [];
    _deps.fetch = vi.fn((_url, options) => {
      const message = JSON.parse(options.body);
      calls.push({ message, options });
      if (message.method === "notifications/cancelled") {
        return Promise.resolve({
          body: { cancel: vi.fn(async () => {}) },
        });
      }
      return abortingFetchCall(options, []);
    });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      longRunning: true,
      requestTimeoutMs: 0,
    });
    const reconnector = vi.fn();
    client.setReconnector("remote", reconnector);
    const controller = new AbortController();

    const pending = client.callTool(
      "remote",
      "mutate",
      {},
      {
        signal: controller.signal,
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CC_MCP_REQUEST_ABORTED",
      dispatched: true,
      outcomeUnknown: true,
    });
    await waitFor(() => calls.length === 1, "request dispatch");
    expect(calls[0].options.signal).not.toBe(controller.signal);

    controller.abort("CALLER_SECRET_CANARY");
    await rejected;
    await waitFor(
      () => entry._httpDiscardControllers.size === 0,
      "cancellation response cleanup",
    );

    const cancellations = calls.filter(
      ({ message }) => message.method === "notifications/cancelled",
    );
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].message.params.reason).toBe(
      "Request cancelled by caller: tools/call",
    );
    expect(cancellations[0].message.params.reason).not.toContain(
      "CALLER_SECRET_CANARY",
    );
    expect(cancellations[0].options.signal).not.toBe(calls[0].options.signal);
    expect(entry._httpRequestControllers.size).toBe(0);
    expect(reconnector).not.toHaveBeenCalled();
  });

  it("rejects a late success from a fetch adapter that ignores abort", async () => {
    let resolveFetch;
    let requestSignal;
    const cancel = vi.fn(async () => {});
    const text = vi.fn(async () =>
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { committed: true } }),
    );
    _deps.fetch = vi.fn((_url, options) => {
      requestSignal = options.signal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      longRunning: true,
      requestTimeoutMs: 0,
    });
    const reconnector = vi.fn();
    client.setReconnector("remote", reconnector);

    const pending = client.callTool("remote", "mutate", {});
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      dispatched: true,
      outcomeUnknown: true,
    });
    await waitFor(() => requestSignal != null, "request dispatch");
    await client.disconnect("remote");
    expect(requestSignal.aborted).toBe(true);

    resolveFetch({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      body: { cancel },
      text,
    });
    await rejected;

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(entry._httpRequestControllers.size).toBe(0);
    expect(reconnector).not.toHaveBeenCalled();
  });

  it("aborts two in-flight POSTs before issuing DELETE with an independent signal", async () => {
    const posts = [];
    const deletes = [];
    _deps.fetch = vi.fn((_url, options) => {
      if (options.method === "DELETE") {
        deletes.push(options);
        return Promise.resolve({ body: { cancel: vi.fn(async () => {}) } });
      }
      return abortingFetchCall(options, posts);
    });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      longRunning: true,
      requestTimeoutMs: 0,
      sessionId: "session-main-cancel",
    });

    const first = client.callTool("remote", "first", {});
    const second = client.callTool("remote", "second", {});
    const firstRejected = expect(first).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      outcomeUnknown: true,
    });
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      outcomeUnknown: true,
    });
    await waitFor(() => posts.length === 2, "parallel request dispatch");

    await client.disconnect("remote");
    await Promise.all([firstRejected, secondRejected]);

    expect(posts.every(({ signal }) => signal.aborted)).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].signal).toBeInstanceOf(AbortSignal);
    expect(deletes[0].signal.aborted).toBe(false);
    expect(entry._httpRequestControllers.size).toBe(0);
    expect(entry._httpDiscardControllers.size).toBe(0);
  });

  it("closes a real request when a long-running peer never sends headers", async () => {
    let requestSeen = false;
    let responseClosed = false;
    const url = await listen((_request, response) => {
      requestSeen = true;
      response.on("close", () => {
        responseClosed = true;
      });
    });
    _deps.fetch = (...args) => globalThis.fetch(...args);
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", url, {
      longRunning: true,
      requestTimeoutMs: 0,
    });

    const pending = client.callTool("remote", "mutate", {});
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      outcomeUnknown: true,
    });
    await waitFor(() => requestSeen, "real request dispatch");
    await client.disconnect("remote");
    await rejected;
    await waitFor(() => responseClosed, "real request close");

    expect(entry._httpRequestControllers.size).toBe(0);
  });

  it("cancels a real chunked JSON body before its canary boundary", async () => {
    const totalBytes = 64 * 1024 * 1024;
    let bytesSent = 0;
    let responseClosed = false;
    const url = await listen((request, response) => {
      let input = "";
      request.on("data", (chunk) => {
        input += chunk;
      });
      request.on("end", () => {
        const requestId = JSON.parse(input).id;
        response.on("close", () => {
          responseClosed = true;
        });
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        });
        response.write(`{"jsonrpc":"2.0","id":${requestId},"result":{"data":"`);
        const chunk = Buffer.alloc(4096, "x");
        const pump = () => {
          if (response.destroyed || bytesSent >= totalBytes) return;
          bytesSent += chunk.byteLength;
          if (response.write(chunk)) setImmediate(pump);
          else response.once("drain", pump);
        };
        setImmediate(pump);
      });
    });
    _deps.fetch = (...args) => globalThis.fetch(...args);
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", url, {
      longRunning: true,
      requestTimeoutMs: 0,
    });

    const pending = client.callTool("remote", "mutate", {});
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CC_MCP_SERVER_DISCONNECTING",
      outcomeUnknown: true,
    });
    await waitFor(() => bytesSent > 0, "chunked response body");
    await client.disconnect("remote");
    await rejected;
    await waitFor(() => responseClosed, "chunked response close");

    expect(bytesSent).toBeLessThan(totalBytes);
    expect(entry._httpRequestControllers.size).toBe(0);
  });
});
