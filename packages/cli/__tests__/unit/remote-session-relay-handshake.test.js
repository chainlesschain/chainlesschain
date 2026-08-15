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
      const server = new ChainlessChainWSServer({
        remoteSessionRelay: relay,
        remoteMembershipCoordinatorOptions: {
          stateFile: path.join(root, "coordinator", "state.json"),
          keyFile: path.join(root, "coordinator", "key.json"),
          witnessFile: path.join(root, "coordinator", "witness.json"),
        },
      });
      const hostCredential = createRemoteMembershipPrincipalCredential();
      const created = server.remoteSessions.create({
        hostClientId: "host-client",
        agentSessionId: "agent-durable",
        durableMembership: true,
        hostCredentialPublicKeySpki: hostCredential.publicKey,
        scopes: ["observe", "approve"],
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
            scopes: ["approve", "observe"],
          }),
        ]),
      );
      expect(relay.sent).toHaveLength(1);
      expect(mobileCrypto.decrypt(relay.sent[0].envelope)).toMatchObject({
        type: "pair.accepted",
        remoteSessionId: sessionId,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
