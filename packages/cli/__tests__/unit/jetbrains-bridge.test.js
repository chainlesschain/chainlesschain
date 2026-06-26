/**
 * JetBrains / IDEA built-in MCP discovery (cc-side) — deterministic env -> MCP
 * config mapping. The ChainlessChain JetBrains plugin injects
 * CHAINLESSCHAIN_JETBRAINS_MCP_URL (+ _TOKEN / _TRANSPORT) only when the IDE
 * (>= 2025.2) actually exposes MCP; cc connects iff that URL is present + valid.
 * No lockfile, no scan, no proxy — pure unit over env objects.
 */
import { describe, it, expect } from "vitest";
import {
  isInJetbrainsContext,
  discoverJetbrainsServer,
  jetbrainsServerToMcpConfig,
  diagnoseJetbrains,
} from "../../src/lib/jetbrains-bridge.js";

describe("jetbrains-bridge discovery", () => {
  it("isInJetbrainsContext is true only when the plugin injected an MCP URL", () => {
    expect(isInJetbrainsContext({})).toBe(false);
    expect(
      isInJetbrainsContext({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }),
    ).toBe(false);
    expect(
      isInJetbrainsContext({
        CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/sse",
      }),
    ).toBe(true);
  });

  it("returns null when the IDE injected nothing (unsupported / not from plugin)", () => {
    expect(discoverJetbrainsServer({ env: {} })).toBeNull();
  });

  it("infers transport from the injected loopback URL", () => {
    expect(
      discoverJetbrainsServer({
        env: { CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/sse" },
      }),
    ).toEqual({
      url: "http://127.0.0.1:64342/sse",
      transport: "sse",
      token: null,
    });

    expect(
      discoverJetbrainsServer({
        env: { CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://localhost:63342/mcp" },
      }),
    ).toEqual({
      url: "http://localhost:63342/mcp",
      transport: "http",
      token: null,
    });
  });

  it("honors an explicit transport + token override", () => {
    expect(
      discoverJetbrainsServer({
        env: {
          CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/api/mcp",
          CHAINLESSCHAIN_JETBRAINS_TRANSPORT: "http",
          CHAINLESSCHAIN_JETBRAINS_TOKEN: "tok-123",
        },
      }),
    ).toEqual({
      url: "http://127.0.0.1:64342/api/mcp",
      transport: "http",
      token: "tok-123",
    });
  });

  it("refuses a non-loopback URL (never connect cc to an arbitrary host)", () => {
    expect(
      discoverJetbrainsServer({
        env: { CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://10.0.0.5:64342/sse" },
      }),
    ).toBeNull();
    expect(
      discoverJetbrainsServer({
        env: {
          CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://evil.example.com/mcp",
        },
      }),
    ).toBeNull();
  });

  it("refuses an unsupported transport (e.g. ws)", () => {
    expect(
      discoverJetbrainsServer({
        env: {
          CHAINLESSCHAIN_JETBRAINS_MCP_URL: "ws://127.0.0.1:64342/mcp",
          CHAINLESSCHAIN_JETBRAINS_TRANSPORT: "ws",
        },
      }),
    ).toBeNull();
  });

  it("maps a discovered server to an MCP config (bearer header + longRunning)", () => {
    const found = discoverJetbrainsServer({
      env: {
        CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/mcp",
        CHAINLESSCHAIN_JETBRAINS_TRANSPORT: "http",
        CHAINLESSCHAIN_JETBRAINS_TOKEN: "tok-123",
      },
    });
    expect(jetbrainsServerToMcpConfig(found)).toEqual({
      url: "http://127.0.0.1:64342/mcp",
      transport: "http",
      headers: { Authorization: "Bearer tok-123" },
      longRunning: true,
    });
  });

  it("omits the Authorization header when there is no token", () => {
    const found = discoverJetbrainsServer({
      env: { CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/mcp" },
    });
    expect(jetbrainsServerToMcpConfig(found)).toEqual({
      url: "http://127.0.0.1:64342/mcp",
      transport: "http",
      headers: {},
      longRunning: true,
    });
  });

  it("jetbrainsServerToMcpConfig(null) is null", () => {
    expect(jetbrainsServerToMcpConfig(null)).toBeNull();
  });
});

describe("diagnoseJetbrains", () => {
  it("explains the unsupported / not-from-plugin case (no token leak)", () => {
    const d = diagnoseJetbrains({ env: {} });
    expect(d.supported).toBe(false);
    expect(d.chosen).toBeNull();
    expect(d.reason).toMatch(/no CHAINLESSCHAIN_JETBRAINS_MCP_URL/);
  });

  it("explains a chosen server and never surfaces the raw token", () => {
    const d = diagnoseJetbrains({
      env: {
        CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://127.0.0.1:64342/mcp",
        CHAINLESSCHAIN_JETBRAINS_TRANSPORT: "http",
        CHAINLESSCHAIN_JETBRAINS_TOKEN: "super-secret",
      },
    });
    expect(d.supported).toBe(true);
    expect(d.chosen).toEqual({
      url: "http://127.0.0.1:64342/mcp",
      transport: "http",
      hasToken: true,
    });
    expect(JSON.stringify(d)).not.toContain("super-secret");
  });

  it("explains a present-but-invalid (non-loopback) URL", () => {
    const d = diagnoseJetbrains({
      env: { CHAINLESSCHAIN_JETBRAINS_MCP_URL: "http://10.0.0.5:64342/sse" },
    });
    expect(d.supported).toBe(true);
    expect(d.chosen).toBeNull();
    expect(d.reason).toMatch(/loopback/);
  });
});
