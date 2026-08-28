import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const VENDOR_CHANNELS = new Set(["dingtalk", "feishu", "wecom"]);

function webhookError(code, message, statusCode, details = {}) {
  const error = new Error(message);
  error.name = "WebhookSecurityError";
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value == null ? "" : String(value);
}

function queryValue(query, name) {
  const value = query?.[name];
  return Array.isArray(value) ? value[0] : value == null ? "" : String(value);
}

function safeTextEqual(expected, supplied) {
  const expectedBytes = Buffer.from(String(expected), "utf8");
  const suppliedBytes = Buffer.from(String(supplied), "utf8");
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function requireCredential(value, channel, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw webhookError(
      "CC_WEBHOOK_VENDOR_CREDENTIAL_REQUIRED",
      `${channel} vendor authentication requires ${name}`,
      503,
      { channel, credential: name },
    );
  }
  return value;
}

function parseTimestamp(timestampText) {
  const value = Number(timestampText);
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  return value < 100_000_000_000 ? value * 1000 : value;
}

function assertFreshTimestamp(timestampText, now, maxClockSkewMs) {
  const timestamp = parseTimestamp(timestampText);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(now - timestamp) > maxClockSkewMs
  ) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "webhook timestamp is invalid or stale",
      401,
    );
  }
}

function fallbackDeliveryId(channel, signature, body) {
  return `${channel}-${createHash("sha256")
    .update(signature)
    .update("\0")
    .update(body)
    .digest("hex")
    .slice(0, 40)}`;
}

function normalizeDeliveryId(value, channel, signature, body) {
  const deliveryId = value == null ? "" : String(value);
  if (deliveryId && deliveryId.length <= 256) return deliveryId;
  return fallbackDeliveryId(channel, signature, body);
}

function jsonObject(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function xmlTag(xml, tag) {
  const pattern = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
    "i",
  );
  const match = String(xml).match(pattern);
  return match ? (match[1] ?? match[2] ?? "").trim() : "";
}

export function signWebhookBody(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret)
    .update(String(timestamp))
    .update(".")
    .update(body)
    .digest("hex")}`;
}

export function signDingTalkWebhook(secret, timestamp) {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
}

export function signFeishuWebhook(encryptKey, timestamp, nonce, body) {
  return createHash("sha256")
    .update(`${timestamp}${nonce}${encryptKey}${body}`)
    .digest("hex");
}

export function signWeComWebhook(token, timestamp, nonce, encrypted) {
  return createHash("sha1")
    .update([token, timestamp, nonce, encrypted].map(String).sort().join(""))
    .digest("hex");
}

function decryptFeishuWebhook(encryptKey, encrypted) {
  let encryptedBytes;
  try {
    encryptedBytes = Buffer.from(encrypted, "base64");
  } catch {
    encryptedBytes = Buffer.alloc(0);
  }
  if (encryptedBytes.length < 32 || encryptedBytes.length % 16 !== 0) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "Feishu encrypted webhook body is invalid",
      401,
    );
  }
  try {
    const key = createHash("sha256").update(encryptKey).digest();
    const decipher = createDecipheriv(
      "aes-256-cbc",
      key,
      encryptedBytes.subarray(0, 16),
    );
    return Buffer.concat([
      decipher.update(encryptedBytes.subarray(16)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "Feishu encrypted webhook body could not be decrypted",
      401,
    );
  }
}

function decodeWeComAesKey(encodingAesKey) {
  if (!/^[A-Za-z0-9+/]{43}={0,1}$/u.test(encodingAesKey)) {
    throw webhookError(
      "CC_WEBHOOK_VENDOR_CREDENTIAL_REQUIRED",
      "WeCom EncodingAESKey must contain 43 base64 characters",
      503,
      { channel: "wecom", credential: "encodingAesKey" },
    );
  }
  const key = Buffer.from(`${encodingAesKey.replace(/=+$/u, "")}=`, "base64");
  if (key.length !== 32) {
    throw webhookError(
      "CC_WEBHOOK_VENDOR_CREDENTIAL_REQUIRED",
      "WeCom EncodingAESKey must decode to 32 bytes",
      503,
      { channel: "wecom", credential: "encodingAesKey" },
    );
  }
  return key;
}

function decryptWeComWebhook(encodingAesKey, encrypted, receiveId) {
  const key = decodeWeComAesKey(encodingAesKey);
  let ciphertext;
  try {
    ciphertext = Buffer.from(encrypted, "base64");
  } catch {
    ciphertext = Buffer.alloc(0);
  }
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom encrypted webhook body is invalid",
      401,
    );
  }

  let padded;
  try {
    const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom encrypted webhook body could not be decrypted",
      401,
    );
  }

  const padding = padded.at(-1) || 0;
  if (
    padding < 1 ||
    padding > 32 ||
    padded.length <= padding ||
    !padded.subarray(padded.length - padding).every((byte) => byte === padding)
  ) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom encrypted webhook padding is invalid",
      401,
    );
  }
  const plaintext = padded.subarray(0, padded.length - padding);
  if (plaintext.length < 20) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom encrypted webhook envelope is truncated",
      401,
    );
  }
  const messageLength = plaintext.readUInt32BE(16);
  const messageEnd = 20 + messageLength;
  if (messageLength <= 0 || messageEnd > plaintext.length) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom encrypted webhook message length is invalid",
      401,
    );
  }
  const actualReceiveId = plaintext.subarray(messageEnd).toString("utf8");
  if (receiveId && !safeTextEqual(receiveId, actualReceiveId)) {
    throw webhookError(
      "CC_WEBHOOK_AUTH_INVALID",
      "WeCom webhook receiver identity does not match",
      401,
    );
  }
  return plaintext.subarray(20, messageEnd).toString("utf8");
}

export class WebhookSecurityGate {
  constructor({
    secret,
    authMode = "cc",
    vendorCredentials = {},
    now = Date.now,
    maxClockSkewMs = 5 * 60_000,
    maxRequestsPerMinute = 30,
    maxReplayEntries = 10_000,
  } = {}) {
    if (!new Set(["cc", "vendor"]).has(authMode)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_MODE_INVALID",
        "webhook authentication mode must be cc or vendor",
        503,
      );
    }
    if (
      authMode === "cc" &&
      (typeof secret !== "string" || secret.length < 16)
    ) {
      throw webhookError(
        "CC_WEBHOOK_SECRET_REQUIRED",
        "webhook mode requires an authentication secret of at least 16 characters",
        503,
      );
    }
    this.secret = secret || "";
    this.authMode = authMode;
    this.vendorCredentials = Object.freeze({ ...vendorCredentials });
    this.now = now;
    this.maxClockSkewMs = Math.max(1_000, Number(maxClockSkewMs) || 300_000);
    this.maxRequestsPerMinute = Math.max(1, Number(maxRequestsPerMinute) || 30);
    this.maxReplayEntries = Math.max(100, Number(maxReplayEntries) || 10_000);
    this.replays = new Map();
    this.rates = new Map();
  }

  verify({ channel, headers, body, query = {}, remoteAddress = "unknown" }) {
    const now = this.now();
    this._checkRate(channel, remoteAddress, now);
    const authenticated =
      this.authMode === "vendor"
        ? this._verifyVendor({ channel, headers, body, query, now })
        : this._verifyCc({ channel, headers, body, now });
    this._claimDelivery(channel, authenticated.deliveryId, now);
    return Object.freeze({
      deliveryId: authenticated.deliveryId,
      body: authenticated.body,
      authMode: this.authMode,
      dataPolicy: this._dataPolicy(channel, authenticated.deliveryId),
    });
  }

  verifyWeComUrl({ query = {}, remoteAddress = "unknown" }) {
    if (this.authMode !== "vendor") {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "WeCom URL verification requires vendor authentication mode",
        401,
      );
    }
    const now = this.now();
    this._checkRate("wecom", remoteAddress, now);
    const token = requireCredential(
      this.vendorCredentials.wecomToken,
      "wecom",
      "token",
    );
    const encodingAesKey = requireCredential(
      this.vendorCredentials.wecomEncodingAesKey,
      "wecom",
      "encodingAesKey",
    );
    const receiveId = requireCredential(
      this.vendorCredentials.wecomReceiveId,
      "wecom",
      "receiveId",
    );
    const timestamp = queryValue(query, "timestamp");
    const nonce = queryValue(query, "nonce");
    const encryptedEcho = queryValue(query, "echostr");
    const supplied = queryValue(query, "msg_signature");
    assertFreshTimestamp(timestamp, now, this.maxClockSkewMs);
    if (!nonce || nonce.length > 256 || !encryptedEcho || !supplied) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "WeCom URL verification parameters are invalid",
        401,
      );
    }
    const expected = signWeComWebhook(token, timestamp, nonce, encryptedEcho);
    if (!safeTextEqual(expected, supplied)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "WeCom URL verification signature is invalid",
        401,
      );
    }
    return Object.freeze({
      echo: decryptWeComWebhook(encodingAesKey, encryptedEcho, receiveId),
    });
  }

  _verifyCc({ headers, body, now }) {
    const timestampText = header(headers, "x-cc-webhook-timestamp");
    const deliveryId = header(headers, "x-cc-webhook-delivery");
    const supplied = header(headers, "x-cc-webhook-signature");
    assertFreshTimestamp(timestampText, now, this.maxClockSkewMs);
    if (!deliveryId || deliveryId.length > 256) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "webhook delivery identity is invalid",
        401,
      );
    }
    const expected = signWebhookBody(this.secret, timestampText, body);
    if (!safeTextEqual(expected, supplied)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "webhook signature is invalid",
        401,
      );
    }
    return { deliveryId, body };
  }

  _verifyVendor({ channel, headers, body, query, now }) {
    if (!VENDOR_CHANNELS.has(channel)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "unsupported vendor webhook channel",
        401,
      );
    }
    if (channel === "dingtalk") {
      return this._verifyDingTalk({ headers, body, now });
    }
    if (channel === "feishu") {
      return this._verifyFeishu({ headers, body, now });
    }
    return this._verifyWeCom({ body, query, now });
  }

  _verifyDingTalk({ headers, body, now }) {
    const secret = requireCredential(
      this.vendorCredentials.dingtalkSecret,
      "dingtalk",
      "secret",
    );
    const timestamp = header(headers, "timestamp");
    const supplied = header(headers, "sign");
    assertFreshTimestamp(timestamp, now, this.maxClockSkewMs);
    const expected = signDingTalkWebhook(secret, timestamp);
    let decodedSupplied = supplied;
    try {
      decodedSupplied = decodeURIComponent(supplied);
    } catch {
      // A raw Base64 header is the normal form.
    }
    if (!safeTextEqual(expected, decodedSupplied)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "DingTalk webhook signature is invalid",
        401,
      );
    }
    const parsed = jsonObject(body);
    return {
      deliveryId: normalizeDeliveryId(parsed.msgId, "dingtalk", supplied, body),
      body,
    };
  }

  _verifyFeishu({ headers, body, now }) {
    const encryptKey = requireCredential(
      this.vendorCredentials.feishuEncryptKey,
      "feishu",
      "encryptKey",
    );
    const timestamp = header(headers, "x-lark-request-timestamp");
    const nonce = header(headers, "x-lark-request-nonce");
    const supplied = header(headers, "x-lark-signature");
    assertFreshTimestamp(timestamp, now, this.maxClockSkewMs);
    if (!nonce || nonce.length > 256) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "Feishu webhook nonce is invalid",
        401,
      );
    }
    const expected = signFeishuWebhook(encryptKey, timestamp, nonce, body);
    if (!safeTextEqual(expected, supplied)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "Feishu webhook signature is invalid",
        401,
      );
    }

    const envelope = jsonObject(body);
    const authenticatedBody = envelope.encrypt
      ? decryptFeishuWebhook(encryptKey, envelope.encrypt)
      : body;
    const parsed = jsonObject(authenticatedBody);
    return {
      deliveryId: normalizeDeliveryId(
        parsed.header?.event_id ?? parsed.uuid,
        "feishu",
        supplied,
        body,
      ),
      body: authenticatedBody,
    };
  }

  _verifyWeCom({ body, query, now }) {
    const token = requireCredential(
      this.vendorCredentials.wecomToken,
      "wecom",
      "token",
    );
    const encodingAesKey = requireCredential(
      this.vendorCredentials.wecomEncodingAesKey,
      "wecom",
      "encodingAesKey",
    );
    const receiveId = requireCredential(
      this.vendorCredentials.wecomReceiveId,
      "wecom",
      "receiveId",
    );
    const timestamp = queryValue(query, "timestamp");
    const nonce = queryValue(query, "nonce");
    const supplied = queryValue(query, "msg_signature");
    const encrypted = xmlTag(body, "Encrypt");
    assertFreshTimestamp(timestamp, now, this.maxClockSkewMs);
    if (!nonce || nonce.length > 256 || !encrypted || !supplied) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "WeCom webhook authentication parameters are invalid",
        401,
      );
    }
    const expected = signWeComWebhook(token, timestamp, nonce, encrypted);
    if (!safeTextEqual(expected, supplied)) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "WeCom webhook signature is invalid",
        401,
      );
    }
    const authenticatedBody = decryptWeComWebhook(
      encodingAesKey,
      encrypted,
      receiveId,
    );
    return {
      deliveryId: normalizeDeliveryId(
        xmlTag(authenticatedBody, "MsgId"),
        "wecom",
        supplied,
        body,
      ),
      body: authenticatedBody,
    };
  }

  _checkRate(channel, remoteAddress, now) {
    const window = Math.floor(now / 60_000);
    const rateKey = `${channel}\0${remoteAddress}\0${window}`;
    const requests = (this.rates.get(rateKey) || 0) + 1;
    this.rates.set(rateKey, requests);
    for (const key of this.rates.keys()) {
      if (!key.endsWith(`\0${window}`)) this.rates.delete(key);
    }
    if (requests > this.maxRequestsPerMinute) {
      throw webhookError(
        "CC_WEBHOOK_RATE_LIMITED",
        "webhook rate limit exceeded",
        429,
        { retryAfterSeconds: 60 - Math.floor((now % 60_000) / 1000) },
      );
    }
  }

  _claimDelivery(channel, deliveryId, now) {
    for (const [key, expiresAt] of this.replays) {
      if (expiresAt <= now) this.replays.delete(key);
    }
    const replayKey = `${channel}\0${deliveryId}`;
    if (this.replays.has(replayKey)) {
      throw webhookError(
        "CC_WEBHOOK_REPLAYED",
        "webhook delivery was already processed",
        409,
      );
    }
    if (this.replays.size >= this.maxReplayEntries) {
      throw webhookError(
        "CC_WEBHOOK_REPLAY_CACHE_FULL",
        "webhook replay cache is full",
        503,
      );
    }
    this.replays.set(replayKey, now + this.maxClockSkewMs);
  }

  _dataPolicy(channel, deliveryId) {
    return Object.freeze({
      origin: `webhook:${channel}:${deliveryId}`,
      trust: "authenticated_user",
      sensitivity: "internal",
      allowedSinks: Object.freeze(["agent:*", "artifact:local"]),
    });
  }
}

export function readBoundedWebhookBody(request, maxBytes = 256 * 1024) {
  const limit = Math.max(1, Number(maxBytes) || 256 * 1024);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(
          webhookError(
            "CC_WEBHOOK_BODY_TOO_LARGE",
            "webhook body exceeds the configured limit",
            413,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
