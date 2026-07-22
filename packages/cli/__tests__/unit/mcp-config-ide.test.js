/**
 * IDE bridge wiring into the MCP resolver: resolveAgentMcp's third step
 * (gated by terminal detection / --ide / --no-ide) and loadIdeMcp (discover →
 * connect as reserved server `ide`, yielding to an explicit registration).
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveAgentMcp,
  loadIdeMcp,
} from "../../src/runtime/mcp-config.js";

// A minimal fake MCP client matching what setupMcpFromConfig drives.
function fakeClient() {
  return {
    servers: new Set(),
    connect: vi.fn(async (name) => {
      this?.servers?.add?.(name);
      return { tools: [{ name: "getSelection", description: "sel" }] };
    }),
  };
}

describe("resolveAgentMcp — IDE gating", () => {
  const base = { includeRegistered: false }; // isolate the IDE branch

  it("does NOT invoke IDE discovery with ide:false (--no-ide)", async () => {
    const loadIdeMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, ide: false, env: { TERM_PROGRAM: "vscode" } },
      { loadIdeMcp, isInIdeTerminal: () => true },
    );
    expect(loadIdeMcp).not.toHaveBeenCalled();
  });

  it("invokes IDE discovery (force) with ide:true even outside a terminal", async () => {
    const loadIdeMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, ide: true, env: {} },
      { loadIdeMcp, isInIdeTerminal: () => false },
    );
    expect(loadIdeMcp).toHaveBeenCalledOnce();
    expect(loadIdeMcp.mock.calls[0][0]).toMatchObject({ force: true });
  });

  it("auto-invokes IDE discovery inside an IDE terminal (ide undefined)", async () => {
    const loadIdeMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: { TERM_PROGRAM: "vscode" } },
      { loadIdeMcp, isInIdeTerminal: () => true },
    );
    expect(loadIdeMcp).toHaveBeenCalledOnce();
    expect(loadIdeMcp.mock.calls[0][0]).toMatchObject({ force: false });
  });

  it("forwards the durable Event Runtime store to external MCP producers", async () => {
    const eventRuntimeStore = { enqueue: vi.fn() };
    const loadIdeMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, ide: true, env: {} },
      { loadIdeMcp, eventRuntimeStore, isInIdeTerminal: () => false },
    );
    expect(loadIdeMcp.mock.calls[0][1].eventRuntimeStore).toBe(eventRuntimeStore);
  });

  it("does NOT auto-invoke outside an IDE terminal (ide undefined)", async () => {
    const loadIdeMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: {} },
      { loadIdeMcp, isInIdeTerminal: () => false },
    );
    expect(loadIdeMcp).not.toHaveBeenCalled();
  });
});

describe("loadIdeMcp", () => {
  const lock = {
    ide: "vscode",
    url: "http://127.0.0.1:1/sse",
    transport: "sse",
    token: "tok",
  };

  it("returns into (null) when nothing is discovered", async () => {
    const res = await loadIdeMcp(
      {},
      { discoverIdeServer: () => null },
    );
    expect(res).toBeNull();
  });

  it("connects the discovered server as reserved name `ide`", async () => {
    const client = fakeClient();
    const res = await loadIdeMcp(
      { cwd: "/abs/ws" },
      {
        discoverIdeServer: () => lock,
        ideServerToMcpConfig: () => ({
          url: lock.url,
          transport: "sse",
          headers: { Authorization: "Bearer tok" },
        }),
        createClient: () => client,
      },
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.connect.mock.calls[0][0]).toBe("ide");
    expect(res.externalToolExecutors["mcp__ide__getSelection"]).toMatchObject({
      kind: "mcp",
      serverName: "ide",
      toolName: "getSelection",
    });
  });

  it("yields to an explicit user registration of server `ide`", async () => {
    const writeErr = vi.fn();
    const into = {
      mcpClient: { servers: new Set(["ide"]) },
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
      connected: [],
    };
    const discoverIdeServer = vi.fn(() => lock);
    const res = await loadIdeMcp(
      { cwd: "/abs/ws" },
      { discoverIdeServer, into, writeErr },
    );
    expect(res).toBe(into); // unchanged
    expect(writeErr).toHaveBeenCalled();
    expect(writeErr.mock.calls[0][0]).toMatch(/already registered/);
  });
});
