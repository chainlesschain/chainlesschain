import { EventEmitter } from "events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { RemoteSessionCryptoContext } from "../../src/harness/remote-session-crypto.js";
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
});
