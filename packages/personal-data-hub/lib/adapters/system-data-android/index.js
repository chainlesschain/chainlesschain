"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME,
  SYSTEM_DATA_ANDROID_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("./adapter");

/**
 * Path C — desktop-side helper. Given a hub instance + an inline snapshot
 * payload from a mobile / browser client, write the snapshot to a staging
 * file, run the adapter's snapshot-mode sync, then clean the staging file up.
 *
 * Centralizing here keeps the schemaVersion check + staging path convention
 * + cleanup discipline in one place — IPC, WS, and P2P-mobile dispatch
 * (3 separate transport adapters) all just call into this.
 *
 * @param {object} hub — hub-wiring output (must have `hubDir` + `registry.syncAdapter`)
 * @param {object} snapshot — payload matching adapter.SNAPSHOT_SCHEMA_VERSION
 * @param {object} [opts]
 * @param {object} [opts.fs] — fs module override for tests (must expose
 *   mkdirSync, writeFileSync, existsSync, unlinkSync)
 * @returns {Promise<object>} SyncReport from registry.syncAdapter
 */
async function ingestSystemDataAndroidSnapshot(hub, snapshot, opts = {}) {
  if (!hub || !hub.hubDir || !hub.registry) {
    throw new Error(
      "ingestSystemDataAndroidSnapshot: hub must expose hubDir + registry"
    );
  }
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(
      "ingestSystemDataAndroidSnapshot: snapshot payload required"
    );
  }
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `ingestSystemDataAndroidSnapshot: schemaVersion ${snapshot.schemaVersion} != expected ${SNAPSHOT_SCHEMA_VERSION}`
    );
  }

  const fsImpl = opts.fs || fs;
  const stagingDir = path.join(hub.hubDir, "staging");
  fsImpl.mkdirSync(stagingDir, { recursive: true });
  const stagingPath = path.join(
    stagingDir,
    `system-data-android-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  fsImpl.writeFileSync(stagingPath, JSON.stringify(snapshot), "utf-8");

  try {
    return await hub.registry.syncAdapter(SYSTEM_DATA_ANDROID_NAME, {
      inputPath: stagingPath,
    });
  } finally {
    // best-effort cleanup; failures shouldn't shadow the (possibly successful) sync
    try {
      if (fsImpl.existsSync(stagingPath)) {
        fsImpl.unlinkSync(stagingPath);
      }
    } catch (_e) {
      /* ignore */
    }
  }
}

module.exports = {
  SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME,
  SYSTEM_DATA_ANDROID_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  ingestSystemDataAndroidSnapshot,
};
