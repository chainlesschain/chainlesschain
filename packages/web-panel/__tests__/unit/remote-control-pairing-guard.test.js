/**
 * Direct-pairing endpoint trust boundary (security hardening):
 * direct mode has no E2EE host identity, so plaintext ws:// must be
 * loopback / RFC-1918 / link-local only; wss:// may go anywhere.
 * Mirrors packages/cli/src/lib/remote-control.js assertDirectWsUrlAllowed.
 */

import { describe, expect, it } from "vitest";
import {
  REMOTE_CONTROL_PAIRING_SCHEME,
  assertDirectWsUrlAllowed,
  isPrivateOrLoopbackHost,
  parseDirectPairingUri,
} from "../../src/utils/remote-control-pairing.js";

function directUri(wsUrl) {
  const payload = {
    v: 1,
    transport: "direct",
    wsUrl,
    serverToken: "tok",
    remoteSessionId: "rc-1",
    pairingToken: "one-time",
    expiresAt: Date.now() + 60_000,
  };
  return (
    REMOTE_CONTROL_PAIRING_SCHEME +
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  );
}

describe("isPrivateOrLoopbackHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "127.8.9.10",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.20",
    "169.254.10.10",
    "::1",
    "[::1]",
    "[fe80::abcd]",
    "fd12:3456::1",
    "::ffff:192.168.1.20",
    "::ffff:c0a8:114", // hex-mapped 192.168.1.20 (how URL serializes it)
  ])("accepts private/loopback %s", (host) => {
    expect(isPrivateOrLoopbackHost(host)).toBe(true);
  });

  it.each([
    "example.com",
    "evil.attacker.io",
    "8.8.8.8",
    "172.32.0.1", // just past RFC-1918 172.16/12
    "192.169.0.1",
    "[2001:db8::1]",
    "::ffff:808:808", // hex-mapped 8.8.8.8
    "",
  ])("rejects public/unknown %s", (host) => {
    expect(isPrivateOrLoopbackHost(host)).toBe(false);
  });
});

describe("assertDirectWsUrlAllowed", () => {
  it("allows plaintext ws:// to LAN and loopback hosts", () => {
    expect(() =>
      assertDirectWsUrlAllowed("ws://192.168.1.20:18800"),
    ).not.toThrow();
    expect(() =>
      assertDirectWsUrlAllowed("ws://127.0.0.1:18800"),
    ).not.toThrow();
    expect(() => assertDirectWsUrlAllowed("ws://[::1]:18800")).not.toThrow();
  });

  it("allows wss:// to any host (TLS carries the trust)", () => {
    expect(() =>
      assertDirectWsUrlAllowed("wss://relay.example.com:443"),
    ).not.toThrow();
  });

  it("refuses plaintext ws:// to public hosts (phishing URI vector)", () => {
    expect(() =>
      assertDirectWsUrlAllowed("ws://evil.example.com:9999"),
    ).toThrow(/non-private host/);
    expect(() => assertDirectWsUrlAllowed("ws://8.8.8.8:18800")).toThrow(
      /non-private host/,
    );
    expect(() => assertDirectWsUrlAllowed("ws://[2001:db8::1]:18800")).toThrow(
      /non-private host/,
    );
  });

  it("refuses non-WebSocket schemes and garbage", () => {
    expect(() => assertDirectWsUrlAllowed("http://127.0.0.1:18800")).toThrow(
      /must be ws:\/\/ or wss:\/\//,
    );
    expect(() => assertDirectWsUrlAllowed("not a url")).toThrow(
      /Invalid direct pairing endpoint/,
    );
  });
});

describe("parseDirectPairingUri endpoint guard integration", () => {
  it("still parses a legit LAN pairing URI", () => {
    const parsed = parseDirectPairingUri(directUri("ws://192.168.1.20:18800"));
    expect(parsed.wsUrl).toBe("ws://192.168.1.20:18800");
  });

  it("rejects a pairing URI pointing plaintext ws:// at a public host", () => {
    expect(() =>
      parseDirectPairingUri(directUri("ws://evil.example.com:9999")),
    ).toThrow(/non-private host/);
  });
});
