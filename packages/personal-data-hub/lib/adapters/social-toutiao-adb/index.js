"use strict";

/**
 * social-toutiao-adb — Phase 6c (Toutiao C 路径) entry.
 *
 * Desktop ADB pulls Chromium cookies from Toutiao Android app
 * (com.ss.android.article.news) via `su -c base64`, then runs Toutiao web
 * HTTP via ToutiaoApiClient. _signature path: desktop wiring injects
 * ToutiaoSignBridge (Electron WebContentsView running acrawler.js, ~100%
 * hit rate); CLI / test contexts get NullSignProvider → signed endpoints
 * short-circuit with lastErrorCode=-99.
 *
 * Pipeline:
 *   bridge.invoke("toutiao.cookies") → {cookie, uid}
 *     → ToutiaoApiClient.fetchProfile (no _sig)
 *     → fetchFeed + fetchCollection + fetchSearchHistory (signed, parallel)
 *     → buildSnapshot + writeSnapshotJson
 *     → registry.syncAdapter("social-toutiao", { inputPath })
 */

const {
  createToutiaoCookiesExtension,
  TOUTIAO_COOKIES_REMOTE_PATH,
  TOUTIAO_COOKIE_HOST_DOMAIN,
  TOUTIAO_SESSION_COOKIES,
  TOUTIAO_UID_COOKIES,
  assembleToutiaoCookieHeader,
} = require("./cookies-extension");
const { ToutiaoApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const { collect, collectAndSync } = require("./collector");

module.exports = {
  createToutiaoCookiesExtension,
  TOUTIAO_COOKIES_REMOTE_PATH,
  TOUTIAO_COOKIE_HOST_DOMAIN,
  TOUTIAO_SESSION_COOKIES,
  TOUTIAO_UID_COOKIES,
  assembleToutiaoCookieHeader,
  ToutiaoApiClient,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  collect,
  collectAndSync,
};
