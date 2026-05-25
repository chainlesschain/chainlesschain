"use strict";

/**
 * social-weibo-adb — Phase 3 (Weibo C 路径) entry.
 *
 * Phase 3a (this commit) — desktop ADB cookies + m.weibo.cn HTTP path:
 *   - weibo.cookies extension (pulls Chromium cookies from Weibo App)
 *   - WeiboApiClient (Node port, 4 endpoints, no signing)
 *   - buildSnapshot (post / favourite / follow → schemaVersion=1)
 *   - collect / collectAndSync
 *
 * Pipeline:
 *   bridge.invoke("weibo.cookies")
 *     → WeiboApiClient.fetchUid (cookie has no inline UID)
 *     → fetchPosts + fetchFavourites + fetchFollows
 *     → buildSnapshot + writeSnapshotJson
 *     → registry.syncAdapter("social-weibo", { inputPath })
 *
 * Reuses the existing `social-weibo` adapter's snapshot mode — same
 * vault schema / dedup / event types. No 2nd adapter.
 */

const {
  createWeiboCookiesExtension,
  WEIBO_COOKIES_REMOTE_PATH,
  WEIBO_COOKIE_HOST_DOMAIN,
  WEIBO_REQUIRED_COOKIE,
  assembleWeiboCookieHeader,
} = require("./cookies-extension");
const { WeiboApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const { collect, collectAndSync } = require("./collector");

module.exports = {
  // Extension factory (wiring registers this on the bridge)
  createWeiboCookiesExtension,
  WEIBO_COOKIES_REMOTE_PATH,
  WEIBO_COOKIE_HOST_DOMAIN,
  WEIBO_REQUIRED_COOKIE,
  assembleWeiboCookieHeader,
  // API client + builder
  WeiboApiClient,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  // Collector orchestrator
  collect,
  collectAndSync,
};
