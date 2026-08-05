/**
 * MCP HTTP transport: per-call timeout so a hung/dead HTTP server can't block
 * forever (parity with the 30s stdio timeout). Servers flagged `longRunning`
 * (the IDE bridge, whose openDiff blocks on human review) are exempt — this
 * finally consumes the `longRunning` metadata set by ideServerToMcpConfig.
 *
 * fetch is mocked via _deps; a hanging fetch that honours AbortSignal lets us
 * assert the timeout fires. Every request now owns a lifecycle signal, while
 * longRunning/timeout=0 disable only the deadline timer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MCPClient } from "../../src/lib/mcp-client.js";

function makeResponse({ body = "", sessionId = "s1" } = {}) {
  const headers = new Map([["content-type", "application/json"]]);
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    },
  };
}

function handshakeResult(method) {
  switch (method) {
    case "initialize":
      return { serverInfo: { name: "h" }, capabilities: {} };
    case "tools/list":
      return { tools: [] };
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return {};
  }
}

// A fetch mock that answers the connect handshake from the request body and
// records each call's options.
function recordingFetch(calls) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const msg = JSON.parse(opts.body);
    if (msg.id === undefined) return makeResponse({ body: "" }); // notification
    return makeResponse({
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: handshakeResult(msg.method),
      }),
    });
  };
}

describe("MCPClient HTTP per-call timeout", () => {
  let client;
  let mod;

  beforeEach(async () => {
    mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
  });

  it("times out a hung request on a normal (non-longRunning) server", async () => {
    // fetch never resolves but honours abort → the timeout must reject it.
    const calls = [];
    mod._deps.fetch = (url, opts) => {
      calls.push({ url, opts, message: JSON.parse(opts.body) });
      return new Promise((_resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }
      });
    };

    await expect(
      client.connect("srv", {
        url: "https://api.example.com/mcp",
        requestTimeoutMs: 40, // tiny so the test is fast
      }),
    ).rejects.toThrow(/timeout/i);
    expect(
      calls.some(({ message }) => message.method === "notifications/cancelled"),
    ).toBe(false);
  });

  it("aborts a timed-out request and sends one independent cancellation", async () => {
    const calls = [];
    mod._deps.fetch = (url, opts) => {
      const message = JSON.parse(opts.body);
      calls.push({ url, opts, message });
      if (message.method === "notifications/cancelled") {
        return Promise.reject(new Error("cancellation delivery failed"));
      }
      if (message.method === "tools/call") {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      if (message.id === undefined) return makeResponse({ body: "" });
      return makeResponse({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: handshakeResult(message.method),
        }),
      });
    };

    await client.connect("srv", {
      url: "https://api.example.com/mcp",
      requestTimeoutMs: 30,
    });
    await expect(client.callTool("srv", "doit", {})).rejects.toThrow(
      "Request timeout: tools/call (HTTP, no response in 30ms)",
    );

    const request = calls.find(
      ({ message }) => message.method === "tools/call",
    );
    const cancellations = calls.filter(
      ({ message }) => message.method === "notifications/cancelled",
    );
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].message.params).toEqual({
      requestId: request.message.id,
      reason: "Request timeout: tools/call (HTTP, no response in 30ms)",
    });
    expect(cancellations[0].opts.signal).toBeInstanceOf(AbortSignal);
    expect(cancellations[0].opts.signal).not.toBe(request.opts.signal);
    expect(cancellations[0].opts.signal.aborted).toBe(false);
  });

  it("attaches an abort signal and does not cancel completed requests", async () => {
    const calls = [];
    mod._deps.fetch = recordingFetch(calls);

    await client.connect("srv", {
      url: "https://api.example.com/mcp",
      requestTimeoutMs: 30,
    });
    await client.callTool("srv", "doit", {});
    await new Promise((resolve) => setTimeout(resolve, 45));

    const requestCalls = calls.filter((c) => {
      const b = JSON.parse(c.opts.body);
      return b.id !== undefined; // ignore the fire-and-forget notification
    });
    expect(requestCalls.length).toBeGreaterThan(0);
    for (const c of requestCalls) {
      expect(c.opts.signal).toBeDefined();
    }
    expect(
      calls.some(
        (c) => JSON.parse(c.opts.body).method === "notifications/cancelled",
      ),
    ).toBe(false);
  });

  it("keeps a lifecycle signal for longRunning servers (openDiff deadline exemption)", async () => {
    const calls = [];
    mod._deps.fetch = recordingFetch(calls);

    await client.connect("ide", {
      url: "http://127.0.0.1:7777/mcp",
      longRunning: true,
    });

    const requestCalls = calls.filter((c) => {
      const b = JSON.parse(c.opts.body);
      return b.id !== undefined;
    });
    expect(requestCalls.length).toBeGreaterThan(0);
    for (const c of requestCalls) {
      expect(c.opts.signal).toBeInstanceOf(AbortSignal);
      expect(c.opts.signal.aborted).toBe(false);
    }
  });

  it("requestTimeoutMs:0 disables only the timeout, not lifecycle cancellation", async () => {
    const calls = [];
    mod._deps.fetch = recordingFetch(calls);

    await client.connect("srv", {
      url: "https://api.example.com/mcp",
      requestTimeoutMs: 0,
    });

    const requestCalls = calls.filter(
      (c) => JSON.parse(c.opts.body).id !== undefined,
    );
    for (const c of requestCalls) {
      expect(c.opts.signal).toBeInstanceOf(AbortSignal);
      expect(c.opts.signal.aborted).toBe(false);
    }
  });
});
