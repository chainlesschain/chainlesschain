// Remote Session vendor push — OPPO (HeyTap / ColorOS push) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for OPPO/OnePlus/realme devices via the OPPO Push (HeyTap) server API. Auth is
// a two-step handshake: sign = SHA256(app_key + timestamp + master_secret) is
// exchanged for a short-lived `auth_token` (valid ~24h), then a form POST to the
// unicast endpoint carries that token. Plain HTTPS with an injectable `fetch`
// (default global), fully unit-testable with a fake transport. The payload
// carries only routing ids (no session content).

import { createHash } from "node:crypto";
import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const DEFAULT_HOST = "https://api.push.oppomobile.com";
const AUTH_PATH = "/server/v1/auth";
const SEND_PATH = "/server/v1/message/notification/unicast";
// OPPO auth_token is valid for 24h; refresh a few minutes early.
const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_TOKEN_SKEW_MS = 5 * 60_000;
const CODE_SUCCESS = 0;
// OPPO has no single canonical "unregistered" code for a stale registration id;
// match the message text it returns alongside the failing code.
const INVALID_TOKEN_RE =
  /invalid.*registration|registration.*invalid|invalid.*token|token.*invalid|unregist|not ?exist|无效|不存在/i;

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Mints + caches an OPPO auth_token from app key + master secret. */
export class OppoAuthProvider {
  constructor(options = {}) {
    if (!options.appKey) throw new Error("OppoAuthProvider requires an appKey");
    if (!options.masterSecret) {
      throw new Error("OppoAuthProvider requires a masterSecret");
    }
    this.appKey = options.appKey;
    this.masterSecret = options.masterSecret;
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
    const timestamp = String(now);
    const sign = sha256Hex(`${this.appKey}${timestamp}${this.masterSecret}`);
    const body = new URLSearchParams({
      app_key: this.appKey,
      sign,
      timestamp,
    });
    const res = await this.fetch(`${this.host}${AUTH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `OPPO auth failed (${res.status}): ${await safeText(res)}`,
      );
    }
    const json = await res.json();
    const token = json?.data?.auth_token;
    if (Number(json.code) !== CODE_SUCCESS || !token) {
      throw new Error(
        `OPPO auth response missing auth_token: ${json.message || json.code}`,
      );
    }
    this._cached = { token, expiresAt: now + AUTH_TOKEN_TTL_MS };
    return token;
  }
}

/** Sends one notification to an OPPO registration id. */
export class OppoPushSender {
  constructor(options = {}) {
    if (!options.authProvider) {
      throw new Error("OppoPushSender requires an authProvider");
    }
    this.authProvider = options.authProvider;
    this.host = options.host || DEFAULT_HOST;
    this.fetch = options.fetch || globalThis.fetch;
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("OPPO send requires a registration id");
    const authToken = await this.authProvider.getAuthToken();
    // Routing ids only — no session content.
    const data = { type: "remote-session.approval-request" };
    if (sessionId != null) data.sessionId = String(sessionId);
    if (clientId != null) data.clientId = String(clientId);
    const message = {
      target_type: 2, // 2 = single registration_id
      target_value: token,
      notification: {
        title: notification?.title || "Approval requested",
        content: notification?.body || "A coding session needs your approval",
        click_action_type: 0, // open the app
        action_parameters: JSON.stringify(data),
      },
    };
    const body = new URLSearchParams({
      auth_token: authToken,
      message: JSON.stringify(message),
    });
    const res = await this.fetch(`${this.host}${SEND_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        auth_token: authToken,
      },
      body: body.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && Number(json.code) === CODE_SUCCESS) {
      return { id: json.data?.messageId || null };
    }
    const reason = json.message || `HTTP ${res.status}`;
    if (INVALID_TOKEN_RE.test(String(reason))) {
      throw new PushTokenUnregisteredError(
        `OPPO registration id invalid: ${reason}`,
      );
    }
    throw new Error(`OPPO push failed (${json.code ?? res.status}): ${reason}`);
  }
}

/**
 * Build a bound OPPO `sender` from env, or null when unconfigured.
 *
 * OPPO env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_OPPO_APP_KEY
 *   CHAINLESSCHAIN_REMOTE_SESSION_OPPO_MASTER_SECRET
 *   CHAINLESSCHAIN_REMOTE_SESSION_OPPO_HOST  (optional; override the API host)
 */
export function createOppoPushSender(env = {}, options = {}) {
  const appKey =
    options.appKey || env.CHAINLESSCHAIN_REMOTE_SESSION_OPPO_APP_KEY;
  const masterSecret =
    options.masterSecret ||
    env.CHAINLESSCHAIN_REMOTE_SESSION_OPPO_MASTER_SECRET;
  if (!appKey || !masterSecret) return null;
  const host = options.host || env.CHAINLESSCHAIN_REMOTE_SESSION_OPPO_HOST;
  let authProvider;
  try {
    authProvider =
      options.authProvider ||
      new OppoAuthProvider({ appKey, masterSecret, host, ...options });
  } catch {
    return null; // Malformed credentials — stay disabled rather than crash.
  }
  return new OppoPushSender({ authProvider, host, ...options }).handler;
}
