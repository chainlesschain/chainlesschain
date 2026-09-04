import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_SESSION_PROTOCOL_VERSION,
  REMOTE_SESSION_SCOPES,
  RemoteSessionPolicy,
  RemoteSessionRegistry,
} from "../../src/harness/remote-session-registry.js";

function durableSnapshot(sessionId = "durable-late") {
  return {
    sessionId,
    agentSessionId: "agent-1",
    hostPrincipalId: `ed25519:${"a".repeat(64)}`,
    sessionEpoch: "1",
    createdAt: 1_000,
    expiresAt: 100_000,
    status: "active",
    authorityGeneration: "1",
    members: [
      {
        principalId: `ed25519:${"a".repeat(64)}`,
        membershipEpoch: "1",
        status: "active",
        scopes: [...REMOTE_SESSION_SCOPES],
        credentialKeySha256: "a".repeat(64),
      },
    ],
    leases: [],
  };
}

function fakeCoordinator({ listSessionSnapshots, getSessionSnapshot }) {
  return {
    listSessionSnapshots,
    getSessionSnapshot,
    trustDescriptor: () => ({
      authorityVersion: "durable-monotonic-membership-epoch-v1",
    }),
  };
}

describe("RemoteSessionRegistry", () => {
  it("keeps a lazy durable coordinator unopened for in-memory enumeration", () => {
    const coordinatorFactory = vi.fn(() =>
      fakeCoordinator({
        listSessionSnapshots: vi.fn(() => []),
        getSessionSnapshot: vi.fn(() => null),
      }),
    );
    const registry = new RemoteSessionRegistry({
      membershipCoordinator: coordinatorFactory,
    });
    registry.create({
      hostClientId: "desktop",
      agentSessionId: "agent-1",
    });

    expect(registry.findHosted("agent-1", "desktop")).toHaveLength(1);
    expect(coordinatorFactory).not.toHaveBeenCalled();
  });

  it("discovers a durable session created after this server completed its initial hydration", () => {
    let current = null;
    const coordinator = fakeCoordinator({
      listSessionSnapshots: vi.fn(() => []),
      getSessionSnapshot: vi.fn(() =>
        current ? { session: current, statement: {} } : null,
      ),
    });
    const serverB = new RemoteSessionRegistry({
      now: () => 1_000,
      membershipCoordinator: coordinator,
    });
    current = durableSnapshot();

    expect(serverB.requireSession(current.sessionId)).toMatchObject({
      sessionId: current.sessionId,
      sessionEpoch: "1",
      status: "active",
    });
    expect(coordinator.getSessionSnapshot).toHaveBeenCalledWith(
      current.sessionId,
    );
  });

  it("retries a failed coordinator hydration instead of permanently caching partial state", () => {
    const current = durableSnapshot("durable-retry");
    let attempts = 0;
    const coordinator = fakeCoordinator({
      listSessionSnapshots: vi.fn(() => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary coordinator outage");
        return [current];
      }),
      getSessionSnapshot: vi.fn(() => ({ session: current, statement: {} })),
    });
    const registry = new RemoteSessionRegistry({
      now: () => 1_000,
      membershipCoordinator: coordinator,
    });

    expect(registry.requireSession(current.sessionId)).toMatchObject({
      sessionId: current.sessionId,
      status: "active",
    });
    expect(coordinator.listSessionSnapshots).toHaveBeenCalledTimes(2);
  });

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

  it("never lets a pairing identity replace the host membership", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    expect(() =>
      registry.join({
        sessionId: created.session.sessionId,
        clientId: "host",
        token: created.pairing.token,
      }),
    ).toThrow(/host membership/);
    expect(
      registry.authorize(created.session.sessionId, "host", "interrupt").member
        .scopes,
    ).toEqual(REMOTE_SESSION_SCOPES);
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

  it("quarantines a disconnected member when its durable revoke outcome is unknown", () => {
    const transitionError = new Error("simulated durable write failure");
    transitionError.code = "CC_REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE";
    const membershipAuthority = {
      createSession: vi.fn(() => ({
        authorityVersion: "durable-monotonic-membership-epoch-v1",
        sessionEpoch: "1",
        membershipEpoch: "1",
      })),
      joinMember: vi.fn(() => ({
        authorityVersion: "durable-monotonic-membership-epoch-v1",
        sessionEpoch: "1",
        membershipEpoch: "2",
      })),
      readMembership: vi.fn(() => ({
        ok: true,
        binding: {
          authorityVersion: "durable-monotonic-membership-epoch-v1",
          sessionId: "ignored",
          principalId: "phone",
          sessionEpoch: "1",
          membershipEpoch: "2",
        },
      })),
      revokeMember: vi.fn(() => {
        throw transitionError;
      }),
    };
    const registry = new RemoteSessionRegistry({ membershipAuthority });
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
      durableMembership: true,
    });
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
    });

    expect(() => registry.removeClient("phone")).toThrow(transitionError);
    expect(() =>
      registry.authorize(created.session.sessionId, "phone", "approve"),
    ).toThrow(/quarantined/);
    expect(
      registry
        .members(created.session.sessionId)
        .find((member) => member.clientId === "phone"),
    ).toMatchObject({ membershipQuarantined: true });
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

  it("stores a push token supplied at join time", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    const joined = registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
      pushToken: "fcm-abc",
      pushProvider: "fcm",
    });
    expect(joined.member.pushToken).toBe("fcm-abc");
    expect(joined.member.pushProvider).toBe("fcm");
    const phone = registry
      .listDevices(created.session.sessionId, "host")
      .devices.find((d) => d.clientId === "phone");
    expect(phone.hasPush).toBe(true);
    expect(phone.pushProvider).toBe("fcm");
  });

  it("ignores a push provider when no token is given at join", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    const phone = registry
      .listDevices(sessionId, "host")
      .devices.find((d) => d.clientId === "phone");
    expect(phone.hasPush).toBe(false);
    expect(phone.pushProvider).toBe(null);
  });

  it("registers, refreshes, and clears a device's own push token after pairing", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    const set = registry.registerPush(sessionId, "phone", {
      token: "fcm-1",
      provider: "fcm",
    });
    expect(set).toEqual({ clientId: "phone", hasPush: true, provider: "fcm" });
    expect(registry.pushTargets(sessionId)).toEqual([
      { clientId: "phone", pushToken: "fcm-1", pushProvider: "fcm" },
    ]);
    // Clearing the token (null) removes the device from wake-up targets.
    const cleared = registry.registerPush(sessionId, "phone", { token: null });
    expect(cleared.hasPush).toBe(false);
    expect(registry.pushTargets(sessionId)).toEqual([]);
  });

  it("refuses to register a push token for a non-member", () => {
    const registry = new RemoteSessionRegistry();
    const sessionId = seedPairedSession(registry);
    expect(() =>
      registry.registerPush(sessionId, "ghost", { token: "x" }),
    ).toThrow(/not paired/);
  });

  it("excludes the host and a named client from push targets", () => {
    const registry = new RemoteSessionRegistry();
    const created = registry.create({
      hostClientId: "host",
      agentSessionId: "agent-1",
    });
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "phone",
      token: created.pairing.token,
      pushToken: "fcm-1",
      pushProvider: "fcm",
    });
    const second = registry.issuePairingToken(created.session.sessionId);
    registry.join({
      sessionId: created.session.sessionId,
      clientId: "tablet",
      token: second.token,
      pushToken: "fcm-2",
      pushProvider: "fcm",
    });
    const targets = registry.pushTargets(created.session.sessionId, {
      excludeClientId: "phone",
    });
    expect(targets).toEqual([
      { clientId: "tablet", pushToken: "fcm-2", pushProvider: "fcm" },
    ]);
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
