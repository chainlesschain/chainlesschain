"use strict";

/**
 * Phase 6c (Toutiao C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("toutiao.cookies")          ← Phase 6c cookies extension
 *           │
 *           ▼  {cookie, uid, diagnostic}
 *   ToutiaoApiClient.fetchProfile             ← passport endpoint (no _sig)
 *           │
 *           ▼  ProfileInfo
 *   signProvider.warmUp(cookie)               ← Phase 6c bridge ready
 *           │
 *           ▼
 *   fetchFeed + fetchCollection + fetchSearchHistory (parallel, _signature)
 *           │
 *           ▼  3 arrays (partial-failure OK; bridge ~100%, fallback 0%)
 *   buildSnapshot + writeSnapshotJson         ← schemaVersion=1
 *           │
 *           ▼
 *   registry.syncAdapter("social-toutiao", { inputPath })
 *
 * Mirror of social-xiaohongshu-adb/collector.js but with URL-mutation
 * signing (signProvider.signUrl) vs Xhs's header signing.
 */

const { ToutiaoApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");

async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "ToutiaoAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;
  const signProvider = opts.signProvider || undefined;
  const client =
    opts.apiClient || new ToutiaoApiClient({ now, signProvider });
  const limits = opts.limits || {};

  const cookieResult = await bridge.invoke("toutiao.cookies");
  if (
    !cookieResult ||
    typeof cookieResult.cookie !== "string"
  ) {
    throw new Error(
      "ToutiaoAdbCollector.collect: bridge.invoke('toutiao.cookies') returned malformed payload — got cookie=" +
        typeof cookieResult?.cookie,
    );
  }
  const { cookie, uid: cookieUid, diagnostic: cookieDiagnostic } = cookieResult;

  // Warm up the bridge before signed endpoints. Feature-detect because
  // NullSignProvider doesn't define warmUp.
  if (signProvider && typeof signProvider.warmUp === "function") {
    try {
      await signProvider.warmUp(cookie);
    } catch (e) {
      // Bridge warm-up failed — fall through. api-client will short-
      // circuit signed endpoints with -99 since signUrl returns null.
      client._setLastError(
        -98,
        `signProvider warm-up failed: ${e && e.message ? e.message : String(e)}`,
      );
    }
  }

  try {
    // fetchProfile — passport endpoint, no _signature required.
    const profile = await client.fetchProfile(cookie);
    if (!profile) {
      // Cookie expired or sessionid missing — emit empty snapshot using
      // best-effort cookie-derived uid (or sentinel if also absent).
      const uid = cookieUid || "unknown-user";
      const snapshot = buildSnapshot({
        uid,
        displayName: opts.displayName,
        snapshottedAt: now(),
      });
      const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
      return {
        snapshotPath,
        uid: cookieUid,
        nickname: null,
        eventCounts: { profile: 0, feed: 0, collection: 0, search: 0, total: 0 },
        lastErrorCode: client.lastErrorCode,
        lastErrorMessage: client.lastErrorMessage,
        cookieDiagnostic: cookieDiagnostic || null,
        profileFetchFailed: true,
        signProviderUsed: signProvider
          ? signProvider.constructor.name
          : "none",
        signProviderHits: client._bridgeHits,
        signProviderFallbacks: client._fallbackHits,
      };
    }

    // Parallel 3 signed endpoints — partial failure tolerated.
    const [feed, collection, search] = await Promise.all([
      client.fetchFeed(cookie, {
        limit: Number.isInteger(limits.feed) ? limits.feed : undefined,
      }),
      client.fetchCollection(cookie, {
        limit: Number.isInteger(limits.collection)
          ? limits.collection
          : undefined,
      }),
      client.fetchSearchHistory(cookie, {
        limit: Number.isInteger(limits.search) ? limits.search : undefined,
      }),
    ]);

    const snapshot = buildSnapshot({
      uid: profile.uid,
      displayName: opts.displayName || profile.nickname,
      profile,
      feed,
      collection,
      search,
      snapshottedAt: now(),
    });
    const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });

    return {
      snapshotPath,
      uid: profile.uid,
      nickname: profile.nickname,
      eventCounts: {
        profile: 1,
        feed: feed.length,
        collection: collection.length,
        search: search.length,
        total: snapshot.events.length,
      },
      lastErrorCode: client.lastErrorCode,
      lastErrorMessage: client.lastErrorMessage,
      cookieDiagnostic: cookieDiagnostic || null,
      profileFetchFailed: false,
      signProviderUsed: signProvider ? signProvider.constructor.name : "none",
      signProviderHits: client._bridgeHits,
      signProviderFallbacks: client._fallbackHits,
    };
  } finally {
    if (signProvider && typeof signProvider.shutdown === "function") {
      try {
        await signProvider.shutdown();
      } catch (_e) {
        // Best-effort — shutdown errors don't block sync result.
      }
    }
  }
}

async function collectAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "ToutiaoAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-toutiao", {
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
    toutiao: {
      uid: collectResult.uid,
      nickname: collectResult.nickname,
      eventCounts: collectResult.eventCounts,
      lastErrorCode: collectResult.lastErrorCode,
      lastErrorMessage: collectResult.lastErrorMessage,
      cookieDiagnostic: collectResult.cookieDiagnostic,
      profileFetchFailed: collectResult.profileFetchFailed,
      signProviderUsed: collectResult.signProviderUsed,
      signProviderHits: collectResult.signProviderHits,
      signProviderFallbacks: collectResult.signProviderFallbacks,
      cleanupFailed,
    },
  };
}

module.exports = {
  collect,
  collectAndSync,
};
