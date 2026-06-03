"use strict";

/**
 * Phase 1b (Bilibili C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("bilibili.cookies")   ← Phase 1a cookies extension
 *           │
 *           ▼  {cookie, uid}
 *   BilibiliApiClient                   ← Phase 1b Node-side WBI port
 *     fetchHistory / fetchFavourites    (4 endpoints, partial-failure OK)
 *     fetchDynamics / fetchFollows
 *           │
 *           ▼  4 arrays
 *   buildSnapshot + writeSnapshotJson   ← Phase 1b snapshot builder
 *           │
 *           ▼  staging JSON path
 *   registry.syncAdapter("social-bilibili", { inputPath })  ← reuses existing
 *                                                              snapshot mode
 *
 * The collector does NOT register itself as a separate adapter — it
 * piggy-backs on the existing `social-bilibili` adapter's snapshot mode
 * so vault schema / event types / dedup all stay single-source-of-truth.
 *
 * Failure modes:
 *   - bridge.invoke throws → propagates (caller catches; UI shows root /
 *     not-installed / cookie-incomplete error from Phase 1a)
 *   - any of the 4 API endpoints fails → empty array; sync proceeds with
 *     partial data and `lastErrorCode` surfaces the cause for UI
 *   - all 4 endpoints empty → still produces a valid snapshot with 0
 *     events; adapter sync emits a clean report (better than throwing —
 *     user can read the error in lastErrorMessage to diagnose)
 *   - staging file write failure → throws (genuine "we can't continue")
 */

const { BilibiliApiClient } = require("./api-client");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");

/**
 * Pull cookies → fetch 4 endpoints → write a snapshot JSON. Returns the
 * staging path + counts + diagnostic — caller decides what to do with
 * the snapshot (typically pass to registry.syncAdapter then cleanup).
 *
 * @param {object} bridge  the host-adb-bridge instance — must have
 *   `bilibili.cookies` extension registered (Phase 1a)
 * @param {{
 *   apiClient?: BilibiliApiClient,
 *   limits?: {history?: number, favourite?: number, dynamic?: number, follow?: number},
 *   stagingDir?: string,
 *   displayName?: string,
 *   now?: () => number,
 * }} [opts]
 * @returns {Promise<{
 *   snapshotPath: string,
 *   uid: number,
 *   eventCounts: {history: number, favourite: number, dynamic: number, follow: number, total: number},
 *   lastErrorCode: number,
 *   lastErrorMessage: string|null,
 *   cookieDiagnostic: object,
 * }>}
 */
async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "BilibiliAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const limits = opts.limits || {};
  const client =
    opts.apiClient || new BilibiliApiClient({ now: opts.now });
  const now = opts.now || Date.now;

  // 1. Pull cookies via Phase 1a extension.
  const { cookie, uid, diagnostic: cookieDiagnostic } = await bridge.invoke(
    "bilibili.cookies",
  );
  if (!cookie || !Number.isFinite(uid) || uid <= 0) {
    throw new Error(
      "BilibiliAdbCollector.collect: bridge.invoke('bilibili.cookies') returned malformed payload — got cookie=" +
        typeof cookie +
        " uid=" +
        uid,
    );
  }

  // 2. Fetch 4 endpoints in parallel — independent calls, partial failure
  // tolerated. Promise.all rejects on first throw, but the client returns
  // [] on error rather than throwing, so all four resolve.
  const [history, favourites, dynamics, follows] = await Promise.all([
    client.fetchHistory(cookie, {
      limit: Number.isInteger(limits.history) ? limits.history : undefined,
    }),
    client.fetchFavourites(cookie, uid, {
      perFolderLimit: Number.isInteger(limits.favourite) ? limits.favourite : undefined,
    }),
    client.fetchDynamics(cookie, {
      limit: Number.isInteger(limits.dynamic) ? limits.dynamic : undefined,
    }),
    client.fetchFollows(cookie, uid, {
      limit: Number.isInteger(limits.follow) ? limits.follow : undefined,
    }),
  ]);

  // 3. Build snapshot + write to staging.
  const snapshot = buildSnapshot({
    uid,
    displayName: opts.displayName,
    history,
    favourites,
    dynamics,
    follows,
    snapshottedAt: now(),
  });
  const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });

  return {
    snapshotPath,
    uid,
    eventCounts: {
      history: history.length,
      favourite: favourites.length,
      dynamic: dynamics.length,
      follow: follows.length,
      total: snapshot.events.length,
    },
    // Surface the API client's last error so UI can disambiguate "all 4
    // empty because anti-spider rate-limited" from "all 4 empty because
    // user is new and has no history".
    lastErrorCode: client.lastErrorCode,
    lastErrorMessage: client.lastErrorMessage,
    cookieDiagnostic: cookieDiagnostic || null,
  };
}

/**
 * One-shot convenience: collect + syncAdapter("social-bilibili") + cleanup.
 *
 * Returns the SyncReport from registry.syncAdapter merged with the
 * collector's diagnostic fields (eventCounts, cookieDiagnostic,
 * lastErrorCode/Message) so UI gets one object with everything.
 *
 * Cleanup is always attempted — even if syncAdapter throws — so the
 * temp .json doesn't leak.
 *
 * @param {object} bridge      host-adb-bridge
 * @param {object} registry    AdapterRegistry (must already have
 *                             "social-bilibili" adapter registered)
 * @param {object} [opts]      forwarded to `collect()`
 * @returns {Promise<object>}  SyncReport + collector diagnostic
 */
async function collectAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "BilibiliAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-bilibili", {
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
    bilibili: {
      uid: collectResult.uid,
      eventCounts: collectResult.eventCounts,
      lastErrorCode: collectResult.lastErrorCode,
      lastErrorMessage: collectResult.lastErrorMessage,
      cookieDiagnostic: collectResult.cookieDiagnostic,
      cleanupFailed,
    },
  };
}

module.exports = {
  collect,
  collectAndSync,
};
