"use strict";

/**
 * Phase 2a (Douyin C 路径 — 2026-05-25): end-to-end orchestrator.
 *
 *   bridge.invoke("douyin.pull-im-db")  ← Phase 2a db-extension
 *           │
 *           ▼  {tempPath, uid, walPath?, shmPath?, cleanup}
 *   parseImDb(tempPath)                  ← Phase 2a im-db-parser
 *           │
 *           ▼  {messages, contacts, diagnostic}
 *   buildSnapshot + writeSnapshotJson    ← Phase 2a snapshot-builder
 *           │
 *           ▼  staging JSON path
 *   registry.syncAdapter("social-douyin", { inputPath })  ← existing
 *                                                            snapshot mode
 *
 * Pattern mirrors social-bilibili-adb/collector.js — same try/finally
 * cleanup, same `{ok, report?, reason?, message?}` return shape.
 */

const { parseImDb } = require("./im-db-parser");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
} = require("./snapshot-builder");
const { salvageFile } = require("../../forensics/leaf-salvage");
const { mapMsgRecords, inferMsgColumns } = require("./salvage-mapper");

/**
 * Pull IM db → parse → write snapshot. Returns the staging path + counts
 * + diagnostic. Caller decides what to do with the snapshot (typically
 * passes to registry.syncAdapter then cleanup).
 *
 * @param {object} bridge  host-adb-bridge instance — must have
 *   "douyin.pull-im-db" extension registered
 * @param {{
 *   uid?: string,                 // 19-digit uid to disambiguate multi-account
 *   limits?: {messages?: number, contacts?: number},
 *   stagingDir?: string,
 *   displayName?: string,
 *   now?: () => number,
 * }} [opts]
 */
async function collect(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "DouyinAdbCollector.collect: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;

  // 1. Pull the IM db cohort.
  const pullResult = await bridge.invoke("douyin.pull-im-db", {
    uid: opts.uid,
  });
  if (
    !pullResult ||
    typeof pullResult.tempPath !== "string" ||
    typeof pullResult.uid !== "string"
  ) {
    throw new Error(
      "DouyinAdbCollector.collect: bridge.invoke('douyin.pull-im-db') returned malformed payload",
    );
  }
  const { tempPath, uid, cleanup: cleanupDbCohort } = pullResult;

  try {
    // 2. Parse the IM db locally.
    const parsed = parseImDb(tempPath, {
      limitMessages: opts.limits && opts.limits.messages,
      limitContacts: opts.limits && opts.limits.contacts,
    });

    // 3. Build snapshot + write to staging.
    const snapshot = buildSnapshot({
      uid,
      displayName: opts.displayName,
      messages: parsed.messages,
      contacts: parsed.contacts,
      snapshottedAt: now(),
    });
    const snapshotPath = writeSnapshotJson(snapshot, {
      dir: opts.stagingDir,
    });

    return {
      snapshotPath,
      uid,
      eventCounts: {
        message: parsed.messages.length,
        contact: parsed.contacts.length,
        total: parsed.messages.length + parsed.contacts.length,
      },
      parserDiagnostic: parsed.diagnostic,
      // Cleanup the pulled db cohort right after parsing — we have the
      // events in memory, no reason to keep the .db lying around.
      _dbCohortCleanup: cleanupDbCohort,
    };
  } catch (err) {
    // On any parse / build / write failure, cleanup the pulled db cohort
    // before re-throwing so we don't leak the temp file.
    if (typeof cleanupDbCohort === "function") {
      try {
        cleanupDbCohort();
      } catch (_e) {
        // best-effort
      }
    }
    throw err;
  }
}

/**
 * One-shot convenience: collect + syncAdapter("social-douyin") + cleanup
 * everything (both the db cohort AND the snapshot JSON, even if
 * syncAdapter throws).
 *
 * @param {object} bridge      host-adb-bridge
 * @param {object} registry    AdapterRegistry
 * @param {object} [opts]      forwarded to `collect()`
 * @returns {Promise<object>}  SyncReport + collector diagnostic
 */
async function collectAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "DouyinAdbCollector.collectAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collect(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-douyin", {
      inputPath: collectResult.snapshotPath,
    });
  } finally {
    try {
      cleanupSnapshotJson(collectResult.snapshotPath);
    } catch (_e) {
      cleanupFailed = true;
    }
    // Always cleanup the pulled db cohort.
    if (typeof collectResult._dbCohortCleanup === "function") {
      try {
        collectResult._dbCohortCleanup();
      } catch (_e) {
        cleanupFailed = true;
      }
    }
  }
  return {
    ...syncReport,
    douyin: {
      uid: collectResult.uid,
      eventCounts: collectResult.eventCounts,
      parserDiagnostic: collectResult.parserDiagnostic,
      cleanupFailed,
    },
  };
}

// ── Salvage path (Method B /proc/mem dump → leaf-salvage → snapshot) ──────
//
// The key-free decryption breakthrough: a rooted device dumps a running app's
// decrypted SQLite pages from /proc/<pid>/mem, then this salvages the message
// records straight out of the leaf pages (no key, no password) and ingests them
// through the same social-douyin snapshot path. Closes the loop: dump → salvage
// → THIS → PDH entities. See docs/internal/pdh-db-decryption-runbook.md §3.5.

/**
 * Salvage records from a memory dump → social-douyin snapshot JSON.
 *
 * @param {string} dumpPath  path to the /proc/mem dump (or concatenated dumps)
 * @param {{
 *   uid?: string,             // account uid; defaults to "salvage" placeholder
 *   columns?: string[],       // explicit msg column order; else inferMsgColumns
 *   pageSize?: number, minCols?: number, unaligned?: boolean, stride?: number,
 *   displayName?: string,
 *   stagingDir?: string,
 *   now?: () => number,
 * }} [opts]
 * @returns {{snapshotPath: string, uid: string, eventCounts: object, salvage: object}}
 */
function salvageDumpToSnapshot(dumpPath, opts = {}) {
  if (typeof dumpPath !== "string" || dumpPath.length === 0) {
    throw new TypeError("salvageDumpToSnapshot: dumpPath must be a non-empty string");
  }
  const now = opts.now || Date.now;
  const { records, pages } = salvageFile(dumpPath, {
    pageSize: opts.pageSize,
    minCols: opts.minCols,
    unaligned: opts.unaligned,
    stride: opts.stride,
  });
  // Leaf pages carry no column names — use the caller's explicit order when
  // known (most accurate), else heuristically infer content/created_time.
  const columns = Array.isArray(opts.columns) && opts.columns.length
    ? opts.columns
    : inferMsgColumns(records);
  const messages = mapMsgRecords(records, columns);
  const uid = typeof opts.uid === "string" && opts.uid.length ? opts.uid : "salvage";
  const snapshot = buildSnapshot({
    uid,
    displayName: opts.displayName,
    messages,
    contacts: [],
    snapshottedAt: now(),
  });
  const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
  return {
    snapshotPath,
    uid,
    eventCounts: { message: messages.length, total: messages.length },
    salvage: { leafPages: pages, recordsSalvaged: records.length, columns },
  };
}

/**
 * One-shot: salvage dump → snapshot → syncAdapter("social-douyin") → cleanup.
 *
 * @param {object} registry  AdapterRegistry (must expose syncAdapter)
 * @param {string} dumpPath
 * @param {object} [opts]    forwarded to salvageDumpToSnapshot
 * @returns {Promise<object>} SyncReport + salvage diagnostic
 */
async function salvageAndSync(registry, dumpPath, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "salvageAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const res = salvageDumpToSnapshot(dumpPath, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-douyin", {
      inputPath: res.snapshotPath,
    });
  } finally {
    try {
      cleanupSnapshotJson(res.snapshotPath);
    } catch (_e) {
      cleanupFailed = true;
    }
  }
  return {
    ...syncReport,
    douyin: {
      uid: res.uid,
      eventCounts: res.eventCounts,
      salvage: res.salvage,
      mode: "salvage",
      cleanupFailed,
    },
  };
}

// ── Watch-history (video_record.db) path ─────────────────────────────────
// Distinct from the IM-db path above: pulls the plaintext video_record.db and
// emits `history` events (KIND_HISTORY → BROWSE) the social-douyin adapter
// already normalizes. No X-Bogus, no SQLCipher — the durable "what/when the
// user watched" signal. See watch-history-reader.js.
const DOUYIN_SNAPSHOT_SCHEMA_VERSION = 1;

async function collectWatchHistory(bridge, opts = {}) {
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new TypeError(
      "DouyinAdbCollector.collectWatchHistory: bridge must expose invoke(method, params)",
    );
  }
  const now = opts.now || Date.now;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 2000;
  const res = await bridge.invoke("douyin.watch-history", { limit });
  if (!res || !Array.isArray(res.records)) {
    throw new Error(
      "DouyinAdbCollector.collectWatchHistory: bridge.invoke('douyin.watch-history') returned malformed payload",
    );
  }
  const uid = res.uid || opts.uid || null;
  const events = [];
  for (const r of res.records) {
    if (!r || !r.awemeId) continue;
    events.push({
      kind: "history",
      id: `history-${r.awemeId}-${r.capturedAt || ""}`,
      capturedAt: r.capturedAt || now(),
      awemeId: r.awemeId,
      enterFrom: r.enterFrom || null,
    });
  }

  // Optional title enrichment: resolve aweme ids → desc/author/duration via the
  // web detail endpoint (plain HTTP, no signing) so events show WHAT was watched.
  // Capped + dedup'd + fail-soft; an unresolved id just keeps "(no title)".
  let titlesResolved = 0;
  if (opts.resolveTitles && events.length > 0) {
    const client =
      opts._detailClient ||
      new (require("./aweme-detail-client").AwemeDetailClient)({
        fetch: opts.fetch,
        delayMs: opts.titleDelayMs,
      });
    // Resolve most-recent first (events come back DESC by view time).
    const titles = await client.resolveMany(
      events.map((e) => e.awemeId),
      { limit: Number.isInteger(opts.titleLimit) && opts.titleLimit > 0 ? opts.titleLimit : 60 },
    );
    for (const e of events) {
      const t = titles.get(e.awemeId);
      if (t) {
        // normalizeHistory reads title/author/duration off the snapshot event.
        e.title = t.desc;
        e.author = t.author;
        e.duration = t.durationMs;
        titlesResolved += 1;
      }
    }
  }

  const snapshot = {
    schemaVersion: DOUYIN_SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt: now(),
    account: {
      ...(uid ? { shortId: String(uid) } : {}),
      displayName: opts.displayName,
    },
    events,
  };
  const snapshotPath = writeSnapshotJson(snapshot, { dir: opts.stagingDir });
  return {
    snapshotPath,
    uid,
    eventCounts: { history: events.length, total: events.length },
    titlesResolved,
  };
}

async function collectWatchHistoryAndSync(bridge, registry, opts = {}) {
  if (!registry || typeof registry.syncAdapter !== "function") {
    throw new TypeError(
      "DouyinAdbCollector.collectWatchHistoryAndSync: registry must expose syncAdapter(name, options)",
    );
  }
  const collectResult = await collectWatchHistory(bridge, opts);
  let syncReport = null;
  let cleanupFailed = false;
  try {
    syncReport = await registry.syncAdapter("social-douyin", {
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
    douyin: {
      uid: collectResult.uid,
      eventCounts: collectResult.eventCounts,
      titlesResolved: collectResult.titlesResolved || 0,
      mode: "watch-history",
      cleanupFailed,
    },
  };
}

module.exports = {
  collect,
  collectAndSync,
  collectWatchHistory,
  collectWatchHistoryAndSync,
  salvageDumpToSnapshot,
  salvageAndSync,
};
