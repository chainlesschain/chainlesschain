// Remote Session vendor push — vivo (vpush) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for vivo/iQOO devices via the vivo Push server API. Auth is a two-step
// handshake: sign = MD5(appId + appKey + timestamp + appSecret) is exchanged for
// a short-lived `authToken` (valid ~24h), then a JSON POST to the single-send
// endpoint carries that token in the `authToken` header. Plain HTTPS with an
// injectable `fetch` (default global), fully unit-testable with a fake
// transport. The payload carries only routing ids (no session content).

import { createHash, randomUUID } from "node:crypto";
import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const DEFAULT_HOST = "https://api-push.vivo.com.cn";
const AUTH_PATH = "/message/auth";
const SEND_PATH = "/message/send";
// vivo authToken is valid for ~24h; refresh a few minutes early.
const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_TOKEN_SKEW_MS = 5 * 60_000;
const RESULT_SUCCESS = 0;
// vivo regId-invalid result codes (single-send). 10302/10303 cover an illegal
// regId or one that does not belong to this app.
const INVALID_TOKEN_CODES = new Set([10302, 10303]);
// vivo has no single canonical string either; also match the desc text.
const INVALID_TOKEN_RE =
  /invalid.*reg|reg.*invalid|illegal|unregist|not ?exist|无效|不存在|非法/i;

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function md5Hex(input) {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Mints + caches a vivo authToken from app id + key + secret. */
export class VivoAuthProvider {
  constructor(options = {}) {
    if (!options.appId) throw new Error("VivoAuthProvider requires an appId");
    if (!options.appKey) throw new Error("VivoAuthProvider requires an appKey");
    if (!options.appSecret) {
      throw new Error("VivoAuthProvider requires an appSecret");
    }
    this.appId = options.appId;
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.host = options.host || DEFAULT_HOST;
    this.now = options.now || Date.now;
    this.fetch = options.fetch || globalThis.fetch;
    this._cached = null; // { token, expiresAt }
  }

  async getAuthToken() {
    const now = this.now();
    if (this._cached && this._cached.expiresAt - AUTH_TOKEN_SKEW_MS > now) {
      return this._cached.token;
    }
    const timestamp = now;
    const sign = md5Hex(
      `${this.appId}${this.appKey}${timestamp}${this.appSecret}`,
    );
    const res = await this.fetch(`${this.host}${AUTH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: this.appId,
        appKey: this.appKey,
        timestamp,
        sign,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `vivo auth failed (${res.status}): ${await safeText(res)}`,
      );
    }
    const json = await res.json();
    if (Number(json.result) !== RESULT_SUCCESS || !json.authToken) {
      throw new Error(
        `vivo auth response missing authToken: ${json.desc || json.result}`,
      );
    }
    this._cached = {
      token: json.authToken,
      expiresAt: now + AUTH_TOKEN_TTL_MS,
    };
    return this._cached.token;
  }
}

/** Sends one notification to a vivo regId. */
export class VivoPushSender {
  constructor(options = {}) {
    if (!options.authProvider) {
      throw new Error("VivoPushSender requires an authProvider");
    }
    this.authProvider = options.authProvider;
    this.host = options.host || DEFAULT_HOST;
    this.fetch = options.fetch || globalThis.fetch;
    // vivo requires a unique requestId per message; injectable for tests.
    this.requestId =
      options.requestId || (() => randomUUID().replace(/-/g, ""));
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("vivo send requires a regId");
    const authToken = await this.authProvider.getAuthToken();
    // Routing ids only — no session content.
    const custom = { type: "remote-session.approval-request" };
    if (sessionId != null) custom.sessionId = String(sessionId);
    if (clientId != null) custom.clientId = String(clientId);
    const message = {
      regId: token,
      notifyType: 1, // 1 = notification bar
      title: notification?.title || "Approval requested",
      content: notification?.body || "A coding session needs your approval",
      skipType: 1, // 1 = open the app
      requestId: this.requestId(),
      clientCustomMap: custom,
    };
    const res = await this.fetch(`${this.host}${SEND_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authToken,
      },
      body: JSON.stringify(message),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && Number(json.result) === RESULT_SUCCESS) {
      return { id: json.taskId || null };
    }
    const code = Number(json.result);
    const desc = json.desc || `HTTP ${res.status}`;
    if (INVALID_TOKEN_CODES.has(code) || INVALID_TOKEN_RE.test(String(desc))) {
      throw new PushTokenUnregisteredError(`vivo regId invalid: ${desc}`);
    }
    throw new Error(
      `vivo push failed (${Number.isNaN(code) ? res.status : code}): ${desc}`,
    );
  }
}

/**
 * Build a bound vivo `sender` from env, or null when unconfigured.
 *
 * vivo env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_ID
 *   CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_KEY
 *   CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_SECRET
 *   CHAINLESSCHAIN_REMOTE_SESSION_VIVO_HOST  (optional; override the API host)
 */
export function createVivoPushSender(env = {}, options = {}) {
  const appId = options.appId || env.CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_ID;
  const appKey =
    options.appKey || env.CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_KEY;
  const appSecret =
    options.appSecret || env.CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_SECRET;
  if (!appId || !appKey || !appSecret) return null;
  const host = options.host || env.CHAINLESSCHAIN_REMOTE_SESSION_VIVO_HOST;
  let authProvider;
  try {
    authProvider =
      options.authProvider ||
      new VivoAuthProvider({ appId, appKey, appSecret, host, ...options });
  } catch {
    return null; // Malformed credentials — stay disabled rather than crash.
  }
  return new VivoPushSender({ authProvider, host, ...options }).handler;
}
