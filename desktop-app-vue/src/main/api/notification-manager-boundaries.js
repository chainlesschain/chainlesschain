"use strict";

const DEFAULT_NOTIFICATION_LIMITS = Object.freeze({
  maxActiveNotifications: 32,
  maxBatchNotifications: 128,
  maxClickItems: 10,
  maxTextBytes: 4 * 1024,
  maxNavigationBytes: 64 * 1024,
  notificationTtlMs: 60 * 1000,
});

const HARD_NOTIFICATION_LIMITS = Object.freeze({
  maxActiveNotifications: 128,
  maxBatchNotifications: 1000,
  maxClickItems: 100,
  maxTextBytes: 64 * 1024,
  maxNavigationBytes: 1024 * 1024,
  notificationTtlMs: 10 * 60 * 1000,
});

class NotificationBoundaryError extends Error {
  constructor(code, scope, message, details = {}) {
    super(message);
    this.name = "NotificationBoundaryError";
    this.code = code;
    this.scope = scope;
    Object.assign(this, details);
  }
}

function boundedPositiveInteger(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return Math.min(fallback, hardLimit);
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return Math.min(fallback, hardLimit);
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createNotificationLimits(options = {}) {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(DEFAULT_NOTIFICATION_LIMITS).map((key) => [
        key,
        boundedPositiveInteger(
          options[key],
          DEFAULT_NOTIFICATION_LIMITS[key],
          HARD_NOTIFICATION_LIMITS[key],
        ),
      ]),
    ),
  );
}

function safeString(value, fallback = "") {
  try {
    return value == null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function truncateUtf8(value, maxBytes) {
  const text = safeString(value);
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) {
    return text;
  }
  let end = maxBytes;
  while (end > 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        encoded.subarray(0, end),
      );
    } catch {
      end--;
    }
  }
  return "";
}

function boundedCount(value) {
  let count;
  try {
    count = Number(value);
  } catch {
    return 0;
  }
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER);
}

function projectNavigationItems(items, maxItems, maxTextBytes, fields) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, maxItems).map((item) => {
    const projected = {};
    for (const field of fields) {
      let value;
      try {
        value = item?.[field];
      } catch {
        value = undefined;
      }
      projected[field] = truncateUtf8(value, maxTextBytes);
    }
    return projected;
  });
}

function cloneBoundedNavigation(value, maxBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(value ?? {});
  } catch {
    throw new NotificationBoundaryError(
      "INVALID_ARGUMENT",
      "notification_navigation",
      "Notification navigation parameters are not serializable",
    );
  }
  if (typeof serialized !== "string") {
    throw new NotificationBoundaryError(
      "INVALID_ARGUMENT",
      "notification_navigation",
      "Notification navigation parameters are not serializable",
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new NotificationBoundaryError(
      "OVERLOADED",
      "notification_navigation",
      "Notification navigation parameters exceed the byte limit",
      { limit: { maxNavigationBytes: maxBytes } },
    );
  }
  return JSON.parse(serialized);
}

module.exports = {
  DEFAULT_NOTIFICATION_LIMITS,
  HARD_NOTIFICATION_LIMITS,
  NotificationBoundaryError,
  boundedCount,
  cloneBoundedNavigation,
  createNotificationLimits,
  projectNavigationItems,
  truncateUtf8,
};
