"use strict";

/**
 * Phase 6d (Kuaishou C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("kuaishou.cookies")        ← Phase 6d cookies extension
 *           │
 *           ▼  {cookie, uid, diagnostic}
 *   KuaishouApiClient.fetchProfile           ← cookie parse (no HTTP)
 *           │
 *           ▼  ProfileInfo
 *   signProvider.warmUp(cookie)              ← Phase 6d bridge ready
 *           │
 *           ▼
 *   fetchWatchHistory + fetchProfilePhotos + fetchSearchHistory
 *           │   (parallel, GraphQL POST + __NS_sig3 + kpf/kpn)
 *           ▼  3 arrays (partial-failure OK)
 *   buildSnapshot + writeSnapshotJson        ← schemaVersion=1
 *           │
 *           ▼
 *   registry.syncAdapter("social-kuaishou", { inputPath })
 *
 * Mirror of social-toutiao-adb but with GraphQL POST signing + dual
 * URL/header bridge contract.
 */

const { KuaishouApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");

async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "KuaishouAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;
  const signProvider = opts.signProvider || undefined;
  const client =
    opts.apiClient || new KuaishouApiClient({ now, signProvider });
  const limits = opts.limits || {};

  const cookieResult = await bridge.invoke("kuaishou.cookies");
  if (
    !cookieResult ||
    typeof cookieResult.cookie !== "string"
  ) {
    throw new Error(
      "KuaishouAdbCollector.collect: bridge.invoke('kuaishou.cookies') returned malformed payload — got cookie=" +
        typeof cookieResult?.cookie,
    );
  }
  const { cookie, uid: cookieUid, diagnostic: cookieDiagnostic } = cookieResult;

  if (signProvider && typeof signProvider.warmUp === "function") {
    try {
      await signProvider.warmUp(cookie);
    } catch (e) {
      client._setLastError(
        -98,
        `signProvider warm-up failed: ${e && e.message ? e.message : String(e)}`,
      );
    }
  }

  try {
    // fetchProfile — pure cookie parse, no HTTP, no _sig.
    const profile = await client.fetchProfile(cookie);
    if (!profile) {
      // Cookie lacks api_ph or parse failed. Emit empty snapshot using
      // cookie-derived uid (or sentinel).
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
        eventCounts: { profile: 0, watch: 0, collect: 0, search: 0, total: 0 },
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
    const [watch, collectPosts, search] = await Promise.all([
      client.fetchWatchHistory(cookie, {
        limit: Number.isInteger(limits.watch) ? limits.watch : undefined,
      }),
      client.fetchProfilePhotos(cookie, profile.uid, {
        limit: Number.isInteger(limits.collect)
          ? limits.collect
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
      watch,
      collect: collectPosts,
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
        watch: watch.length,
        collect: collectPosts.length,
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
        // Best-effort
      }
    }
  }
}

async function collectAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "KuaishouAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-kuaishou", {
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
    kuaishou: {
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
