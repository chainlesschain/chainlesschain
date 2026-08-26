import {
  handleSessionAnswer,
  handleSessionInterrupt,
  handleSessionMessage,
} from "./session-protocol.js";
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
} from "../../harness/remote-session-crypto.js";
import { isApprovalRequestEvent } from "../../harness/remote-session-push.js";
import { RemoteCommandLedger } from "../../harness/remote-command-ledger.js";
import {
  ORIGIN,
  assertCanApprove,
  assertCanAnswerInteraction,
  describeAuthorityChain,
} from "../../lib/agent-authority.js";
import { hasCompleteInteractionBinding } from "../../lib/interaction-binding.js";
import { REMOTE_MEMBERSHIP_NOT_ACTIVE_CODE } from "../../lib/remote-membership-coordinator.js";
import {
  REMOTE_APPROVAL_DECISION_CAPABILITY,
  requireRemoteApprovalDecision,
} from "../../lib/remote-approval-decision.js";

const CLIENT_EVENT_SCOPES = Object.freeze({
  prompt: "prompt",
  "approval.resolve": "approve",
  "question.answer": "prompt",
  interrupt: "interrupt",
});

function reply(server, ws, id, type, payload = {}) {
  server._send(ws, { id, type, ...payload });
}

function audit(server, entry) {
  server.remoteSessionAudit?.record(entry);
}

function approvalRequestKey(remoteSessionId, requestId) {
  return JSON.stringify([String(remoteSessionId), String(requestId)]);
}

function rememberRemoteApprovalRequest(server, session, member, event) {
  const requestId = event?.requestId;
  if (
    typeof requestId !== "string" ||
    !requestId ||
    typeof event.fingerprint !== "string" ||
    !event.fingerprint ||
    typeof event.binding !== "string" ||
    !event.binding ||
    !(
      (Number.isSafeInteger(event.revision) && event.revision > 0) ||
      (typeof event.revision === "string" && /^[1-9]\d*$/.test(event.revision))
    ) ||
    !Number.isSafeInteger(event.notAfter) ||
    event.notAfter <= Date.now()
  ) {
    throw new Error("Complete durable approval request binding is required");
  }
  if (!server._remoteApprovalRequests) {
    server._remoteApprovalRequests = new Map();
  }
  const key = approvalRequestKey(session.sessionId, requestId);
  const prior = server._remoteApprovalRequests.get(key);
  const record = Object.freeze({
    remoteSessionId: session.sessionId,
    agentSessionId: session.agentSessionId,
    hostPrincipalId: member.principalId,
    hostMembershipEpoch: member.membershipEpoch,
    sessionEpoch: session.sessionEpoch,
    requestId,
    fingerprint: event.fingerprint,
    binding: event.binding,
    revision: event.revision,
    expiresAt: event.notAfter,
  });
  if (prior && JSON.stringify(prior) !== JSON.stringify(record)) {
    throw new Error("Remote approval request binding changed");
  }
  server._remoteApprovalRequests.set(key, record);
  return record;
}

function requireRemoteApprovalRequest(server, session, event) {
  const requestId = event?.requestId || event?.approvalId;
  const record = server._remoteApprovalRequests?.get(
    approvalRequestKey(session.sessionId, requestId),
  );
  if (
    !record ||
    record.agentSessionId !== session.agentSessionId ||
    record.sessionEpoch !== session.sessionEpoch ||
    record.requestId !== requestId ||
    record.fingerprint !== event.fingerprint ||
    record.binding !== event.binding ||
    record.revision !== event.revision ||
    record.expiresAt <= Date.now()
  ) {
    throw new Error(
      "Remote approval response does not match a live host request",
    );
  }
  return record;
}

/**
 * Apply a remote-client control event (prompt / approval.resolve /
 * question.answer / interrupt)
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
  // A direct-WS client puts the idempotency key at the message top level, but
  // the RELAY path (`_handleRemoteEncryptedControl`) decrypts the whole mobile
  // control payload into `message.event`, so a relay-paired mobile's commandId
  // lands at `event.commandId`. Read either — otherwise the primary takeover
  // path (relay-paired mobile) never consults the ledger and a reconnect
  // re-runs the agent turn, defeating the entire Phase 5 guarantee.
  const commandId = message.commandId ?? message.event?.commandId;
  const seq = message.seq ?? message.event?.seq;
  if (!commandId) return forward();
  // Create the ledger SYNCHRONOUSLY (no await between the check and the assign)
  // so two concurrent re-deliveries of the same commandId share ONE ledger and
  // coalesce — a lazy `await import()` here would let each build its own ledger
  // and both would execute, defeating the whole guarantee.
  if (!server._remoteControlLedger) {
    server._remoteControlLedger = new RemoteCommandLedger();
  }
  const outcome = await server._remoteControlLedger.apply(
    { commandId, deviceId: clientId, seq },
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
      // A local/headless approval bridge asks the server to persist a
      // principal/session epoch before it exposes pairing credentials. Older
      // or ordinary server-hosted sessions remain on their in-memory path.
      durableMembership: message.requireDurableMembershipAuthority === true,
      hostCredentialPublicKeySpki: message.hostCredentialPublicKeySpki,
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

export function handleRemoteSessionJoinChallenge(
  server,
  clientId,
  ws,
  message,
) {
  try {
    const client = server.clients.get(clientId);
    if (!client?.membershipConnectionNonce) {
      throw new Error("Remote membership connection nonce is unavailable");
    }
    const challenge = server.remoteSessions.issueMemberJoinChallenge({
      sessionId: message.remoteSessionId,
      transportClientId: clientId,
      token: message.token,
      credentialPublicKey: message.credentialPublicKey,
      connectionNonce: client.membershipConnectionNonce,
      capabilities: message.capabilities,
    });
    reply(server, ws, message.id, "remote-session-join-challenge", {
      challenge,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_JOIN_CHALLENGE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionResumeChallenge(
  server,
  clientId,
  ws,
  message,
) {
  try {
    const client = server.clients.get(clientId);
    if (!client?.membershipConnectionNonce) {
      throw new Error("Remote membership connection nonce is unavailable");
    }
    const challenge = server.remoteSessions.issueSessionResumeChallenge({
      sessionId: message.remoteSessionId,
      principalId: message.principalId,
      transportClientId: clientId,
      connectionNonce: client.membershipConnectionNonce,
    });
    reply(server, ws, message.id, "remote-session-resume-challenge", {
      challenge,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code:
        error?.code === REMOTE_MEMBERSHIP_NOT_ACTIVE_CODE
          ? "REMOTE_SESSION_MEMBERSHIP_NOT_ACTIVE"
          : "REMOTE_SESSION_RESUME_CHALLENGE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionResume(server, clientId, ws, message) {
  try {
    const client = server.clients.get(clientId);
    if (!client?.membershipConnectionNonce) {
      throw new Error("Remote membership connection nonce is unavailable");
    }
    const result = server.remoteSessions.completeSessionResume({
      challengeId: message.challengeId,
      transportClientId: clientId,
      connectionNonce: client.membershipConnectionNonce,
      signature: message.signature,
    });
    client.membershipConnectionNonce = result.nextConnectionNonce;
    reply(server, ws, message.id, "remote-session-resumed", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_RESUME_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionReenableChallenge(
  server,
  clientId,
  ws,
  message,
) {
  try {
    const client = server.clients.get(clientId);
    if (!client?.membershipConnectionNonce) {
      throw new Error("Remote membership connection nonce is unavailable");
    }
    const challenge = server.remoteSessions.issueSessionReenableChallenge({
      sessionId: message.remoteSessionId,
      principalId: message.principalId,
      transportClientId: clientId,
      connectionNonce: client.membershipConnectionNonce,
      newHostCredentialPublicKeySpki:
        message.newHostCredentialPublicKeySpki || null,
    });
    reply(server, ws, message.id, "remote-session-reenable-challenge", {
      challenge,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_REENABLE_CHALLENGE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionReenable(server, clientId, ws, message) {
  try {
    const client = server.clients.get(clientId);
    if (!client?.membershipConnectionNonce) {
      throw new Error("Remote membership connection nonce is unavailable");
    }
    const result = server.remoteSessions.completeSessionReenable({
      challengeId: message.challengeId,
      transportClientId: clientId,
      connectionNonce: client.membershipConnectionNonce,
      signature: message.signature,
    });
    client.membershipConnectionNonce = result.nextConnectionNonce;
    reply(server, ws, message.id, "remote-session-reenabled", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_REENABLE_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionPairingToken(server, clientId, ws, message) {
  try {
    const { session, member } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      session.hostPrincipalId
        ? member.principalId !== session.hostPrincipalId
        : session.hostClientId !== clientId
    ) {
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
    const client = server.clients.get(clientId);
    const result = message.challengeId
      ? server.remoteSessions.completeMemberJoin({
          challengeId: message.challengeId,
          transportClientId: clientId,
          connectionNonce: client?.membershipConnectionNonce,
          signature: message.signature,
          pushToken: message.pushToken,
          pushProvider: message.pushProvider,
        })
      : server.remoteSessions.join({
          sessionId: message.remoteSessionId,
          clientId,
          token: message.token,
          pushToken: message.pushToken,
          pushProvider: message.pushProvider,
        });
    if (message.challengeId && client) {
      client.membershipConnectionNonce = result.nextConnectionNonce;
    }
    audit(server, {
      // A challengeId is the authority for a durable join. Its signed result
      // can legitimately identify a different session than an untrusted outer
      // field, so successful attribution must use only the committed result.
      sessionId: result.session.sessionId,
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

export function handleRemoteSessionLeaseAck(server, clientId, ws, message) {
  try {
    const { session, member, membership } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      !membership ||
      member.principalId !== session.hostPrincipalId ||
      membership.principalId !== session.hostPrincipalId
    ) {
      throw new Error("Only the durable host may ACK an approval lease");
    }
    const result = server
      ._requireRemoteMembershipCoordinator()
      .ackApprovalLease({
        sessionId: session.sessionId,
        leaseId: message.leaseId,
        hostPrincipalId: membership.principalId,
        expectedHostMembershipEpoch: membership.membershipEpoch,
        expectedCreatedGeneration: message.expectedCreatedGeneration,
        hostReceiptDigest: message.hostReceiptDigest,
      });
    reply(server, ws, message.id, "remote-session-lease-acked", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_LEASE_ACK_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionLeaseConsume(server, clientId, ws, message) {
  try {
    const { session, member, membership } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      !membership ||
      member.principalId !== session.hostPrincipalId ||
      membership.principalId !== session.hostPrincipalId
    ) {
      throw new Error("Only the durable host may consume an approval lease");
    }
    const result = server
      ._requireRemoteMembershipCoordinator()
      .consumeApprovalLease({
        sessionId: session.sessionId,
        leaseId: message.leaseId,
        hostPrincipalId: membership.principalId,
        expectedHostMembershipEpoch: membership.membershipEpoch,
        expectedAckedGeneration: message.expectedAckedGeneration,
        expectedMembershipEpoch: message.expectedMembershipEpoch,
        requestId: message.requestId,
        fingerprint: message.fingerprint,
        binding: message.binding,
      });
    reply(server, ws, message.id, "remote-session-lease-consumed", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_LEASE_CONSUME_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionLeaseCancel(server, clientId, ws, message) {
  try {
    const { session, member, membership } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      !membership ||
      member.principalId !== session.hostPrincipalId ||
      membership.principalId !== session.hostPrincipalId
    ) {
      throw new Error("Only the durable host may cancel an approval lease");
    }
    const result = server
      ._requireRemoteMembershipCoordinator()
      .cancelApprovalLease({
        sessionId: session.sessionId,
        leaseId: message.leaseId,
        hostPrincipalId: membership.principalId,
        expectedHostMembershipEpoch: membership.membershipEpoch,
        reason: message.reason || "host-cancelled",
      });
    reply(server, ws, message.id, "remote-session-lease-cancelled", result);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_LEASE_CANCEL_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionMembershipSnapshot(
  server,
  clientId,
  ws,
  message,
) {
  try {
    const { session, member, membership } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      !membership ||
      member.principalId !== session.hostPrincipalId ||
      membership.principalId !== session.hostPrincipalId
    ) {
      throw new Error("Only the durable host may read a membership snapshot");
    }
    const snapshot = server
      ._requireRemoteMembershipCoordinator()
      .snapshotSession(session.sessionId);
    reply(server, ws, message.id, "remote-session-membership-snapshot", {
      ...snapshot,
    });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_MEMBERSHIP_SNAPSHOT_ERROR",
      message: error.message,
    });
  }
}

export function handleRemoteSessionTerminal(server, _clientId, ws, message) {
  try {
    const terminal = server.remoteSessions.terminalSnapshot(
      message.remoteSessionId,
    );
    if (
      message.principalId &&
      terminal.session.hostPrincipalId !== message.principalId
    ) {
      throw new Error("Remote membership terminal principal changed");
    }
    reply(server, ws, message.id, "remote-session-terminal", terminal);
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_TERMINAL_ERROR",
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
    const { session, member } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      "observe",
    );
    if (
      session.hostPrincipalId
        ? member.principalId !== session.hostPrincipalId
        : session.hostClientId !== clientId
    ) {
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
    const { session, member, statement } = server.remoteSessions.revokeMember(
      message.remoteSessionId,
      clientId,
      targetClientId,
    );
    notifyRevokedDevice(
      server,
      message.remoteSessionId,
      session.agentSessionId,
      member.transportClientId || member.clientId,
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
      ...(statement ? { statement } : {}),
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
    const closed = server.remoteSessions.close(
      message.remoteSessionId,
      clientId,
    );
    const session = closed?.session || closed;
    server.remoteSessionCrypto.delete(message.remoteSessionId);
    server.remoteSessionPairingSecrets.delete(message.remoteSessionId);
    audit(server, {
      sessionId: message.remoteSessionId,
      actor: clientId,
      action: "session.closed",
      detail: { reason: "host-closed" },
    });
    reply(server, ws, message.id, "remote-session-closed", {
      session,
      ...(closed?.statement ? { statement: closed.statement } : {}),
      ...(closed?.terminal ? { terminal: true } : {}),
      ...(closed?.alreadyClosed ? { alreadyClosed: true } : {}),
    });
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
    const { session, member, membership } = server.remoteSessions.authorize(
      message.remoteSessionId,
      clientId,
      requiredScope || "observe",
    );
    // Runtime/output events are host-only. Remote clients may publish only the
    // explicitly scoped control event types above.
    const actorIsHost = session.hostPrincipalId
      ? member.principalId === session.hostPrincipalId
      : session.hostClientId === clientId;
    if (!requiredScope && !actorIsHost) {
      throw new Error("Only the host can publish runtime events");
    }

    if (
      !requiredScope &&
      session.hostPrincipalId &&
      message.event.type === "permission.request"
    ) {
      if (!membership) {
        throw new Error(
          "Durable coordinator membership is required for a remote approval request",
        );
      }
      rememberRemoteApprovalRequest(server, session, member, message.event);
    } else if (!requiredScope && message.event.type === "permission.resolved") {
      server._remoteApprovalRequests?.delete(
        approvalRequestKey(
          session.sessionId,
          message.event.requestId || message.event.approvalId,
        ),
      );
    }

    if (requiredScope && !actorIsHost) {
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
      if (message.event.type === "question.answer") {
        if (
          typeof message.event.requestId !== "string" ||
          !message.event.requestId
        ) {
          throw new Error("question requestId is required");
        }
        if (!hasCompleteInteractionBinding(message.event.binding)) {
          throw new Error("complete question binding is required");
        }
        assertCanAnswerInteraction({
          origin: ORIGIN.REMOTE,
          authenticated: true,
          scopes: ["prompt"],
          principalId: member.principalId || clientId,
          sessionId: message.remoteSessionId,
        });
      }
      // Authority (§"权限来源与跨 Agent 授权边界"): a remote *approve* is honored
      // only from an authenticated, approve-scoped device — the SINGLE
      // authoritative rule, not just the per-device scope check above, so the
      // remote seam can never drift from the local/headless approval gate. The
      // approve scope was already proven by the `authorize(..., "approve")` call
      // above; asserting here makes that rule explicit and centralized. Built
      // up-front (before the idempotency ledger) so a rejected approve never
      // consumes a commandId slot. A deny always passes (anyone may deny —
      // fail-safe). The envelope also feeds `describeAuthorityChain` provenance
      // into the audit trail below.
      let approvalEnvelope = null;
      let approvalDecision = null;
      if (message.event.type === "approval.resolve") {
        approvalDecision = requireRemoteApprovalDecision(message.event, {
          requireCanonical:
            member.capabilities?.includes(
              REMOTE_APPROVAL_DECISION_CAPABILITY,
            ) === true,
        });
        approvalEnvelope = {
          origin: ORIGIN.REMOTE,
          authenticated: true,
          scopes: ["approve"],
          principalId:
            membership?.principalId || member.principalId || clientId,
          sessionId: message.remoteSessionId,
          ...(membership
            ? {
                remoteSessionId: membership.sessionId,
                sessionEpoch: membership.sessionEpoch,
                membershipEpoch: membership.membershipEpoch,
              }
            : {}),
        };
        if (approvalDecision.approved) {
          assertCanApprove(approvalEnvelope);
          if (session.hostPrincipalId) {
            requireRemoteApprovalRequest(server, session, message.event);
          }
        }
      }
      // CLIENT-HOSTED sessions (第四阶段 #2): when the agent session does not
      // live in THIS server's sessionManager — e.g. a REPL/headless process
      // that connected as a WS client and registered its own local session id —
      // the server cannot dispatch the control event itself. Forward it to the
      // HOST connection instead; the host's approval bridge resolves its local
      // permission gate / prompt queue. Checked BEFORE the idempotency ledger
      // so "host unreachable" never consumes a commandId slot (stays retryable
      // after the host reconnects). Server-hosted sessions are byte-identical.
      let serverHosted = false;
      try {
        serverHosted = Boolean(
          server.sessionManager?.getSession?.(session.agentSessionId),
        );
      } catch {
        serverHosted = false;
      }
      let hostTarget = null;
      if (!serverHosted) {
        hostTarget = server.clients.get(session.hostClientId);
        if (!hostTarget) {
          throw new Error(
            "Remote session host is not reachable for this control event",
          );
        }
        if (message.event.type === "approval.resolve" && !membership) {
          throw new Error(
            "Durable Remote membership authority is required before forwarding an approval",
          );
        }
      } else if (
        session.hostPrincipalId &&
        message.event.type === "approval.resolve" &&
        approvalDecision.approved
      ) {
        throw new Error(
          "Server-hosted remote approval is disabled until its dispatch path consumes a durable lease",
        );
      }
      // Idempotent forward: a control event with a stable commandId runs its
      // side effect (audit + dispatch into the host agent) AT MOST ONCE, so a
      // reconnecting device re-sending the same prompt/approval/interrupt gets a
      // `replayed` ack instead of a second agent turn. No commandId → forwarded
      // directly, byte-identical to before.
      await applyControlIdempotent(server, clientId, ws, message, async () => {
        let approvalLease = null;
        if (
          session.hostPrincipalId &&
          message.event.type === "approval.resolve" &&
          !serverHosted
        ) {
          const request = requireRemoteApprovalRequest(
            server,
            session,
            message.event,
          );
          if (approvalDecision.approved) {
            approvalLease = server
              ._requireRemoteMembershipCoordinator()
              .createApprovalLease({
                sessionId: session.sessionId,
                sessionEpoch: membership.sessionEpoch,
                principalId: membership.principalId,
                membershipEpoch: membership.membershipEpoch,
                hostPrincipalId: request.hostPrincipalId,
                requestId: request.requestId,
                fingerprint: request.fingerprint,
                binding: request.binding,
                expiresAt: request.expiresAt,
              });
          }
          server._remoteApprovalRequests.delete(
            approvalRequestKey(session.sessionId, request.requestId),
          );
        }
        if (!serverHosted) {
          // Audit the control action with the same taxonomy as server-hosted
          // dispatch, then hand the event to the host process.
          const auditAction =
            message.event.type === "prompt"
              ? "control.prompt"
              : message.event.type === "approval.resolve"
                ? "control.approval"
                : message.event.type === "question.answer"
                  ? "control.question"
                  : "control.interrupt";
          audit(server, {
            sessionId: message.remoteSessionId,
            actor: membership?.principalId || member.principalId || clientId,
            action: auditAction,
            detail:
              message.event.type === "prompt"
                ? { chars: message.event.content.length, forwarded: true }
                : message.event.type === "approval.resolve"
                  ? {
                      requestId:
                        message.event.requestId || message.event.approvalId,
                      approved: approvalDecision.approved,
                      decisionKind: approvalDecision.kind,
                      // Log-safe provenance: which principal/session/authority.
                      authority: describeAuthorityChain(approvalEnvelope || {}),
                      forwarded: true,
                    }
                  : message.event.type === "question.answer"
                    ? {
                        requestId: message.event.requestId,
                        authority: describeAuthorityChain({
                          origin: ORIGIN.REMOTE,
                          authenticated: true,
                          scopes: ["prompt"],
                          principalId: clientId,
                          sessionId: message.remoteSessionId,
                        }),
                        forwarded: true,
                      }
                    : { forwarded: true },
          });
          // Hand the event to the host process. `message.event` carries any
          // echoed approval or interaction binding, so the host gate can
          // reject a stale / tampered verdict.
          server.remoteSessions.authorize(
            message.remoteSessionId,
            clientId,
            requiredScope || "observe",
          );
          const currentSession = server.remoteSessions.requireSession(
            message.remoteSessionId,
          );
          const currentHostTransport = currentSession.hostClientId;
          server.remoteSessions.authorize(
            message.remoteSessionId,
            currentHostTransport,
            "observe",
          );
          const currentHostTarget = server.clients.get(currentHostTransport);
          if (!currentHostTarget || currentHostTarget.ws !== hostTarget.ws) {
            throw new Error(
              "Remote session host transport changed before delivery",
            );
          }
          server._send(currentHostTarget.ws, {
            type: "remote-session-control",
            remoteSessionId: message.remoteSessionId,
            agentSessionId: session.agentSessionId,
            from: membership?.principalId || member.principalId || clientId,
            ...(membership
              ? {
                  membershipAuthority: membership.authorityVersion,
                  sessionEpoch: membership.sessionEpoch,
                  membershipEpoch: membership.membershipEpoch,
                  memberCapabilities: [...(member.capabilities || [])],
                }
              : {}),
            event: message.event,
            ...(approvalLease
              ? { approvalLeaseStatement: approvalLease.statement }
              : {}),
          });
          reply(server, ws, message.id, "remote-session-published", {
            delivered: 1,
            forwardedToHost: true,
          });
          return;
        }
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
              approved: approvalDecision.approved,
              decisionKind: approvalDecision.kind,
              // Log-safe provenance: which principal/session/authority approved.
              authority: describeAuthorityChain(approvalEnvelope || {}),
            },
          });
          await handleSessionAnswer(server, message.id, ws, {
            ...controlMessage,
            requestId: message.event.requestId || message.event.approvalId,
            answer: approvalDecision.approved,
            // Echoed approval binding (if any): the host interaction gate rejects
            // a verdict whose binding doesn't match the pending request.
            binding: message.event.binding ?? null,
          });
        } else if (message.event.type === "question.answer") {
          const authority = {
            origin: ORIGIN.REMOTE,
            authenticated: true,
            scopes: ["prompt"],
            principalId: clientId,
            sessionId: message.remoteSessionId,
          };
          audit(server, {
            sessionId: message.remoteSessionId,
            actor: clientId,
            action: "control.question",
            detail: {
              requestId: message.event.requestId,
              authority: describeAuthorityChain(authority),
            },
          });
          await handleSessionAnswer(server, message.id, ws, {
            ...controlMessage,
            requestId: message.event.requestId,
            answer: message.event.answer ?? null,
            binding: message.event.binding,
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
      if (
        member.transportClientId === clientId ||
        (!member.transportClientId && member.clientId === clientId)
      )
        continue;
      // Wake a backgrounded device for approval/permission requests — parity
      // with the server-hosted mirror path (_mirrorRemoteSessionEvent). A
      // client-hosted session publishing `permission.request` must reach a
      // suspended phone the same way (第四阶段 #2).
      if (
        member.pushToken &&
        isApprovalRequestEvent(message.event.type) &&
        typeof server._dispatchApprovalPush === "function"
      ) {
        server._dispatchApprovalPush(session, member, message.event);
      }
      const transportClientId = member.transportClientId || member.clientId;
      const target = server.clients.get(transportClientId);
      if (!target) {
        // Relay-paired mobiles have no local socket — deliver over the E2EE
        // relay like the mirror path does; without this, host-published
        // events silently skipped every relay member.
        if (server.remoteSessionRelay) {
          const crypto = server.remoteSessionCrypto?.get(
            message.remoteSessionId,
          );
          if (crypto) {
            try {
              server.remoteSessions.authorize(
                message.remoteSessionId,
                transportClientId,
                "observe",
              );
              server.remoteSessionRelay.sendEncrypted(
                transportClientId,
                crypto.encrypt(transportClientId, {
                  type: "remote-session-event",
                  remoteSessionId: message.remoteSessionId,
                  agentSessionId: session.agentSessionId,
                  event: message.event,
                }),
              );
              delivered += 1;
            } catch {
              // Peer key may be gone — best-effort, same as revocation notice.
            }
          }
        }
        continue;
      }
      try {
        server.remoteSessions.authorize(
          message.remoteSessionId,
          transportClientId,
          "observe",
        );
        const currentTarget = server.clients.get(transportClientId);
        if (!currentTarget || currentTarget.ws !== target.ws) continue;
        server._send(currentTarget.ws, {
          type: "remote-session-event",
          remoteSessionId: message.remoteSessionId,
          agentSessionId: session.agentSessionId,
          event: message.event,
        });
        delivered += 1;
      } catch {
        // Revoked/closed after enumeration: do not deliver to the old socket.
      }
    }
    reply(server, ws, message.id, "remote-session-published", { delivered });
  } catch (error) {
    reply(server, ws, message.id, "error", {
      code: "REMOTE_SESSION_PUBLISH_ERROR",
      message: error.message,
    });
  }
}
