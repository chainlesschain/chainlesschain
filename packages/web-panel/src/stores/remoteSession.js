// Web Remote Session client store.
//
// Two transports (auto-detected from the pairing URI):
//
//   RELAY  (chainlesschain://remote-session/pair#…)  — a browser port of the
//   Android RemoteSessionClient: joins over the signaling relay, speaks the
//   E2EE protocol, auto-reconnects transient drops on the already-derived
//   shared secret without re-spending the one-time pairing token.
//
//   DIRECT (chainlesschain://remote-control/pair#…)  — LAN mode from
//   `cc remote-control` / `cc agent --remote-control` / REPL `/remote-control`:
//   connects straight to the host's WS endpoint and authenticates with the
//   embedded server token. Legacy sessions consume the one-time pairing token
//   and cannot rejoin after a drop. Durable sessions bind a non-extractable
//   browser credential during that first join, then reconnect with fresh
//   possession challenges instead of replaying the token. Both speak the
//   plaintext-over-WS remote-session protocol and send controls with a
//   TOP-LEVEL commandId+seq for the host's idempotency ledger.
//
// Both transports feed the same event log and the same `pendingApprovals`
// cards: a `permission.request` runtime event (RemoteApprovalBridge) opens a
// card, `permission.resolved` (any decider: another device, the terminal, a
// timeout) clears it.

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  RemoteSessionCrypto,
  parseRemotePairingUri,
} from "../utils/remote-session-crypto.js";
import {
  isDirectPairingUri,
  parseDirectPairingUri,
} from "../utils/remote-control-pairing.js";
import {
  forgetRemoteMembershipCredential,
  getOrCreateRemoteMembershipCredential,
  rememberRemoteMembershipPrincipal,
  signRemoteMembershipChallenge,
} from "../utils/remote-membership-credential.js";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// The connection outlives route changes (singleton store) so approvals keep
// arriving while the user browses other panel pages — but the reconnect loop
// must not poll a dead relay forever from a background view. ~20 exponential
// attempts ≈ 8 minutes of outage, then give up; resumeReconnect() (view
// mount) starts a fresh round.
const RECONNECT_MAX_ATTEMPTS = 20;
const DIRECT_REQUEST_TIMEOUT_MS = 15_000;
const RELAY_PAIR_ACK_TIMEOUT_MS = 5_000;
const RELAY_PAIR_ACK_MAX_RETRIES = 2;

let seq = 0;
function newUuid() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function newPeerId() {
  return `web-${newUuid()}`;
}

export const useRemoteSessionStore = defineStore("remoteSession", () => {
  const status = ref("idle"); // idle|connecting|pairing|connected|reconnecting|disconnected|revoked|error
  const events = ref([]);
  const error = ref("");
  const remoteSessionId = ref(null);
  // "relay" | "direct" | null — which transport the active pairing uses.
  const transport = ref(null);
  // Scopes granted to THIS device by the pairing token (direct mode reports
  // them from the join ack; relay mode doesn't carry them → null).
  const scopes = ref(null);
  // First-class permission cards: [{requestId, tool, action, detail, askedAt}]
  // opened by `permission.request`, cleared by `permission.resolved` or an
  // answer sent from this panel.
  const pendingApprovals = ref([]);
  // Human questions carry a runtime-owned binding. Keep it opaque and echo
  // the stored value; UI input can never replace the authority tuple.
  const pendingQuestions = ref([]);

  // Process-local transport-card CAS. The host/CLI remains the durable
  // HumanTask authority; this state only prevents duplicate/conflicting sends
  // while a response or interrupt is in flight.
  const approvalSettlements = new Map();
  const resolvedApprovalIds = new Set();
  const resolvedApprovalOrder = [];

  // Non-reactive connection internals (persist for the singleton store).
  let socket = null;
  let crypto = null;
  let pairing = null;
  let peerId = null;
  let paired = false;
  let closedExplicitly = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let relayPairAckTimer = null;
  let relayPairAckRetries = 0;
  // Optional vendor push (Web Push subscription) carried in pair.join so the
  // host can wake this browser for approvals when the tab is backgrounded.
  let pushCredentials = null;
  // Idempotency (Phase 5): every control event carries a commandId + a
  // per-pairing monotonic seq. Relay mode stamps them INSIDE the encrypted
  // plaintext (the host reads event.commandId after decryption); direct mode
  // stamps them at the message TOP LEVEL (applyControlIdempotent reads
  // message.commandId first). deviceId is NOT sent: the host derives it from
  // the authenticated peer (spoof-proof).
  let controlSeq = 0;

  // Direct-mode internals.
  let directSocket = null;
  let directPairing = null;
  let directCredential = null;
  let directPrincipalId = null;
  let directPending = new Map(); // id → {resolve, reject, timer}
  let directCounter = 0;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearRelayPairAck() {
    if (relayPairAckTimer) {
      clearTimeout(relayPairAckTimer);
      relayPairAckTimer = null;
    }
  }

  // ── shared event ingestion (both transports) ─────────────────────────────

  function recordEvent(event) {
    const payload =
      event?.payload && typeof event.payload === "object"
        ? event.payload
        : event;
    if (
      ["permission.request", "approval.requested", "approval_request"].includes(
        event?.type,
      )
    ) {
      const requestId = approvalRequestId(event);
      if (
        requestId &&
        !approvalSettlements.has(requestId) &&
        !resolvedApprovalIds.has(requestId) &&
        !pendingApprovals.value.some((card) => card.requestId === requestId)
      ) {
        approvalSettlements.set(requestId, "pending");
        pendingApprovals.value = [
          ...pendingApprovals.value,
          {
            requestId,
            tool: event.tool || null,
            action: event.action || null,
            detail: event.detail || null,
            askedAt: event.askedAt || Date.now(),
            fingerprint: event.fingerprint || null,
            binding: event.binding || null,
            revision: event.revision ?? null,
            requestedPermissions: normalizeRequestedPermissions(event),
          },
        ];
      }
    } else if (
      [
        "permission.resolved",
        "approval.resolved",
        "approval_resolved",
      ].includes(event?.type)
    ) {
      const requestId = approvalRequestId(event);
      if (requestId) {
        approvalSettlements.delete(requestId);
        rememberResolvedApproval(requestId);
        clearApprovalCard(requestId);
      }
    } else if (
      ["question_request", "question.requested", "question"].includes(
        event?.type,
      )
    ) {
      const requestId = payload?.requestId || payload?.id || event?.id || null;
      const binding =
        payload?.binding &&
        typeof payload.binding === "object" &&
        !Array.isArray(payload.binding)
          ? payload.binding
          : null;
      if (
        requestId &&
        binding &&
        !pendingQuestions.value.some((card) => card.requestId === requestId)
      ) {
        pendingQuestions.value = [
          ...pendingQuestions.value,
          {
            requestId,
            question: payload.question || payload.prompt || "",
            options: Array.isArray(payload.options) ? payload.options : [],
            multiSelect: payload.multiSelect === true,
            binding,
          },
        ];
      }
    } else if (
      ["question_resolved", "question.resolved"].includes(event?.type)
    ) {
      const requestId = payload?.requestId || payload?.id || event?.id || null;
      if (requestId) clearQuestionCard(requestId);
    }
    seq += 1;
    events.value = [
      ...events.value,
      { ...event, _id: seq, _rxAt: Date.now() },
    ].slice(-200);
  }

  function clearApprovalCard(requestId) {
    pendingApprovals.value = pendingApprovals.value.filter(
      (card) => card.requestId !== requestId,
    );
  }

  function approvalRequestId(event) {
    return event?.requestId || event?.approvalId || event?.id || null;
  }

  function normalizeRequestedPermissions(event) {
    const raw = event?.requested_permissions ?? event?.requestedPermissions;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return null;
    const grants = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return null;
      const capability = entry.capability;
      const scope = entry.scope;
      const expiresAt = entry.expiresAt ?? entry.expires_at ?? null;
      if (
        typeof capability !== "string" ||
        capability.length < 1 ||
        capability.length > 128 ||
        typeof scope !== "string" ||
        scope.length < 1 ||
        scope.length > 1024 ||
        (expiresAt !== null && typeof expiresAt !== "string")
      ) {
        return null;
      }
      grants.push({
        capability,
        scope,
        ...(expiresAt === null ? {} : { expiresAt }),
      });
    }
    return grants;
  }

  function rememberResolvedApproval(requestId) {
    if (!resolvedApprovalIds.has(requestId)) {
      resolvedApprovalIds.add(requestId);
      resolvedApprovalOrder.push(requestId);
    }
    while (resolvedApprovalOrder.length > 1024) {
      resolvedApprovalIds.delete(resolvedApprovalOrder.shift());
    }
  }

  function resetApprovalSettlements() {
    approvalSettlements.clear();
    resolvedApprovalIds.clear();
    resolvedApprovalOrder.splice(0);
    pendingApprovals.value = [];
  }

  function clearQuestionCard(requestId) {
    pendingQuestions.value = pendingQuestions.value.filter(
      (card) => card.requestId !== requestId,
    );
  }

  // Undo an optimistic clear when the approval never left this client (send
  // failed / not connected) so the user can answer again. Same requestId
  // dedup as recordEvent — a re-delivered permission.request or a concurrent
  // restore never duplicates the card.
  function restoreApprovalCard(card) {
    if (!card || !card.requestId) return;
    // Don't resurrect a request another device/terminal resolved while our
    // send was failing — its permission.resolved is already in the log.
    const resolvedMeanwhile = events.value.some(
      (e) =>
        [
          "permission.resolved",
          "approval.resolved",
          "approval_resolved",
        ].includes(e.type) && approvalRequestId(e) === card.requestId,
    );
    if (resolvedMeanwhile || resolvedApprovalIds.has(card.requestId)) return;
    approvalSettlements.set(card.requestId, "pending");
    if (!pendingApprovals.value.some((c) => c.requestId === card.requestId)) {
      pendingApprovals.value = [...pendingApprovals.value, card];
    }
  }

  // ── relay transport ───────────────────────────────────────────────────────

  function openSocket() {
    if (!pairing) return;
    if (!paired) relayPairAckRetries = 0;
    const ws = new WebSocket(pairing.relayUrl);
    socket = ws;
    ws.addEventListener("open", () => {
      if (ws !== socket) return;
      ws.send(
        JSON.stringify({
          type: "register",
          peerId,
          deviceType: "web",
          deviceInfo: { protocol: "remote-session.e2ee.v1" },
        }),
      );
    });
    ws.addEventListener("message", (event) => {
      if (ws !== socket) return;
      handleMessage(event.data);
    });
    ws.addEventListener("close", () => {
      if (ws !== socket) return;
      clearRelayPairAck();
      socket = null;
      if (closedExplicitly) {
        status.value = "disconnected";
      } else {
        scheduleReconnect();
      }
    });
    ws.addEventListener("error", () => {
      if (ws !== socket) return;
      error.value = "Remote Session relay connection error";
    });
  }

  function scheduleReconnect() {
    if (closedExplicitly || reconnectTimer) return;
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      // Bounded: don't poll a dead relay forever from a backgrounded view.
      // The pairing is kept — resumeReconnect() revives it.
      status.value = "disconnected";
      error.value =
        "Remote Session 重连已放弃（中继长时间不可达）— 回到本页可自动重试";
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    reconnectAttempts += 1;
    status.value = "reconnecting";
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closedExplicitly) openSocket();
    }, delay);
  }

  // Revive a relay pairing whose reconnect loop hit the attempt cap (or that
  // dropped while nobody was looking). Called on view mount, so leaving the
  // page bounds the background churn yet coming back picks the session up
  // with a fresh attempt budget. Durable direct membership uses the same entry
  // point but resumes with a fresh possession challenge instead of replaying
  // its one-time pairing token.
  function resumeReconnect() {
    if (closedExplicitly || reconnectTimer) return;
    if (transport.value === "direct") {
      if (
        !directPairing?.durableMembership ||
        !directPrincipalId ||
        directSocket
      ) {
        return;
      }
      reconnectAttempts = 0;
      error.value = "";
      connectDirect(directPairing, { resumeOnly: true });
      return;
    }
    if (transport.value !== "relay" || !pairing || socket) return;
    reconnectAttempts = 0;
    error.value = "";
    status.value = "connecting";
    openSocket();
  }

  function handleMessage(raw) {
    try {
      let message = JSON.parse(typeof raw === "string" ? raw : String(raw));
      if (message.type === "offline-message")
        message = message.originalMessage || {};
      if (message.type === "registered") {
        if (paired) {
          // Reconnected after a transient drop — resume without re-pairing.
          status.value = "connected";
        } else {
          status.value = "pairing";
          sendPairRequest();
        }
        return;
      }
      if (message.type !== "message") return;
      const payload = message.payload;
      if (!payload || payload.type !== "remote-session.encrypted") return;
      const event = crypto.decrypt(payload.envelope);
      if (event.type === "pair.accepted") {
        clearRelayPairAck();
        paired = true;
        relayPairAckRetries = 0;
        reconnectAttempts = 0;
        status.value = "connected";
      } else if (event.type === "session.revoked") {
        closedExplicitly = true;
        paired = false;
        clearReconnect();
        clearRelayPairAck();
        if (socket) socket.close();
        socket = null;
        status.value = "revoked";
      } else {
        recordEvent(event);
      }
    } catch (cause) {
      status.value = "error";
      error.value = cause?.message || "Remote Session protocol error";
    }
  }

  function relaySend(payloadType, envelope) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !pairing)
      return false;
    socket.send(
      JSON.stringify({
        type: "message",
        to: pairing.hostPeerId,
        payload: { type: payloadType, ...envelope },
      }),
    );
    return true;
  }

  function sendPairRequest() {
    const join = {
      type: "pair.join",
      remoteSessionId: pairing.remoteSessionId,
      token: pairing.pairingToken,
      capabilities: ["approval-binding-v1", "approval-decision-v1"],
    };
    if (pushCredentials?.token) {
      join.pushToken = pushCredentials.token;
      join.pushProvider = pushCredentials.provider || "web";
    }
    const sent = relaySend("remote-session.pair", {
      mobilePeerId: peerId,
      mobilePublicKey: crypto.publicKeyBase64(),
      envelope: crypto.encrypt(join),
    });
    clearRelayPairAck();
    if (!sent) return false;
    relayPairAckTimer = setTimeout(() => {
      relayPairAckTimer = null;
      if (paired || closedExplicitly) return;
      if (relayPairAckRetries >= RELAY_PAIR_ACK_MAX_RETRIES) {
        // Force the ordinary reconnect path after bounded encrypted retries.
        // The next registered frame sends the same credential-bound join; the
        // host reconciles it without recreating or consuming a token.
        try {
          socket?.close();
        } catch {
          /* already closing */
        }
        return;
      }
      relayPairAckRetries += 1;
      sendPairRequest();
    }, RELAY_PAIR_ACK_TIMEOUT_MS);
    return true;
  }

  function sendControl(event) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !paired)
      return false;
    // Stamp the idempotency key before encryption (the host only sees the
    // decrypted event). Preserve a caller-supplied commandId so an explicit
    // retry of the SAME logical command stays deduplicable.
    const stamped = {
      ...event,
      commandId: event.commandId || newUuid(),
      seq: event.seq ?? ++controlSeq,
    };
    return relaySend("remote-session.encrypted", {
      envelope: crypto.encrypt(stamped),
    });
  }

  // ── direct (LAN) transport ────────────────────────────────────────────────

  function failDirectPending(reason) {
    for (const [, pending] of directPending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    directPending = new Map();
  }

  /**
   * Send `{id, type, ...payload}` and await the matching response frame.
   * Envelope responses repurpose `id` as an eventId and carry the correlation
   * key in `requestId` — match `requestId` FIRST, then `id` (same contract as
   * the CLI's WsRpcClient).
   */
  function directRequest(type, payload = {}) {
    const ws = directSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = `web-rc-${++directCounter}-${newUuid()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        directPending.delete(id);
        reject(new Error(`request "${type}" timed out`));
      }, DIRECT_REQUEST_TIMEOUT_MS);
      directPending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  function handleDirectMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return; // non-JSON frames are not part of this protocol
    }
    const key =
      message.requestId && directPending.has(message.requestId)
        ? message.requestId
        : message.id && directPending.has(message.id)
          ? message.id
          : null;
    if (key) {
      const pending = directPending.get(key);
      directPending.delete(key);
      clearTimeout(pending.timer);
      if (message.type === "error") {
        const remoteError = new Error(
          message.message || message.payload?.message || "server error",
        );
        if (typeof message.code === "string" && message.code) {
          remoteError.code = message.code;
        }
        remoteError.remoteResponse = true;
        pending.reject(remoteError);
      } else {
        pending.resolve(message);
      }
      return;
    }
    if (
      message.type === "remote-session-event" &&
      message.remoteSessionId === directPairing?.remoteSessionId
    ) {
      recordEvent(message.event || {});
      return;
    }
    if (
      message.type === "remote-session-revoked" &&
      message.remoteSessionId === directPairing?.remoteSessionId
    ) {
      closedExplicitly = true;
      const revokedSessionId = directPairing.remoteSessionId;
      directPrincipalId = null;
      directCredential = null;
      void forgetRemoteMembershipCredential(revokedSessionId);
      if (directSocket) directSocket.close();
      directSocket = null;
      status.value = "revoked";
    }
  }

  function scheduleDirectReconnect() {
    if (
      closedExplicitly ||
      reconnectTimer ||
      !directPairing?.durableMembership ||
      !directPrincipalId
    ) {
      return;
    }
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      status.value = "disconnected";
      error.value =
        "Durable Remote Session reconnect attempts were exhausted; retry from this page.";
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    reconnectAttempts += 1;
    status.value = "reconnecting";
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closedExplicitly && directPairing) {
        connectDirect(directPairing, { resumeOnly: true });
      }
    }, delay);
  }

  function connectDirect(parsed, { resumeOnly = false } = {}) {
    directPairing = parsed;
    remoteSessionId.value = parsed.remoteSessionId;
    transport.value = "direct";
    scopes.value = parsed.scopes;
    status.value = resumeOnly ? "reconnecting" : "connecting";
    const ws = new WebSocket(parsed.wsUrl);
    directSocket = ws;
    ws.addEventListener("open", async () => {
      if (ws !== directSocket) return;
      try {
        status.value = resumeOnly ? "reconnecting" : "pairing";
        if (parsed.serverToken) {
          const auth = await directRequest("auth", {
            token: parsed.serverToken,
          });
          if (!auth.success) {
            throw new Error(auth.message || "authentication failed");
          }
        }
        let joined;
        if (parsed.durableMembership) {
          directCredential =
            directCredential ||
            (await getOrCreateRemoteMembershipCredential(
              parsed.remoteSessionId,
            ));
          directPrincipalId =
            directPrincipalId || directCredential.principalId || null;
          const isCanonicalEpoch = (value) =>
            typeof value === "string" && /^[1-9]\d*$/.test(value);
          const validateMembershipResult = (result, operation, challenge) => {
            const resultSessionId = result.session?.sessionId || null;
            const resultPrincipalId =
              result.member?.principalId || result.member?.clientId || null;
            if (
              resultSessionId !== parsed.remoteSessionId ||
              resultPrincipalId !== directCredential.credentialPrincipalId ||
              !isCanonicalEpoch(challenge?.sessionEpoch) ||
              !isCanonicalEpoch(challenge?.membershipEpoch) ||
              result.session?.sessionEpoch !== challenge.sessionEpoch ||
              result.member?.membershipEpoch !== challenge.membershipEpoch
            ) {
              throw new Error(
                `Durable Remote Session ${operation} binding changed`,
              );
            }
            return result;
          };
          const resumeDurableMembership = async () => {
            if (!directPrincipalId) {
              throw new Error(
                "Durable Remote Session principal binding is unavailable",
              );
            }
            const challenged = await directRequest(
              "remote-session-resume-challenge",
              {
                remoteSessionId: parsed.remoteSessionId,
                principalId: directPrincipalId,
              },
            );
            if (
              challenged.challenge?.sessionId !== parsed.remoteSessionId ||
              challenged.challenge?.principalId !== directPrincipalId ||
              !isCanonicalEpoch(challenged.challenge?.sessionEpoch) ||
              !isCanonicalEpoch(challenged.challenge?.membershipEpoch)
            ) {
              throw new Error(
                "Durable Remote Session resume challenge binding changed",
              );
            }
            const signature = await signRemoteMembershipChallenge(
              challenged.challenge,
              directCredential.privateKey,
            );
            return validateMembershipResult(
              await directRequest("remote-session-resume", {
                remoteSessionId: parsed.remoteSessionId,
                challengeId: challenged.challenge.challengeId,
                signature,
              }),
              "resume",
              challenged.challenge,
            );
          };
          const joinWithFreshPairingToken = async () => {
            const challenged = await directRequest(
              "remote-session-join-challenge",
              {
                remoteSessionId: parsed.remoteSessionId,
                token: parsed.pairingToken,
                credentialPublicKey: directCredential.publicKey,
                capabilities: ["approval-binding-v1", "approval-decision-v1"],
              },
            );
            if (
              challenged.challenge?.sessionId !== parsed.remoteSessionId ||
              challenged.challenge?.principalId !==
                directCredential.credentialPrincipalId ||
              challenged.challenge?.credentialPublicKey !==
                directCredential.publicKey ||
              !isCanonicalEpoch(challenged.challenge?.sessionEpoch) ||
              !isCanonicalEpoch(challenged.challenge?.membershipEpoch)
            ) {
              throw new Error(
                "Durable Remote Session join challenge binding changed",
              );
            }
            // Persist the coordinator's deterministic credential principal
            // before dispatching the one-shot join. If the commit succeeds but
            // its response is lost, a fresh browser process can reconcile by
            // possession proof without replaying the pairing token.
            directCredential = await rememberRemoteMembershipPrincipal(
              parsed.remoteSessionId,
              directCredential.credentialPrincipalId,
            );
            directPrincipalId = directCredential.principalId;
            const signature = await signRemoteMembershipChallenge(
              challenged.challenge,
              directCredential.privateKey,
            );
            try {
              return validateMembershipResult(
                await directRequest("remote-session-join", {
                  remoteSessionId: parsed.remoteSessionId,
                  challengeId: challenged.challenge.challengeId,
                  signature,
                }),
                "join",
                challenged.challenge,
              );
            } catch (joinError) {
              // A remote error is a known failed join. Timeout/close is
              // outcome-unknown: read it back only through possession-based
              // resume, never by issuing another join or spending the token.
              if (joinError?.remoteResponse) throw joinError;
              try {
                return await resumeDurableMembership();
              } catch (resumeError) {
                resumeError.joinOutcomeUnknown = true;
                throw resumeError;
              }
            }
          };
          if (directPrincipalId) {
            try {
              joined = await resumeDurableMembership();
            } catch (resumeError) {
              // Automatic reconnect is resume-only: it must never consume or
              // retry a one-time token. A freshly scanned URI is different — a
              // host close then re-enable intentionally revokes the old membership,
              // so reuse the same non-extractable key to rejoin at epoch+1.
              if (
                resumeOnly ||
                resumeError?.code !== "REMOTE_SESSION_MEMBERSHIP_NOT_ACTIVE"
              ) {
                throw resumeError;
              }
              joined = await joinWithFreshPairingToken();
            }
          } else {
            if (resumeOnly) {
              throw new Error(
                "Durable Remote Session principal binding is unavailable",
              );
            }
            joined = await joinWithFreshPairingToken();
          }
        } else {
          joined = await directRequest("remote-session-join", {
            remoteSessionId: parsed.remoteSessionId,
            token: parsed.pairingToken,
          });
        }
        if (ws !== directSocket) return;
        scopes.value = joined.member?.scopes || parsed.scopes;
        reconnectAttempts = 0;
        error.value = "";
        status.value = "connected";
      } catch (cause) {
        if (ws !== directSocket) return;
        error.value = cause?.message || "Direct pairing failed";
        failDirectPending(error.value);
        directSocket = null;
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        if (
          !closedExplicitly &&
          (resumeOnly || cause?.joinOutcomeUnknown === true)
        ) {
          scheduleDirectReconnect();
        } else {
          status.value = "error";
        }
      }
    });
    ws.addEventListener("message", (event) => {
      if (ws !== directSocket) return;
      handleDirectMessage(event.data);
    });
    ws.addEventListener("close", () => {
      if (ws !== directSocket) return;
      directSocket = null;
      failDirectPending("connection closed");
      if (closedExplicitly) {
        if (status.value !== "revoked") status.value = "disconnected";
        return;
      }
      if (parsed.durableMembership && directPrincipalId) {
        scheduleDirectReconnect();
        return;
      }
      // The pairing token was one-time (consumed by the join), so a dropped
      // direct connection CANNOT silently re-join — surface it honestly
      // instead of auto-reconnect-looping into join errors.
      if (
        ["connected", "connecting", "pairing", "reconnecting"].includes(
          status.value,
        )
      ) {
        status.value = "disconnected";
        error.value =
          "直连会话已断开 — 配对码为一次性，请在主机端重新生成配对链接";
      }
    });
    ws.addEventListener("error", () => {
      if (ws !== directSocket) return;
      error.value = "Remote control host connection error";
    });
  }

  function sendDirectControl(event) {
    // Top-level commandId + seq: the direct-WS idempotency contract
    // (applyControlIdempotent reads message.commandId ?? event.commandId).
    return directRequest("remote-session-publish", {
      remoteSessionId: directPairing.remoteSessionId,
      commandId: newUuid(),
      seq: ++controlSeq,
      event,
    }).catch((cause) => {
      error.value = cause?.message || "Remote control send failed";
      return null;
    });
  }

  // ── public API ────────────────────────────────────────────────────────────

  function connect(uri, options = {}) {
    disconnect();
    try {
      error.value = "";
      events.value = [];
      resetApprovalSettlements();
      closedExplicitly = false;
      controlSeq = 0;
      if (isDirectPairingUri(uri)) {
        directCredential = null;
        directPrincipalId = null;
        reconnectAttempts = 0;
        connectDirect(parseDirectPairingUri(uri));
        return true;
      }
      const parsed = parseRemotePairingUri(uri);
      pushCredentials = options.pushCredentials || null;
      peerId = newPeerId();
      crypto = new RemoteSessionCrypto(parsed.remoteSessionId, peerId);
      crypto.pair(parsed.hostPublicKey, parsed.pairingToken);
      pairing = parsed;
      remoteSessionId.value = parsed.remoteSessionId;
      transport.value = "relay";
      scopes.value = null;
      paired = false;
      relayPairAckRetries = 0;
      reconnectAttempts = 0;
      status.value = "connecting";
      openSocket();
      return true;
    } catch (cause) {
      status.value = "error";
      error.value = cause?.message || "Invalid pairing link";
      return false;
    }
  }

  function sendPrompt(content) {
    const trimmed = (content || "").trim();
    if (!trimmed) return;
    if (transport.value === "direct") {
      if (directSocket) sendDirectControl({ type: "prompt", content: trimmed });
      else error.value = "Remote Session is not connected";
      return;
    }
    if (!sendControl({ type: "prompt", content: trimmed })) {
      error.value = "Remote Session is not connected";
    }
  }

  function approve(requestId, choice) {
    if (!requestId) return false;
    const card =
      pendingApprovals.value.find((c) => c.requestId === requestId) || null;
    if (!card || approvalSettlements.get(requestId) !== "pending") return false;
    const decision = buildApprovalDecision(card, choice);
    if (!decision) {
      error.value =
        "This approval does not contain a reviewable persistent grant";
      return false;
    }
    const approved = decision.kind.startsWith("accept");
    approvalSettlements.set(requestId, "responding");
    // Optimistic card clear (snappy UI + no double-answer while in flight) —
    // permission.resolved will confirm (idempotent). If the send fails or we
    // were never connected, the card is RESTORED so the answer can be retried
    // (the host gate stays pending until its own timeout).
    clearApprovalCard(requestId);
    if (transport.value === "direct") {
      if (!directSocket) {
        error.value = "Remote Session is not connected";
        restoreApprovalCard(card);
        return false;
      }
      sendDirectControl({
        type: "approval.resolve",
        requestId,
        decision,
        answer: approved,
        approved,
        fingerprint: card?.fingerprint || null,
        binding: card?.binding || null,
        revision: card?.revision ?? null,
      }).then((result) => {
        // sendDirectControl resolves null on failure (error.value already set).
        if (result === null) restoreApprovalCard(card);
      });
      return true;
    }
    if (
      !sendControl({
        type: "approval.resolve",
        requestId,
        decision,
        approved,
        fingerprint: card?.fingerprint || null,
        binding: card?.binding || null,
        revision: card?.revision ?? null,
      })
    ) {
      error.value = "Remote Session is not connected";
      restoreApprovalCard(card);
      return false;
    }
    return true;
  }

  function buildApprovalDecision(card, choice) {
    if (choice === true || choice === "once" || choice === "acceptOnce") {
      return { kind: "acceptOnce" };
    }
    if (choice === false || choice === "decline") {
      return { kind: "decline" };
    }
    if (choice === "turn" || choice === "acceptForTurn") {
      return card.requestedPermissions?.length
        ? { kind: "acceptForTurn", permissions: card.requestedPermissions }
        : null;
    }
    if (choice === "session" || choice === "acceptForSession") {
      return card.requestedPermissions?.length
        ? { kind: "acceptForSession", permissions: card.requestedPermissions }
        : null;
    }
    return null;
  }

  function answerQuestion(requestId, answer) {
    if (!requestId) return;
    const card =
      pendingQuestions.value.find((item) => item.requestId === requestId) ||
      null;
    if (!card?.binding) return;
    clearQuestionCard(requestId);
    const event = {
      type: "question.answer",
      requestId,
      answer,
      binding: card.binding,
    };
    if (transport.value === "direct") {
      if (!directSocket) {
        error.value = "Remote Session is not connected";
        pendingQuestions.value = [...pendingQuestions.value, card];
        return;
      }
      sendDirectControl(event).then((result) => {
        if (
          result === null &&
          !pendingQuestions.value.some((item) => item.requestId === requestId)
        ) {
          pendingQuestions.value = [...pendingQuestions.value, card];
        }
      });
      return;
    }
    if (!sendControl(event)) {
      error.value = "Remote Session is not connected";
      pendingQuestions.value = [...pendingQuestions.value, card];
    }
  }

  function interrupt() {
    const reserved = pendingApprovals.value.filter(
      (card) => approvalSettlements.get(card.requestId) === "pending",
    );
    for (const card of reserved) {
      approvalSettlements.set(card.requestId, "interrupting");
      clearApprovalCard(card.requestId);
    }
    const complete = (accepted) => {
      for (const card of reserved) {
        if (approvalSettlements.get(card.requestId) !== "interrupting")
          continue;
        if (accepted) {
          approvalSettlements.delete(card.requestId);
          rememberResolvedApproval(card.requestId);
        } else {
          restoreApprovalCard(card);
        }
      }
      return accepted;
    };
    if (transport.value === "direct") {
      if (!directSocket) return complete(false);
      sendDirectControl({ type: "interrupt" }).then((result) =>
        complete(result !== null),
      );
      return true;
    }
    return complete(sendControl({ type: "interrupt" }));
  }

  // Update the Web Push subscription after pairing (e.g. the browser re-subscribed
  // with a new endpoint). Records it for the next pair.join and, when already
  // paired, forwards it to the host now via a push.register control event.
  // (Relay transport only — direct LAN pairings are same-network/foreground.)
  function updatePushCredentials(token, provider = "web") {
    pushCredentials = token ? { token, provider } : null;
    if (!paired) return;
    const event = { type: "push.register" };
    if (pushCredentials?.token) {
      event.pushToken = pushCredentials.token;
      event.pushProvider = pushCredentials.provider;
    }
    sendControl(event);
  }

  function disconnect() {
    closedExplicitly = true;
    paired = false;
    clearReconnect();
    clearRelayPairAck();
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
    socket = null;
    if (directSocket) {
      try {
        directSocket.close();
      } catch {
        /* already closing */
      }
    }
    directSocket = null;
    directPairing = null;
    directCredential = null;
    directPrincipalId = null;
    failDirectPending("disconnected");
    resetApprovalSettlements();
    if (status.value !== "revoked") status.value = "disconnected";
  }

  return {
    status,
    events,
    error,
    remoteSessionId,
    transport,
    scopes,
    pendingApprovals,
    pendingQuestions,
    connect,
    sendPrompt,
    approve,
    answerQuestion,
    interrupt,
    updatePushCredentials,
    resumeReconnect,
    disconnect,
  };
});
