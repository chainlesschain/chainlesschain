import { describe, expect, it } from "vitest";
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
  parseRemotePairingUri,
} from "../../src/harness/remote-session-crypto.js";

describe("Remote Session end-to-end encryption", () => {
  function pairedContexts() {
    const host = new RemoteSessionCryptoContext({
      sessionId: "remote-1",
      localPeerId: "host",
    });
    const phone = new RemoteSessionCryptoContext({
      sessionId: "remote-1",
      localPeerId: "phone",
    });
    const token = "one-time-pairing-secret";
    host.pair("phone", phone.publicKey, token);
    phone.pair("host", host.publicKey, token);
    return { host, phone };
  }

  it("round-trips messages using X25519 + HKDF + AES-256-GCM", () => {
    const { host, phone } = pairedContexts();
    const envelope = host.encrypt("phone", {
      type: "approval.request",
      path: "secret.txt",
    });
    expect(envelope.ciphertext).not.toContain("secret.txt");
    expect(phone.decrypt(envelope)).toEqual({
      type: "approval.request",
      path: "secret.txt",
    });
  });

  it("rejects ciphertext tampering without advancing replay state", () => {
    const { host, phone } = pairedContexts();
    const envelope = host.encrypt("phone", {
      type: "assistant.delta",
      content: "ok",
    });
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -1)}A`,
    };
    expect(() => phone.decrypt(tampered)).toThrow(/authentication failed/);
    expect(phone.decrypt(envelope)).toEqual({
      type: "assistant.delta",
      content: "ok",
    });
  });

  it("rejects replayed envelopes", () => {
    const { host, phone } = pairedContexts();
    const envelope = host.encrypt("phone", { type: "ping" });
    phone.decrypt(envelope);
    expect(() => phone.decrypt(envelope)).toThrow(/replay or out-of-order/);
  });

  it("encodes sensitive pairing material in the URI fragment and validates expiry", () => {
    const host = new RemoteSessionCryptoContext({
      sessionId: "remote-1",
      localPeerId: "host",
    });
    const uri = createRemotePairingUri({
      relayUrl: "wss://relay.example.test",
      remoteSessionId: "remote-1",
      hostPeerId: "host",
      hostPublicKey: host.publicKey,
      pairingToken: "secret",
      expiresAt: 2_000,
    });
    expect(uri).toMatch(/^chainlesschain:\/\/remote-session\/pair#/);
    expect(parseRemotePairingUri(uri, 1_000)).toMatchObject({
      relayUrl: "wss://relay.example.test",
      remoteSessionId: "remote-1",
      pairingToken: "secret",
    });
    expect(() => parseRemotePairingUri(uri, 2_001)).toThrow(/expired/);
  });
});
