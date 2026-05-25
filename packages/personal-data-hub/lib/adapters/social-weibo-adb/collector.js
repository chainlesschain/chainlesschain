"use strict";

/**
 * Phase 3a (Weibo C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("weibo.cookies")          ← Phase 3a cookies extension
 *           │
 *           ▼  {cookie, diagnostic}
 *   WeiboApiClient.fetchUid                  ← /api/config 拿 UID + 验登录
 *           │
 *           ▼  uid (numeric)
 *   fetchPosts + fetchFavourites + fetchFollows   (partial-failure OK)
 *           │
 *           ▼  3 arrays
 *   buildSnapshot + writeSnapshotJson        ← schemaVersion=1
 *           │
 *           ▼
 *   registry.syncAdapter("social-weibo", { inputPath })
 *
 * Mirror of social-bilibili-adb/collector.js — same `{ok, report?, reason?,
 * message?}` shape, same try/finally cleanup. **Key diff**: Weibo needs
 * an extra fetchUid roundtrip after cookies extraction (cookie alone
 * doesn't carry UID — Bilibili has DedeUserID inline).
 */

const { WeiboApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");

/**
 * Pull cookies → fetchUid → 3 endpoints → write snapshot. Returns the
 * staging path + counts + diagnostic.
 *
 * Throws (with typed-reason BILIBILI_-style prefix) on cookie failures.
 * Returns with empty events on /api/config failure or any endpoint
 * failure (partial-result tolerated — lastErrorCode surfaces the cause
 * for UI).
 */
async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "WeiboAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;
  const client = opts.apiClient || new WeiboApiClient();
  const limits = opts.limits || {};

  // 1. Pull cookies via Phase 3a extension.
  const cookieResult = await bridge.invoke("weibo.cookies");
  if (!cookieResult || typeof cookieResult.cookie !== "string") {
    throw new Error(
      "WeiboAdbCollector.collect: bridge.invoke('weibo.cookies') returned malformed payload — got cookie=" +
        typeof cookieResult?.cookie,
    );
  }
  const { cookie, diagnostic: cookieDiagnostic } = cookieResult;

  // 2. fetchUid — required first call. Weibo cookie has no inline UID.
  const uid = await client.fetchUid(cookie);
  if (!uid) {
    // /api/config returned login=false or non-2xx. Could be:
    //  - cookie expired (most common — user logged out on phone)
    //  - anti-bot 30x to login HTML (UA missing — but we set browser UA)
    //  - IO error
    // Surface as ExtractFailed via the hub-level wrapper; here we
    // produce an empty-event snapshot so the registry call doesn't
    // throw (consumers can read douyin.lastErrorCode to disambiguate).
    const snapshot = buildSnapshot({
      uid: 1, // sentinel — buildSnapshot requires positive; sync emits 0 events
      displayName: opts.displayName,
      snapshottedAt: now(),
    });
    const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
    return {
      snapshotPath,
      uid: null,
      eventCounts: { post: 0, favourite: 0, follow: 0, total: 0 },
      lastErrorCode: client.lastErrorCode,
      lastErrorMessage: client.lastErrorMessage,
      cookieDiagnostic: cookieDiagnostic || null,
      uidFetchFailed: true,
    };
  }

  // 3. Parallel fetch — partial failure tolerated (client returns []).
  const [posts, favourites, follows] = await Promise.all([
    client.fetchPosts(cookie, uid, {
      limit: Number.isInteger(limits.post) ? limits.post : undefined,
    }),
    client.fetchFavourites(cookie, {
      limit: Number.isInteger(limits.favourite) ? limits.favourite : undefined,
    }),
    client.fetchFollows(cookie, uid, {
      limit: Number.isInteger(limits.follow) ? limits.follow : undefined,
    }),
  ]);

  // 4. Build snapshot + write.
  const snapshot = buildSnapshot({
    uid,
    displayName: opts.displayName,
    posts,
    favourites,
    follows,
    snapshottedAt: now(),
  });
  const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });

  return {
    snapshotPath,
    uid,
    eventCounts: {
      post: posts.length,
      favourite: favourites.length,
      follow: follows.length,
      total: snapshot.events.length,
    },
    lastErrorCode: client.lastErrorCode,
    lastErrorMessage: client.lastErrorMessage,
    cookieDiagnostic: cookieDiagnostic || null,
    uidFetchFailed: false,
  };
}

/**
 * Convenience: collect + registry.syncAdapter("social-weibo") + cleanup.
 */
async function collectAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "WeiboAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-weibo", {
      inputPath: collectResult.snapshotPath,
    });
  } finally {
    try {
      cleanupSnapshotJson(collectResult.snapshotPath);
    } catch (_e) {
      cleanupFailed = true;
    }
  }
  return {
    ...syncReport,
    weibo: {
      uid: collectResult.uid,
      eventCounts: collectResult.eventCounts,
      lastErrorCode: collectResult.lastErrorCode,
      lastErrorMessage: collectResult.lastErrorMessage,
      cookieDiagnostic: collectResult.cookieDiagnostic,
      uidFetchFailed: collectResult.uidFetchFailed,
      cleanupFailed,
    },
  };
}

module.exports = {
  collect,
  collectAndSync,
};
