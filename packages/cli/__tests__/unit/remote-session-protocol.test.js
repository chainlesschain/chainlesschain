import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSessionRegistry } from "../../src/harness/remote-session-registry.js";
import {
  handleRemoteSessionCreate,
  handleRemoteSessionDevices,
  handleRemoteSessionJoin,
  handleRemoteSessionPublish,
  handleRemoteSessionRevoke,
} from "../../src/gateways/ws/remote-session-protocol.js";
import { parseRemotePairingUri } from "../../src/harness/remote-session-crypto.js";

function socket(name) {
  return { name, sent: [] };
}

describe("remote session WebSocket protocol", () => {
  let server;
  let host;
  let phone;

  beforeEach(() => {
    host = socket("host");
    phone = socket("phone");
    server = {
      remoteSessions: new RemoteSessionRegistry(),
      clients: new Map([
        ["host", { ws: host }],
        ["phone", { ws: phone }],
      ]),
      _send(ws, message) {
        ws.sent.push(message);
      },
      sessionHandlers: new Map(),
      sessionManager: {
        getSession: vi.fn(() => ({
          interaction: { resolveAnswer: vi.fn() },
        })),
      },
      emit: vi.fn(),
      remoteSessionRelayUrl: null,
      remoteSessionPeerId: null,
      remoteSessionCrypto: new Map(),
      remoteSessionPairingSecrets: new Map(),
    };
  });

  it("returns a QR-safe pairing URI when relay settings are configured", () => {
    server.remoteSessionRelayUrl = "wss://relay.example.test";
    server.remoteSessionPeerId = "desktop-peer";
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-relay",
      sessionId: "agent-1",
    });
    const response = host.sent.at(-1);
    expect(parseRemotePairingUri(response.pairing.uri)).toMatchObject({
      relayUrl: "wss://relay.example.test",
      remoteSessionId: response.session.sessionId,
      hostPeerId: "desktop-peer",
      hostPublicKey: response.pairing.hostPublicKey,
      pairingToken: response.pairing.token,
    });
  });

  function createAndJoin(scopes = ["observe", "approve"]) {
    handleRemoteSessionCreate(server, "host", host, {
      id: "create-1",
      sessionId: "agent-1",
      scopes,
    });
    const created = host.sent.at(-1);
    handleRemoteSessionJoin(server, "phone", phone, {
      id: "join-1",
      remoteSessionId: created.session.sessionId,
      token: created.pairing.token,
    });
    return created.session.sessionId;
  }

  it("creates, joins and fans host events out to paired clients", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionPublish(server, "host", host, {
      id: "publish-1",
      remoteSessionId,
      event: { type: "assistant.delta", content: "hello" },
    });

    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-event",
      remoteSessionId,
      agentSessionId: "agent-1",
      event: { type: "assistant.delta", content: "hello" },
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-published",
      delivered: 1,
    });
  });

  it("routes scoped approval responses into the existing session handler", async () => {
    const remoteSessionId = createAndJoin();
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "approve-1",
      remoteSessionId,
      event: { type: "approval.resolve", approvalId: "a-1", approved: true },
    });
    const session = server.sessionManager.getSession.mock.results.at(-1).value;
    expect(session.interaction.resolveAnswer).toHaveBeenCalledWith("a-1", true);
    expect(phone.sent.at(-1)).toMatchObject({
      type: "command.response",
      sessionId: "agent-1",
    });
  });

  it("routes scoped prompts into the active Agent Session handler", async () => {
    const remoteSessionId = createAndJoin(["observe", "prompt"]);
    const handleMessage = vi.fn(async () => {});
    server.sessionHandlers.set("agent-1", { handleMessage });
    await handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-1",
      remoteSessionId,
      event: { type: "prompt", content: "continue fixing CI" },
    });
    expect(handleMessage).toHaveBeenCalledWith(
      "continue fixing CI",
      "prompt-1",
    );
  });

  it("lists paired devices for the host and rejects non-host callers", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionDevices(server, "host", host, {
      id: "devices-1",
      remoteSessionId,
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-devices",
      devices: expect.arrayContaining([
        expect.objectContaining({ clientId: "phone", isHost: false }),
        expect.objectContaining({ clientId: "host", isHost: true }),
      ]),
    });

    handleRemoteSessionDevices(server, "phone", phone, {
      id: "devices-2",
      remoteSessionId,
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_DEVICES_ERROR",
    });
  });

  it("revokes a locally connected device and pushes a revocation notice", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionRevoke(server, "host", host, {
      id: "revoke-1",
      remoteSessionId,
      clientId: "phone",
    });

    expect(phone.sent.at(-1)).toMatchObject({
      type: "remote-session-revoked",
      remoteSessionId,
      agentSessionId: "agent-1",
    });
    expect(host.sent.at(-1)).toMatchObject({
      type: "remote-session-revoked",
      revoked: "phone",
      devices: [expect.objectContaining({ clientId: "host" })],
    });

    // A revoked device can no longer publish scoped control events.
    handleRemoteSessionPublish(server, "phone", phone, {
      id: "after-revoke",
      remoteSessionId,
      event: { type: "prompt", content: "still here?" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });
  });

  it("rejects revocation attempts from non-host callers", () => {
    const remoteSessionId = createAndJoin();
    handleRemoteSessionRevoke(server, "phone", phone, {
      id: "revoke-x",
      remoteSessionId,
      clientId: "host",
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_REVOKE_ERROR",
    });
  });

  it("sends an encrypted revocation notice to a relay-paired device", () => {
    const remoteSessionId = createAndJoin();
    // Simulate a device reachable only over the relay (no local ws client).
    server.remoteSessions.join({
      sessionId: remoteSessionId,
      clientId: "mobile-peer",
      token: server.remoteSessions.issuePairingToken(remoteSessionId).token,
    });
    const sent = [];
    server.remoteSessionRelay = {
      sendEncrypted: (peerId, envelope) => sent.push({ peerId, envelope }),
    };
    server.remoteSessionCrypto.set(remoteSessionId, {
      encrypt: (peerId, message) => ({ peerId, message }),
    });

    handleRemoteSessionRevoke(server, "host", host, {
      id: "revoke-relay",
      remoteSessionId,
      clientId: "mobile-peer",
    });

    expect(sent).toEqual([
      {
        peerId: "mobile-peer",
        envelope: {
          peerId: "mobile-peer",
          message: { type: "session.revoked", remoteSessionId },
        },
      },
    ]);
  });

  it("blocks unscoped prompts and arbitrary remote runtime events", () => {
    const remoteSessionId = createAndJoin(["observe"]);
    handleRemoteSessionPublish(server, "phone", phone, {
      id: "prompt-1",
      remoteSessionId,
      event: { type: "prompt", content: "do it" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      code: "REMOTE_SESSION_PUBLISH_ERROR",
    });

    handleRemoteSessionPublish(server, "phone", phone, {
      id: "fake-runtime",
      remoteSessionId,
      event: { type: "assistant.delta", content: "spoof" },
    });
    expect(phone.sent.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/host/),
    });
  });
});
