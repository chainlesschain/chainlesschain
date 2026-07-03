// Remote Session vendor push — Firebase Cloud Messaging (HTTP v1) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender`
// contract that delivers approval wake-ups to Android devices through FCM's
// current HTTP v1 API (the legacy server-key API is retired). Auth uses a
// Google service account: a short-lived OAuth2 access token minted by signing a
// JWT (RS256) with the service account private key and exchanging it at
// oauth2.googleapis.com — no long-lived server key on disk.
//
// Everything is injectable (fetch, clock, signer, fs) so the whole chain is
// unit-testable with a generated keypair and a fake transport — no real
// credentials or network. The payload carries NO session content, only the
// routing shape (aligns with the audit log's privacy-first stance).

import { createSign } from "node:crypto";
import fs from "node:fs";
import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

// Re-exported for existing importers; canonical definition lives in the shared
// errors module so every provider raises the same type.
export { PushTokenUnregisteredError };

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ACCESS_TOKEN_SKEW_MS = 60_000; // refresh a minute before real expiry
const ASSERTION_TTL_SEC = 3600;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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

/** Mints + caches OAuth2 access tokens from a Google service account. */
export class GoogleServiceAccountTokenProvider {
  constructor(serviceAccount = {}, options = {}) {
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error(
        "Service account must include client_email and private_key",
      );
    }
    this.clientEmail = serviceAccount.client_email;
    this.privateKey = serviceAccount.private_key;
    this.tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
    this.scope = options.scope || FCM_SCOPE;
    this.now = options.now || Date.now;
    this.fetch = options.fetch || globalThis.fetch;
    // RS256 = RSA PKCS#1 v1.5 over SHA-256. Injectable for tests.
    this.sign =
      options.sign ||
      ((signingInput, key) =>
        createSign("RSA-SHA256").update(signingInput).sign(key));
    this._cached = null; // { token, expiresAt }
  }

  async getAccessToken() {
    const now = this.now();
    if (this._cached && this._cached.expiresAt - ACCESS_TOKEN_SKEW_MS > now) {
      return this._cached.token;
    }
    const assertion = this._buildAssertion(now);
    const body = new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion,
    });
    const res = await this.fetch(this.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `OAuth token request failed (${res.status}): ${await safeText(res)}`,
      );
    }
    const json = await res.json();
    if (!json.access_token) {
      throw new Error("OAuth token response missing access_token");
    }
    const expiresInMs = (Number(json.expires_in) || ASSERTION_TTL_SEC) * 1000;
    this._cached = { token: json.access_token, expiresAt: now + expiresInMs };
    return this._cached.token;
  }

  _buildAssertion(now) {
    const iat = Math.floor(now / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        iss: this.clientEmail,
        scope: this.scope,
        aud: this.tokenUri,
        iat,
        exp: iat + ASSERTION_TTL_SEC,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = base64url(this.sign(signingInput, this.privateKey));
    return `${signingInput}.${signature}`;
  }
}

/** Sends one high-priority data+notification message via FCM HTTP v1. */
export class FcmV1PushSender {
  constructor(options = {}) {
    if (!options.projectId) {
      throw new Error("FcmV1PushSender requires projectId");
    }
    if (!options.tokenProvider) {
      throw new Error("FcmV1PushSender requires a tokenProvider");
    }
    this.projectId = options.projectId;
    this.tokenProvider = options.tokenProvider;
    this.fetch = options.fetch || globalThis.fetch;
    this.endpoint =
      options.endpoint ||
      `https://fcm.googleapis.com/v1/projects/${options.projectId}/messages:send`;
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("FCM send requires a device token");
    const accessToken = await this.tokenProvider.getAccessToken();
    const message = {
      message: dropUndefined({
        token,
        notification: notification
          ? dropUndefined({
              title: notification.title,
              body: notification.body,
            })
          : undefined,
        // Data-only fields let the app route the wake-up; no session content.
        data: dropUndefined({
          type: "remote-session.approval-request",
          sessionId: sessionId != null ? String(sessionId) : undefined,
          clientId: clientId != null ? String(clientId) : undefined,
        }),
        android: { priority: "high" },
        apns: { headers: { "apns-priority": "10" } },
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
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return { id: json.name || null };
    }
    const text = await safeText(res);
    // A retired/uninstalled token surfaces as HTTP 404 or an UNREGISTERED /
    // NOT_FOUND error status — prune it rather than retry forever.
    if (res.status === 404 || /UNREGISTERED|NOT_FOUND/i.test(text)) {
      throw new PushTokenUnregisteredError(`FCM token unregistered: ${text}`);
    }
    throw new Error(`FCM send failed (${res.status}): ${text}`);
  }
}

function loadServiceAccount(env, options) {
  if (options.serviceAccount) return options.serviceAccount;
  const inline = env.CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      return null;
    }
  }
  const filePath = env.CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT;
  if (filePath) {
    const fsMod = options.fs || fs;
    try {
      return JSON.parse(fsMod.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build a bound FCM `sender` from env, or null when FCM is not configured. The
 * provider dispatch (fcm vs apns vs …) is the caller's job — see
 * remote-session-push-senders.js.
 *
 * FCM env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT      (path to JSON), or
 *   CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON (inline JSON)
 *   CHAINLESSCHAIN_REMOTE_SESSION_FCM_PROJECT_ID     (optional; else service
 *                                                     account project_id)
 */
export function createFcmPushSender(env = {}, options = {}) {
  const serviceAccount = loadServiceAccount(env, options);
  if (!serviceAccount) return null;
  const projectId =
    env.CHAINLESSCHAIN_REMOTE_SESSION_FCM_PROJECT_ID ||
    serviceAccount.project_id;
  if (!projectId) return null;
  let tokenProvider;
  try {
    tokenProvider =
      options.tokenProvider ||
      new GoogleServiceAccountTokenProvider(serviceAccount, options);
  } catch {
    return null; // Malformed service account — stay disabled rather than crash.
  }
  const sender = new FcmV1PushSender({ projectId, tokenProvider, ...options });
  return sender.handler;
}
