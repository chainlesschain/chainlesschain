/**
 * MCP capability-discovery retry + 404 error message (Claude-Code 2.1.191):
 *   - "capability discovery now retries transient network errors with short backoff"
 *   - "HTTP 404 errors now show the URL and point to your MCP config"
 *
 * fetch + sleep are mocked via the harness module's singleton _deps so retries
 * are observable and instant.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MCPClient,
  isTransientMcpError,
  _deps,
} from "../../src/harness/mcp-client.js";

function jsonResponse(id, result, { status = 200, ok = true } = {}) {
  const headers = new Map([
    ["content-type", "application/json"],
    ["mcp-session-id", "s1"],
  ]);
  return {
    ok,
    status,
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    async text() {
      return JSON.stringify({ jsonrpc: "2.0", id, result });
    },
    async json() {
      return { jsonrpc: "2.0", id, result };
    },
  };
}

function handshakeResult(method) {
  switch (method) {
    case "initialize":
      return { serverInfo: { name: "h" }, capabilities: { tools: {} } };
    case "tools/list":
      return { tools: [{ name: "t1" }] };
    default:
      return {};
  }
}

describe("isTransientMcpError", () => {
  it("retries network failures and 5xx, not 4xx / timeouts / dead process", () => {
    for (const m of [
      "fetch failed",
      "ECONNRESET",
      "ETIMEDOUT",
      "socket hang up",
      "HTTP 503: busy",
    ]) {
      expect(isTransientMcpError(new Error(m)), m).toBe(true);
    }
    for (const m of [
      "HTTP 404: Not Found",
      "HTTP 401: bad token",
      "HTTP 403: forbidden",
      "Request timeout: initialize (HTTP, no response in 30000ms)",
      'MCP server "x" process exited (code 1) before responding',
    ]) {
      expect(isTransientMcpError(new Error(m)), m).toBe(false);
    }
  });
});

describe("MCPClient discovery retry", () => {
  let client;
  let slept;
  let realSleep;
  let realFetch;

  beforeEach(() => {
    client = new MCPClient();
    slept = [];
    realSleep = _deps.sleep;
    realFetch = _deps.fetch;
    _deps.sleep = async (ms) => {
      slept.push(ms);
    };
  });

  afterEach(() => {
    _deps.sleep = realSleep;
    _deps.fetch = realFetch;
  });

  it("retries initialize on a transient error then succeeds (short backoff)", async () => {
    let n = 0;
    _deps.fetch = async (url, opts) => {
      const msg = JSON.parse(opts.body);
      if (msg.id === undefined) return jsonResponse(undefined, {}); // notification
      if (msg.method === "initialize") {
        n += 1;
        if (n === 1) throw new Error("fetch failed"); // transient on first try
      }
      return jsonResponse(msg.id, handshakeResult(msg.method));
    };

    const res = await client.connect("srv", {
      url: "https://api.example.com/mcp",
    });
    expect(res.state).toBe("connected");
    expect(n).toBe(2); // initialize was retried once
    expect(slept).toEqual([250]); // one backoff of 250ms
  });

  it("does NOT retry a permanent 4xx and surfaces it", async () => {
    let n = 0;
    _deps.fetch = async (url, opts) => {
      const msg = JSON.parse(opts.body);
      if (msg.method === "initialize") {
        n += 1;
        return jsonResponse(msg.id, null, { status: 401, ok: false });
      }
      return jsonResponse(msg.id, handshakeResult(msg.method));
    };

    await expect(
      client.connect("srv", { url: "https://api.example.com/mcp" }),
    ).rejects.toThrow(/HTTP 401/);
    expect(n).toBe(1); // no retry on auth failure
    expect(slept).toEqual([]);
  });

  it("gives up after the retry budget on persistent transient errors", async () => {
    let n = 0;
    _deps.fetch = async (url, opts) => {
      const msg = JSON.parse(opts.body);
      if (msg.method === "initialize") {
        n += 1;
        throw new Error("ECONNREFUSED");
      }
      return jsonResponse(msg.id, handshakeResult(msg.method));
    };

    await expect(
      client.connect("srv", { url: "https://api.example.com/mcp" }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(n).toBe(3); // 1 + 2 retries
    expect(slept).toEqual([250, 500]); // increasing backoff
  });

  it("404 names the URL and points at the MCP config", async () => {
    _deps.fetch = async (url, opts) => {
      const msg = JSON.parse(opts.body);
      if (msg.method === "initialize") {
        return jsonResponse(msg.id, null, { status: 404, ok: false });
      }
      return jsonResponse(msg.id, {});
    };

    await expect(
      client.connect("srv", { url: "https://api.example.com/wrong" }),
    ).rejects.toThrow(/HTTP 404.*api\.example\.com\/wrong.*MCP config/s);
  });
});
