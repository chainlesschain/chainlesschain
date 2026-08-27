"use strict";

const DEFAULT_RSS_FETCHER_LIMITS = Object.freeze({
  maxCacheEntries: 100,
  maxCacheBytes: 16 * 1024 * 1024,
  maxFeedResponseBytes: 4 * 1024 * 1024,
  maxHtmlResponseBytes: 1024 * 1024,
  maxFeedBytes: 4 * 1024 * 1024,
  maxFeedItems: 500,
  maxItemContentBytes: 128 * 1024,
  maxTextBytes: 16 * 1024,
  maxUrlBytes: 4 * 1024,
  maxCategories: 32,
  maxCategoryBytes: 1024,
  maxBatchFeeds: 100,
  maxBatchRetainedBytes: 16 * 1024 * 1024,
  maxConcurrentFetches: 8,
  maxRetries: 3,
  maxRedirects: 5,
  maxDiscoveredFeeds: 32,
  requestTimeoutMs: 30_000,
});

const HARD_RSS_FETCHER_LIMITS = Object.freeze({
  maxCacheEntries: 1000,
  maxCacheBytes: 128 * 1024 * 1024,
  maxFeedResponseBytes: 32 * 1024 * 1024,
  maxHtmlResponseBytes: 16 * 1024 * 1024,
  maxFeedBytes: 32 * 1024 * 1024,
  maxFeedItems: 5000,
  maxItemContentBytes: 2 * 1024 * 1024,
  maxTextBytes: 256 * 1024,
  maxUrlBytes: 32 * 1024,
  maxCategories: 256,
  maxCategoryBytes: 8 * 1024,
  maxBatchFeeds: 1000,
  maxBatchRetainedBytes: 128 * 1024 * 1024,
  maxConcurrentFetches: 64,
  maxRetries: 10,
  maxRedirects: 10,
  maxDiscoveredFeeds: 256,
  requestTimeoutMs: 120_000,
});

class RSSFetcherBoundaryError extends Error {
  constructor(code, scope, message, details = {}) {
    super(message);
    this.name = "RSSFetcherBoundaryError";
    this.code = code;
    this.scope = scope;
    Object.assign(this, details);
  }
}

function boundedPositiveInteger(value, fallback, hardLimit) {
  const boundedFallback = Math.min(fallback, hardLimit);
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return boundedFallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return boundedFallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createRSSFetcherLimits(options = {}) {
  const limits = Object.fromEntries(
    Object.keys(DEFAULT_RSS_FETCHER_LIMITS).map((key) => [
      key,
      boundedPositiveInteger(
        options[key],
        DEFAULT_RSS_FETCHER_LIMITS[key],
        HARD_RSS_FETCHER_LIMITS[key],
      ),
    ]),
  );
  limits.maxFeedBytes = Math.max(
    limits.maxFeedBytes,
    limits.maxTextBytes * 7 * 6 + limits.maxUrlBytes * 4 * 6 + 8192,
  );
  limits.maxCacheBytes = Math.max(
    limits.maxCacheBytes,
    limits.maxFeedBytes + limits.maxUrlBytes,
  );
  limits.maxBatchRetainedBytes = Math.max(
    limits.maxBatchRetainedBytes,
    limits.maxFeedBytes,
  );
  return Object.freeze(limits);
}

function safeString(value, fallback = "") {
  try {
    return value == null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function safeProperty(value, key, fallback = undefined) {
  try {
    return value?.[key] ?? fallback;
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

function estimateJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function clonePlainValue(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_RSS_FETCHER_LIMITS,
  HARD_RSS_FETCHER_LIMITS,
  RSSFetcherBoundaryError,
  boundedPositiveInteger,
  clonePlainValue,
  createRSSFetcherLimits,
  estimateJsonBytes,
  safeProperty,
  safeString,
  truncateUtf8,
};
