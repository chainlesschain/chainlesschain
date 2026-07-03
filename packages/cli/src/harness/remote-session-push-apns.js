// Remote Session vendor push — Apple Push Notification service (APNs) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for iOS/macOS devices, using APNs' HTTP/2 provider API with token-based
// (JWT ES256) auth: a short-lived bearer signed with the .p8 auth key
// (key id + team id). APNs mandates HTTP/2, so the network transport is an
// injectable `request` function (default: node:http2) — everything else is
// injectable too (clock, signer), so the whole chain is unit-testable with a
// generated EC keypair and a fake transport, no real credentials or network.
// The payload carries NO session content, only routing ids.

import { sign as cryptoSign } from "node:crypto";
import http2 from "node:http2";
import fs from "node:fs";
import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
// APNs auth tokens are valid up to 60 min; refresh well inside that window.
const JWT_TTL_MS = 50 * 60 * 1000;
const JWT_SKEW_MS = 60 * 1000;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function dropUndefined(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Default HTTP/2 transport for APNs. Resolves `{ status, headers, body }`. */
function http2Request({ url, headers, body }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = http2.connect(`${target.protocol}//${target.host}`);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `${target.pathname}${target.search}`,
      ...headers,
    });
    let status = 0;
    let responseHeaders = {};
    let data = "";
    req.on("response", (h) => {
      status = Number(h[":status"]) || 0;
      responseHeaders = h;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      client.close();
      resolve({ status, headers: responseHeaders, body: data });
    });
    req.on("error", (error) => {
      client.close();
      reject(error);
    });
    req.end(body);
  });
}

/** Mints + caches the ES256 provider JWT from a .p8 auth key. */
export class ApnsTokenProvider {
  constructor(options = {}) {
    if (!options.keyId) throw new Error("ApnsTokenProvider requires a keyId");
    if (!options.teamId) throw new Error("ApnsTokenProvider requires a teamId");
    if (!options.privateKey) {
      throw new Error("ApnsTokenProvider requires a privateKey (.p8 contents)");
    }
    this.keyId = options.keyId;
    this.teamId = options.teamId;
    this.privateKey = options.privateKey;
    this.now = options.now || Date.now;
    // ES256 = ECDSA P-256 / SHA-256 with a raw R||S signature (JOSE form).
    this.sign =
      options.sign ||
      ((input, key) =>
        cryptoSign("sha256", Buffer.from(input), {
          key,
          dsaEncoding: "ieee-p1363",
        }));
    this._cached = null; // { token, expiresAt }
  }

  getToken() {
    const now = this.now();
    if (this._cached && this._cached.expiresAt - JWT_SKEW_MS > now) {
      return this._cached.token;
    }
    const header = base64url(
      JSON.stringify({ alg: "ES256", kid: this.keyId, typ: "JWT" }),
    );
    const payload = base64url(
      JSON.stringify({ iss: this.teamId, iat: Math.floor(now / 1000) }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = base64url(this.sign(signingInput, this.privateKey));
    const token = `${signingInput}.${signature}`;
    this._cached = { token, expiresAt: now + JWT_TTL_MS };
    return token;
  }
}

/** Sends one high-priority alert to a device token via APNs HTTP/2. */
export class ApnsPushSender {
  constructor(options = {}) {
    if (!options.tokenProvider) {
      throw new Error("ApnsPushSender requires a tokenProvider");
    }
    if (!options.topic) {
      throw new Error("ApnsPushSender requires a topic (app bundle id)");
    }
    this.tokenProvider = options.tokenProvider;
    this.topic = options.topic;
    this.host = options.host || (options.production ? PROD_HOST : SANDBOX_HOST);
    this.request = options.request || http2Request;
  }

  /** Bound function matching the dispatcher's `sender` contract. */
  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("APNs send requires a device token");
    const jwt = this.tokenProvider.getToken();
    const payload = {
      aps: dropUndefined({
        alert: notification
          ? dropUndefined({
              title: notification.title,
              body: notification.body,
            })
          : undefined,
        sound: "default",
      }),
      // Routing ids only; no session content.
      "remote-session": dropUndefined({
        type: "approval-request",
        sessionId: sessionId != null ? String(sessionId) : undefined,
        clientId: clientId != null ? String(clientId) : undefined,
      }),
    };
    const res = await this.request({
      url: `${this.host}/3/device/${token}`,
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": this.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) {
      return { id: res.headers?.["apns-id"] || null };
    }
    const reason = parseReason(res.body);
    // A retired/invalid device token: 410 Unregistered or 400 BadDeviceToken —
    // prune it rather than retry forever.
    if (
      res.status === 410 ||
      reason === "Unregistered" ||
      reason === "BadDeviceToken"
    ) {
      throw new PushTokenUnregisteredError(
        `APNs token unregistered: ${reason || res.status}`,
      );
    }
    throw new Error(`APNs send failed (${res.status}): ${reason || res.body}`);
  }
}

function parseReason(body) {
  if (!body) return null;
  try {
    return JSON.parse(body).reason || null;
  } catch {
    return null;
  }
}

function loadPrivateKey(env, options) {
  if (options.privateKey) return options.privateKey;
  const inline = env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_P8;
  if (inline) return inline;
  const filePath = env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY;
  if (filePath) {
    const fsMod = options.fs || fs;
    try {
      return fsMod.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build a bound APNs `sender` from env, or null when APNs is not configured.
 *
 * APNs env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY       (path to .p8), or
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_P8    (inline .p8 PEM)
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_ID
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_TEAM_ID
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_TOPIC      (app bundle id)
 *   CHAINLESSCHAIN_REMOTE_SESSION_APNS_PRODUCTION ("true" → prod host)
 */
export function createApnsPushSender(env = {}, options = {}) {
  const privateKey = loadPrivateKey(env, options);
  const keyId = options.keyId || env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_ID;
  const teamId =
    options.teamId || env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_TEAM_ID;
  const topic = options.topic || env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_TOPIC;
  if (!privateKey || !keyId || !teamId || !topic) return null;
  let tokenProvider;
  try {
    tokenProvider =
      options.tokenProvider ||
      new ApnsTokenProvider({ keyId, teamId, privateKey, ...options });
  } catch {
    return null; // Malformed credentials — stay disabled rather than crash.
  }
  const production =
    options.production !== undefined
      ? options.production
      : String(env.CHAINLESSCHAIN_REMOTE_SESSION_APNS_PRODUCTION) === "true";
  const sender = new ApnsPushSender({
    tokenProvider,
    topic,
    production,
    ...options,
  });
  return sender.handler;
}
