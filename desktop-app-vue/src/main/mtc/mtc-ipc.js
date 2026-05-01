/**
 * MTC IPC handlers — exposes audit-mtc status + envelope verification to the
 * renderer (V6 MtcStatusPreviewWidget + future Phase 4.2 surfaces).
 *
 * Reads directly from the audit-mtc filesystem layout (same shape as the
 * `cc audit mtc *` CLI uses) and calls core-mtc's verifier in-process —
 * no subprocess shell-out, so the main thread stays responsive.
 *
 * Channels:
 *   mtc:get-audit-status   → { config, staging, batches } (mirrors cc audit mtc status)
 *   mtc:get-active-alg     → "ed25519" | "slh-dsa-128f" — derived from last batch
 *   mtc:verify-envelope    → { ok, code?, leaf?, treeHead? } via core-mtc verify()
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

let cachedMtcLib = null;
function loadMtcLib() {
  if (!cachedMtcLib) {
    cachedMtcLib = require("@chainlesschain/core-mtc");
  }
  return cachedMtcLib;
}

/** Resolve audit-mtc dir under Electron's userData (`~/Library/Application Support/<appname>/audit-mtc/`). */
function defaultAuditMtcDir() {
  // app.getPath('userData') returns Electron's per-app data dir; the CLI
  // shares the same .chainlesschain root when desktop is the host.
  let userData;
  try {
    userData = app && app.getPath ? app.getPath("userData") : null;
  } catch (_err) {
    userData = null;
  }
  if (!userData) {
    // Fallback for non-Electron contexts (tests)
    userData = process.env.CHAINLESSCHAIN_USER_DATA || process.cwd();
  }
  return path.join(userData, ".chainlesschain", "audit-mtc");
}

const STATUS_DEFAULTS = Object.freeze({
  config: {
    enabled: false,
    batch_interval_seconds: 3600,
    namespace_prefix: "mtc/v1/audit/local",
    issuer: "mtca:cc:audit-local",
  },
  staging: { count: 0, malformed: 0, oldest_queued_at: null },
  batches: {
    count: 0,
    last_batch_id: null,
    last_closed_at: null,
    last_tree_size: null,
    last_tree_head_id: null,
  },
});

function readStatusFromDisk(dir) {
  const result = JSON.parse(JSON.stringify(STATUS_DEFAULTS));
  if (!dir || !fs.existsSync(dir)) {
    return result;
  }

  // Config
  const cfgPath = path.join(dir, "config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      Object.assign(result.config, cfg);
    } catch (_err) {
      /* malformed config — fall back to defaults */
    }
  }

  // Staging
  const stagingDir = path.join(dir, "staging");
  if (fs.existsSync(stagingDir)) {
    let oldest = null;
    let count = 0;
    let malformed = 0;
    const entries = fs
      .readdirSync(stagingDir)
      .filter((n) => n.endsWith(".json"))
      .sort();
    for (const name of entries) {
      count++;
      try {
        const obj = JSON.parse(
          fs.readFileSync(path.join(stagingDir, name), "utf-8"),
        );
        if (obj && obj.queued_at && (!oldest || obj.queued_at < oldest)) {
          oldest = obj.queued_at;
        }
        if (obj.schema !== "audit-event/v1") {
          malformed++;
        }
      } catch (_err) {
        malformed++;
      }
    }
    result.staging.count = count;
    result.staging.malformed = malformed;
    result.staging.oldest_queued_at = oldest;
  }

  // Batches — scan for the latest sequential dir + read its manifest
  const batchesDir = path.join(dir, "batches");
  if (fs.existsSync(batchesDir)) {
    const seqs = fs
      .readdirSync(batchesDir)
      .filter((n) => /^\d{6}$/.test(n))
      .sort();
    result.batches.count = seqs.length;
    if (seqs.length > 0) {
      const last = seqs[seqs.length - 1];
      const manifestPath = path.join(batchesDir, last, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const mf = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          result.batches.last_batch_id = mf.batch_id || last;
          result.batches.last_closed_at = mf.closed_at || null;
          result.batches.last_tree_size = mf.tree_size || null;
          result.batches.last_tree_head_id = mf.tree_head_id || null;
        } catch (_err) {
          result.batches.last_batch_id = last;
        }
      } else {
        result.batches.last_batch_id = last;
      }
    }
  }
  return result;
}

/**
 * Detect signing algorithm from the most recent batch's landmark.
 * Returns "ed25519" / "slh-dsa-128f" / null when no batches exist.
 */
function detectActiveAlg(dir) {
  const batchesDir = path.join(dir, "batches");
  if (!fs.existsSync(batchesDir)) {
    return null;
  }
  const seqs = fs
    .readdirSync(batchesDir)
    .filter((n) => /^\d{6}$/.test(n))
    .sort();
  if (seqs.length === 0) {
    return null;
  }
  const last = seqs[seqs.length - 1];
  const lmPath = path.join(batchesDir, last, "landmark.json");
  if (!fs.existsSync(lmPath)) {
    return null;
  }
  try {
    const lm = JSON.parse(fs.readFileSync(lmPath, "utf-8"));
    const alg = lm?.snapshots?.[0]?.signature?.alg;
    if (typeof alg !== "string") {
      return null;
    }
    if (alg === "Ed25519") {
      return "ed25519";
    }
    if (alg === "SLH-DSA-SHA2-128F") {
      return "slh-dsa-128f";
    }
    return alg.toLowerCase();
  } catch (_err) {
    return null;
  }
}

/**
 * Build a multi-alg verifier from a landmark — accepts either Ed25519 or
 * SLH-DSA tree-head signatures. Mirrors the CLI's mtc.js makeMultiAlgVerifier.
 */
function makeMultiAlgVerifier(landmark) {
  const lib = loadMtcLib();
  const ed = lib.ed25519.makeVerifierFromLandmark(landmark);
  const slh = lib.slhDsa.makeVerifierFromLandmark(landmark);
  return (signingInput, signatureObj) =>
    ed(signingInput, signatureObj) || slh(signingInput, signatureObj);
}

function verifyEnvelopeInProcess(envelope, landmark, opts = {}) {
  const lib = loadMtcLib();
  const cache = new lib.LandmarkCache({
    signatureVerifier: makeMultiAlgVerifier(landmark),
  });
  cache.ingest(landmark);
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  return lib.verify(envelope, cache, { now });
}

function registerMtcIPC({ ipcMain: injectedIpcMain, configDir, logger } = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const dir = configDir || defaultAuditMtcDir();
  const log = logger || console;

  ipcMain.handle("mtc:get-audit-status", async () => {
    try {
      return readStatusFromDisk(dir);
    } catch (err) {
      log.warn?.("[MTC IPC] get-audit-status failed:", err && err.message);
      // Return shape with defaults so the widget doesn't break
      return JSON.parse(JSON.stringify(STATUS_DEFAULTS));
    }
  });

  ipcMain.handle("mtc:get-active-alg", async () => {
    try {
      const alg = detectActiveAlg(dir);
      return alg || "ed25519";
    } catch (err) {
      log.warn?.("[MTC IPC] get-active-alg failed:", err && err.message);
      return "ed25519";
    }
  });

  ipcMain.handle(
    "mtc:verify-envelope",
    async (_event, envelope, landmark, opts) => {
      if (!envelope || !landmark) {
        return { ok: false, code: "MISSING_INPUT", recoverable: false };
      }
      try {
        const result = verifyEnvelopeInProcess(envelope, landmark, opts || {});
        return {
          ok: !!result.ok,
          code: result.code || result.reason || "",
          recoverable: !!result.recoverable,
          leaf: result.leaf || null,
          treeHead: result.treeHead || null,
        };
      } catch (err) {
        log.warn?.("[MTC IPC] verify-envelope failed:", err && err.message);
        return {
          ok: false,
          code: "VERIFY_THREW",
          recoverable: false,
          error: err && err.message,
        };
      }
    },
  );

  log.info?.("[MTC IPC] handlers registered");
}

module.exports = {
  registerMtcIPC,
  // Exported for tests:
  readStatusFromDisk,
  detectActiveAlg,
  verifyEnvelopeInProcess,
  makeMultiAlgVerifier,
  defaultAuditMtcDir,
  STATUS_DEFAULTS,
};
