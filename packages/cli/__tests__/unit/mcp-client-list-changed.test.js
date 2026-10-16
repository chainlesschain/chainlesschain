/**
 * MCP tools/resources list_changed handling (gap-analysis 2026-07-11 P1 "MCP
 * 生命周期"): a server's `notifications/tools/list_changed` /
 * `notifications/resources/list_changed` triggers a refetch so the client's
 * cached lists stay live (listTools / callTool routing / `/mcp` status). A
 * burst of notifications coalesces into the in-flight refetch + at most one
 * trailing pass. Fake stdio child injected via _deps.spawn (same harness as
 * mcp-client-roots.test.js).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { MCPClient, ServerState, _deps } from "../../src/lib/mcp-client.js";

beforeEach(() => {
  _deps.consumeMcpStdioExecutionAuthority = () => ({
    approvalKind: "test-fixture",
  });
  _deps.materializeApprovedMcpStdioInvocation = (_approval, { config }) =>
    config;
  _deps.prepareMcpStdioExecutableIdentity = ({ config }) => ({
    command: config.command,
    args: config.args || [],
    identity: null,
    authority: Object.freeze({}),
  });
});

function makeFakeProc(state) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  const stdin = new EventEmitter();
  proc.written = [];
  stdin.write = (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data).trim());
    } catch {
      return true;
    }
    proc.written.push(msg);
    if (msg.id === undefined || msg.method === undefined) return true;
    let result;
    switch (msg.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "fake", version: "1" },
          capabilities: { tools: {}, resources: {} },
        };
        break;
      case "tools/list":
        state.toolsListCalls++;
        result = { tools: [...state.tools] };
        break;
      case "resources/list":
        result = { resources: [...state.resources] };
        break;
      case "resources/templates/list":
        result = { resourceTemplates: [...state.resourceTemplates] };
        break;
      case "prompts/list":
        result = { prompts: [] };
        break;
      default:
        return true;
    }
    setImmediate(() => {
      proc.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
        ),
      );
    });
    return true;
  };
  proc.stdin = stdin;
  return proc;
}

async function fromServer(proc, frame) {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
  // Two macrotask turns: notification dispatch + refetch round-trip.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("MCPClient list_changed refresh", () => {
  let proc, state;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    state = {
      tools: [{ name: "alpha", inputSchema: { type: "object" } }],
      resources: [{ uri: "res://a", name: "a" }],
      resourceTemplates: [
        { uriTemplate: "res://{id}", name: "resource-by-id" },
      ],
      toolsListCalls: 0,
    };
    proc = makeFakeProc(state);
    mod._deps.spawn = () => proc;
  });

  it("refetches tools on notifications/tools/list_changed", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });
    expect(client.listTools("srv").map((t) => t.name)).toEqual(["alpha"]);

    const changed = [];
    client.on("tools-changed", (e) => changed.push(e));

    state.tools.push({ name: "beta", inputSchema: { type: "object" } });
    await fromServer(proc, {
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });

    expect(client.listTools("srv").map((t) => t.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(changed).toEqual([{ server: "srv", count: 2 }]);
  });

  it("refetches resources and templates on notifications/resources/list_changed", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    state.resources.push({ uri: "res://b", name: "b" });
    state.resourceTemplates.push({
      uriTemplate: "docs://{slug}",
      name: "document-by-slug",
    });
    await fromServer(proc, {
      jsonrpc: "2.0",
      method: "notifications/resources/list_changed",
    });

    const entry = client.servers.get("srv");
    expect(entry.resources.map((r) => r.name)).toEqual(["a", "b"]);
    expect(
      client.listResourceTemplates("srv").map((template) => template.name),
    ).toEqual(["resource-by-id", "document-by-slug"]);
  });

  it("coalesces a notification burst (in-flight + one trailing refetch)", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });
    const baseline = state.toolsListCalls; // 1 from connect

    for (let i = 0; i < 5; i++) {
      proc.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/tools/list_changed",
          }) + "\n",
        ),
      );
    }
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setImmediate(r));
    }

    const refetches = state.toolsListCalls - baseline;
    expect(refetches).toBeGreaterThanOrEqual(1);
    expect(refetches).toBeLessThanOrEqual(2); // never 5
  });

  it("discards a late list result after the server entry is replaced", async () => {
    const client = new MCPClient();
    const oldEntry = { config: {}, tools: [], _toolMetadataBytes: 0 };
    client.servers.set("srv", oldEntry);
    client._replaceToolInventory("srv", oldEntry, [
      { name: "old", inputSchema: { type: "object" } },
    ]);
    let resolveList;
    let calls = 0;
    client._sendRequest = () => {
      calls++;
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    };
    const changed = [];
    client.on("tools-changed", (event) => changed.push(event));

    const pending = client._refreshServerList("srv", "tools");
    await client._refreshServerList("srv", "tools"); // mark a trailing pass
    client._releaseToolInventory(oldEntry);
    const newEntry = { config: {}, tools: [], _toolMetadataBytes: 0 };
    client.servers.set("srv", newEntry);
    client._replaceToolInventory("srv", newEntry, [
      { name: "current", inputSchema: { type: "object" } },
    ]);
    const currentBudget = client._toolMetadataBytes;

    resolveList({ tools: [{ name: "stale", inputSchema: { type: "object" } }] });
    await pending;

    expect(calls).toBe(1);
    expect(oldEntry.tools).toEqual([]);
    expect(client.listTools("srv").map((tool) => tool.name)).toEqual([
      "current",
    ]);
    expect(client._toolMetadataBytes).toBe(currentBudget);
    expect(changed).toEqual([]);
  });

  it("blocks old tool calls during refresh and after removal before dispatch", async () => {
    const client = new MCPClient();
    const entry = {
      config: {},
      state: ServerState.CONNECTED,
      transportKind: "stdio",
      tools: [{ name: "old", inputSchema: { type: "object" } }],
      _toolMetadataBytes: 0,
    };
    client.servers.set("srv", entry);
    let resolveList;
    const calls = [];
    client._sendRequest = (_server, method, params) => {
      calls.push({ method, params });
      if (method === "tools/list") {
        return new Promise((resolve) => {
          resolveList = resolve;
        });
      }
      return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
    };

    const refresh = client._refreshServerList("srv", "tools");
    await expect(client.callTool("srv", "old", {})).rejects.toMatchObject({
      code: "CC_MCP_TOOL_CATALOG_STALE",
      dispatched: false,
    });
    expect(calls.map((call) => call.method)).toEqual(["tools/list"]);

    resolveList({ tools: [{ name: "new", inputSchema: { type: "object" } }] });
    await refresh;
    await expect(client.callTool("srv", "old", {})).rejects.toMatchObject({
      code: "CC_MCP_TOOL_NOT_ADVERTISED",
      dispatched: false,
    });
    expect(calls.map((call) => call.method)).toEqual(["tools/list"]);
    await expect(client.callTool("srv", "new", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }],
    });
    expect(calls.map((call) => call.method)).toEqual([
      "tools/list",
      "tools/call",
    ]);
  });

  it("keeps tool calls blocked across a trailing refresh and a failed refresh", async () => {
    const client = new MCPClient();
    client.servers.set("srv", {
      config: {},
      state: ServerState.CONNECTED,
      transportKind: "stdio",
      tools: [{ name: "old", inputSchema: { type: "object" } }],
      _toolMetadataBytes: 0,
    });
    const pendingLists = [];
    const methods = [];
    client._sendRequest = (_server, method) => {
      methods.push(method);
      if (method === "tools/list") {
        return new Promise((resolve, reject) => {
          pendingLists.push({ resolve, reject });
        });
      }
      return Promise.resolve({ content: [] });
    };

    const firstRefresh = client._refreshServerList("srv", "tools");
    await client._refreshServerList("srv", "tools");
    pendingLists[0].resolve({ tools: [{ name: "old" }] });
    await Promise.resolve();
    expect(methods).toEqual(["tools/list", "tools/list"]);
    await expect(client.callTool("srv", "old")).rejects.toMatchObject({
      code: "CC_MCP_TOOL_CATALOG_STALE",
      dispatched: false,
    });

    pendingLists[1].reject(new Error("list unavailable"));
    await firstRefresh;
    await expect(client.callTool("srv", "old")).rejects.toMatchObject({
      code: "CC_MCP_TOOL_CATALOG_STALE",
      dispatched: false,
    });
    expect(methods).toEqual(["tools/list", "tools/list"]);

    const retry = client._refreshServerList("srv", "tools");
    pendingLists[2].resolve({ tools: [{ name: "new" }] });
    await retry;
    await expect(client.callTool("srv", "old")).rejects.toMatchObject({
      code: "CC_MCP_TOOL_NOT_ADVERTISED",
      dispatched: false,
    });
    await expect(client.callTool("srv", "new")).resolves.toMatchObject({
      content: [],
    });
    expect(methods).toEqual([
      "tools/list",
      "tools/list",
      "tools/list",
      "tools/call",
    ]);
  });
});
