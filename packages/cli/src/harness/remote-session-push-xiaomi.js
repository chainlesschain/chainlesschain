// Remote Session vendor push — Xiaomi (小米) push sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for MIUI devices, using the Xiaomi Push server API. Unlike FCM/APNs there is
// no JWT — auth is a static app AppSecret in the `Authorization: key=` header —
// so this sender is a straight form-encoded POST over plain HTTPS with an
// injectable `fetch` (default global), fully unit-testable with a fake
// transport. The payload carries only routing ids (no session content).

import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const DEFAULT_HOST = "https://api.xmpush.xiaomi.com";
const SEND_PATH = "/v3/message/regid";

// Xiaomi does not use a single canonical "unregistered" code; match the reason
// text it returns for a stale/invalid registration id.
const INVALID_TOKEN_RE = /invalid|not valid|unregist|not ?exist|无效|不存在/i;

/** Sends one notification to a Xiaomi registration id. */
export class XiaomiPushSender {
  constructor(options = {}) {
    if (!options.appSecret) {
      throw new Error("XiaomiPushSender requires an appSecret");
    }
    if (!options.packageName) {
      throw new Error("XiaomiPushSender requires a packageName");
    }
    this.appSecret = options.appSecret;
    this.packageName = options.packageName;
    this.host = options.host || DEFAULT_HOST;
    this.fetch = options.fetch || globalThis.fetch;
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("Xiaomi send requires a registration id");
    const params = new URLSearchParams({
      registration_id: token,
      restricted_package_name: this.packageName,
      pass_through: "0", // 0 = show a notification, 1 = data-only
      notify_type: "-1", // default sound/vibrate
      title: notification?.title || "Approval requested",
      description: notification?.body || "A coding session needs your approval",
    });
    // Routing ids only — no session content.
    const payload = { type: "remote-session.approval-request" };
    if (sessionId != null) payload.sessionId = String(sessionId);
    if (clientId != null) payload.clientId = String(clientId);
    params.set("payload", JSON.stringify(payload));

    const res = await this.fetch(`${this.host}${SEND_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `key=${this.appSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.result === "ok" && Number(json.code) === 0) {
      return { id: json.data?.id || null };
    }
    const reason = json.reason || json.description || `HTTP ${res.status}`;
    if (INVALID_TOKEN_RE.test(String(reason))) {
      throw new PushTokenUnregisteredError(
        `Xiaomi registration id invalid: ${reason}`,
      );
    }
    throw new Error(`Xiaomi push failed: ${reason}`);
  }
}

/**
 * Build a bound Xiaomi `sender` from env, or null when unconfigured.
 *
 * Xiaomi env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_APP_SECRET
 *   CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_PACKAGE_NAME
 *   CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_HOST  (optional; e.g. the global host)
 */
export function createXiaomiPushSender(env = {}, options = {}) {
  const appSecret =
    options.appSecret || env.CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_APP_SECRET;
  const packageName =
    options.packageName ||
    env.CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_PACKAGE_NAME;
  if (!appSecret || !packageName) return null;
  const host = options.host || env.CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_HOST;
  return new XiaomiPushSender({
    appSecret,
    packageName,
    host,
    ...options,
  }).handler;
}
