"use strict";

/**
 * social-bilibili-adb — Phase 1 (Bilibili C 路径) entry.
 *
 * Phase 1a (this commit) exports the cookies extraction layer only:
 *   - createBilibiliCookiesExtension — bridge extension handler factory
 *   - readChromiumCookies / assembleBilibiliCookieHeader — building blocks
 *     for testing + reuse by future platforms (Weibo / Xhs / Douyin) that
 *     also have Chromium WebView cookies
 *
 * Phase 1b (next session) will add:
 *   - BilibiliApiClient (Node) with WBI signing — ports the algorithm from
 *     android-app/.../pdh/social/bilibili/BilibiliApiClient.kt (the 64-index
 *     mixin key table + img_key/sub_key handshake)
 *   - BilibiliSnapshotBuilder — turns API responses into the events array
 *     shape that the existing `social-bilibili` JS adapter consumes in
 *     snapshot mode (so we don't duplicate the adapter, just feed it from
 *     a different upstream)
 *   - Collector orchestrator + wiring registration
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

module.exports = {
  createBilibiliCookiesExtension,
  BILIBILI_COOKIES_REMOTE_PATH,
  readChromiumCookies,
  assembleBilibiliCookieHeader,
  BILIBILI_COOKIE_NAMES,
};
