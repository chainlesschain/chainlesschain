import { describe, expect, it } from "vitest";
import { RemoteSessionPolicy } from "../../src/harness/remote-session-registry.js";

describe("RemoteSessionPolicy", () => {
  it("is a permissive no-op by default", () => {
    const policy = new RemoteSessionPolicy();
    expect(policy.applyScopes(["observe", "approve"])).toEqual({
      scopes: ["observe", "approve"],
      narrowed: false,
    });
    expect(policy.capSessionTtl(1000)).toBe(1000);
    expect(policy.capTokenTtl(1000)).toBe(1000);
    expect(() =>
      policy.enforceJoin({ deviceCount: 100, via: "relay" }),
    ).not.toThrow();
    expect(policy.describe()).toEqual({
      allowedScopes: null,
      maxDevices: null,
      maxSessionTtlMs: null,
      maxTokenTtlMs: null,
      allowRelayPairing: true,
    });
  });

  it("narrows requested scopes to the allow-list and flags narrowing", () => {
    const policy = new RemoteSessionPolicy({
      allowedScopes: ["observe", "prompt"],
    });
    expect(
      policy.applyScopes(["observe", "prompt", "approve", "interrupt"]),
    ).toEqual({
      scopes: ["observe", "prompt"],
      narrowed: true,
    });
    // A null request expands to the full set, then narrows.
    expect(policy.applyScopes(null)).toEqual({
      scopes: ["observe", "prompt"],
      narrowed: true,
    });
    // No narrowing when the request already fits.
    expect(policy.applyScopes(["observe"])).toEqual({
      scopes: ["observe"],
      narrowed: false,
    });
  });

  it("throws only when request and allow-list are wholly disjoint", () => {
    const policy = new RemoteSessionPolicy({ allowedScopes: ["observe"] });
    expect(() => policy.applyScopes(["approve", "interrupt"])).toThrow(
      /not permitted by org policy/,
    );
  });

  it("rejects an unknown scope in the allow-list", () => {
    expect(
      () => new RemoteSessionPolicy({ allowedScopes: ["observe", "root"] }),
    ).toThrow(/Unknown scope/);
    expect(() => new RemoteSessionPolicy({ allowedScopes: [] })).toThrow(
      /cannot be empty/,
    );
  });

  it("caps session and token TTLs to the configured maxima", () => {
    const policy = new RemoteSessionPolicy({
      maxSessionTtlMs: 5000,
      maxTokenTtlMs: 1000,
    });
    expect(policy.capSessionTtl(10_000)).toBe(5000);
    expect(policy.capSessionTtl(3000)).toBe(3000);
    expect(policy.capTokenTtl(10_000)).toBe(1000);
  });

  it("enforces the device limit and the relay toggle", () => {
    const policy = new RemoteSessionPolicy({
      maxDevices: 2,
      allowRelayPairing: false,
    });
    expect(() =>
      policy.enforceJoin({ deviceCount: 1, via: "direct" }),
    ).not.toThrow();
    expect(() => policy.enforceJoin({ deviceCount: 2, via: "direct" })).toThrow(
      /device limit reached/,
    );
    expect(() => policy.enforceJoin({ deviceCount: 0, via: "relay" })).toThrow(
      /Relay pairing is disabled/,
    );
  });

  it("builds a policy from environment variables", () => {
    const policy = RemoteSessionPolicy.fromEnv({
      CHAINLESSCHAIN_REMOTE_SESSION_ALLOWED_SCOPES: "observe, prompt",
      CHAINLESSCHAIN_REMOTE_SESSION_MAX_DEVICES: "3",
      CHAINLESSCHAIN_REMOTE_SESSION_MAX_SESSION_TTL_MS: "60000",
      CHAINLESSCHAIN_REMOTE_SESSION_ALLOW_RELAY: "false",
    });
    expect(policy.describe()).toEqual({
      allowedScopes: ["observe", "prompt"],
      maxDevices: 3,
      maxSessionTtlMs: 60000,
      maxTokenTtlMs: null,
      allowRelayPairing: false,
    });
  });

  it("returns a permissive policy from an empty environment", () => {
    expect(RemoteSessionPolicy.fromEnv({}).describe()).toEqual({
      allowedScopes: null,
      maxDevices: null,
      maxSessionTtlMs: null,
      maxTokenTtlMs: null,
      allowRelayPairing: true,
    });
  });
});
