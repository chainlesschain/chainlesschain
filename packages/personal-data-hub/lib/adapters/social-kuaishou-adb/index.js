"use strict";

/**
 * social-kuaishou-adb — Phase 6d (Kuaishou C 路径) entry.
 *
 * Desktop ADB pulls Chromium cookies from Kuaishou Android app
 * (com.smile.gifmaker) via `su -c base64`, then runs Kuaishou web
 * GraphQL via KuaishouApiClient. Profile comes from cookie's api_ph
 * payload (no HTTP); 3 signed GraphQL endpoints (visionFeedRecommend /
 * visionProfilePhotoList / visionSearchPhoto) need __NS_sig3 query
 * param + kpf/kpn headers. Desktop wiring injects KuaishouSignBridge;
 * CLI / test contexts use NullSignProvider → signed endpoints short-
 * circuit with lastErrorCode=-99.
 *
 * Pipeline:
 *   bridge.invoke("kuaishou.cookies") → {cookie, uid}
 *     → KuaishouApiClient.fetchProfile (cookie parse, no HTTP)
 *     → fetchWatchHistory + fetchProfilePhotos + fetchSearchHistory
 *       (signed GraphQL POST, parallel)
 *     → buildSnapshot + writeSnapshotJson
 *     → registry.syncAdapter("social-kuaishou", { inputPath })
 */

const {
  createKuaishouCookiesExtension,
  KUAISHOU_COOKIES_REMOTE_PATH,
  KUAISHOU_COOKIE_HOST_DOMAIN,
  KUAISHOU_LOGIN_COOKIES,
  assembleKuaishouCookieHeader,
} = require("./cookies-extension");
const { KuaishouApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const { collect, collectAndSync } = require("./collector");

module.exports = {
  createKuaishouCookiesExtension,
  KUAISHOU_COOKIES_REMOTE_PATH,
  KUAISHOU_COOKIE_HOST_DOMAIN,
  KUAISHOU_LOGIN_COOKIES,
  assembleKuaishouCookieHeader,
  KuaishouApiClient,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  collect,
  collectAndSync,
};
