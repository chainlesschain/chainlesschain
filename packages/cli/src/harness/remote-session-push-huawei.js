// Remote Session vendor push — Huawei (HMS Push Kit) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for Huawei/HarmonyOS devices via HMS Push Kit. Auth is OAuth2 client
// credentials (app id + secret) exchanged for a short-lived access token —
// simpler than FCM's signed JWT — then a Bearer POST to messages:send. Plain
// HTTPS with an injectable `fetch` (default global), fully unit-testable with a
// fake transport. The payload carries only routing ids (no session content).

import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const DEFAULT_TOKEN_URI =
  "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const DEFAULT_PUSH_HOST = "https://push-api.cloud.huawei.com";
const ACCESS_TOKEN_SKEW_MS = 60_000;
// HMS success + invalid-token result codes (single-token send).
const CODE_SUCCESS = "80000000";
const CODE_ALL_TOKENS_INVALID = "80300007";
const CODE_SOME_TOKENS_INVALID = "80100000";
const INVALID_TOKEN_RE = /invalid.*token|token.*invalid|unregist/i;

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function dropUndefined(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Mints + caches an OAuth2 access token from HMS client credentials. */
export class HuaweiTokenProvider {
  constructor(options = {}) {
    if (!options.appId)
      throw new Error("HuaweiTokenProvider requires an appId");
    if (!options.appSecret) {
      throw new Error("HuaweiTokenProvider requires an appSecret");
    }
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.tokenUri = options.tokenUri || DEFAULT_TOKEN_URI;
    this.now = options.now || Date.now;
    this.fetch = options.fetch || globalThis.fetch;
    this._cached = null; // { token, expiresAt }
  }

  async getAccessToken() {
    const now = this.now();
    if (this._cached && this._cached.expiresAt - ACCESS_TOKEN_SKEW_MS > now) {
      return this._cached.token;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.appId,
      client_secret: this.appSecret,
    });
    const res = await this.fetch(this.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `Huawei OAuth failed (${res.status}): ${await safeText(res)}`,
      );
    }
    const json = await res.json();
    if (!json.access_token) {
      throw new Error("Huawei OAuth response missing access_token");
    }
    const ttl = (Number(json.expires_in) || 3600) * 1000;
    this._cached = { token: json.access_token, expiresAt: now + ttl };
    return this._cached.token;
  }
}

/** Sends one notification to an HMS device token. */
export class HuaweiPushSender {
  constructor(options = {}) {
    if (!options.appId) throw new Error("HuaweiPushSender requires an appId");
    if (!options.tokenProvider) {
      throw new Error("HuaweiPushSender requires a tokenProvider");
    }
    this.appId = options.appId;
    this.tokenProvider = options.tokenProvider;
    this.fetch = options.fetch || globalThis.fetch;
    this.endpoint =
      options.endpoint ||
      `${options.host || DEFAULT_PUSH_HOST}/v1/${options.appId}/messages:send`;
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("Huawei send requires a device token");
    const accessToken = await this.tokenProvider.getAccessToken();
    const data = { type: "remote-session.approval-request" };
    if (sessionId != null) data.sessionId = String(sessionId);
    if (clientId != null) data.clientId = String(clientId);
    const message = {
      message: dropUndefined({
        notification: notification
          ? dropUndefined({
              title: notification.title,
              body: notification.body,
            })
          : undefined,
        android: { urgency: "HIGH" },
        data: JSON.stringify(data), // routing ids only, no session content
        token: [token],
      }),
    };
    const res = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.code === CODE_SUCCESS) {
      return { id: json.requestId || null };
    }
    const code = json.code || `HTTP ${res.status}`;
    const msg = json.msg || "";
    // A single-token send that reports invalid/all-invalid tokens means this
    // token is dead — prune it rather than retry.
    if (
      code === CODE_ALL_TOKENS_INVALID ||
      code === CODE_SOME_TOKENS_INVALID ||
      INVALID_TOKEN_RE.test(String(msg))
    ) {
      throw new PushTokenUnregisteredError(
        `Huawei token invalid (${code}): ${msg}`.trim(),
      );
    }
    throw new Error(`Huawei push failed (${code}): ${msg}`.trim());
  }
}

/**
 * Build a bound Huawei `sender` from env, or null when unconfigured.
 *
 * Huawei env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_ID
 *   CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_SECRET
 */
export function createHuaweiPushSender(env = {}, options = {}) {
  const appId =
    options.appId || env.CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_ID;
  const appSecret =
    options.appSecret || env.CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_SECRET;
  if (!appId || !appSecret) return null;
  let tokenProvider;
  try {
    tokenProvider =
      options.tokenProvider ||
      new HuaweiTokenProvider({ appId, appSecret, ...options });
  } catch {
    return null; // Malformed credentials — stay disabled rather than crash.
  }
  return new HuaweiPushSender({ appId, tokenProvider, ...options }).handler;
}
