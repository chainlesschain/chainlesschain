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
    let profile = await client.fetchProfile(cookie);
    const profileFailed = !profile;
    // Capture the profile error BEFORE the signed fetches overwrite lastError —
    // when profile is permission-denied (real-device 2026-06-11: passport
    // error_code 16 该应用无权限) it's the headline diagnostic, more useful than
    // a downstream -99 short-circuit.
    const profileErrCode = profileFailed ? client.lastErrorCode : null;
    const profileErrMsg = profileFailed ? client.lastErrorMessage : null;

    // Local account_db fallback: the web profile endpoint is often
    // permission-denied (error_code 16) AND the WebView cookie jar carries no
    // numeric uid — but the app's local account_db has uid+nickname in
    // plaintext. Recover it so the signed collection/search endpoints (which
    // need a uid) can still run. Best-effort: the bridge may not expose
    // "toutiao.account" (older wiring) — that's fine, we fall through.
    let profileSource = profile ? "web" : null;
    if (profileFailed && bridge && typeof bridge.invoke === "function") {
      try {
        const acct = await bridge.invoke("toutiao.account");
        if (acct && acct.uid && /^\d+$/.test(String(acct.uid))) {
          profile = { uid: String(acct.uid), nickname: acct.nickname || null };
          profileSource = "local-account-db";
        }
      } catch (_e) {
        // account extension unavailable / logged out — keep web error.
      }
    }

    // The signed feed endpoint is cookie-identified and collection/search can
    // use a cookie-derived uid, so a profile failure should NOT abort the whole
    // sync when we still have a usable uid — only bail when there is no uid at
    // all. (Previously any profile failure returned an empty snapshot, so the
    // SignBridge feed/collection/search were never even attempted.)
    const effectiveUid = (profile && profile.uid) || cookieUid || null;
    if (!effectiveUid) {
      const snapshot = buildSnapshot({
        uid: "unknown-user",
        displayName: opts.displayName,
        snapshottedAt: now(),
      });
      const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
      return {
        snapshotPath,
        uid: null,
        nickname: null,
        eventCounts: { profile: 0, feed: 0, collection: 0, search: 0, total: 0 },
        lastErrorCode: profileErrCode,
        lastErrorMessage: profileErrMsg,
        cookieDiagnostic: cookieDiagnostic || null,
        profileFetchFailed: true,
        profileSource,
        signProviderUsed: signProvider
          ? signProvider.constructor.name
          : "none",
        signProviderHits: client._bridgeHits,
        signProviderFallbacks: client._fallbackHits,
      };
    }

    // Parallel 3 signed endpoints — partial failure tolerated. Attempted even
    // when profile failed (as long as we have a uid), so feed can still flow
    // through a SignBridge despite a permission-denied profile endpoint.
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
      uid: effectiveUid,
      displayName: opts.displayName || (profile && profile.nickname),
      profile: profile || undefined,
      feed,
      collection,
      search,
      snapshottedAt: now(),
    });
    const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });

    return {
      snapshotPath,
      uid: effectiveUid,
      nickname: profile ? profile.nickname : null,
      eventCounts: {
        profile: profile ? 1 : 0,
        feed: feed.length,
        collection: collection.length,
        search: search.length,
        total: snapshot.events.length,
      },
      // On profile failure surface the profile error (the headline issue), not
      // the last signed-endpoint status.
      lastErrorCode: profileFailed ? profileErrCode : client.lastErrorCode,
      lastErrorMessage: profileFailed ? profileErrMsg : client.lastErrorMessage,
      cookieDiagnostic: cookieDiagnostic || null,
      profileFetchFailed: profileFailed,
      profileSource,
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
