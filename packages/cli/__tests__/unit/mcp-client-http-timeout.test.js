/**
 * MCP HTTP transport: per-call timeout so a hung/dead HTTP server can't block
 * forever (parity with the 30s stdio timeout). Servers flagged `longRunning`
 * (the IDE bridge, whose openDiff blocks on human review) are exempt — this
 * finally consumes the `longRunning` metadata set by ideServerToMcpConfig.
 *
 * fetch is mocked via _deps; a hanging fetch that honours AbortSignal lets us
 * assert the timeout fires, and recording opts.signal lets us assert that
 * normal servers get an abort signal while longRunning ones don't.
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
    mod._deps.fetch = (url, opts) =>
      new Promise((_resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }
      });

    await expect(
      client.connect("srv", {
        url: "https://api.example.com/mcp",
        requestTimeoutMs: 40, // tiny so the test is fast
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it("attaches an abort signal for normal servers", async () => {
    const calls = [];
    mod._deps.fetch = recordingFetch(calls);

    await client.connect("srv", { url: "https://api.example.com/mcp" });

    const requestCalls = calls.filter((c) => {
      const b = JSON.parse(c.opts.body);
      return b.id !== undefined; // ignore the fire-and-forget notification
    });
    expect(requestCalls.length).toBeGreaterThan(0);
    for (const c of requestCalls) {
      expect(c.opts.signal).toBeDefined();
    }
  });

  it("does NOT attach a signal for longRunning servers (openDiff exemption)", async () => {
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
      expect(c.opts.signal).toBeUndefined();
    }
  });

  it("requestTimeoutMs:0 disables the timeout (no signal attached)", async () => {
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
      expect(c.opts.signal).toBeUndefined();
    }
  });
});
