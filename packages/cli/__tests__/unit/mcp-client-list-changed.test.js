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
import { MCPClient } from "../../src/lib/mcp-client.js";

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

  it("refetches resources on notifications/resources/list_changed", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    state.resources.push({ uri: "res://b", name: "b" });
    await fromServer(proc, {
      jsonrpc: "2.0",
      method: "notifications/resources/list_changed",
    });

    const entry = client.servers.get("srv");
    expect(entry.resources.map((r) => r.name)).toEqual(["a", "b"]);
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
});
