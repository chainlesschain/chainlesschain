/**
 * IDEA built-in MCP wiring into the MCP resolver: resolveAgentMcp's `idea`
 * step (gated by JetBrains-plugin context / --jetbrains / --no-jetbrains) and
 * loadJetbrainsMcp (discover → connect as reserved server `idea`, yielding to
 * an explicit registration). Scoped: no env URL = no connect (unsupported IDE).
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveAgentMcp,
  loadJetbrainsMcp,
} from "../../src/runtime/mcp-config.js";

// A minimal fake MCP client matching what setupMcpFromConfig drives.
function fakeClient() {
  return {
    servers: new Set(),
    connect: vi.fn(async (name) => {
      return { tools: [{ name: "find_usages", description: "idx" }] };
    }),
  };
}

const JB_ENV = {
  CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/mcp",
};

describe("resolveAgentMcp — IDEA (jetbrains) gating", () => {
  const base = { includeRegistered: false }; // isolate the jetbrains branch

  it("does NOT invoke IDEA discovery with jetbrains:false (--no-jetbrains)", async () => {
    const loadJetbrainsMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, jetbrains: false, env: JB_ENV },
      { loadJetbrainsMcp, isInJetbrainsContext: () => true },
    );
    expect(loadJetbrainsMcp).not.toHaveBeenCalled();
  });

  it("invokes IDEA discovery (force) with jetbrains:true even without env", async () => {
    const loadJetbrainsMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, jetbrains: true, env: {} },
      { loadJetbrainsMcp, isInJetbrainsContext: () => false },
    );
    expect(loadJetbrainsMcp).toHaveBeenCalledOnce();
  });

  it("auto-invokes when the JetBrains plugin injected the endpoint (jetbrains undefined)", async () => {
    const loadJetbrainsMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: JB_ENV },
      { loadJetbrainsMcp, isInJetbrainsContext: () => true },
    );
    expect(loadJetbrainsMcp).toHaveBeenCalledOnce();
  });

  it("does NOT auto-invoke when no endpoint was injected (unsupported IDE)", async () => {
    const loadJetbrainsMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, env: {} },
      { loadJetbrainsMcp, isInJetbrainsContext: () => false },
    );
    expect(loadJetbrainsMcp).not.toHaveBeenCalled();
  });

  it("is skipped entirely under --strict-mcp-config", async () => {
    const loadJetbrainsMcp = vi.fn(async () => null);
    await resolveAgentMcp(
      { ...base, strict: true, env: JB_ENV },
      { loadJetbrainsMcp, isInJetbrainsContext: () => true },
    );
    expect(loadJetbrainsMcp).not.toHaveBeenCalled();
  });
});

describe("loadJetbrainsMcp", () => {
  const found = {
    url: "http://127.0.0.1:64342/mcp",
    transport: "http",
    token: "tok",
  };

  it("returns into (null) when nothing was injected", async () => {
    const res = await loadJetbrainsMcp(
      { env: {} },
      { discoverJetbrainsServer: () => null },
    );
    expect(res).toBeNull();
  });

  it("connects the discovered server as reserved name `idea`", async () => {
    const client = fakeClient();
    const res = await loadJetbrainsMcp(
      { env: JB_ENV },
      {
        discoverJetbrainsServer: () => found,
        jetbrainsServerToMcpConfig: () => ({
          url: found.url,
          transport: "http",
          headers: { Authorization: "Bearer tok" },
          longRunning: true,
        }),
        createClient: () => client,
      },
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.connect.mock.calls[0][0]).toBe("idea");
    expect(res.externalToolExecutors["mcp__idea__find_usages"]).toMatchObject({
      kind: "mcp",
      serverName: "idea",
      toolName: "find_usages",
    });
  });

  it("yields to an explicit user registration of server `idea`", async () => {
    const writeErr = vi.fn();
    const into = {
      mcpClient: { servers: new Set(["idea"]) },
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
      connected: [],
    };
    const discoverJetbrainsServer = vi.fn(() => found);
    const res = await loadJetbrainsMcp(
      { env: JB_ENV },
      { discoverJetbrainsServer, into, writeErr },
    );
    expect(res).toBe(into); // unchanged
    expect(writeErr).toHaveBeenCalled();
    expect(writeErr.mock.calls[0][0]).toMatch(/already registered/);
  });
});
