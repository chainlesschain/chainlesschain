import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  REMOTE_CONTROL_DEFAULT_PORT,
  REMOTE_CONTROL_DEFAULT_SCOPES,
  assertDirectWsUrlAllowed,
  buildDirectPairingUri,
  parseDirectPairingUri,
  parseScopes,
  pickLanAddress,
  isPidAlive,
  readRemoteControlStates,
  removeRemoteControlState,
  renderQrCode,
  resolveRemoteControlOptions,
  writeRemoteControlState,
} from "../../src/lib/remote-control.js";
import { resolveServerPolicy } from "../../src/runtime/policies/agent-policy.js";

describe("parseScopes", () => {
  it("defaults to the full scope set when empty", () => {
    expect(parseScopes(null)).toEqual([...REMOTE_CONTROL_DEFAULT_SCOPES]);
    expect(parseScopes("")).toEqual([...REMOTE_CONTROL_DEFAULT_SCOPES]);
  });

  it("splits on commas/whitespace and dedupes", () => {
    expect(parseScopes("observe, prompt observe")).toEqual([
      "observe",
      "prompt",
    ]);
  });

  it("rejects unknown scopes", () => {
    expect(() => parseScopes("observe,root")).toThrow(/Unknown remote-control/);
  });
});

describe("resolveRemoteControlOptions", () => {
  it("applies defaults and auto-generates a token", () => {
    const opts = resolveRemoteControlOptions({
      flags: {},
      env: {},
      config: {},
    });
    expect(opts.port).toBe(REMOTE_CONTROL_DEFAULT_PORT);
    expect(opts.host).toBe("0.0.0.0");
    expect(opts.token).toMatch(/^[0-9a-f]{32}$/);
    expect(opts.relayUrl).toBeNull();
    expect(opts.peerId).toBeNull();
    expect(opts.scopes).toEqual([...REMOTE_CONTROL_DEFAULT_SCOPES]);
  });

  it("prefers flags over env over config", () => {
    const opts = resolveRemoteControlOptions({
      flags: { port: "19999", token: "flag-token" },
      env: {
        CC_REMOTE_CONTROL_PORT: "18888",
        CC_REMOTE_CONTROL_TOKEN: "env-token",
        CC_REMOTE_SESSION_RELAY_URL: "wss://env-relay.example",
      },
      config: {
        remoteControl: { port: 17777, token: "config-token" },
        remoteSession: { relayUrl: "wss://config-relay.example" },
      },
    });
    expect(opts.port).toBe(19999);
    expect(opts.token).toBe("flag-token");
    expect(opts.relayUrl).toBe("wss://env-relay.example");
  });

  it("auto-derives a peer id only when a relay is configured", () => {
    const withRelay = resolveRemoteControlOptions({
      flags: { relayUrl: "wss://relay.example" },
      env: {},
      config: {},
    });
    expect(withRelay.peerId).toMatch(/^cc-host-/);
    const without = resolveRemoteControlOptions({
      flags: {},
      env: {},
      config: {},
    });
    expect(without.peerId).toBeNull();
  });

  it("falls back to the default port on garbage input", () => {
    const opts = resolveRemoteControlOptions({
      flags: { port: "not-a-port" },
      env: {},
      config: {},
    });
    expect(opts.port).toBe(REMOTE_CONTROL_DEFAULT_PORT);
  });
});

describe("direct pairing URI", () => {
  it("roundtrips the payload", () => {
    const uri = buildDirectPairingUri({
      wsUrl: "ws://192.168.1.10:18800",
      serverToken: "server-secret",
      remoteSessionId: "rs-1",
      agentSessionId: "agent-1",
      pairingToken: "pair-token",
      scopes: ["observe", "approve"],
      expiresAt: 1234567890,
    });
    expect(uri).toMatch(/^chainlesschain:\/\/remote-control\/pair#/);
    expect(parseDirectPairingUri(uri)).toEqual({
      v: 1,
      transport: "direct",
      wsUrl: "ws://192.168.1.10:18800",
      serverToken: "server-secret",
      remoteSessionId: "rs-1",
      agentSessionId: "agent-1",
      pairingToken: "pair-token",
      scopes: ["observe", "approve"],
      expiresAt: 1234567890,
    });
  });

  it("requires the essential fields", () => {
    expect(() =>
      buildDirectPairingUri({ wsUrl: "ws://x", remoteSessionId: "rs" }),
    ).toThrow(/required/);
  });

  it("rejects foreign URIs", () => {
    expect(() => parseDirectPairingUri("https://example.com")).toThrow(
      /Not a remote-control pairing URI/,
    );
  });
});

describe("direct pairing endpoint trust boundary", () => {
  // Direct mode has no E2EE host identity — the endpoint IS the trust
  // boundary. Plaintext ws:// only to loopback/RFC-1918/link-local (all
  // pickLanAddress can emit); wss:// anywhere. Mirrored in the web-panel
  // parser (packages/web-panel/src/utils/remote-control-pairing.js).
  it.each([
    "ws://127.0.0.1:18800",
    "ws://192.168.1.10:18800",
    "ws://10.1.2.3:18800",
    "ws://172.31.0.9:18800",
    "ws://[::1]:18800",
    "ws://localhost:18800",
    "wss://anywhere.example.com:443",
  ])("allows %s", (wsUrl) => {
    expect(() => assertDirectWsUrlAllowed(wsUrl)).not.toThrow();
  });

  it.each([
    "ws://evil.example.com:9999",
    "ws://8.8.8.8:18800",
    "ws://[2001:db8::1]:18800",
    "ws://172.32.0.1:18800",
  ])("refuses plaintext %s to a public host", (wsUrl) => {
    expect(() => assertDirectWsUrlAllowed(wsUrl)).toThrow(/non-private host/);
  });

  it("refuses non-WebSocket schemes and garbage", () => {
    expect(() => assertDirectWsUrlAllowed("http://127.0.0.1:1")).toThrow(
      /must be ws:\/\/ or wss:\/\//,
    );
    expect(() => assertDirectWsUrlAllowed("%%%")).toThrow(
      /Invalid direct pairing endpoint/,
    );
  });

  it("parseDirectPairingUri enforces the guard on embedded wsUrl", () => {
    const evil = buildDirectPairingUri({
      wsUrl: "ws://evil.example.com:9999",
      remoteSessionId: "rs-1",
      pairingToken: "pair-token",
    });
    expect(() => parseDirectPairingUri(evil)).toThrow(/non-private host/);
  });
});

describe("pickLanAddress", () => {
  it("returns the first non-internal IPv4", () => {
    expect(
      pickLanAddress({
        lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
        eth0: [
          { family: "IPv6", address: "::1", internal: false },
          { family: "IPv4", address: "192.168.5.20", internal: false },
        ],
      }),
    ).toBe("192.168.5.20");
  });

  it("supports the numeric family form (Node 18+) and empty maps", () => {
    expect(
      pickLanAddress({
        eth0: [{ family: 4, address: "10.0.0.7", internal: false }],
      }),
    ).toBe("10.0.0.7");
    expect(pickLanAddress({})).toBeNull();
  });
});

describe("state files", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rc-state-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes, reads (with liveness) and removes a record", () => {
    writeRemoteControlState(
      { pid: process.pid, port: 18800, mode: "direct", token: "t" },
      { dir },
    );
    const states = readRemoteControlStates({ dir });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      pid: process.pid,
      port: 18800,
      alive: true,
    });
    expect(removeRemoteControlState(18800, { dir })).toBe(true);
    expect(readRemoteControlStates({ dir })).toHaveLength(0);
  });

  it("marks dead pids and survives corrupt files", () => {
    writeRemoteControlState({ pid: 999999999, port: 18801 }, { dir });
    fs.writeFileSync(path.join(dir, "18802.json"), "{ not json", "utf-8");
    const states = readRemoteControlStates({ dir });
    const byPort = Object.fromEntries(states.map((s) => [s.port, s]));
    expect(byPort[18801].alive).toBe(false);
    expect(states.some((s) => s.invalid)).toBe(true);
  });

  it("returns [] when the directory does not exist", () => {
    expect(readRemoteControlStates({ dir: path.join(dir, "missing") })).toEqual(
      [],
    );
  });
});

describe("isPidAlive", () => {
  it("is true for this process and false for junk", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(NaN)).toBe(false);
  });
});

describe("renderQrCode", () => {
  it("returns null when the optional qrcode package is unavailable", async () => {
    const qr = await renderQrCode("hello", {
      importer: async () => {
        throw new Error("Cannot find package 'qrcode'");
      },
    });
    expect(qr).toBeNull();
  });

  it("uses an injected qrcode implementation when present", async () => {
    const qr = await renderQrCode("hello", {
      importer: async () => ({
        default: { toString: async (text) => `QR[${text}]` },
      }),
    });
    expect(qr).toBe("QR[hello]");
  });
});

describe("resolveServerPolicy remote-session keys (regression)", () => {
  it("keeps remoteSessionRelayUrl/PeerId instead of dropping them", () => {
    const policy = resolveServerPolicy({
      port: 18800,
      remoteSessionRelayUrl: "wss://relay.example",
      remoteSessionPeerId: "host-1",
    });
    expect(policy.remoteSessionRelayUrl).toBe("wss://relay.example");
    expect(policy.remoteSessionPeerId).toBe("host-1");
  });

  it("defaults them to null", () => {
    const policy = resolveServerPolicy({});
    expect(policy.remoteSessionRelayUrl).toBeNull();
    expect(policy.remoteSessionPeerId).toBeNull();
  });
});
