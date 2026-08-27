"use strict";

const DEFAULT_RSS_IPC_LIMITS = Object.freeze({
  maxFeedRows: 500,
  maxItemRows: 200,
  maxCategoryRows: 256,
  maxFetchAllFeeds: 256,
  maxSyncIntervals: 256,
  maxSavedItems: 500,
  maxIdBytes: 256,
  maxTextBytes: 16 * 1024,
  minSyncSeconds: 60,
  maxSyncSeconds: 24 * 60 * 60,
});

const HARD_RSS_IPC_LIMITS = Object.freeze({
  maxFeedRows: 5000,
  maxItemRows: 2000,
  maxCategoryRows: 1000,
  maxFetchAllFeeds: 1000,
  maxSyncIntervals: 1000,
  maxSavedItems: 5000,
  maxIdBytes: 2048,
  maxTextBytes: 256 * 1024,
  minSyncSeconds: 60,
  maxSyncSeconds: 7 * 24 * 60 * 60,
});

const RSS_FEED_UPDATE_FIELDS = Object.freeze({
  url: "url",
  title: "title",
  description: "description",
  link: "link",
  language: "language",
  image_url: "image_url",
  category: "category",
  update_frequency: "update_frequency",
  status: "status",
});

class RSSIPCBoundaryError extends Error {
  constructor(code, scope, message, details = {}) {
    super(message);
    this.name = "RSSIPCBoundaryError";
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

function createRSSIPCLimits(options = {}) {
  const limits = Object.fromEntries(
    Object.keys(DEFAULT_RSS_IPC_LIMITS).map((key) => [
      key,
      boundedPositiveInteger(
        options[key],
        DEFAULT_RSS_IPC_LIMITS[key],
        HARD_RSS_IPC_LIMITS[key],
      ),
    ]),
  );
  limits.maxSyncSeconds = Math.max(
    limits.minSyncSeconds,
    limits.maxSyncSeconds,
  );
  return Object.freeze(limits);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertBoundedString(
  value,
  scope,
  maxBytes,
  { nullable = false } = {},
) {
  if (nullable && value == null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    byteLength(value) > maxBytes
  ) {
    throw new RSSIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Invalid or oversized ${scope}`,
      { limit: { maxBytes } },
    );
  }
  return value;
}

function boundedQueryLimit(value, fallback, hardLimit) {
  return boundedPositiveInteger(value, fallback, hardLimit);
}

function boundedQueryOffset(value, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return 0;
  }
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function boundedSyncSeconds(value, limits) {
  const seconds = boundedPositiveInteger(value, 3600, limits.maxSyncSeconds);
  return Math.max(limits.minSyncSeconds, seconds);
}

function normalizeFeedUpdates(updates, limits, isValidUrl) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new RSSIPCBoundaryError(
      "INVALID_ARGUMENT",
      "rss_feed_updates",
      "Feed updates must be an object",
    );
  }

  const normalized = [];
  for (const [key, value] of Object.entries(updates)) {
    const column = RSS_FEED_UPDATE_FIELDS[key];
    if (!column) {
      throw new RSSIPCBoundaryError(
        "INVALID_ARGUMENT",
        "rss_feed_update_field",
        `Unsupported feed update field: ${key}`,
      );
    }

    if (key === "url") {
      if (!isValidUrl(value)) {
        throw new RSSIPCBoundaryError(
          "INVALID_ARGUMENT",
          "rss_feed_url",
          "Invalid or oversized Feed URL",
        );
      }
      normalized.push([column, value]);
      continue;
    }
    if (key === "update_frequency") {
      normalized.push([column, boundedSyncSeconds(value, limits)]);
      continue;
    }
    if (key === "status") {
      if (!new Set(["active", "paused"]).has(value)) {
        throw new RSSIPCBoundaryError(
          "INVALID_ARGUMENT",
          "rss_feed_status",
          "Unsupported RSS feed status",
        );
      }
      normalized.push([column, value]);
      continue;
    }

    normalized.push([
      column,
      assertBoundedString(value, `rss_feed_${key}`, limits.maxTextBytes, {
        nullable: key === "category" || key === "image_url",
      }),
    ]);
  }

  if (normalized.length === 0) {
    throw new RSSIPCBoundaryError(
      "INVALID_ARGUMENT",
      "rss_feed_updates",
      "Feed updates cannot be empty",
    );
  }
  return normalized;
}

module.exports = {
  DEFAULT_RSS_IPC_LIMITS,
  HARD_RSS_IPC_LIMITS,
  RSSIPCBoundaryError,
  RSS_FEED_UPDATE_FIELDS,
  assertBoundedString,
  boundedQueryLimit,
  boundedQueryOffset,
  boundedSyncSeconds,
  createRSSIPCLimits,
  normalizeFeedUpdates,
};
