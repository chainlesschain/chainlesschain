import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { RemoteSessionCryptoContext } from "../../src/harness/remote-session-crypto.js";

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
});
