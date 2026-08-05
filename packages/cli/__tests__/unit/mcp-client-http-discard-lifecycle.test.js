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

function addHttpEntry(
  client,
  name,
  url,
  { longRunning = false, requestTimeoutMs = 1000, sessionId = null } = {},
) {
  const entry = {
    config: { longRunning, requestTimeoutMs, url },
    httpHeaders: {},
    httpSessionId: sessionId,
    httpUrl: url,
    protocolVersion: "2025-11-25",
    state: "connected",
    transportKind: "http",
    _httpDiscardControllers: new Set(),
    _httpDiscardStopping: false,
    _disconnectPromise: null,
    _pending: new Map(),
  };
  client.servers.set(name, entry);
  clients.add(client);
  return entry;
}

function jsonResponse(message, result) {
  const text = JSON.stringify({
    jsonrpc: "2.0",
    id: message.id,
    result,
  });
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/json"
          : null;
      },
    },
    async text() {
      return text;
    },
  };
}

beforeEach(() => {
  Object.assign(_deps, originalDeps);
});

afterEach(async () => {
  vi.useRealTimers();
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

describe("MCPClient discarded HTTP response lifecycle", () => {
  it("cancels response bodies for notification, server response, and DELETE", async () => {
    const calls = [];
    _deps.fetch = vi.fn(async (_url, options) => {
      const cancel = vi.fn(async () => {});
      calls.push({ cancel, options });
      return { body: { cancel } };
    });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      sessionId: "session-1",
    });

    client._sendHttpNotification("remote", "notifications/test", {});
    client._sendResponse("remote", "server-request-1", { ok: true });
    await waitFor(
      () => calls.length === 2 && entry._httpDiscardControllers.size === 0,
      "POST body cancellation",
    );
    await client.disconnect("remote");

    expect(calls.map(({ options }) => options.method)).toEqual([
      "POST",
      "POST",
      "DELETE",
    ]);
    for (const { cancel, options } of calls) {
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal.aborted).toBe(false);
    }
    expect(entry._httpDiscardControllers.size).toBe(0);
  });

  it.each([
    [25, 25, false],
    [25, 25, true],
    [0, 30000, false],
    [-1, 30000, false],
    [Number.POSITIVE_INFINITY, 30000, false],
    [60000, 30000, false],
  ])(
    "uses a host-owned deadline for requestTimeoutMs=%s capped at %sms (longRunning=%s)",
    async (requestTimeoutMs, expectedMs, longRunning) => {
      vi.useFakeTimers();
      let signal = null;
      _deps.fetch = vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("fixture aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      });
      const client = new MCPClient();
      const entry = addHttpEntry(client, "deadline", "https://mcp.test/rpc", {
        longRunning,
        requestTimeoutMs,
      });

      client._sendHttpNotification("deadline", "notifications/test", {});
      expect(signal).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(expectedMs - 1);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      await Promise.resolve();
      expect(entry._httpDiscardControllers.size).toBe(0);
      client.servers.delete("deadline");
    },
  );

  it("drops the controller registry when a non-standard fetch ignores abort", async () => {
    vi.useFakeTimers();
    let signal = null;
    _deps.fetch = vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const client = new MCPClient();
    const entry = addHttpEntry(
      client,
      "ignores-abort",
      "https://mcp.test/rpc",
      { requestTimeoutMs: 20 },
    );

    client._sendHttpNotification("ignores-abort", "notifications/test", {});
    expect(entry._httpDiscardControllers.size).toBe(1);
    await vi.advanceTimersByTimeAsync(20);

    expect(signal.aborted).toBe(true);
    expect(entry._httpDiscardControllers.size).toBe(0);
    client.servers.delete("ignores-abort");
  });

  it("single-flights disconnect and blocks every late HTTP send", async () => {
    const postCalls = [];
    const deleteCalls = [];
    let resolveDelete;
    _deps.fetch = vi.fn((_url, options) => {
      if (options.method === "DELETE") {
        const cancel = vi.fn(async () => {});
        deleteCalls.push({ cancel, options });
        return new Promise((resolve) => {
          resolveDelete = () => resolve({ body: { cancel } });
        });
      }
      postCalls.push(options);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("fixture aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "remote", "https://mcp.test/rpc", {
      sessionId: "session-2",
    });
    const streamErrors = [];
    const reconnector = vi.fn();
    client.setReconnector("remote", reconnector);
    client.on("server-stream-error", (event) => streamErrors.push(event));

    client._sendHttpNotification("remote", "notifications/test", {});
    client._sendResponse("remote", "server-request-2", { ok: true });
    expect(entry._httpDiscardControllers.size).toBe(2);
    const disconnecting = client.disconnect("remote");
    const concurrentDisconnect = client.disconnect("remote");
    expect(concurrentDisconnect).toBe(disconnecting);
    expect(entry.state).toBe("disconnected");
    await waitFor(() => deleteCalls.length === 1, "DELETE dispatch");
    expect(postCalls.every(({ signal }) => signal.aborted)).toBe(true);

    await expect(
      client.callTool("remote", "late-tool", {}),
    ).rejects.toMatchObject({ code: "CC_MCP_SERVER_DISCONNECTING" });
    await expect(
      client.readResource("remote", "file:///late-resource"),
    ).rejects.toMatchObject({ code: "CC_MCP_SERVER_DISCONNECTING" });
    expect(reconnector).not.toHaveBeenCalled();

    client._sendHttpNotification("remote", "notifications/late", {});
    client._sendResponse("remote", "server-request-late", { ok: true });
    expect(postCalls).toHaveLength(2);
    resolveDelete();
    await Promise.all([disconnecting, concurrentDisconnect]);

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].cancel).toHaveBeenCalledTimes(1);
    expect(deleteCalls[0].options.signal.aborted).toBe(false);
    expect(entry._httpDiscardControllers.size).toBe(0);
    expect(streamErrors).toHaveLength(0);
  });

  it("reaps an initialized notification when connect fails after discovery", async () => {
    let initializedSignal = null;
    let resolveInitializedAbort;
    const initializedAborted = new Promise((resolve) => {
      resolveInitializedAbort = resolve;
    });
    _deps.fetch = vi.fn(async (_url, options) => {
      const message = JSON.parse(options.body);
      if (message.id == null) {
        initializedSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              resolveInitializedAbort();
              const error = new Error("initialized aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }
      const results = {
        initialize: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "fixture", version: "1" },
          capabilities: { tools: {}, resources: {}, prompts: {} },
        },
        "tools/list": { tools: [] },
        "resources/list": { resources: [] },
        "resources/templates/list": { resourceTemplates: [] },
        "prompts/list": { prompts: [] },
      };
      return jsonResponse(message, results[message.method] || {});
    });
    const client = new MCPClient();
    client.on("server-connected", () => {
      throw new Error("fixture post-discovery failure");
    });

    await expect(
      client.connect("failing", {
        url: "https://mcp.test/rpc",
        requestTimeoutMs: 1000,
      }),
    ).rejects.toThrow("fixture post-discovery failure");
    await initializedAborted;

    expect(initializedSignal).toBeInstanceOf(AbortSignal);
    expect(initializedSignal.aborted).toBe(true);
    expect(client.servers.has("failing")).toBe(false);
  });

  it("cancels a real chunked response before an unbounded body is sent", async () => {
    const totalBytes = 64 * 1024 * 1024;
    let bytesSent = 0;
    let closed = false;
    const url = await listen((_request, response) => {
      response.on("close", () => {
        closed = true;
      });
      response.writeHead(202, {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      });
      const chunk = Buffer.alloc(4096, "x");
      const pump = () => {
        if (response.destroyed || bytesSent >= totalBytes) return;
        bytesSent += chunk.byteLength;
        if (response.write(chunk)) setImmediate(pump);
        else response.once("drain", pump);
      };
      setImmediate(pump);
    });
    _deps.fetch = (...args) => globalThis.fetch(...args);
    const client = new MCPClient();
    const entry = addHttpEntry(client, "chunked", url, {
      requestTimeoutMs: 2000,
    });

    client._sendHttpNotification("chunked", "notifications/test", {});
    await waitFor(() => closed, "chunked response cancellation");
    await waitFor(
      () => entry._httpDiscardControllers.size === 0,
      "chunked controller cleanup",
    );

    expect(bytesSent).toBeGreaterThan(0);
    expect(bytesSent).toBeLessThan(totalBytes);
  });

  it("aborts a real HTTP request when the peer never sends headers", async () => {
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
    const entry = addHttpEntry(client, "silent", url, {
      requestTimeoutMs: 75,
    });

    client._sendHttpNotification("silent", "notifications/test", {});
    await waitFor(() => requestSeen, "silent request dispatch");
    await waitFor(() => responseClosed, "silent response abort");
    await waitFor(
      () => entry._httpDiscardControllers.size === 0,
      "silent controller cleanup",
    );
  });
});
