// Remote Session vendor push — Web Push (browser) sender.
//
// A concrete implementation of the RemoteSessionPushDispatcher `sender` contract
// for browser clients, using the Web Push protocol: VAPID (RFC 8292) auth via an
// ES256 JWT signed with the server VAPID key, and RFC 8291 (aes128gcm) payload
// encryption bound to the subscription's ECDH public key + auth secret. The
// "token" is the browser PushSubscription (endpoint + keys) as JSON.
//
// Web Push endpoints accept plain HTTPS, so the network transport is an
// injectable `fetch` (default global). Encryption/signing use node:crypto and
// are exercised by a real encrypt→decrypt round-trip in the tests — no live
// push service or credentials needed. The payload carries only routing ids.

import crypto from "node:crypto";
import { PushTokenUnregisteredError } from "./remote-session-push-errors.js";

const VAPID_TTL_MS = 12 * 60 * 60 * 1000;
const VAPID_SKEW_MS = 60 * 1000;
const RECORD_SIZE = 4096;
const DEFAULT_TTL_SECONDS = 2419200; // 28 days, capped by the push service

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(value) {
  return Buffer.from(String(value), "base64url");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

// HKDF-Expand for a single output block (len <= 32).
function hkdfExpand(prk, info, len) {
  return hmac(prk, Buffer.concat([info, Buffer.from([0x01])])).subarray(0, len);
}

// HKDF(salt, ikm, info, len) = Expand(Extract(salt, ikm), info, len).
function hkdf(salt, ikm, info, len) {
  return hkdfExpand(hmac(salt, ikm), info, len);
}

function uint32be(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

// RFC 8291 §3.4 + RFC 8188 §2.1 content-encryption key + nonce.
function deriveContentKeys({
  ecdhSecret,
  authSecret,
  salt,
  uaPublic,
  asPublic,
}) {
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const prk = hmac(salt, ikm); // HKDF-Extract(salt, IKM)
  const cek = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: aes128gcm\0", "utf8"),
    16,
  );
  const nonce = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: nonce\0", "utf8"),
    12,
  );
  return { cek, nonce };
}

/**
 * Encrypt a payload for a Web Push subscription (RFC 8291, aes128gcm). Returns
 * the full content-encoded body (header + ciphertext). Generates a fresh
 * ephemeral key each call unless one is injected (tests).
 */
export function encryptWebPushPayload({
  payload,
  uaPublicKey,
  authSecret,
  ecdh,
  salt,
}) {
  const server = ecdh || crypto.createECDH("prime256v1");
  if (!ecdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublicKey);
  const useSalt = salt || crypto.randomBytes(16);
  const { cek, nonce } = deriveContentKeys({
    ecdhSecret,
    authSecret,
    salt: useSalt,
    uaPublic: uaPublicKey,
    asPublic,
  });
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  const record = Buffer.concat([data, Buffer.from([0x02])]); // last-record delimiter
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(record),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.concat([
    useSalt,
    uint32be(RECORD_SIZE),
    Buffer.from([asPublic.length]),
    asPublic,
  ]);
  return Buffer.concat([header, ciphertext]);
}

/** Inverse of {@link encryptWebPushPayload}; used for interop tests. */
export function decryptWebPushPayload({ body, uaEcdh, authSecret }) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdhSecret = uaEcdh.computeSecret(asPublic);
  const { cek, nonce } = deriveContentKeys({
    ecdhSecret,
    authSecret,
    salt,
    uaPublic: uaEcdh.getPublicKey(),
    asPublic,
  });
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const body2 = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(body2), decipher.final()]);
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0x00) end -= 1; // strip padding
  return record.subarray(0, end); // drop the 0x02 delimiter
}

/** Builds an EC private key object from raw base64url VAPID keys. */
function importVapidKey(publicKeyB64url, privateKeyB64url) {
  const pub = fromBase64url(publicKeyB64url);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error(
      "VAPID public key must be a 65-byte uncompressed P-256 key",
    );
  }
  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: privateKeyB64url,
      x: base64url(pub.subarray(1, 33)),
      y: base64url(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/** Mints + caches a VAPID (RFC 8292) ES256 JWT per push-endpoint origin. */
export class VapidTokenProvider {
  constructor(options = {}) {
    if (!options.publicKey)
      throw new Error("VapidTokenProvider requires publicKey");
    if (!options.privateKey)
      throw new Error("VapidTokenProvider requires privateKey");
    if (!options.subject) {
      throw new Error("VapidTokenProvider requires a subject (mailto: or URL)");
    }
    this.publicKey = options.publicKey;
    this.subject = options.subject;
    this.now = options.now || Date.now;
    this._key =
      options.key || importVapidKey(options.publicKey, options.privateKey);
    this.sign =
      options.sign ||
      ((input, key) =>
        crypto.sign("sha256", Buffer.from(input), {
          key,
          dsaEncoding: "ieee-p1363",
        }));
    this._cache = new Map(); // origin → { token, expiresAt }
  }

  getToken(aud) {
    const now = this.now();
    const cached = this._cache.get(aud);
    if (cached && cached.expiresAt - VAPID_SKEW_MS > now) return cached.token;
    const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const payload = base64url(
      JSON.stringify({
        aud,
        exp: Math.floor((now + VAPID_TTL_MS) / 1000),
        sub: this.subject,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const token = `${signingInput}.${base64url(this.sign(signingInput, this._key))}`;
    this._cache.set(aud, { token, expiresAt: now + VAPID_TTL_MS });
    return token;
  }
}

/** Sends one encrypted Web Push message to a browser PushSubscription. */
export class WebPushSender {
  constructor(options = {}) {
    if (!options.vapid)
      throw new Error("WebPushSender requires a vapid provider");
    this.vapid = options.vapid;
    this.fetch = options.fetch || globalThis.fetch;
    this.ttl = options.ttl || DEFAULT_TTL_SECONDS;
  }

  get handler() {
    return (payload) => this.send(payload);
  }

  async send({ token, notification, sessionId, clientId } = {}) {
    if (!token) throw new Error("Web Push send requires a subscription");
    const subscription = typeof token === "string" ? JSON.parse(token) : token;
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      throw new Error("Web Push subscription is missing endpoint/keys");
    }
    const message = { type: "remote-session.approval-request" };
    if (notification?.title) message.title = notification.title;
    if (notification?.body) message.body = notification.body;
    if (sessionId != null) message.sessionId = String(sessionId);
    if (clientId != null) message.clientId = String(clientId);

    const body = encryptWebPushPayload({
      payload: JSON.stringify(message),
      uaPublicKey: fromBase64url(p256dh),
      authSecret: fromBase64url(auth),
    });
    const origin = new URL(endpoint).origin;
    const res = await this.fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${this.vapid.getToken(origin)}, k=${this.vapid.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(this.ttl),
        Urgency: "high",
      },
      body,
    });
    if (res.status === 201 || res.ok) {
      return { id: res.headers?.get?.("location") || null };
    }
    // 404/410 mean the subscription is gone — prune it rather than retry.
    if (res.status === 404 || res.status === 410) {
      throw new PushTokenUnregisteredError(
        `Web Push subscription expired (${res.status})`,
      );
    }
    throw new Error(`Web Push failed (${res.status})`);
  }
}

/**
 * Build a bound Web Push `sender` from env, or null when VAPID is unconfigured.
 *
 * Web env:
 *   CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PUBLIC_KEY  (base64url, 65-byte P-256)
 *   CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PRIVATE_KEY (base64url, 32-byte scalar)
 *   CHAINLESSCHAIN_REMOTE_SESSION_VAPID_SUBJECT     (mailto: or https URL)
 */
export function createWebPushSender(env = {}, options = {}) {
  const publicKey =
    options.vapidPublicKey ||
    env.CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PUBLIC_KEY;
  const privateKey =
    options.vapidPrivateKey ||
    env.CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PRIVATE_KEY;
  const subject =
    options.vapidSubject || env.CHAINLESSCHAIN_REMOTE_SESSION_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  let vapid;
  try {
    vapid =
      options.vapid ||
      new VapidTokenProvider({ publicKey, privateKey, subject, ...options });
  } catch {
    return null; // Malformed VAPID keys — stay disabled rather than crash.
  }
  return new WebPushSender({ vapid, ...options }).handler;
}
