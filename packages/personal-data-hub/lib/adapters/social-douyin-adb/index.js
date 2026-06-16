"use strict";

/**
 * social-douyin-adb — Phase 2 (Douyin C 路径) entry.
 *
 * Phase 2a (this commit) — desktop ADB-based IM db extraction:
 *   - douyin.pull-im-db extension     pulls <uid>_im.db cohort to host
 *   - parseImDb                        parse msg + SIMPLE_USER tables
 *   - buildSnapshot                    → schemaVersion=1 events JSON
 *   - collect / collectAndSync         orchestrator
 *
 * Phase 2b (next) — Android Kotlin B path (in-APK root):
 *   - reuse Phase B0 LocalRootCollector / BaseRootCredentialsStore /
 *     RootShellRunner / DbCohortCopier scaffold
 *   - libmsaoaidsec.so frida bypass for the anti-debug TracerPid check
 *
 * Pipeline (C path):
 *   bridge.invoke("douyin.pull-im-db")
 *     → parseImDb(tempPath)
 *     → buildSnapshot + writeSnapshotJson
 *     → registry.syncAdapter("social-douyin", { inputPath })
 *
 * Reuses the existing `social-douyin` adapter's snapshot mode — no 2nd
 * adapter, same vault schema / dedup / event types. Phase 2a extended
 * VALID_SNAPSHOT_KINDS in social-douyin/index.js to include `message` +
 * `contact` for the abrignoni-DFIR-parsed IM tables.
 */

const {
  createDouyinDbExtension,
  DOUYIN_DB_REMOTE_DIR,
  IM_DB_PATTERN,
} = require("./db-extension");
const { parseImDb } = require("./im-db-parser");
const {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./snapshot-builder");
const {
  collect,
  collectAndSync,
  collectWatchHistory,
  collectWatchHistoryAndSync,
  salvageDumpToSnapshot,
  salvageAndSync,
} = require("./collector");
const {
  createDouyinWatchExtension,
  VIDEO_RECORD_DB_REMOTE_PATH,
} = require("./watch-history-reader");
const { AwemeDetailClient } = require("./aweme-detail-client");

module.exports = {
  // Extension factory (wiring registers this on the bridge)
  createDouyinDbExtension,
  DOUYIN_DB_REMOTE_DIR,
  IM_DB_PATTERN,
  // Watch-history (video_record.db) extension + path
  createDouyinWatchExtension,
  VIDEO_RECORD_DB_REMOTE_PATH,
  collectWatchHistory,
  collectWatchHistoryAndSync,
  // Aweme title resolver (web detail endpoint, no signing)
  AwemeDetailClient,
  // Parser + builder (also exposed for advanced callers / tests)
  parseImDb,
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
  // Collector orchestrator
  collect,
  collectAndSync,
  // Method B salvage path (/proc/mem dump → leaf-salvage → snapshot → ingest)
  salvageDumpToSnapshot,
  salvageAndSync,
};
