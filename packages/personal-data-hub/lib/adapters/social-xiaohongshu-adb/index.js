"use strict";

/**
 * social-xiaohongshu-adb — Phase 3c (Xhs C 路径) entry.
 *
 * Phase 3c — desktop ADB Chromium cookies + edith.xiaohongshu.com HTTP
 * with best-effort X-S signing (md5 approximation, ~60% GET hit rate).
 *
 * Pipeline:
 *   bridge.invoke("xhs.cookies") → {cookie, a1}
 *     → XhsApiClient.fetchMe (no X-S, cookies-only)
 *     → fetchNotes + fetchLiked + fetchFollows (X-S signed, parallel)
 *     → buildSnapshot + writeSnapshotJson
 *     → registry.syncAdapter("social-xiaohongshu", { inputPath })
 */

const {
  createXhsCookiesExtension,
  XHS_COOKIES_REMOTE_PATH,
  XHS_COOKIE_HOST_DOMAIN,
  XHS_REQUIRED_COOKIES,
  assembleXhsCookieHeader,
} = require("./cookies-extension");
const { computeXsXt, extractA1, XS_PREFIX } = require("./sign");
const { XhsApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const { collect, collectAndSync } = require("./collector");

module.exports = {
  createXhsCookiesExtension,
  XHS_COOKIES_REMOTE_PATH,
  XHS_COOKIE_HOST_DOMAIN,
  XHS_REQUIRED_COOKIES,
  assembleXhsCookieHeader,
  computeXsXt,
  extractA1,
  XS_PREFIX,
  XhsApiClient,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  collect,
  collectAndSync,
};
