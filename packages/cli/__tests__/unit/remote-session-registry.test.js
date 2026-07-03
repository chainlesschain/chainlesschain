import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_SESSION_PROTOCOL_VERSION,
  RemoteSessionPolicy,
  RemoteSessionRegistry,
} from "../../src/harness/remote-session-registry.js";

describe("RemoteSessionRegistry", () => {
  it("creates a session and pairs one remote client with explicit scopes", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "desktop",
      agentSessionId: "agent-1",
      name: "Fix CI",
      scopes: ["observe", "approve"],
    });

    expect(created.session.protocolVersion).toBe(
      REMOTE_SESSION_PROTOCOL_VERSION,
    );
    expect(created.session.memberCount).toBe(1);
    expect(created.pairing.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const joined = registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });
    expect(joined.member.scopes).toEqual(["observe", "approve"]);
    expect(joined.session.memberCount).toBe(2);
    expect(() =>
      registry.authorize(created.session.sessionId, "phone", "approve"),
    ).not.toThrow();
    expect(() =>
      registry.authorize(created.session.sessionId, "phone", "prompt"),
    ).toThrow(/scope required/);
  });

  it("uses one-time pairing tokens", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "tablet",
        token: created.pairing.token,
      }),
    ).toThrow(/missing or expired/);
  });

  it("rejects invalid and expired pairing credentials", () => {
    const clock = vi.fn(() => 1_000);
    const registry = new RemoteSessionRegistry({ now: clock, tokenTtlMs: 100 });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "x",
        token: "wrong",
      }),
    ).toThrow(/Invalid/);
    clock.mockReturnValue(1_101);
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "x",
        token: created.pairing.token,
      }),
    ).toThrow(/expired/);
  });

  it("closes hosted sessions when the host disconnects", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    const result = registry.removeClient("host");
    expect(result).toEqual([
      { sessionId: created.session.sessionId, closed: true },
    ]);
    expect(() => registry.requireSession(created.session.sessionId)).toThrow(
      /not found/,
    );
  });

  it("rejects unknown scopes", () => {
    const registry = new RemoteSessionRegistry();
    expect(() =>
      registry.create({
        hostClientId: "host",
        agentSessionId: "agent-1",
        scopes: ["admin"],
      }),
    ).toThrow(/Unsupported/);
  });

  it("allows only the host to close a session", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    expect(() => registry.close(created.session.sessionId, "phone")).toThrow(
      /Only the host/,
    );
    expect(registry.close(created.session.sessionId, "host").sessionId).toBe(
      created.session.sessionId,
    );
    expect(() => registry.requireSession(created.session.sessionId)).toThrow(
      /not found/,
    );
  });

  function seedPairedSession(registry) {
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });
    return created.session.sessionId;
  }

  it("lists paired devices with a host marker for the owner only", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    const { devices } = registry.listDevices(sessionId, "host");
    expect(devices).toHaveLength(2);
    const host = devices.find((d) => d.clientId === "host");
    const phone = devices.find((d) => d.clientId === "phone");
    expect(host.isHost).toBe(true);
    expect(phone.isHost).toBe(false);
    expect(phone.scopes).toEqual(expect.arrayContaining(["observe"]));
    expect(() => registry.listDevices(sessionId, "phone")).toThrow(
      /Only the host/,
    );
  });

  it("revokes a paired device and blocks its subsequent authorization", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    const { member, session } = registry.revokeMember(
      sessionId,
      "host",
      "phone",
    );
    expect(member.clientId).toBe("phone");
    expect(session.memberCount).toBe(1);
    expect(() => registry.authorize(sessionId, "phone", "observe")).toThrow(
      /not paired/,
    );
    expect(registry.listDevices(sessionId, "host").devices).toHaveLength(1);
  });

  it("refuses to revoke from non-hosts or to revoke the host itself", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    expect(() => registry.revokeMember(sessionId, "phone", "host")).toThrow(
      /Only the host/,
    );
    expect(() => registry.revokeMember(sessionId, "host", "host")).toThrow(
      /Cannot revoke the host/,
    );
    expect(() => registry.revokeMember(sessionId, "host", "unknown")).toThrow(
      /not paired/,
    );
  });

  it("narrows pairing-token scopes to the org policy at issue time", () => {
    const registry = new RemoteSessionRegistry({
      policy: new RemoteSessionPolicy({ allowedScopes: ["observe", "prompt"] }),
    });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
      scopes: ["observe", "prompt", "approve", "interrupt"],
    });
    expect(created.pairing.scopes).toEqual(["observe", "prompt"]);
    expect(created.pairing.policyNarrowed).toBe(true);
    // The host keeps full control of its own session; only the device is capped.
    const joined = registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });
    expect(joined.member.scopes).toEqual(["observe", "prompt"]);
    expect(() =>
      registry.authorize(created.session.sessionId, "phone", "approve"),
    ).toThrow(/scope required/);
  });

  it("caps session and token TTLs to the org policy", () => {
    const clock = vi.fn(() => 10_000);
    const registry = new RemoteSessionRegistry({
      now: clock,
      sessionTtlMs: 12 * 60 * 60 * 1000,
      tokenTtlMs: 5 * 60 * 1000,
      policy: new RemoteSessionPolicy({
        maxSessionTtlMs: 60_000,
        maxTokenTtlMs: 30_000,
      }),
    });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    expect(created.session.expiresAt).toBe(10_000 + 60_000);
    expect(created.pairing.expiresAt).toBe(10_000 + 30_000);
  });

  it("enforces the org device limit on join", () => {
    const registry = new RemoteSessionRegistry({
      policy: new RemoteSessionPolicy({ maxDevices: 1 }),
    });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });
    const second = registry.issuePairingToken(created.session.sessionId);
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "tablet",
        token: second.token,
      }),
    ).toThrow(/device limit reached/);
  });

  it("blocks relay pairing when disabled by org policy", () => {
    const registry = new RemoteSessionRegistry({
      policy: new RemoteSessionPolicy({ allowRelayPairing: false }),
    });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "phone",
        token: created.pairing.token,
        via: "relay",
      }),
    ).toThrow(/Relay pairing is disabled/);
    // The same device may still pair directly.
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "phone",
        token: created.pairing.token,
        via: "direct",
      }),
    ).not.toThrow();
  });
});
