import {
  handleSessionAnswer,
  handleSessionInterrupt,
  handleSessionMessage,
} from "./session-protocol.js";
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
} from "../../harness/remote-session-crypto.js";
import { RemoteCommandLedger } from "../../harness/remote-command-ledger.js";

const CLIENT_EVENT_SCOPES = Object.freeze({
  prompt: "prompt",
  "approval.resolve": "approve",
  interrupt: "interrupt",
});

function reply(server, ws, id, type, payload = {}) {
  server._send(ws, { id, type, ...payload });
}

function audit(server, entry) {
  server.remoteSessionAudit?.record(entry);
}

/**
 * Apply a remote-client control event (prompt / approval.resolve / interrupt)
 * idempotently when it carries a stable `commandId`. This is the ACTUAL takeover
 * path — a paired mobile/web device driving the host agent — and it does NOT
 * flow through message-dispatcher's execute/stream ledger, so without this a
 * prompt re-sent after a dropped connection would run the agent turn a SECOND
 * time (Phase 5 acceptance "断网恢复后不会重复执行工具调用"). The side effect
 * (audit + dispatch into the host session) runs AT MOST ONCE per commandId; a
 * re-delivery gets a `replayed` ack instead. Byte-identical when the event
 * carries no `commandId` (existing clients unchanged). deviceId is the
 * AUTHENTICATED clientId, so a device can never spoof another's idempotency /
 * ordering stream. A revoked device / stale seq is rejected without forwarding.
 * Uses a ledger SEPARATE from the execute/stream one (`_commandLedger`) so the
 * two paths keep independent per-device sequence spaces.
 */
async function applyControlIdempotent(server, clientId, ws, message, forward) {
  const commandId = message.commandId;
  if (!commandId) return forward();
  // Create the ledger SYNCHRONOUSLY (no await between the check and the assign)
  // so two concurrent re-deliveries of the same commandId share ONE ledger and
  // coalesce — a lazy `await import()` here would let each build its own ledger
  // and both would execute, defeating the whole guarantee.
  if (!server._remoteControlLedger) {
    server._remoteControlLedger = new RemoteCommandLedger();
  }
  const outcome = await server._remoteControlLedger.apply(
    { commandId, deviceId: clientId, seq: message.seq },
    async () => {
      await forward();
      return true;
    },
  );
  if (outcome.status === "replayed") {
    reply(server, ws, message.id, "remote-session-published", {
      delivered: 0,
      replayed: true,
      commandId,
      applyIndex: outcome.applyIndex,
    });
  } else if (outcome.status === "rejected") {
    reply(server, ws, message.id, "error", {
      code: "COMMAND_REJECTED",
      commandId,
      message: outcome.reason,
    });
  }
  return outcome;
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
    audit(server, {
      sessionId: result.session.sessionId,
      actor: clientId,
      action: "session.created",
      detail: { agentSessionId: message.sessionId, name: message.name || null },
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
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "pairing-token.issued",
      detail: { scopes: message.scopes || null, expiresAt: pairing.expiresAt },
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
      pushToken: message.pushToken,
      pushProvider: message.pushProvider,
    });
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "device.joined",
      detail: {
        scopes: result.member.scopes,
        via: "direct",
        hasPush: result.member.pushToken ? true : false,
      },
    });
    reply(server, ws, message.id, "remote-session-joined", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_JOIN_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionPushRegister(server, clientId, ws, message) {
  try {
    // A device may only register its OWN token (clientId is the authenticated
    // caller). Storing no push value clears it.
    const result = server.remoteSessions.registerPush(
      message.remoteSessionId,
      clientId,
      { token: message.pushToken, provider: message.pushProvider },
    );
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "push.registered",
      detail: { hasPush: result.hasPush, provider: result.provider },
    });
    reply(server, ws, message.id, "remote-session-push-registered", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_PUSH_REGISTER_ERROR",
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

export function handleRemoteSessionPolicy(server, clientId, ws, message) {
  try {
    // The active org policy is not sensitive — any authenticated client may
    // read it (e.g. to pre-check allowed scopes before requesting a session).
    const policy = server.remoteSessions?.policy;
    reply(server, ws, message.id, "remote-session-policy", {
      policy: policy ? policy.describe() : null,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_POLICY_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionAudit(server, clientId, ws, message) {
  try {
    // Host-only: authorize proves membership, the host check proves ownership.
    const { session } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (session.hostClientId !== clientId) {
      throw new Error("Only the host can read the audit log");
    }
    const auditLog = server.remoteSessionAudit;
    const entries = auditLog
      ? auditLog.list({
          sessionId: message.remoteSessionId,
          limit: message.limit || 200,
        })
      : [];
    const stats = auditLog
      ? auditLog.stats(message.remoteSessionId)
      : { total: 0, byAction: {} };
    reply(server, ws, message.id, "remote-session-audit", {
      remoteSessionId: message.remoteSessionId,
      entries,
      stats,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_AUDIT_ERROR",
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
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "device.revoked",
      detail: { revoked: member.clientId },
    });
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
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "session.closed",
      detail: { reason: "host-closed" },
    });
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
    // A paired device (incl. relay-only mobiles) refreshing its own vendor push
    // token — e.g. after FCM onNewToken. Self-scoped: authorize proves
    // membership and registerPush keys off the authenticated clientId, so a
    // device can only ever set its OWN token. Omitting the token clears it.
    if (message.event.type === "push.register") {
      server.remoteSessions.authorize(
        message.remoteSessionId,
        clientId,
        "observe",
      );
      const registered = server.remoteSessions.registerPush(
        message.remoteSessionId,
        clientId,
        {
          token: message.event.pushToken,
          provider: message.event.pushProvider,
        },
      );
      audit(server, {
        sessionId: message.remoteSessionId,
        actor: clientId,
        action: "push.registered",
        detail: {
          hasPush: registered.hasPush,
          provider: registered.provider,
          via: "relay",
        },
      });
      reply(
        server,
        ws,
        message.id,
        "remote-session-push-registered",
        registered,
      );
      return;
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
      // Validate up-front so a malformed control event errors identically
      // whether or not it carries a commandId — idempotency must never change
      // validation semantics (a bad prompt must not consume a commandId slot).
      if (
        message.event.type === "prompt" &&
        (typeof message.event.content !== "string" ||
          !message.event.content.trim())
      ) {
        throw new Error("prompt content is required");
      }
      // Idempotent forward: a control event with a stable commandId runs its
      // side effect (audit + dispatch into the host agent) AT MOST ONCE, so a
      // reconnecting device re-sending the same prompt/approval/interrupt gets a
      // `replayed` ack instead of a second agent turn. No commandId → forwarded
      // directly, byte-identical to before.
      await applyControlIdempotent(server, clientId, ws, message, async () => {
        if (message.event.type === "prompt") {
          // Record the shape, not the content — the audit trail must stay
          // useful without hoarding potentially sensitive session prompts.
          audit(server, {
            sessionId: message.remoteSessionId,
            actor: clientId,
            action: "control.prompt",
            detail: { chars: message.event.content.length },
          });
          handleSessionMessage(server, message.id, ws, {
            ...controlMessage,
            content: message.event.content,
          });
        } else if (message.event.type === "approval.resolve") {
          audit(server, {
            sessionId: message.remoteSessionId,
            actor: clientId,
            action: "control.approval",
            detail: {
              requestId: message.event.requestId || message.event.approvalId,
              approved: message.event.answer ?? message.event.approved,
            },
          });
          await handleSessionAnswer(server, message.id, ws, {
            ...controlMessage,
            requestId: message.event.requestId || message.event.approvalId,
            answer: message.event.answer ?? message.event.approved,
          });
        } else if (message.event.type === "interrupt") {
          audit(server, {
            sessionId: message.remoteSessionId,
            actor: clientId,
            action: "control.interrupt",
            detail: null,
          });
          await handleSessionInterrupt(server, message.id, ws, controlMessage);
        }
      });
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
