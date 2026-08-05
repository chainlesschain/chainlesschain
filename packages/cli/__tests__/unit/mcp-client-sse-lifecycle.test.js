import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  ServerState,
  _deps,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/harness/mcp-client.js";

const originalFetch = _deps.fetch;

function addHttpEntry(client, name = "remote", config = {}) {
  const entry = {
    config,
    state: ServerState.CONNECTED,
    transportKind: "https",
    process: null,
    socket: null,
    httpUrl: "https://mcp.example.test/rpc?token=secret",
    httpHeaders: {},
    httpSessionId: "session-1",
    protocolVersion: "2025-11-25",
    _httpMessageStream: null,
    _pending: new Map(),
  };
  client.servers.set(name, entry);
  return entry;
}

beforeEach(() => {
  _deps.fetch = originalFetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  _deps.fetch = originalFetch;
});

describe("MCPClient background SSE lifecycle", () => {
  it("does not open a stream for an already-aborted handler owner", () => {
    _deps.fetch = vi.fn();
    const client = new MCPClient();
    const entry = addHttpEntry(client);
    const controller = new AbortController();
    controller.abort("CALLER_SECRET_CANARY");

    client.setElicitationHandler(vi.fn(), { signal: controller.signal });

    expect(_deps.fetch).not.toHaveBeenCalled();
    expect(entry._httpMessageStream).toBeNull();
    expect(client._elicitationHandler).toBeNull();
  });

  it("settles locally on owner abort and cancels a late ignored-fetch body", async () => {
    let resolveFetch;
    const cancel = vi.fn();
    _deps.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = new MCPClient();
    const entry = addHttpEntry(client);
    const streamErrors = [];
    client.on("server-stream-error", (event) => streamErrors.push(event));
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );

    client.setElicitationHandler(vi.fn(), { signal: controller.signal });
    const stream = entry._httpMessageStream;
    expect(_deps.fetch).toHaveBeenCalledOnce();

    controller.abort("CALLER_SECRET_CANARY");
    await stream.promise;

    expect(entry._httpMessageStream).toBeNull();
    expect(client._elicitationHandler).toBeNull();
    expect(streamErrors).toEqual([]);
    expect(removeEventListener).toHaveBeenCalled();

    resolveFetch({ body: { cancel } });
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps a shared stream until its final session handler is cleared", async () => {
    _deps.fetch = vi.fn(() => new Promise(() => {}));
    const client = new MCPClient();
    const entry = addHttpEntry(client);

    client.setElicitationHandler(vi.fn(), { sessionId: "session-a" });
    client.setElicitationHandler(vi.fn(), { sessionId: "session-b" });
    const stream = entry._httpMessageStream;

    expect(client.clearElicitationHandler("session-a")).toBe(true);
    expect(entry._httpMessageStream).toBe(stream);
    expect(stream.stopped).toBe(false);

    expect(client.clearElicitationHandler("session-b")).toBe(true);
    await stream.promise;
    expect(stream.stopped).toBe(true);
    expect(entry._httpMessageStream).toBeNull();
    expect(_deps.fetch).toHaveBeenCalledOnce();
  });

  it("does not time out an idle stream after a complete event", async () => {
    vi.useFakeTimers();
    let readCalls = 0;
    const cancel = vi.fn();
    _deps.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader() {
          return {
            read() {
              readCalls += 1;
              if (readCalls === 1) {
                return Promise.resolve({
                  done: false,
                  value: Buffer.from(
                    'data: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n',
                  ),
                });
              }
              return new Promise(() => {});
            },
            cancel,
            releaseLock: vi.fn(),
          };
        },
      },
    }));
    const client = new MCPClient();
    const entry = addHttpEntry(client, "idle", { requestTimeoutMs: 5 });
    const controller = new AbortController();
    const streamErrors = [];
    const notifications = [];
    client.on("server-stream-error", (event) => streamErrors.push(event));
    client.on("notification", (event) => notifications.push(event));

    client.setElicitationHandler(vi.fn(), { signal: controller.signal });
    const stream = entry._httpMessageStream;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);

    expect(readCalls).toBe(2);
    expect(streamErrors).toEqual([]);
    expect(notifications).toHaveLength(1);
    expect(entry._httpMessageStream).toBe(stream);

    controller.abort();
    await stream.promise;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [7, 7],
    [0, 30_000],
    [Number.MAX_SAFE_INTEGER, 30_000],
  ])(
    "stops a slow-drip event at the host deadline for requestTimeoutMs=%s",
    async (configuredTimeout, expectedTimeout) => {
      vi.useFakeTimers();
      let readCalls = 0;
      const cancel = vi.fn(() => new Promise(() => {}));
      _deps.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        body: {
          getReader() {
            return {
              read() {
                readCalls += 1;
                if (readCalls === 1) {
                  return Promise.resolve({
                    done: false,
                    // A lone UTF-8 lead byte produces no decoded text. The
                    // wire-byte state must still start the event deadline.
                    value: Buffer.from([0xe4]),
                  });
                }
                return new Promise(() => {});
              },
              cancel,
              releaseLock: vi.fn(),
            };
          },
        },
      }));
      const client = new MCPClient();
      const entry = addHttpEntry(client, "slow-drip", {
        longRunning: true,
        requestTimeoutMs: configuredTimeout,
        maxBufferChars: 1024,
      });
      const streamError = new Promise((resolve) =>
        client.once("server-stream-error", resolve),
      );
      const notifications = [];
      client.on("notification", (event) => notifications.push(event));

      client.setElicitationHandler(vi.fn());
      const stream = entry._httpMessageStream;
      await vi.advanceTimersByTimeAsync(0);
      expect(readCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(expectedTimeout);
      const errorEvent = await streamError;
      await stream.promise;

      expect(errorEvent).toEqual({
        name: "slow-drip",
        code: "CC_MCP_SSE_EVENT_TIMEOUT",
        error: `MCP HTTP message stream event exceeded the ${expectedTimeout}ms host deadline`,
        timeoutMs: expectedTimeout,
      });
      expect(isLikelyConnectionError(errorEvent)).toBe(false);
      expect(isTransientMcpError(errorEvent)).toBe(false);
      expect(cancel).toHaveBeenCalledOnce();
      expect(_deps.fetch).toHaveBeenCalledOnce();
      expect(entry._httpMessageStream).toBeNull();
      expect(notifications).toEqual([]);
      client.setElicitationHandler(null);
    },
  );
});
