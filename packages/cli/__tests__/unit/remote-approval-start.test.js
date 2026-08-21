import { describe, expect, it, vi } from "vitest";
import { startHeadlessRemoteApproval } from "../../src/lib/remote-approval-bridge.js";

function fakeRuntime({ pairingMode = "direct" } = {}) {
  let serverOptions;
  let bridgeOptions;
  const server = {
    port: 19001,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  class FakeServer {
    constructor(options) {
      serverOptions = options;
      return server;
    }
  }
  const bridge = {
    start: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    pairingInfo: vi.fn(({ lanWsUrl }) => ({
      uri:
        pairingMode === "relay"
          ? "chainlesschain://remote-session/relay"
          : `chainlesschain://remote-control/pair#${lanWsUrl}`,
      mode: pairingMode,
      remoteSessionId: "remote-1",
      scopes: ["observe", "approve"],
      expiresAt: 123,
    })),
    makeConfirmer: vi.fn(() => vi.fn()),
    consumeAuthorization: vi.fn(async () => true),
  };
  return {
    server,
    bridge,
    deps: {
      serverModule: { ChainlessChainWSServer: FakeServer },
      createBridge(options) {
        bridgeOptions = options;
        return bridge;
      },
    },
    inspect() {
      return { serverOptions, bridgeOptions };
    },
  };
}

describe("startHeadlessRemoteApproval exposure boundary", () => {
  it("fails before server startup when neither relay nor LAN was opted in", async () => {
    const runtime = fakeRuntime();
    await expect(
      startHeadlessRemoteApproval({
        agentSessionId: "agent-1",
        env: {},
        config: {},
        deps: runtime.deps,
      }),
    ).rejects.toThrow(/loopback-only.*relay.*allowLan/i);
    expect(runtime.server.start).not.toHaveBeenCalled();
    expect(runtime.inspect().serverOptions).toBeUndefined();
  });

  it("permits direct pairing after explicit LAN opt-in and warns", async () => {
    const runtime = fakeRuntime({ pairingMode: "direct" });
    const warn = vi.fn();
    const started = await startHeadlessRemoteApproval({
      agentSessionId: "agent-1",
      allowLan: true,
      env: {},
      config: {},
      deps: {
        ...runtime.deps,
        lanAddress: "192.168.50.20",
        warn,
      },
    });

    expect(runtime.inspect().serverOptions.host).toBe("0.0.0.0");
    expect(runtime.inspect().bridgeOptions.wsUrl).toBe("ws://127.0.0.1:19001");
    expect(runtime.bridge.pairingInfo).toHaveBeenCalledWith({
      lanWsUrl: "ws://192.168.50.20:19001",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/plaintext ws:\/\//i),
    );
    expect(started.pairing.mode).toBe("direct");

    await started.close();
    expect(runtime.bridge.close).toHaveBeenCalled();
    expect(runtime.server.stop).toHaveBeenCalled();
  });

  it("fails before startup when wildcard binding has no private address", async () => {
    const runtime = fakeRuntime({ pairingMode: "direct" });
    await expect(
      startHeadlessRemoteApproval({
        agentSessionId: "agent-1",
        allowLan: true,
        env: {},
        config: {},
        deps: { ...runtime.deps, pickLanAddress: () => null },
      }),
    ).rejects.toThrow(/no private LAN address/i);
    expect(runtime.server.start).not.toHaveBeenCalled();
    expect(runtime.inspect().serverOptions).toBeUndefined();
  });

  it("closes the bridge and listener after a late pairing failure", async () => {
    const runtime = fakeRuntime({ pairingMode: "direct" });
    runtime.bridge.pairingInfo.mockImplementation(() => {
      throw new Error("pairing publication failed");
    });
    await expect(
      startHeadlessRemoteApproval({
        agentSessionId: "agent-1",
        allowLan: true,
        env: {},
        config: {},
        deps: { ...runtime.deps, lanAddress: "192.168.50.20" },
      }),
    ).rejects.toThrow(/pairing publication failed/);
    expect(runtime.bridge.close).toHaveBeenCalled();
    expect(runtime.server.stop).toHaveBeenCalled();
  });

  it("keeps relay mode on loopback and never falls back silently", async () => {
    const relayRuntime = fakeRuntime({ pairingMode: "relay" });
    const relay = await startHeadlessRemoteApproval({
      agentSessionId: "agent-1",
      env: { CC_REMOTE_SESSION_RELAY_URL: "wss://relay.example" },
      config: {},
      deps: relayRuntime.deps,
    });
    expect(relayRuntime.inspect().serverOptions.host).toBe("127.0.0.1");
    expect(relay.pairing.mode).toBe("relay");
    await relay.close();

    const fallbackRuntime = fakeRuntime({ pairingMode: "direct" });
    await expect(
      startHeadlessRemoteApproval({
        agentSessionId: "agent-2",
        env: { CC_REMOTE_SESSION_RELAY_URL: "wss://relay.example" },
        config: {},
        deps: fallbackRuntime.deps,
      }),
    ).rejects.toThrow(/refusing to fall back to LAN/i);
    expect(fallbackRuntime.bridge.close).toHaveBeenCalled();
    expect(fallbackRuntime.server.stop).toHaveBeenCalled();
  });
});
