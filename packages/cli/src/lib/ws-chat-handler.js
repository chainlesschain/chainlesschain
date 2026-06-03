/**
 * WebSocket Chat Handler
 *
 * Handles simple streaming chat sessions over WebSocket.
 * Consumes chat-core's chatStream generator.
 */

import { chatWithStreaming } from "./chat-core.js";

export class WSChatHandler {
  /**
   * @param {object} options
   * @param {import("./ws-session-manager.js").Session} options.session
   * @param {import("./interaction-adapter.js").WebSocketInteractionAdapter} options.interaction
   */
  constructor({ session, interaction }) {
    this.session = session;
    this.interaction = interaction;
    this._processing = false;
  }

  /**
   * Handle a user message — stream the response.
   *
   * @param {string} userMessage
   * @param {string} [requestId]
   */
  async handleMessage(userMessage, requestId) {
    if (this._processing) {
      this.interaction.emit("error", {
        requestId,
        code: "BUSY",
        message: "Session is currently processing a message",
      });
      return;
    }

    this._processing = true;

    try {
      const { session } = this;
      session.messages.push({ role: "user", content: userMessage });

      const options = {
        provider: session.provider,
        model: session.model,
        baseUrl: session.baseUrl || "http://localhost:11434",
        apiKey: session.apiKey,
        // Phase J — pipe WS session id so chat-core records token_usage
        // into the JSONL session store; visible via `cc session usage`.
        sessionId: session.sessionId || session.id,
      };

      const fullContent = await chatWithStreaming(
        session.messages,
        options,
        (event) => {
          if (event.type === "response-token") {
            this.interaction.emit("response-token", {
              requestId,
              token: event.token,
            });
          }
        },
      );

      session.messages.push({ role: "assistant", content: fullContent });
      this.interaction.emit("response-complete", {
        requestId,
        content: fullContent,
      });

      session.lastActivity = new Date().toISOString();
    } catch (err) {
      this.interaction.emit("error", {
        requestId,
        code: "CHAT_ERROR",
        message: err.message,
      });
    } finally {
      this._processing = false;
    }
  }

  /**
   * Handle slash commands.
   *
   * @param {string} command
   * @param {string} [requestId]
   */
  handleSlashCommand(command, requestId) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const arg = args.join(" ").trim();
    const { session } = this;

    switch (cmd) {
      case "/model":
        if (arg) session.model = arg;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { model: session.model },
        });
        break;

      case "/provider":
        if (arg) session.provider = arg;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { provider: session.provider },
        });
        break;

      case "/clear":
        session.messages.length = 0;
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { cleared: true },
        });
        break;

      case "/history":
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            messages: session.messages.map((m) => ({
              role: m.role,
              content:
                m.content.length > 200
                  ? m.content.substring(0, 200) + "..."
                  : m.content,
            })),
          },
        });
        break;

      default:
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { error: `Unknown command: ${cmd}` },
        });
    }
  }
}

// =====================================================================
// ws-chat-handler V2 governance overlay (iter27)
// =====================================================================
export const WSCGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  IDLE: "idle",
  ARCHIVED: "archived",
});
export const WSCGOV_MSG_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  HANDLING: "handling",
  HANDLED: "handled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _wscgovPTrans = new Map([
  [
    WSCGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      WSCGOV_PROFILE_MATURITY_V2.ACTIVE,
      WSCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WSCGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      WSCGOV_PROFILE_MATURITY_V2.IDLE,
      WSCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WSCGOV_PROFILE_MATURITY_V2.IDLE,
    new Set([
      WSCGOV_PROFILE_MATURITY_V2.ACTIVE,
      WSCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [WSCGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _wscgovPTerminal = new Set([WSCGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _wscgovJTrans = new Map([
  [
    WSCGOV_MSG_LIFECYCLE_V2.QUEUED,
    new Set([
      WSCGOV_MSG_LIFECYCLE_V2.HANDLING,
      WSCGOV_MSG_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    WSCGOV_MSG_LIFECYCLE_V2.HANDLING,
    new Set([
      WSCGOV_MSG_LIFECYCLE_V2.HANDLED,
      WSCGOV_MSG_LIFECYCLE_V2.FAILED,
      WSCGOV_MSG_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [WSCGOV_MSG_LIFECYCLE_V2.HANDLED, new Set()],
  [WSCGOV_MSG_LIFECYCLE_V2.FAILED, new Set()],
  [WSCGOV_MSG_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _wscgovPsV2 = new Map();
const _wscgovJsV2 = new Map();
let _wscgovMaxActive = 10,
  _wscgovMaxPending = 25,
  _wscgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _wscgovStuckMs = 60 * 1000;
function _wscgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _wscgovCheckP(from, to) {
  const a = _wscgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wscgov profile transition ${from} → ${to}`);
}
function _wscgovCheckJ(from, to) {
  const a = _wscgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wscgov msg transition ${from} → ${to}`);
}
function _wscgovCountActive(owner) {
  let c = 0;
  for (const p of _wscgovPsV2.values())
    if (p.owner === owner && p.status === WSCGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _wscgovCountPending(profileId) {
  let c = 0;
  for (const j of _wscgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === WSCGOV_MSG_LIFECYCLE_V2.QUEUED ||
        j.status === WSCGOV_MSG_LIFECYCLE_V2.HANDLING)
    )
      c++;
  return c;
}
export function setMaxActiveWscgovProfilesPerOwnerV2(n) {
  _wscgovMaxActive = _wscgovPos(n, "maxActiveWscgovProfilesPerOwner");
}
export function getMaxActiveWscgovProfilesPerOwnerV2() {
  return _wscgovMaxActive;
}
export function setMaxPendingWscgovMsgsPerProfileV2(n) {
  _wscgovMaxPending = _wscgovPos(n, "maxPendingWscgovMsgsPerProfile");
}
export function getMaxPendingWscgovMsgsPerProfileV2() {
  return _wscgovMaxPending;
}
export function setWscgovProfileIdleMsV2(n) {
  _wscgovIdleMs = _wscgovPos(n, "wscgovProfileIdleMs");
}
export function getWscgovProfileIdleMsV2() {
  return _wscgovIdleMs;
}
export function setWscgovMsgStuckMsV2(n) {
  _wscgovStuckMs = _wscgovPos(n, "wscgovMsgStuckMs");
}
export function getWscgovMsgStuckMsV2() {
  return _wscgovStuckMs;
}
export function _resetStateWsChatHandlerGovV2() {
  _wscgovPsV2.clear();
  _wscgovJsV2.clear();
  _wscgovMaxActive = 10;
  _wscgovMaxPending = 25;
  _wscgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _wscgovStuckMs = 60 * 1000;
}
export function registerWscgovProfileV2({
  id,
  owner,
  connection,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_wscgovPsV2.has(id))
    throw new Error(`wscgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    connection: connection || "default",
    status: WSCGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wscgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateWscgovProfileV2(id) {
  const p = _wscgovPsV2.get(id);
  if (!p) throw new Error(`wscgov profile ${id} not found`);
  const isInitial = p.status === WSCGOV_PROFILE_MATURITY_V2.PENDING;
  _wscgovCheckP(p.status, WSCGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _wscgovCountActive(p.owner) >= _wscgovMaxActive)
    throw new Error(`max active wscgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = WSCGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function idleWscgovProfileV2(id) {
  const p = _wscgovPsV2.get(id);
  if (!p) throw new Error(`wscgov profile ${id} not found`);
  _wscgovCheckP(p.status, WSCGOV_PROFILE_MATURITY_V2.IDLE);
  p.status = WSCGOV_PROFILE_MATURITY_V2.IDLE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveWscgovProfileV2(id) {
  const p = _wscgovPsV2.get(id);
  if (!p) throw new Error(`wscgov profile ${id} not found`);
  _wscgovCheckP(p.status, WSCGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = WSCGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchWscgovProfileV2(id) {
  const p = _wscgovPsV2.get(id);
  if (!p) throw new Error(`wscgov profile ${id} not found`);
  if (_wscgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal wscgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getWscgovProfileV2(id) {
  const p = _wscgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listWscgovProfilesV2() {
  return [..._wscgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createWscgovMsgV2({ id, profileId, payload, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_wscgovJsV2.has(id)) throw new Error(`wscgov msg ${id} already exists`);
  if (!_wscgovPsV2.has(profileId))
    throw new Error(`wscgov profile ${profileId} not found`);
  if (_wscgovCountPending(profileId) >= _wscgovMaxPending)
    throw new Error(`max pending wscgov msgs for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    payload: payload || "",
    status: WSCGOV_MSG_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wscgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function handlingWscgovMsgV2(id) {
  const j = _wscgovJsV2.get(id);
  if (!j) throw new Error(`wscgov msg ${id} not found`);
  _wscgovCheckJ(j.status, WSCGOV_MSG_LIFECYCLE_V2.HANDLING);
  const now = Date.now();
  j.status = WSCGOV_MSG_LIFECYCLE_V2.HANDLING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeMsgWscgovV2(id) {
  const j = _wscgovJsV2.get(id);
  if (!j) throw new Error(`wscgov msg ${id} not found`);
  _wscgovCheckJ(j.status, WSCGOV_MSG_LIFECYCLE_V2.HANDLED);
  const now = Date.now();
  j.status = WSCGOV_MSG_LIFECYCLE_V2.HANDLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failWscgovMsgV2(id, reason) {
  const j = _wscgovJsV2.get(id);
  if (!j) throw new Error(`wscgov msg ${id} not found`);
  _wscgovCheckJ(j.status, WSCGOV_MSG_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = WSCGOV_MSG_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelWscgovMsgV2(id, reason) {
  const j = _wscgovJsV2.get(id);
  if (!j) throw new Error(`wscgov msg ${id} not found`);
  _wscgovCheckJ(j.status, WSCGOV_MSG_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = WSCGOV_MSG_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getWscgovMsgV2(id) {
  const j = _wscgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listWscgovMsgsV2() {
  return [..._wscgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoIdleIdleWscgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _wscgovPsV2.values())
    if (
      p.status === WSCGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _wscgovIdleMs
    ) {
      p.status = WSCGOV_PROFILE_MATURITY_V2.IDLE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckWscgovMsgsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _wscgovJsV2.values())
    if (
      j.status === WSCGOV_MSG_LIFECYCLE_V2.HANDLING &&
      j.startedAt != null &&
      t - j.startedAt >= _wscgovStuckMs
    ) {
      j.status = WSCGOV_MSG_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getWsChatHandlerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(WSCGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _wscgovPsV2.values()) profilesByStatus[p.status]++;
  const msgsByStatus = {};
  for (const v of Object.values(WSCGOV_MSG_LIFECYCLE_V2)) msgsByStatus[v] = 0;
  for (const j of _wscgovJsV2.values()) msgsByStatus[j.status]++;
  return {
    totalWscgovProfilesV2: _wscgovPsV2.size,
    totalWscgovMsgsV2: _wscgovJsV2.size,
    maxActiveWscgovProfilesPerOwner: _wscgovMaxActive,
    maxPendingWscgovMsgsPerProfile: _wscgovMaxPending,
    wscgovProfileIdleMs: _wscgovIdleMs,
    wscgovMsgStuckMs: _wscgovStuckMs,
    profilesByStatus,
    msgsByStatus,
  };
}
