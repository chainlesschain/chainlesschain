import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  _deps,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/harness/mcp-client.js";

const originalDeps = { ..._deps };

function addHttpEntry(
  client,
  name,
  { longRunning = true, requestTimeoutMs = 20 } = {},
) {
  const url = "https://mcp.example.test/rpc?secret=must-not-surface";
  const entry = {
    config: { longRunning, requestTimeoutMs, url },
    httpHeaders: {},
    httpSessionId: null,
    httpUrl: url,
    protocolVersion: "2025-11-25",
    state: "connected",
    transportKind: "https",
    _httpMessageStream: null,
    _httpRequestControllers: new Set(),
    _httpDiscardControllers: new Set(),
    _httpDiscardStopping: false,
    _pending: new Map(),
  };
  client.servers.set(name, entry);
  return entry;
}

async function flushUntil(predicate, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`${label} did not occur`);
}

function installResponseFixture({ dripEveryMs = null } = {}) {
  const state = {
    calls: [],
    cancelCalls: 0,
    readCalls: 0,
    releaseCalls: 0,
    requestSignal: null,
  };
  _deps.fetch = vi.fn(async (_url, options) => {
    const message = JSON.parse(options.body);
    state.calls.push({ message, options });
    if (message.method === "notifications/cancelled") {
      return {
        body: {
          async cancel() {
            state.cancelCalls += 1;
          },
        },
      };
    }
    state.requestSignal = options.signal;
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
      body: {
        getReader() {
          return {
            read() {
              state.readCalls += 1;
              if (dripEveryMs == null) return new Promise(() => {});
              return new Promise((resolve) => {
                setTimeout(
                  () => resolve({ done: false, value: Uint8Array.of(0x20) }),
                  dripEveryMs,
                );
              });
            },
            async cancel() {
              state.cancelCalls += 1;
            },
            releaseLock() {
              state.releaseCalls += 1;
            },
          };
        },
      },
    };
  });
  return state;
}

beforeEach(() => {
  Object.assign(_deps, originalDeps);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(_deps, originalDeps);
});

describe("MCPClient finite HTTP response body deadline", () => {
  it("terminates a longRunning byte-at-a-time response at an absolute deadline", async () => {
    const state = installResponseFixture({ dripEveryMs: 5 });
    const client = new MCPClient();
    const entry = addHttpEntry(client, "slow-drip");
    const reconnector = vi.fn(async () => true);
    client.setReconnector("slow-drip", reconnector);

    let settled = false;
    const outcome = client
      .callTool("slow-drip", "mutate", {})
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    await flushUntil(() => state.readCalls > 0, "response body read");

    await vi.advanceTimersByTimeAsync(19);
    expect(settled).toBe(false);
    expect(state.readCalls).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = await outcome;

    expect(error).toMatchObject({
      code: "CC_MCP_HTTP_RESPONSE_TIMEOUT",
      transport: "https",
      url: "https://mcp.example.test/rpc",
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(error.message).toBe(
      'MCP HTTP response body for method "tools/call" exceeded the 20ms host deadline',
    );
    expect(error.message).not.toContain("must-not-surface");
    expect(isLikelyConnectionError(error)).toBe(false);
    expect(isTransientMcpError(error)).toBe(false);
    expect(state.requestSignal).toBeInstanceOf(AbortSignal);
    expect(state.requestSignal.aborted).toBe(true);
    expect(state.cancelCalls).toBe(2);
    expect(state.releaseCalls).toBe(1);
    expect(
      state.calls.filter(({ message }) => message.method === "tools/call"),
    ).toHaveLength(1);
    const cancellations = state.calls.filter(
      ({ message }) => message.method === "notifications/cancelled",
    );
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].message.params.reason).toBe(error.message);
    expect(reconnector).not.toHaveBeenCalled();
    expect(entry._httpRequestControllers.size).toBe(0);
    expect(entry._httpDiscardControllers.size).toBe(0);
  });

  it.each([
    [true, 0, 30000],
    [true, 60000, 30000],
    [false, 0, 30000],
  ])(
    "keeps the host ceiling for longRunning=%s requestTimeoutMs=%s",
    async (longRunning, requestTimeoutMs, expectedMs) => {
      const state = installResponseFixture();
      const client = new MCPClient();
      const entry = addHttpEntry(client, "bounded", {
        longRunning,
        requestTimeoutMs,
      });
      let settled = false;
      const outcome = client.callTool("bounded", "mutate", {}).then(
        (value) => {
          settled = true;
          return { value };
        },
        (error) => {
          settled = true;
          return { error };
        },
      );
      await flushUntil(() => state.readCalls === 1, "response body read");

      await vi.advanceTimersByTimeAsync(expectedMs - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const { error } = await outcome;

      expect(error).toMatchObject({
        code: "CC_MCP_HTTP_RESPONSE_TIMEOUT",
        dispatched: true,
        outcomeUnknown: true,
      });
      expect(error.message).toContain(`${expectedMs}ms host deadline`);
      expect(state.requestSignal.aborted).toBe(true);
      expect(state.cancelCalls).toBe(2);
      expect(state.releaseCalls).toBe(1);
      expect(entry._httpRequestControllers.size).toBe(0);
      expect(entry._httpDiscardControllers.size).toBe(0);
    },
  );
});
