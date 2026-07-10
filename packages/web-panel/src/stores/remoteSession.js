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
//   connects straight to the host's WS endpoint, authenticates with the
//   embedded server token, joins with the ONE-TIME pairing token, and speaks
//   the plaintext-over-WS remote-session protocol (auth → remote-session-join
//   → remote-session-event frames; controls via remote-session-publish with a
//   TOP-LEVEL commandId+seq for the host's idempotency ledger). Because the
//   pairing token is one-time, an unexpected drop cannot re-join — the store
//   reports `disconnected` with a re-pair hint instead of auto-reconnecting.
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

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// The connection outlives route changes (singleton store) so approvals keep
// arriving while the user browses other panel pages — but the reconnect loop
// must not poll a dead relay forever from a background view. ~20 exponential
// attempts ≈ 8 minutes of outage, then give up; resumeReconnect() (view
// mount) starts a fresh round.
const RECONNECT_MAX_ATTEMPTS = 20;
const DIRECT_REQUEST_TIMEOUT_MS = 15_000;

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

  // Non-reactive connection internals (persist for the singleton store).
  let socket = null;
  let crypto = null;
  let pairing = null;
  let peerId = null;
  let paired = false;
  let closedExplicitly = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
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
  let directPending = new Map(); // id → {resolve, reject, timer}
  let directCounter = 0;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // ── shared event ingestion (both transports) ─────────────────────────────

  function recordEvent(event) {
    if (event?.type === "permission.request") {
      const requestId = event.requestId || event.approvalId || null;
      if (
        requestId &&
        !pendingApprovals.value.some((card) => card.requestId === requestId)
      ) {
        pendingApprovals.value = [
          ...pendingApprovals.value,
          {
            requestId,
            tool: event.tool || null,
            action: event.action || null,
            detail: event.detail || null,
            askedAt: event.askedAt || Date.now(),
          },
        ];
      }
    } else if (event?.type === "permission.resolved") {
      const requestId = event.requestId || event.approvalId || null;
      if (requestId) clearApprovalCard(requestId);
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

  // Undo an optimistic clear when the approval never left this client (send
  // failed / not connected) so the user can answer again. Same requestId
  // dedup as recordEvent — a re-delivered permission.request or a concurrent
  // restore never duplicates the card.
  function restoreApprovalCard(card) {
    if (!card || !card.requestId) return;
    // Don't resurrect a request another device/terminal resolved while our
    // send was failing — its permission.resolved is already in the log.
    const resolvedMeanwhile = events.value.some(
      (e) => e.type === "permission.resolved" && e.requestId === card.requestId,
    );
    if (resolvedMeanwhile) return;
    if (!pendingApprovals.value.some((c) => c.requestId === card.requestId)) {
      pendingApprovals.value = [...pendingApprovals.value, card];
    }
  }

  // ── relay transport ───────────────────────────────────────────────────────

  function openSocket() {
    if (!pairing) return;
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
  // with a fresh attempt budget. No-op while connected/connecting, after an
  // explicit disconnect/revocation, and for direct transport (its one-time
  // pairing token cannot re-join anyway).
  function resumeReconnect() {
    if (transport.value !== "relay" || !pairing || closedExplicitly) return;
    if (socket || reconnectTimer) return;
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
        paired = true;
        reconnectAttempts = 0;
        status.value = "connected";
      } else if (event.type === "session.revoked") {
        closedExplicitly = true;
        paired = false;
        clearReconnect();
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
    };
    if (pushCredentials?.token) {
      join.pushToken = pushCredentials.token;
      join.pushProvider = pushCredentials.provider || "web";
    }
    relaySend("remote-session.pair", {
      mobilePeerId: peerId,
      mobilePublicKey: crypto.publicKeyBase64(),
      envelope: crypto.encrypt(join),
    });
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
        pending.reject(
          new Error(
            message.message || message.payload?.message || "server error",
          ),
        );
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
      if (directSocket) directSocket.close();
      directSocket = null;
      status.value = "revoked";
    }
  }

  function connectDirect(parsed) {
    directPairing = parsed;
    remoteSessionId.value = parsed.remoteSessionId;
    transport.value = "direct";
    scopes.value = parsed.scopes;
    status.value = "connecting";
    const ws = new WebSocket(parsed.wsUrl);
    directSocket = ws;
    ws.addEventListener("open", async () => {
      if (ws !== directSocket) return;
      try {
        status.value = "pairing";
        if (parsed.serverToken) {
          const auth = await directRequest("auth", {
            token: parsed.serverToken,
          });
          if (!auth.success) {
            throw new Error(auth.message || "authentication failed");
          }
        }
        const joined = await directRequest("remote-session-join", {
          remoteSessionId: parsed.remoteSessionId,
          token: parsed.pairingToken,
        });
        if (ws !== directSocket) return;
        scopes.value = joined.member?.scopes || parsed.scopes;
        status.value = "connected";
      } catch (cause) {
        if (ws !== directSocket) return;
        status.value = "error";
        error.value = cause?.message || "Direct pairing failed";
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        directSocket = null;
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
      // The pairing token was one-time (consumed by the join), so a dropped
      // direct connection CANNOT silently re-join — surface it honestly
      // instead of auto-reconnect-looping into join errors.
      if (status.value === "connected" || status.value === "pairing") {
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
      pendingApprovals.value = [];
      closedExplicitly = false;
      controlSeq = 0;
      if (isDirectPairingUri(uri)) {
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

  function approve(requestId, approved) {
    if (!requestId) return;
    const card =
      pendingApprovals.value.find((c) => c.requestId === requestId) || null;
    // Optimistic card clear (snappy UI + no double-answer while in flight) —
    // permission.resolved will confirm (idempotent). If the send fails or we
    // were never connected, the card is RESTORED so the answer can be retried
    // (the host gate stays pending until its own timeout).
    clearApprovalCard(requestId);
    if (transport.value === "direct") {
      if (!directSocket) {
        error.value = "Remote Session is not connected";
        restoreApprovalCard(card);
        return;
      }
      sendDirectControl({
        type: "approval.resolve",
        requestId,
        answer: approved,
        approved,
      }).then((result) => {
        // sendDirectControl resolves null on failure (error.value already set).
        if (result === null) restoreApprovalCard(card);
      });
      return;
    }
    if (!sendControl({ type: "approval.resolve", requestId, approved })) {
      error.value = "Remote Session is not connected";
      restoreApprovalCard(card);
    }
  }

  function interrupt() {
    if (transport.value === "direct") {
      if (directSocket) sendDirectControl({ type: "interrupt" });
      return;
    }
    sendControl({ type: "interrupt" });
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
    failDirectPending("disconnected");
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
    connect,
    sendPrompt,
    approve,
    interrupt,
    updatePushCredentials,
    resumeReconnect,
    disconnect,
  };
});
