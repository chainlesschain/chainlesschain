import { EventEmitter } from "events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { handleRemoteSessionRevoke } from "../../src/gateways/ws/remote-session-protocol.js";
import {
  RemoteSessionCryptoContext,
  createRemoteSessionKeyPair,
} from "../../src/harness/remote-session-crypto.js";
import { createRemoteMembershipPrincipalCredential } from "../../src/lib/remote-membership-coordinator.js";

class FakeRelay extends EventEmitter {
  sent = [];
  connect() {
    return Promise.resolve();
  }
  close() {}
  sendEncrypted(to, envelope) {
    this.sent.push({ to, envelope });
    return true;
  }
}

function oneShotFaultHooks(point) {
  let fired = false;
  return {
    [point]: () => {
      if (fired) return;
      fired = true;
      throw new Error(`injected relay publication fault: ${point}`);
    },
  };
}

function durableRelayHarness({ faultPoint = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-relay-recovery-"));
  const relay = new FakeRelay();
  const coordinatorOptions = {
    stateFile: path.join(root, "coordinator", "state.json"),
    keyFile: path.join(root, "coordinator", "key.json"),
    witnessFile: path.join(root, "coordinator", "witness.json"),
  };
  const server = new ChainlessChainWSServer({
    remoteSessionRelay: relay,
    remoteMembershipCoordinatorOptions: coordinatorOptions,
  });
  const hostCredential = createRemoteMembershipPrincipalCredential();
  const created = server.remoteSessions.create({
    hostClientId: "host-client",
    agentSessionId: "agent-recovery",
    durableMembership: true,
    hostCredentialPublicKeySpki: hostCredential.publicKey,
    scopes: ["approve"],
  });
  const sessionId = created.session.sessionId;
  const hostCrypto = new RemoteSessionCryptoContext({
    sessionId,
    localPeerId: "host-peer",
    faultHooks: faultPoint ? oneShotFaultHooks(faultPoint) : null,
  });
  const mobileCrypto = new RemoteSessionCryptoContext({
    sessionId,
    localPeerId: "mobile-peer",
  });
  mobileCrypto.pair("host-peer", hostCrypto.publicKey, created.pairing.token);
  server.remoteSessionCrypto.set(sessionId, hostCrypto);
  server.remoteSessionPairingSecrets.set(sessionId, created.pairing.token);
  const message = ({
    crypto = mobileCrypto,
    mobilePublicKey = crypto.publicKey,
    token = created.pairing.token,
    capabilities = ["approval-binding-v1"],
    remoteSessionId = sessionId,
  } = {}) => ({
    type: "message",
    from: "mobile-peer",
    payload: {
      type: "remote-session.pair",
      mobilePeerId: "mobile-peer",
      mobilePublicKey,
      envelope: crypto.encrypt("host-peer", {
        type: "pair.join",
        remoteSessionId,
        token,
        capabilities,
      }),
    },
  });
  return {
    root,
    relay,
    server,
    created,
    sessionId,
    hostCrypto,
    mobileCrypto,
    message,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function nonHostMember(server, sessionId, hostPrincipalId) {
  return server.remoteSessions
    .members(sessionId)
    .find((member) => member.principalId !== hostPrincipalId);
}

describe("Remote Session signaling relay handshake", () => {
  it("pairs a remote peer only after decrypting its one-time token", async () => {
    const relay = new FakeRelay();
    const server = new ChainlessChainWSServer({ remoteSessionRelay: relay });
    const created = server.remoteSessions.create({
      hostClientId: "host-client",
      agentSessionId: "agent-1",
    });
    const sessionId = created.session.sessionId;
    const hostCrypto = new RemoteSessionCryptoContext({
      sessionId,
      localPeerId: "host-peer",
    });
    const mobileCrypto = new RemoteSessionCryptoContext({
      sessionId,
      localPeerId: "mobile-peer",
    });
    hostCrypto.pair(
      "mobile-peer",
      mobileCrypto.publicKey,
      created.pairing.token,
    );
    mobileCrypto.pair("host-peer", hostCrypto.publicKey, created.pairing.token);
    server.remoteSessionCrypto.set(sessionId, hostCrypto);
    server.remoteSessionPairingSecrets.set(sessionId, created.pairing.token);

    relay.emit("relay-message", {
      type: "message",
      from: "mobile-peer",
      payload: {
        type: "remote-session.pair",
        mobilePeerId: "mobile-peer",
        mobilePublicKey: mobileCrypto.publicKey,
        envelope: mobileCrypto.encrypt("host-peer", {
          type: "pair.join",
          remoteSessionId: sessionId,
          token: created.pairing.token,
        }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      server.remoteSessions.members(sessionId).map((member) => member.clientId),
    ).toContain("mobile-peer");
    expect(relay.sent).toHaveLength(1);
    expect(mobileCrypto.decrypt(relay.sent[0].envelope)).toMatchObject({
      type: "pair.accepted",
      remoteSessionId: sessionId,
    });
    expect(server.remoteSessionPairingSecrets.has(sessionId)).toBe(false);
  });

  it("canonicalizes a mobile raw X25519 key through the authenticated durable relay proof", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-relay-raw-key-"));
    try {
      const relay = new FakeRelay();
      const coordinatorOptions = {
        stateFile: path.join(root, "coordinator", "state.json"),
        keyFile: path.join(root, "coordinator", "key.json"),
        witnessFile: path.join(root, "coordinator", "witness.json"),
      };
      const server = new ChainlessChainWSServer({
        remoteSessionRelay: relay,
        remoteMembershipCoordinatorOptions: coordinatorOptions,
      });
      const hostCredential = createRemoteMembershipPrincipalCredential();
      const created = server.remoteSessions.create({
        hostClientId: "host-client",
        agentSessionId: "agent-durable",
        durableMembership: true,
        hostCredentialPublicKeySpki: hostCredential.publicKey,
        scopes: ["approve"],
      });
      const sessionId = created.session.sessionId;
      const hostCrypto = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "host-peer",
      });
      const mobileCrypto = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      const mobileRawPublicKey = Buffer.from(
        mobileCrypto.publicKey,
        "base64url",
      )
        .subarray(-32)
        .toString("base64url");
      mobileCrypto.pair(
        "host-peer",
        hostCrypto.publicKey,
        created.pairing.token,
      );
      server.remoteSessionCrypto.set(sessionId, hostCrypto);
      server.remoteSessionPairingSecrets.set(sessionId, created.pairing.token);

      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: mobileRawPublicKey,
            envelope: mobileCrypto.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: "wrong-session",
              token: created.pairing.token,
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/Invalid encrypted Remote Session pairing request/);
      expect(server.remoteSessionPairingSecrets.has(sessionId)).toBe(true);
      expect(server.remoteSessions.members(sessionId)).toHaveLength(1);
      expect(relay.sent).toHaveLength(0);

      await server._handleRemoteRelayMessage({
        type: "message",
        from: "mobile-peer",
        payload: {
          type: "remote-session.pair",
          mobilePeerId: "mobile-peer",
          mobilePublicKey: mobileRawPublicKey,
          envelope: mobileCrypto.encrypt("host-peer", {
            type: "pair.join",
            remoteSessionId: sessionId,
            token: created.pairing.token,
            capabilities: ["approval-binding-v1"],
          }),
        },
      });

      expect(server.remoteSessions.members(sessionId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principalId: expect.stringMatching(/^relay-x25519:[0-9a-f]{64}$/),
            scopes: ["approve"],
          }),
        ]),
      );
      expect(relay.sent).toHaveLength(1);
      const member = server.remoteSessions
        .members(sessionId)
        .find(
          (candidate) =>
            candidate.principalId !== created.session.hostPrincipalId,
        );
      expect(member).toBeTruthy();
      expect(server.remoteSessionPairingSecrets.has(sessionId)).toBe(false);

      // Treat the first pair.accepted as lost, then have the host issue a fresh
      // invitation for another device before this peer retries. The old,
      // authenticated receipt must win without consuming the new token.
      const nextPairing = server.remoteSessions.issuePairingToken(sessionId, {
        scopes: ["approve"],
      });
      server.remoteSessionPairingSecrets.set(sessionId, nextPairing.token);
      await server._handleRemoteRelayMessage({
        type: "message",
        from: "mobile-peer",
        payload: {
          type: "remote-session.pair",
          mobilePeerId: "mobile-peer",
          mobilePublicKey: mobileRawPublicKey,
          envelope: mobileCrypto.encrypt("host-peer", {
            type: "pair.join",
            remoteSessionId: sessionId,
            token: created.pairing.token,
            capabilities: ["approval-binding-v1"],
          }),
        },
      });
      expect(relay.sent).toHaveLength(2);
      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(sessionId, nextPairing.token),
      ).not.toThrow();
      expect(mobileCrypto.decrypt(relay.sent[1].envelope)).toMatchObject({
        type: "pair.accepted",
        remoteSessionId: sessionId,
        principalId: member.principalId,
        sessionEpoch: created.session.sessionEpoch,
        membershipEpoch: member.membershipEpoch,
        scopes: member.scopes,
        capabilities: ["approval-binding-v1"],
        reconciled: true,
      });

      // The receipt is fail-closed on every authenticated authority input.
      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: mobileRawPublicKey,
            envelope: mobileCrypto.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: created.pairing.token,
              capabilities: [],
            }),
          },
        }),
      ).rejects.toThrow(/unavailable or mismatched/);
      expect(relay.sent).toHaveLength(2);

      const otherMobile = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "other-mobile",
      });
      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: otherMobile.publicKey,
            envelope: mobileCrypto.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: created.pairing.token,
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/unavailable or mismatched/);

      // An unauthenticated same-peer attempt under the wrong token is rejected
      // at the active transport binding, before candidate-key authentication;
      // it must not replace the committed key or erase its acceptance receipt.
      const impostor = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      impostor.pair("host-peer", hostCrypto.publicKey, "wrong-pairing-token");
      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: impostor.publicKey,
            envelope: impostor.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: "wrong-pairing-token",
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/already bound to an active membership/);

      await server._handleRemoteRelayMessage({
        type: "message",
        from: "mobile-peer",
        payload: {
          type: "remote-session.pair",
          mobilePeerId: "mobile-peer",
          mobilePublicKey: mobileRawPublicKey,
          envelope: mobileCrypto.encrypt("host-peer", {
            type: "pair.join",
            remoteSessionId: sessionId,
            token: created.pairing.token,
            capabilities: ["approval-binding-v1"],
          }),
        },
      });
      expect(relay.sent).toHaveLength(3);
      expect(mobileCrypto.decrypt(relay.sent[2].envelope)).toMatchObject({
        type: "pair.accepted",
        principalId: member.principalId,
        reconciled: true,
      });
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(sessionId, nextPairing.token),
      ).not.toThrow();

      // Even possession of the current invitation must not let a different
      // key replace an active transport id. The collision must be detected
      // before the durable coordinator transition, leaving the new token and
      // the old authenticated receipt available for their intended owners.
      const currentTokenImpostor = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      currentTokenImpostor.pair(
        "host-peer",
        hostCrypto.publicKey,
        nextPairing.token,
      );
      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: currentTokenImpostor.publicKey,
            envelope: currentTokenImpostor.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: nextPairing.token,
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/already bound to an active membership/);
      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
      expect(
        server
          ._requireRemoteMembershipCoordinator()
          .getSessionSnapshot(sessionId).session.members,
      ).toHaveLength(2);
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(sessionId, nextPairing.token),
      ).not.toThrow();
      expect(hostCrypto.hasRelayMembershipAcceptance("mobile-peer")).toBe(true);
      await server._handleRemoteRelayMessage({
        type: "message",
        from: "mobile-peer",
        payload: {
          type: "remote-session.pair",
          mobilePeerId: "mobile-peer",
          mobilePublicKey: mobileRawPublicKey,
          envelope: mobileCrypto.encrypt("host-peer", {
            type: "pair.join",
            remoteSessionId: sessionId,
            token: created.pairing.token,
            capabilities: ["approval-binding-v1"],
          }),
        },
      });
      expect(relay.sent).toHaveLength(4);
      expect(mobileCrypto.decrypt(relay.sent[3].envelope)).toMatchObject({
        type: "pair.accepted",
        principalId: member.principalId,
        reconciled: true,
      });
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );

      const hostMember = server.remoteSessions
        .members(sessionId)
        .find(
          (candidate) =>
            candidate.principalId === created.session.hostPrincipalId,
        );
      server._requireRemoteMembershipCoordinator().revokeMember({
        sessionId,
        principalId: member.principalId,
        hostPrincipalId: created.session.hostPrincipalId,
        expectedSessionEpoch: created.session.sessionEpoch,
        expectedMembershipEpoch: member.membershipEpoch,
        expectedHostMembershipEpoch: hostMember.membershipEpoch,
      });
      await expect(
        server._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: mobileRawPublicKey,
            envelope: mobileCrypto.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: created.pairing.token,
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/not active|not paired|denied/);

      // This recovery receipt is intentionally process-local. A new server
      // can hydrate durable membership state but has no authenticated DH/AEAD
      // transcript, so replaying the old join after host restart is rejected.
      const restarted = new ChainlessChainWSServer({
        remoteSessionRelay: new FakeRelay(),
        remoteMembershipCoordinatorOptions: coordinatorOptions,
      });
      await expect(
        restarted._handleRemoteRelayMessage({
          type: "message",
          from: "mobile-peer",
          payload: {
            type: "remote-session.pair",
            mobilePeerId: "mobile-peer",
            mobilePublicKey: mobileRawPublicKey,
            envelope: mobileCrypto.encrypt("host-peer", {
              type: "pair.join",
              remoteSessionId: sessionId,
              token: created.pairing.token,
              capabilities: ["approval-binding-v1"],
            }),
          },
        }),
      ).rejects.toThrow(/unavailable or expired/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "afterRelayRegistryCommit",
    "afterCommittedRelayKeyPublication",
    "afterCommittedRelayReceiptPublication",
  ])(
    "reconciles the exact committed membership after %s",
    async (faultPoint) => {
      const harness = durableRelayHarness({ faultPoint });
      const {
        server,
        relay,
        created,
        sessionId,
        hostCrypto,
        mobileCrypto,
        message,
      } = harness;
      try {
        await expect(
          server._handleRemoteRelayMessage(message()),
        ).rejects.toThrow(`injected relay publication fault: ${faultPoint}`);

        const member = nonHostMember(
          server,
          sessionId,
          created.session.hostPrincipalId,
        );
        expect(member).toBeTruthy();
        expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
        expect(
          server
            ._requireRemoteMembershipCoordinator()
            .getSessionSnapshot(sessionId).session.members,
        ).toHaveLength(2);
        expect(relay.sent).toHaveLength(0);
        expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
          created.pairing.token,
        );
        expect(() =>
          server.remoteSessions.pairingInvitation(
            sessionId,
            created.pairing.token,
          ),
        ).toThrow(/missing or expired/);

        await server._handleRemoteRelayMessage(message());

        expect(relay.sent).toHaveLength(1);
        expect(mobileCrypto.decrypt(relay.sent[0].envelope)).toMatchObject({
          type: "pair.accepted",
          remoteSessionId: sessionId,
          principalId: member.principalId,
          sessionEpoch: created.session.sessionEpoch,
          membershipEpoch: member.membershipEpoch,
          scopes: ["approve"],
          capabilities: ["approval-binding-v1"],
          reconciled: true,
        });
        expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
        expect(
          hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer"),
        ).toBe(false);
        expect(hostCrypto.hasRelayMembershipAcceptance("mobile-peer")).toBe(
          true,
        );
        expect(server.remoteSessionPairingSecrets.has(sessionId)).toBe(false);
        expect(
          JSON.stringify(server.remoteSessionAudit.list({ sessionId })),
        ).not.toContain(created.pairing.token);
      } finally {
        harness.cleanup();
      }
    },
  );

  it("keeps a fresh token and committed pending outcome intact under adversarial retries", async () => {
    const harness = durableRelayHarness({
      faultPoint: "afterRelayRegistryCommit",
    });
    const {
      server,
      relay,
      created,
      sessionId,
      hostCrypto,
      mobileCrypto,
      message,
    } = harness;
    try {
      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /afterRelayRegistryCommit/,
      );
      const member = nonHostMember(
        server,
        sessionId,
        created.session.hostPrincipalId,
      );
      const authoritativeBefore = server
        ._requireRemoteMembershipCoordinator()
        .getSessionSnapshot(sessionId).session;
      const nextPairing = server.remoteSessions.issuePairingToken(sessionId, {
        scopes: ["approve"],
      });
      server.remoteSessionPairingSecrets.set(sessionId, nextPairing.token);

      await expect(
        server._handleRemoteRelayMessage(
          message({ capabilities: [], token: created.pairing.token }),
        ),
      ).rejects.toThrow(/pending membership request.*mismatched/);
      await expect(
        server._handleRemoteRelayMessage(message({ token: nextPairing.token })),
      ).rejects.toThrow(/pending membership request.*mismatched/);
      await expect(
        server._handleRemoteRelayMessage(
          message({ remoteSessionId: "wrong-session" }),
        ),
      ).rejects.toThrow(/Invalid encrypted Remote Session pairing retry/);

      const impostor = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      impostor.pair("host-peer", hostCrypto.publicKey, nextPairing.token);
      await expect(
        server._handleRemoteRelayMessage(
          message({
            crypto: impostor,
            mobilePublicKey: impostor.publicKey,
            token: nextPairing.token,
          }),
        ),
      ).rejects.toThrow(/already bound to an active membership/);

      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
      expect(
        server
          ._requireRemoteMembershipCoordinator()
          .getSessionSnapshot(sessionId).session,
      ).toEqual(authoritativeBefore);
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(sessionId, nextPairing.token),
      ).not.toThrow();
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        true,
      );

      await server._handleRemoteRelayMessage(message());
      expect(relay.sent).toHaveLength(1);
      expect(mobileCrypto.decrypt(relay.sent[0].envelope)).toMatchObject({
        type: "pair.accepted",
        principalId: member.principalId,
        reconciled: true,
      });
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(sessionId, nextPairing.token),
      ).not.toThrow();
      const audit = JSON.stringify(
        server.remoteSessionAudit.list({ sessionId }),
      );
      expect(audit).not.toContain(created.pairing.token);
      expect(audit).not.toContain(nextPairing.token);
    } finally {
      harness.cleanup();
    }
  });

  it("fences a revoked pending outcome and permits a fresh same-peer join only after authority refresh", async () => {
    const harness = durableRelayHarness({
      faultPoint: "afterRelayRegistryCommit",
    });
    const { server, relay, created, sessionId, hostCrypto, message } = harness;
    try {
      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /afterRelayRegistryCommit/,
      );
      const member = nonHostMember(
        server,
        sessionId,
        created.session.hostPrincipalId,
      );
      const hostMember = server.remoteSessions
        .members(sessionId)
        .find(
          (candidate) =>
            candidate.principalId === created.session.hostPrincipalId,
        );
      const nextPairing = server.remoteSessions.issuePairingToken(sessionId, {
        scopes: ["approve"],
      });
      server.remoteSessionPairingSecrets.set(sessionId, nextPairing.token);
      server._requireRemoteMembershipCoordinator().revokeMember({
        sessionId,
        principalId: member.principalId,
        hostPrincipalId: created.session.hostPrincipalId,
        expectedSessionEpoch: created.session.sessionEpoch,
        expectedMembershipEpoch: member.membershipEpoch,
        expectedHostMembershipEpoch: hostMember.membershipEpoch,
      });

      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /no longer active/,
      );
      expect(relay.sent).toHaveLength(0);
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        false,
      );
      expect(hostCrypto.hasRelayMembershipAcceptance("mobile-peer")).toBe(
        false,
      );
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        nextPairing.token,
      );

      const replacement = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      replacement.pair("host-peer", hostCrypto.publicKey, nextPairing.token);
      await server._handleRemoteRelayMessage(
        message({
          crypto: replacement,
          mobilePublicKey: replacement.publicKey,
          token: nextPairing.token,
        }),
      );
      expect(relay.sent).toHaveLength(1);
      expect(replacement.decrypt(relay.sent[0].envelope)).toMatchObject({
        type: "pair.accepted",
        remoteSessionId: sessionId,
      });
      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
    } finally {
      harness.cleanup();
    }
  });

  it("clears a pending-only outcome when an offline relay member is revoked", async () => {
    const harness = durableRelayHarness({
      faultPoint: "afterRelayRegistryCommit",
    });
    const { server, relay, created, sessionId, hostCrypto, message } = harness;
    try {
      server.remoteSessions._attachTransport(
        server.remoteSessions.sessions.get(sessionId),
        created.session.hostPrincipalId,
        "host-client",
      );
      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /afterRelayRegistryCommit/,
      );
      const member = nonHostMember(
        server,
        sessionId,
        created.session.hostPrincipalId,
      );
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        true,
      );
      expect(hostCrypto.keys.has("mobile-peer")).toBe(false);

      const hostSocket = {
        OPEN: 1,
        readyState: 1,
        sent: [],
        send(raw) {
          this.sent.push(JSON.parse(raw));
        },
      };
      handleRemoteSessionRevoke(server, "host-client", hostSocket, {
        id: "revoke-pending-relay",
        remoteSessionId: sessionId,
        clientId: member.principalId,
      });
      expect(hostSocket.sent.at(-1)).toMatchObject({
        type: "remote-session-revoked",
        revoked: member.principalId,
      });

      // The peer is offline and never submits an old-key retry. The failed
      // courtesy encryption must still retire the pending generation.
      expect(relay.sent).toHaveLength(0);
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        false,
      );

      const nextPairing = server.remoteSessions.issuePairingToken(sessionId, {
        scopes: ["approve"],
      });
      server.remoteSessionPairingSecrets.set(sessionId, nextPairing.token);
      const replacement = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      replacement.pair("host-peer", hostCrypto.publicKey, nextPairing.token);
      await server._handleRemoteRelayMessage(
        message({
          crypto: replacement,
          mobilePublicKey: replacement.publicKey,
          token: nextPairing.token,
        }),
      );

      expect(relay.sent).toHaveLength(1);
      expect(replacement.decrypt(relay.sent[0].envelope)).toMatchObject({
        type: "pair.accepted",
        remoteSessionId: sessionId,
      });
      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
    } finally {
      harness.cleanup();
    }
  });

  it("fences a pending outcome after the authoritative session closes", async () => {
    const harness = durableRelayHarness({
      faultPoint: "afterRelayRegistryCommit",
    });
    const { server, relay, created, sessionId, hostCrypto, message } = harness;
    try {
      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /afterRelayRegistryCommit/,
      );
      const hostMember = server.remoteSessions
        .members(sessionId)
        .find(
          (candidate) =>
            candidate.principalId === created.session.hostPrincipalId,
        );
      server._requireRemoteMembershipCoordinator().closeSession({
        sessionId,
        hostPrincipalId: created.session.hostPrincipalId,
        expectedSessionEpoch: created.session.sessionEpoch,
        expectedHostMembershipEpoch: hostMember.membershipEpoch,
      });

      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /no longer active/,
      );
      expect(relay.sent).toHaveLength(0);
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        false,
      );
      expect(hostCrypto.hasRelayMembershipAcceptance("mobile-peer")).toBe(
        false,
      );
    } finally {
      harness.cleanup();
    }
  });

  it("replaces an old key generation high-water instead of contaminating a fresh rejoin", async () => {
    const harness = durableRelayHarness();
    const {
      server,
      relay,
      created,
      sessionId,
      hostCrypto,
      mobileCrypto,
      message,
    } = harness;
    try {
      await server._handleRemoteRelayMessage(message());
      mobileCrypto.decrypt(relay.sent.at(-1).envelope);
      for (let index = 0; index < 5; index += 1) {
        await server._handleRemoteRelayMessage(message());
        mobileCrypto.decrypt(relay.sent.at(-1).envelope);
      }
      expect(hostCrypto.receivedSequences.get("mobile-peer")).toBe(6);

      const member = nonHostMember(
        server,
        sessionId,
        created.session.hostPrincipalId,
      );
      const hostMember = server.remoteSessions
        .members(sessionId)
        .find(
          (candidate) =>
            candidate.principalId === created.session.hostPrincipalId,
        );
      const nextPairing = server.remoteSessions.issuePairingToken(sessionId, {
        scopes: ["approve"],
      });
      server.remoteSessionPairingSecrets.set(sessionId, nextPairing.token);
      server._requireRemoteMembershipCoordinator().revokeMember({
        sessionId,
        principalId: member.principalId,
        hostPrincipalId: created.session.hostPrincipalId,
        expectedSessionEpoch: created.session.sessionEpoch,
        expectedMembershipEpoch: member.membershipEpoch,
        expectedHostMembershipEpoch: hostMember.membershipEpoch,
      });

      const replacement = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
      });
      replacement.pair("host-peer", hostCrypto.publicKey, nextPairing.token);
      const replacementMessage = () =>
        message({
          crypto: replacement,
          mobilePublicKey: replacement.publicKey,
          token: nextPairing.token,
        });
      await server._handleRemoteRelayMessage(replacementMessage());
      expect(hostCrypto.receivedSequences.get("mobile-peer")).toBe(1);

      // Sequence 2 under the new key must authenticate even though the retired
      // key generation had already reached sequence 6.
      await server._handleRemoteRelayMessage(replacementMessage());
      expect(hostCrypto.receivedSequences.get("mobile-peer")).toBe(2);
      expect(replacement.decrypt(relay.sent.at(-1).envelope)).toMatchObject({
        type: "pair.accepted",
        reconciled: true,
      });
    } finally {
      harness.cleanup();
    }
  });

  it("clears a prepared marker only after a fresh read proves non-commit", async () => {
    const harness = durableRelayHarness();
    const { server, created, sessionId, hostCrypto, message } = harness;
    const originalJoin = server.remoteSessions.joinRelayMember.bind(
      server.remoteSessions,
    );
    try {
      server.remoteSessions.joinRelayMember = () => {
        const error = new Error("injected known non-commit");
        error.commitState = "not-committed";
        throw error;
      };
      await expect(server._handleRemoteRelayMessage(message())).rejects.toThrow(
        /known non-commit/,
      );
      expect(server.remoteSessions.members(sessionId)).toHaveLength(1);
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        false,
      );
      expect(server.remoteSessionPairingSecrets.get(sessionId)).toBe(
        created.pairing.token,
      );
      expect(() =>
        server.remoteSessions.pairingInvitation(
          sessionId,
          created.pairing.token,
        ),
      ).not.toThrow();

      server.remoteSessions.joinRelayMember = originalJoin;
      await server._handleRemoteRelayMessage(message());
      expect(server.remoteSessions.members(sessionId)).toHaveLength(2);
    } finally {
      server.remoteSessions.joinRelayMember = originalJoin;
      harness.cleanup();
    }
  });

  it("never overwrites a same-peer prepared record with a different candidate", () => {
    const harness = durableRelayHarness();
    const { server, created, sessionId, hostCrypto } = harness;
    try {
      const invitation = server.remoteSessions.pairingInvitation(
        sessionId,
        created.pairing.token,
      );
      const coordinator = server._requireRemoteMembershipCoordinator();
      const authority = coordinator.relayAuthorityDescriptor();
      const sharedKeys = createRemoteSessionKeyPair();
      const first = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
        privateKey: sharedKeys.privateKey,
        publicKey: sharedKeys.publicKey,
      });
      const second = new RemoteSessionCryptoContext({
        sessionId,
        localPeerId: "mobile-peer",
        privateKey: sharedKeys.privateKey,
        publicKey: sharedKeys.publicKey,
      });
      first.pair("host-peer", hostCrypto.publicKey, created.pairing.token);
      second.pair("host-peer", hostCrypto.publicKey, created.pairing.token);
      const initialEnvelope = first.encrypt("host-peer", {
        type: "pair.join",
        remoteSessionId: sessionId,
        token: created.pairing.token,
        capabilities: ["approval-binding-v1"],
        pushToken: "push-a",
        pushProvider: "fcm",
      });
      const stage = () =>
        hostCrypto.stageRelayPairing(
          "mobile-peer",
          first.publicKey,
          created.pairing.token,
          initialEnvelope,
          {
            authorizedScopes: invitation.scopes,
            expiresAtMs: invitation.expiresAt,
            ...authority,
          },
        );
      const authoritySnapshot =
        coordinator.getSessionSnapshot(sessionId).session;
      hostCrypto.armPendingRelayMembershipCommit(stage().stage, {
        authoritySnapshot,
        scopes: ["approve"],
        capabilities: ["approval-binding-v1"],
      });
      expect(() =>
        hostCrypto.armPendingRelayMembershipCommit(stage().stage, {
          authoritySnapshot,
          scopes: ["approve"],
          capabilities: ["approval-binding-v1"],
        }),
      ).not.toThrow();

      // Both clients hold the same private key, token, peer id, and start at
      // sequence 1. A different nonce/ciphertext (and push metadata) is still
      // a different authenticated request and must not be treated as an exact
      // idempotent arm.
      const conflictingEnvelope = second.encrypt("host-peer", {
        type: "pair.join",
        remoteSessionId: sessionId,
        token: created.pairing.token,
        capabilities: ["approval-binding-v1"],
        pushToken: "push-b",
        pushProvider: "fcm",
      });
      expect(conflictingEnvelope.sequence).toBe(initialEnvelope.sequence);
      expect(conflictingEnvelope.nonce).not.toBe(initialEnvelope.nonce);
      const conflictingStage = hostCrypto.stageRelayPairing(
        "mobile-peer",
        second.publicKey,
        created.pairing.token,
        conflictingEnvelope,
        {
          authorizedScopes: invitation.scopes,
          expiresAtMs: invitation.expiresAt,
          ...authority,
        },
      );
      expect(() =>
        hostCrypto.armPendingRelayMembershipCommit(conflictingStage.stage, {
          authoritySnapshot,
          scopes: ["approve"],
          capabilities: ["approval-binding-v1"],
        }),
      ).toThrow(/different pending membership commit/);
      expect(hostCrypto.hasPendingCommittedRelayAcceptance("mobile-peer")).toBe(
        true,
      );
      expect(server.remoteSessions.members(sessionId)).toHaveLength(1);
      expect(() =>
        server.remoteSessions.pairingInvitation(
          sessionId,
          created.pairing.token,
        ),
      ).not.toThrow();
    } finally {
      harness.cleanup();
    }
  });
});
