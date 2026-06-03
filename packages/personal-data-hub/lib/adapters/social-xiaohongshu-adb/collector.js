"use strict";

/**
 * Phase 3c (Xhs C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("xhs.cookies")            ← Phase 3c cookies extension
 *           │
 *           ▼  {cookie, a1, diagnostic}
 *   XhsApiClient.fetchMe                     ← /user/me 拿 user_id (无 X-S)
 *           │
 *           ▼  {userId, nickname}
 *   fetchNotes + fetchLiked + fetchFollows   (parallel, X-S 需 a1)
 *           │
 *           ▼  3 arrays (partial-failure OK; ~60% GET hit rate)
 *   buildSnapshot + writeSnapshotJson        ← schemaVersion=1
 *           │
 *           ▼
 *   registry.syncAdapter("social-xiaohongshu", { inputPath })
 *
 * Mirror of social-weibo-adb/collector.js. Key diff: 3 endpoints need
 * X-S signing (best-effort md5 approximation hits ~60% GET, <30% POST;
 * collector tolerates partial failures via lastErrorCode propagation).
 */

const { XhsApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");

async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "XhsAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;
  // Phase 6b: signProvider opt — desktop wiring injects XhsSignBridge for
  // ~100% X-S hit rate; cli wiring leaves undefined → client falls back
  // to in-process best-effort md5 (~60% GET / <30% POST).
  const signProvider = opts.signProvider || undefined;
  const client =
    opts.apiClient || new XhsApiClient({ now, signProvider });
  const limits = opts.limits || {};

  const cookieResult = await bridge.invoke("xhs.cookies");
  if (
    !cookieResult ||
    typeof cookieResult.cookie !== "string" ||
    typeof cookieResult.a1 !== "string"
  ) {
    throw new Error(
      "XhsAdbCollector.collect: bridge.invoke('xhs.cookies') returned malformed payload — got cookie=" +
        typeof cookieResult?.cookie +
        " a1=" +
        typeof cookieResult?.a1,
    );
  }
  const { cookie, a1, diagnostic: cookieDiagnostic } = cookieResult;

  // Phase 6b: warm up the sign bridge with the captured cookie BEFORE
  // calling any X-S endpoint. warmUp is idempotent (no-op when already
  // warm). NullSignProvider.warmUp doesn't exist (only on the abstract
  // base + ElectronWebSignBridge), so we feature-detect.
  if (signProvider && typeof signProvider.warmUp === "function") {
    try {
      await signProvider.warmUp(cookie);
    } catch (e) {
      // Bridge warm-up failed (timeout / xhs.com 403 / IPC error).
      // Fall through — api-client will use in-process fallback. Surface
      // the reason via lastErrorMessage so UI can hint "Electron bridge
      // unavailable, command-line precision degraded".
      client._setLastError(
        -98,
        `signProvider warm-up failed: ${e && e.message ? e.message : String(e)}`,
      );
    }
  }

  try {
    // fetchMe — no X-S required
    const me = await client.fetchMe(cookie);
    if (!me) {
      // Cookie expired or web_session missing — write empty snapshot
      // (build requires userId, use sentinel "0" + emit 0 events).
      const snapshot = buildSnapshot({
        userId: "unknown-user",
        nickname: opts.displayName,
        snapshottedAt: now(),
      });
      const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
      return {
        snapshotPath,
        userId: null,
        nickname: null,
        eventCounts: { note: 0, liked: 0, follow: 0, total: 0 },
        lastErrorCode: client.lastErrorCode,
        lastErrorMessage: client.lastErrorMessage,
        cookieDiagnostic: cookieDiagnostic || null,
        meFetchFailed: true,
        signProviderUsed: signProvider
          ? signProvider.constructor.name
          : "none",
        signProviderHits: client._bridgeHits,
        signProviderFallbacks: client._fallbackHits,
      };
    }

    // Parallel 3 endpoints — partial failure tolerated; bridge-signed
    // requests should hit ~100% while fallback hits ~60% GET / <30% POST.
    const [notes, liked, follows] = await Promise.all([
      client.fetchNotes(cookie, a1, me.userId, {
        limit: Number.isInteger(limits.note) ? limits.note : undefined,
      }),
      client.fetchLiked(cookie, a1, {
        limit: Number.isInteger(limits.liked) ? limits.liked : undefined,
      }),
      client.fetchFollows(cookie, a1, me.userId, {
        limit: Number.isInteger(limits.follow) ? limits.follow : undefined,
      }),
    ]);

    const snapshot = buildSnapshot({
      userId: me.userId,
      nickname: opts.displayName || me.nickname,
      notes,
      liked,
      follows,
      snapshottedAt: now(),
    });
    const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });

    return {
      snapshotPath,
      userId: me.userId,
      nickname: me.nickname,
      eventCounts: {
        note: notes.length,
        liked: liked.length,
        follow: follows.length,
        total: snapshot.events.length,
      },
      lastErrorCode: client.lastErrorCode,
      lastErrorMessage: client.lastErrorMessage,
      cookieDiagnostic: cookieDiagnostic || null,
      meFetchFailed: false,
      signProviderUsed: signProvider ? signProvider.constructor.name : "none",
      signProviderHits: client._bridgeHits,
      signProviderFallbacks: client._fallbackHits,
    };
  } finally {
    // Always release the WebContentsView heap (~30-50MB) — even on
    // throw. shutdown is idempotent so collectAndSync's outer cleanup
    // calling it again is safe.
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
      "XhsAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-xiaohongshu", {
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
    xhs: {
      userId: collectResult.userId,
      nickname: collectResult.nickname,
      eventCounts: collectResult.eventCounts,
      lastErrorCode: collectResult.lastErrorCode,
      lastErrorMessage: collectResult.lastErrorMessage,
      cookieDiagnostic: collectResult.cookieDiagnostic,
      meFetchFailed: collectResult.meFetchFailed,
      // Phase 6b diagnostic — UI can highlight when bridge upgraded
      // X-S signing from ~60% best-effort to ~100% bridge.
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
