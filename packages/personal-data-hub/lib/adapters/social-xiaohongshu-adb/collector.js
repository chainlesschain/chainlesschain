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
  const client = opts.apiClient || new XhsApiClient({ now });
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
    };
  }

  // Parallel 3 endpoints — partial failure tolerated (~60% X-S hit rate)
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
  };
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
      cleanupFailed,
    },
  };
}

module.exports = {
  collect,
  collectAndSync,
};
