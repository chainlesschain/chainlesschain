/**
 * MCP connect: surface a tools/list failure instead of a misleading "Tools: 0"
 * (Claude-Code 2.1.181 parity — "claude mcp get/list showing ✓ Connected when
 * tools/list fails; now shows ! Connected · tools fetch failed").
 *
 * When a server advertises a `tools` capability in its initialize response but
 * the subsequent tools/list request fails, connect() must still mark the server
 * CONNECTED (initialize succeeded) yet report a `toolsError` so callers can show
 * "Connected · tools fetch failed" rather than an empty tool list. A server that
 * never advertised tools simply has none — a failure there stays quiet.
 *
 * The HTTP transport is fetch-mocked via _deps so no process/network is used.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MCPClient } from "../../src/lib/mcp-client.js";

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
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    },
  };
}

const initResponse = (capabilities) =>
  makeResponse({
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "srv", version: "1" }, capabilities },
    }),
    sessionId: "sess-1",
  });

const okResult = (id, result) =>
  makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id, result }) });

const jsonRpcError = (id, message) =>
  makeResponse({
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message },
    }),
  });

describe("MCPClient connect — tools/list failure surfacing", () => {
  let client;
  let fetchQueue;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    fetchQueue = [];
    mod._deps.fetch = async (url) => {
      if (fetchQueue.length === 0)
        throw new Error(`unexpected fetch to ${url}`);
      return fetchQueue.shift();
    };
  });

  it("reports toolsError when an advertised tools/list fails (still CONNECTED)", async () => {
    fetchQueue.push(initResponse({ tools: {} })); // advertises tools
    fetchQueue.push(makeResponse({ body: "" })); // notifications/initialized
    fetchQueue.push(jsonRpcError(2, "boom fetching tools")); // tools/list FAILS
    fetchQueue.push(okResult(3, { resources: [] })); // resources/list
    fetchQueue.push(okResult(4, { prompts: [] })); // prompts/list

    const result = await client.connect("srv", {
      url: "https://api.example.com/mcp",
    });

    expect(result.tools).toEqual([]);
    expect(result.toolsError).toBe("boom fetching tools");
    // initialize succeeded → still connected, not thrown.
    expect(result.state).toBeDefined();
    // listServers() exposes the same signal for the `mcp servers` view.
    const listed = client.listServers().find((s) => s.name === "srv");
    expect(listed.toolsError).toBe("boom fetching tools");
  });

  it("stays quiet (toolsError null) when a server that did NOT advertise tools fails tools/list", async () => {
    fetchQueue.push(initResponse({})); // no tools capability
    fetchQueue.push(makeResponse({ body: "" }));
    fetchQueue.push(jsonRpcError(2, "method not found")); // tools/list FAILS
    fetchQueue.push(okResult(3, { resources: [] }));
    fetchQueue.push(okResult(4, { prompts: [] }));

    const result = await client.connect("srv", {
      url: "https://api.example.com/mcp",
    });

    expect(result.tools).toEqual([]);
    expect(result.toolsError).toBeNull();
  });

  it("has null toolsError on a normal successful tools/list", async () => {
    fetchQueue.push(initResponse({ tools: {} }));
    fetchQueue.push(makeResponse({ body: "" }));
    fetchQueue.push(okResult(2, { tools: [{ name: "hello" }] }));
    fetchQueue.push(okResult(3, { resources: [] }));
    fetchQueue.push(okResult(4, { prompts: [] }));

    const result = await client.connect("srv", {
      url: "https://api.example.com/mcp",
    });

    expect(result.tools).toEqual([{ name: "hello" }]);
    expect(result.toolsError).toBeNull();
  });
});
