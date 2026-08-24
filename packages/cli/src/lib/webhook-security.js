import { createHmac, timingSafeEqual } from "node:crypto";

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

export function signWebhookBody(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret)
    .update(String(timestamp))
    .update(".")
    .update(body)
    .digest("hex")}`;
}

export class WebhookSecurityGate {
  constructor({
    secret,
    now = Date.now,
    maxClockSkewMs = 5 * 60_000,
    maxRequestsPerMinute = 30,
    maxReplayEntries = 10_000,
  } = {}) {
    if (typeof secret !== "string" || secret.length < 16) {
      throw webhookError(
        "CC_WEBHOOK_SECRET_REQUIRED",
        "webhook mode requires an authentication secret of at least 16 characters",
        503,
      );
    }
    this.secret = secret;
    this.now = now;
    this.maxClockSkewMs = Math.max(1_000, Number(maxClockSkewMs) || 300_000);
    this.maxRequestsPerMinute = Math.max(1, Number(maxRequestsPerMinute) || 30);
    this.maxReplayEntries = Math.max(100, Number(maxReplayEntries) || 10_000);
    this.replays = new Map();
    this.rates = new Map();
  }

  verify({ channel, headers, body, remoteAddress = "unknown" }) {
    const now = this.now();
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
    const timestampText = header(headers, "x-cc-webhook-timestamp");
    const deliveryId = header(headers, "x-cc-webhook-delivery");
    const supplied = header(headers, "x-cc-webhook-signature");
    const timestamp = Number(timestampText);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(now - timestamp) > this.maxClockSkewMs ||
      !deliveryId ||
      deliveryId.length > 256
    ) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "webhook timestamp or delivery identity is invalid",
        401,
      );
    }
    const expected = signWebhookBody(this.secret, timestampText, body);
    const expectedBytes = Buffer.from(expected, "utf8");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    if (
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw webhookError(
        "CC_WEBHOOK_AUTH_INVALID",
        "webhook signature is invalid",
        401,
      );
    }
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
    return Object.freeze({
      deliveryId,
      dataPolicy: Object.freeze({
        origin: `webhook:${channel}:${deliveryId}`,
        trust: "authenticated_user",
        sensitivity: "internal",
        allowedSinks: Object.freeze(["agent:*", "artifact:local"]),
      }),
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
