"use strict";

/**
 * social-bilibili-adb — Phase 1 (Bilibili C 路径) entry.
 *
 * Phase 1a (commit `7c12fd253`) — cookies extraction layer
 * Phase 1b (this commit)        — Node API client + snapshot builder + collector
 * Phase 1c (next)               — wiring injection + UI + real-device E2E
 *
 * Pipeline (see collector.js):
 *   bridge.invoke("bilibili.cookies")
 *     → BilibiliApiClient (4 endpoints, WBI-signed)
 *     → buildSnapshot → writeSnapshotJson
 *     → registry.syncAdapter("social-bilibili", { inputPath })
 */

const {
  createBilibiliCookiesExtension,
  BILIBILI_COOKIES_REMOTE_PATH,
} = require("./cookies-extension");
const {
  readChromiumCookies,
  assembleBilibiliCookieHeader,
  BILIBILI_COOKIE_NAMES,
} = require("./chromium-cookies-reader");
const { BilibiliApiClient, extractUid } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const { collect, collectAndSync } = require("./collector");

module.exports = {
  // Phase 1a
  createBilibiliCookiesExtension,
  BILIBILI_COOKIES_REMOTE_PATH,
  readChromiumCookies,
  assembleBilibiliCookieHeader,
  BILIBILI_COOKIE_NAMES,
  // Phase 1b
  BilibiliApiClient,
  extractUid,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  collect,
  collectAndSync,
};
