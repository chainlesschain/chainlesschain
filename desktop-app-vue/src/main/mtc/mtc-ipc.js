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

/** Resolve cross-chain-mtc dir (sibling of audit-mtc under .chainlesschain/). */
function defaultBridgeMtcDir() {
  let userData;
  try {
    userData = app && app.getPath ? app.getPath("userData") : null;
  } catch (_err) {
    userData = null;
  }
  if (!userData) {
    userData = process.env.CHAINLESSCHAIN_USER_DATA || process.cwd();
  }
  return path.join(userData, ".chainlesschain", "cross-chain-mtc");
}

const BRIDGE_STATUS_DEFAULTS = Object.freeze({
  config: {
    enabled: false,
    mode: "independent",
    alg: "ed25519",
    batch_interval_seconds: 60,
    issuer: "mtca:cc:bridge-local",
  },
  trust_anchors: { chain_count: 0, total: 0, by_chain: {} },
  staging: { pending: 0 },
  batches: { total: 0, latest: null },
});

/** Resolve federation governance log dir under .chainlesschain/federation/governance/. */
function defaultFederationGovernanceDir() {
  let userData;
  try {
    userData = app && app.getPath ? app.getPath("userData") : null;
  } catch (_err) {
    userData = null;
  }
  if (!userData) {
    userData = process.env.CHAINLESSCHAIN_USER_DATA || process.cwd();
  }
  return path.join(userData, ".chainlesschain", "federation", "governance");
}

/**
 * Read all governance.log JSONL files from <dir>/<fed>.jsonl and replay
 * each one into a {fed_id → state} map using core-mtc's pure replay fn.
 *
 * @param {string} dir
 * @returns {{ federations: Array<{fed_id, events_count, state}> }}
 */
function readFederationGovernanceFromDisk(dir) {
  const result = { federations: [] };
  if (!dir || !fs.existsSync(dir)) {
    return result;
  }

  const lib = loadMtcLib();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const fedId = name.slice(0, -".jsonl".length);
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch (_err) {
        /* skip corrupt line */
      }
    }
    let state = null;
    try {
      state = lib.replayGovernanceLog(events, fedId);
    } catch (_err) {
      state = { federation_id: fedId, replay_error: true };
    }
    result.federations.push({
      fed_id: fedId,
      events_count: events.length,
      state,
    });
  }
  return result;
}

/**
 * Read all per-federation sync-stats files written by the governance-sync
 * daemons (governance-sync-serve / governance-sync-libp2p). These are
 * atomic JSON files at <dir>/<fed>.sync-stats.json. v0.10 surface.
 *
 * @param {string} dir - same governance dir as readFederationGovernanceFromDisk
 * @returns {{ federations: Array<{fed_id, available, mode, last_tick_at,
 *             publish, pull, libp2p}> }}
 */
function readFederationSyncStatsFromDisk(dir) {
  const result = { federations: [] };
  if (!dir || !fs.existsSync(dir)) {
    return result;
  }

  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".sync-stats.json")) {
      continue;
    }
    const fedId = name.slice(0, -".sync-stats.json".length);
    let stats;
    try {
      stats = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    } catch (_err) {
      result.federations.push({
        fed_id: fedId,
        available: false,
        error: "PARSE_ERROR",
      });
      continue;
    }
    result.federations.push({
      fed_id: fedId,
      available: true,
      mode: stats.mode || null,
      last_tick_at: stats.last_tick_at || null,
      publish: stats.publish || null,
      pull: stats.pull || null,
      libp2p: stats.libp2p || null,
    });
  }
  return result;
}

function readBridgeStatusFromDisk(dir) {
  const result = JSON.parse(JSON.stringify(BRIDGE_STATUS_DEFAULTS));
  if (!dir || !fs.existsSync(dir)) {
    return result;
  }

  // Config
  const cfgPath = path.join(dir, "config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      Object.assign(
        result.config,
        JSON.parse(fs.readFileSync(cfgPath, "utf-8")),
      );
    } catch (_err) {
      /* fall back to defaults on malformed json */
    }
  }

  // Trust anchors
  const taPath = path.join(dir, "trust-anchors.json");
  if (fs.existsSync(taPath)) {
    try {
      const store = JSON.parse(fs.readFileSync(taPath, "utf-8"));
      const anchors = (store && store.anchors) || {};
      const chains = Object.keys(anchors);
      result.trust_anchors.chain_count = chains.length;
      result.trust_anchors.total = chains.reduce(
        (sum, c) => sum + ((anchors[c] || []).length || 0),
        0,
      );
      result.trust_anchors.by_chain = Object.fromEntries(
        chains.map((c) => [c, (anchors[c] || []).length]),
      );
    } catch (_err) {
      /* fall back */
    }
  }

  // Staging
  const stagingDir = path.join(dir, "staging");
  if (fs.existsSync(stagingDir)) {
    result.staging.pending = fs
      .readdirSync(stagingDir)
      .filter((n) => n.endsWith(".json")).length;
  }

  // Batches (named "<pair>-<seq>", sortable)
  const batchesDir = path.join(dir, "batches");
  if (fs.existsSync(batchesDir)) {
    const entries = fs.readdirSync(batchesDir).sort();
    result.batches.total = entries.length;
    if (entries.length > 0) {
      result.batches.latest = entries[entries.length - 1];
    }
  }
  return result;
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
    verifyPublisherSignature: true,
  });
  cache.ingest(landmark);
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  return lib.verify(envelope, cache, { now });
}

function registerMtcIPC({
  ipcMain: injectedIpcMain,
  configDir,
  bridgeConfigDir,
  governanceDir: injectedGovernanceDir,
  logger,
} = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const dir = configDir || defaultAuditMtcDir();
  const bridgeDir = bridgeConfigDir || defaultBridgeMtcDir();
  const governanceDir =
    injectedGovernanceDir || defaultFederationGovernanceDir();
  const log = logger || console;

  ipcMain.handle("mtc:get-bridge-status", async () => {
    try {
      return readBridgeStatusFromDisk(bridgeDir);
    } catch (err) {
      log.warn?.("[MTC IPC] get-bridge-status failed:", err && err.message);
      return JSON.parse(JSON.stringify(BRIDGE_STATUS_DEFAULTS));
    }
  });

  ipcMain.handle("mtc:get-federation-governance", async () => {
    try {
      return readFederationGovernanceFromDisk(governanceDir);
    } catch (err) {
      log.warn?.(
        "[MTC IPC] get-federation-governance failed:",
        err && err.message,
      );
      return { federations: [] };
    }
  });

  ipcMain.handle("mtc:get-federation-sync-stats", async () => {
    try {
      return readFederationSyncStatsFromDisk(governanceDir);
    } catch (err) {
      log.warn?.(
        "[MTC IPC] get-federation-sync-stats failed:",
        err && err.message,
      );
      return { federations: [] };
    }
  });

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
  readBridgeStatusFromDisk,
  readFederationGovernanceFromDisk,
  readFederationSyncStatsFromDisk,
  detectActiveAlg,
  verifyEnvelopeInProcess,
  makeMultiAlgVerifier,
  defaultAuditMtcDir,
  defaultBridgeMtcDir,
  defaultFederationGovernanceDir,
  STATUS_DEFAULTS,
  BRIDGE_STATUS_DEFAULTS,
};
