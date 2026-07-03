import {
  handleSessionAnswer,
  handleSessionInterrupt,
  handleSessionMessage,
} from "./session-protocol.js";
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
} from "../../harness/remote-session-crypto.js";

const CLIENT_EVENT_SCOPES = Object.freeze({
  prompt: "prompt",
  "approval.resolve": "approve",
  interrupt: "interrupt",
});

function reply(server, ws, id, type, payload = {}) {
  server._send(ws, { id, type, ...payload });
}

function attachPairingUri(server, result) {
  const relayUrl = server.remoteSessionRelayUrl;
  const hostPeerId = server.remoteSessionPeerId;
  if (!relayUrl || !hostPeerId) return result;
  server.remoteSessionPairingSecrets.set(
    result.session.sessionId,
    result.pairing.token,
  );
  let crypto = server.remoteSessionCrypto.get(result.session.sessionId);
  if (!crypto) {
    crypto = new RemoteSessionCryptoContext({
      sessionId: result.session.sessionId,
      localPeerId: hostPeerId,
    });
    server.remoteSessionCrypto.set(result.session.sessionId, crypto);
  }
  return {
    ...result,
    pairing: {
      ...result.pairing,
      hostPublicKey: crypto.publicKey,
      uri: createRemotePairingUri({
        relayUrl,
        remoteSessionId: result.session.sessionId,
        hostPeerId,
        hostPublicKey: crypto.publicKey,
        pairingToken: result.pairing.token,
        expiresAt: result.pairing.expiresAt,
      }),
    },
  };
}

export function handleRemoteSessionCreate(server, clientId, ws, message) {
  try {
    const result = server.remoteSessions.create({
      hostClientId: clientId,
      agentSessionId: message.sessionId,
      name: message.name,
      scopes: message.scopes,
    });
    reply(
      server,
      ws,
      message.id,
      "remote-session-created",
      attachPairingUri(server, result),
    );
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_CREATE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionPairingToken(server, clientId, ws, message) {
  try {
    const { session } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (session.hostClientId !== clientId) {
      throw new Error("Only the host can issue pairing tokens");
    }
    const pairing = server.remoteSessions.issuePairingToken(
      message.remoteSessionId,
      { scopes: message.scopes },
    );
    const result = attachPairingUri(server, {
      session: {
        sessionId: message.remoteSessionId,
      },
      pairing,
    });
    reply(server, ws, message.id, "remote-session-pairing-token", {
      pairing: result.pairing,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_PAIRING_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionJoin(server, clientId, ws, message) {
  try {
    const result = server.remoteSessions.join({
      sessionId: message.remoteSessionId,
      clientId,
      token: message.token,
    });
    reply(server, ws, message.id, "remote-session-joined", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_JOIN_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionDevices(server, clientId, ws, message) {
  try {
    const result = server.remoteSessions.listDevices(
      message.remoteSessionId,
      clientId,
    );
    reply(server, ws, message.id, "remote-session-devices", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_DEVICES_ERROR",
      message: error.message,
    });
  }
}

/**
 * Tell a revoked device it is no longer paired. Locally connected clients get a
 * plaintext `remote-session-revoked` push; relay-paired mobile devices get an
 * encrypted `session.revoked` control event so they stop auto-reconnecting.
 */
function notifyRevokedDevice(
  server,
  remoteSessionId,
  agentSessionId,
  clientId,
) {
  const target = server.clients.get(clientId);
  if (target) {
    server._send(target.ws, {
      type: "remote-session-revoked",
      remoteSessionId,
      agentSessionId,
    });
    return;
  }
  if (!server.remoteSessionRelay) return;
  const crypto = server.remoteSessionCrypto.get(remoteSessionId);
  if (!crypto) return;
  try {
    server.remoteSessionRelay.sendEncrypted(
      clientId,
      crypto.encrypt(clientId, { type: "session.revoked", remoteSessionId }),
    );
  } catch {
    // Peer key may already be gone; the registry removal is what actually
    // enforces revocation, so a failed courtesy notice is non-fatal.
  }
}

export function handleRemoteSessionRevoke(server, clientId, ws, message) {
  try {
    const targetClientId = message.clientId || message.deviceId;
    const { session, member } = server.remoteSessions.revokeMember(
      message.remoteSessionId,
      clientId,
      targetClientId,
    );
    notifyRevokedDevice(
      server,
      message.remoteSessionId,
      session.agentSessionId,
      member.clientId,
    );
    reply(server, ws, message.id, "remote-session-revoked", {
      session,
      revoked: member.clientId,
      devices: server.remoteSessions.listDevices(
        message.remoteSessionId,
        clientId,
      ).devices,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_REVOKE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionClose(server, clientId, ws, message) {
  try {
    const session = server.remoteSessions.close(
      message.remoteSessionId,
      clientId,
    );
    server.remoteSessionCrypto.delete(message.remoteSessionId);
    server.remoteSessionPairingSecrets.delete(message.remoteSessionId);
    reply(server, ws, message.id, "remote-session-closed", { session });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_CLOSE_ERROR",
      message: error.message,
    });
  }
}

export async function handleRemoteSessionPublish(
  server,
  clientId,
  ws,
  message,
) {
  try {
    if (!message.event || typeof message.event.type !== "string") {
      throw new Error("event.type is required");
    }
    const requiredScope = CLIENT_EVENT_SCOPES[message.event.type];
    const { session } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      requiredScope || "observe",
    );
    // Runtime/output events are host-only. Remote clients may publish only the
    // three explicitly scoped control event types above.
    if (!requiredScope && session.hostClientId !== clientId) {
      throw new Error("Only the host can publish runtime events");
    }

    if (requiredScope && session.hostClientId !== clientId) {
      const controlMessage = {
        id: message.id,
        sessionId: session.agentSessionId,
      };
      if (message.event.type === "prompt") {
        if (
          typeof message.event.content !== "string" ||
          !message.event.content.trim()
        ) {
          throw new Error("prompt content is required");
        }
        handleSessionMessage(server, message.id, ws, {
          ...controlMessage,
          content: message.event.content,
        });
      } else if (message.event.type === "approval.resolve") {
        await handleSessionAnswer(server, message.id, ws, {
          ...controlMessage,
          requestId: message.event.requestId || message.event.approvalId,
          answer: message.event.answer ?? message.event.approved,
        });
      } else if (message.event.type === "interrupt") {
        await handleSessionInterrupt(server, message.id, ws, controlMessage);
      }
      return;
    }

    let delivered = 0;
    for (const member of server.remoteSessions.members(
      message.remoteSessionId,
    )) {
      if (member.clientId === clientId) continue;
      const target = server.clients.get(member.clientId);
      if (!target) continue;
      server._send(target.ws, {
        type: "remote-session-event",
        remoteSessionId: message.remoteSessionId,
        agentSessionId: session.agentSessionId,
        event: message.event,
      });
      delivered += 1;
    }
    reply(server, ws, message.id, "remote-session-published", { delivered });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_PUBLISH_ERROR",
      message: error.message,
    });
  }
}
