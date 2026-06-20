/**
 * PDH bridge wiring into the MCP resolver: resolveAgentMcp's PDH step (gated by
 * env detection / --pdh / --no-pdh) and loadPdhMcp (discover → connect as the
 * reserved server `pdh`, yielding to an explicit registration).
 * Mirrors mcp-config-ide.test.js. Design: docs/design/modules/101_个人数据IDE桥接方案.md
 */
import { describe, it, expect, vi } from "vitest";
import { resolveAgentMcp, loadPdhMcp } from "../../src/runtime/mcp-config.js";

// A minimal fake MCP client matching what setupMcpFromConfig drives.
function fakeClient() {
  return {
    servers: new Set(),
    connect: vi.fn(async (name) => {
      this?.servers?.add?.(name);
      return { tools: [{ name: "collect_app_data", description: "collect" }] };
    }),
  };
}

describe("resolveAgentMcp — PDH gating", () => {
  const base = { includeRegistered: false, ide: false }; // isolate the PDH branch

  it("does NOT invoke PDH discovery with pdh:false (--no-pdh)", async () => {
    const loadPdhMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, pdh: false, env: { CHAINLESSCHAIN_PDH_PORT: "1" } },
      { loadPdhMcp, isInPdhTerminal: () => true },
    );
    expect(loadPdhMcp).not.toHaveBeenCalled();
  });

  it("invokes PDH discovery (force) with pdh:true even outside a PDH terminal", async () => {
    const loadPdhMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, pdh: true, env: {} },
      { loadPdhMcp, isInPdhTerminal: () => false },
    );
    expect(loadPdhMcp).toHaveBeenCalledOnce();
    expect(loadPdhMcp.mock.calls[0][0]).toMatchObject({ force: true });
  });

  it("auto-invokes PDH discovery when env-wired (pdh undefined)", async () => {
    const loadPdhMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: { CHAINLESSCHAIN_PDH_PORT: "1" } },
      { loadPdhMcp, isInPdhTerminal: () => true },
    );
    expect(loadPdhMcp).toHaveBeenCalledOnce();
    expect(loadPdhMcp.mock.calls[0][0]).toMatchObject({ force: false });
  });

  it("does NOT auto-invoke without an env-wired PDH bridge (pdh undefined)", async () => {
    const loadPdhMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: {} },
      { loadPdhMcp, isInPdhTerminal: () => false },
    );
    expect(loadPdhMcp).not.toHaveBeenCalled();
  });

  it("is skipped under --strict-mcp-config (returns before PDH step)", async () => {
    const loadPdhMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      {
        ...base,
        strict: true,
        pdh: true,
        env: { CHAINLESSCHAIN_PDH_PORT: "1" },
      },
      { loadPdhMcp, isInPdhTerminal: () => true },
    );
    expect(loadPdhMcp).not.toHaveBeenCalled();
  });
});

describe("loadPdhMcp", () => {
  const lock = {
    device: "android",
    url: "http://127.0.0.1:1/mcp",
    transport: "http",
    token: "tok",
  };

  it("returns into (null) when nothing is discovered", async () => {
    const res = await loadPdhMcp({}, { discoverPdhServer: () => null });
    expect(res).toBeNull();
  });

  it("connects the discovered server as reserved name `pdh`", async () => {
    const client = fakeClient();
    const res = await loadPdhMcp(
      { env: {} },
      {
        discoverPdhServer: () => lock,
        pdhServerToMcpConfig: () => ({
          url: lock.url,
          transport: "http",
          headers: { Authorization: "Bearer tok" },
          longRunning: true,
        }),
        createClient: () => client,
      },
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.connect.mock.calls[0][0]).toBe("pdh");
    expect(
      res.externalToolExecutors["mcp__pdh__collect_app_data"],
    ).toMatchObject({
      kind: "mcp",
      serverName: "pdh",
      toolName: "collect_app_data",
    });
  });

  it("yields to an explicit user registration of server `pdh`", async () => {
    const writeErr = vi.fn();
    const into = {
      mcpClient: { servers: new Set(["pdh"]) },
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
      connected: [],
    };
    const discoverPdhServer = vi.fn(() => lock);
    const res = await loadPdhMcp(
      { env: {} },
      { discoverPdhServer, into, writeErr },
    );
    expect(res).toBe(into); // unchanged
    expect(writeErr).toHaveBeenCalled();
    expect(writeErr.mock.calls[0][0]).toMatch(/already registered/);
  });
});
