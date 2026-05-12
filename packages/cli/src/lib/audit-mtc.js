/**
 * Audit MTC double-track scaffolding (Phase 2 audit, off-by-default).
 *
 * Design ref: docs/design/默克尔树证书_MTC_落地方案.md §6.3 + 评审清单 §7.
 * Compliance status (2026-05-01): Q-COMP-1 (等保三级最终性窗口) + Q-COMP-2
 * (T/ZGCMCA 023—2025 条款摘要) legal sign-off received. This module still
 * ships `enabled=false` so each tenant decides when to switch on for their
 * own org via explicit `cc audit mtc enable`. See landing plan §14.2.
 *
 * Layout under <configDir>/audit-mtc/:
 *   config.json                  enabled, batch_interval_seconds, namespace_prefix, issuer, ...
 *   keys/issuer.hex              Ed25519 secret key (0o600)
 *   staging/<event-id>.json      one Ed25519-signed event per file (track 1: realtime)
 *   batches/<batch-id>/          one closed batch:
 *     manifest.json                schema=audit-batch-manifest/v1, batch_id, tree_head_id, event_ids, ...
 *     landmark.json                MTC landmark (track 2: batch finality)
 *     envelope-<event-id>.json     one per event with inclusion_proof
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ed25519 as nobleEd25519 } from "@noble/curves/ed25519.js";
import mtcLib from "@chainlesschain/core-mtc";

const { sha256, jcs, encodeHashStr, ed25519, assembleBatch } = mtcLib;

const CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  // 3600 = Q-COMP-1 lenient path (approved unless legal requires sub-minute finality);
  // 60 = strict path; both fully supported, just flip the number.
  batch_interval_seconds: 3600,
  namespace_prefix: "mtc/v1/audit/local",
  issuer: "mtca:cc:audit-local",
});

const SCHEMA_EVENT = "audit-event/v1";
const SCHEMA_MANIFEST = "audit-batch-manifest/v1";

// ─────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────

export function getAuditMtcDir(configDir) {
  if (!configDir) throw new Error("getAuditMtcDir: configDir required");
  return path.join(configDir, "audit-mtc");
}

function configPath(dir) {
  return path.join(dir, "config.json");
}
function stagingDir(dir) {
  return path.join(dir, "staging");
}
function batchesDir(dir) {
  return path.join(dir, "batches");
}
function keyPath(dir) {
  return path.join(dir, "keys", "issuer.hex");
}

function ensureDirs(dir) {
  for (const p of [
    dir,
    stagingDir(dir),
    batchesDir(dir),
    path.dirname(keyPath(dir)),
  ]) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────

export function loadAuditMtcConfig(dir) {
  ensureDirs(dir);
  const p = configPath(dir);
  if (!fs.existsSync(p)) return { ...CONFIG_DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { ...CONFIG_DEFAULTS, ...raw };
  } catch (err) {
    throw new Error(`audit-mtc config malformed at ${p}: ${err.message}`);
  }
}

export function saveAuditMtcConfig(dir, patch) {
  ensureDirs(dir);
  const merged = { ...loadAuditMtcConfig(dir), ...patch };
  // Validate
  if (typeof merged.enabled !== "boolean") {
    throw new TypeError("config.enabled must be boolean");
  }
  if (
    !Number.isInteger(merged.batch_interval_seconds) ||
    merged.batch_interval_seconds < 1
  ) {
    throw new RangeError(
      "config.batch_interval_seconds must be positive integer",
    );
  }
  if (typeof merged.namespace_prefix !== "string" || !merged.namespace_prefix) {
    throw new TypeError("config.namespace_prefix must be non-empty string");
  }
  if (typeof merged.issuer !== "string" || !merged.issuer) {
    throw new TypeError("config.issuer must be non-empty string");
  }
  fs.writeFileSync(configPath(dir), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// ─────────────────────────────────────────────────────────────────────
// Key management — Ed25519 issuer key for tree-head signing.
// SLH-DSA swap-out is a one-line change here when @noble/post-quantum lands.
// ─────────────────────────────────────────────────────────────────────

function readIssuerKeyFile(p) {
  const secretKey = Buffer.from(fs.readFileSync(p, "utf-8").trim(), "hex");
  if (secretKey.length !== 32) {
    throw new Error(
      `issuer key file ${p} must contain 32 bytes (64 hex chars)`,
    );
  }
  const publicKey = Buffer.from(nobleEd25519.getPublicKey(secretKey));
  return { secretKey, publicKey, pubkeyId: ed25519.pubkeyId(publicKey) };
}

export function loadOrCreateIssuerKey(dir) {
  ensureDirs(dir);
  const p = keyPath(dir);
  if (fs.existsSync(p)) {
    return readIssuerKeyFile(p);
  }
  // Race-safe create: 'wx' flag fails with EEXIST if another writer beat us;
  // in that case re-read what they wrote so all callers agree on one key.
  // audit-mtc stays on Ed25519 for both realtime and tree-head signatures
  // (small/fast sig is the realtime track's value prop). SLH-DSA opt-in
  // is exposed at the cc mtc batch* / publish-skills surfaces only.
  const keys = ed25519.generateKeyPair();
  try {
    fs.writeFileSync(p, keys.secretKey.toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
    return keys;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    return readIssuerKeyFile(p);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Track 1: emit — write event with realtime Ed25519 signature
// ─────────────────────────────────────────────────────────────────────

function makeEventId() {
  // Time-prefixed so listing by name = chronological order within a batch.
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${ts}-${rand}`;
}

/**
 * Submit one audit event. Always writes an Ed25519-signed staging file
 * (so the event is queryable + cryptographically pinned within milliseconds).
 * The event will land in a Merkle batch on the next reconcile() call.
 *
 * @param {string} dir - audit-mtc root
 * @param {object} body - { event_type, operation, actor?, target?, details?, risk_level?, occurred_at? }
 * @param {object} [opts]
 * @param {boolean} [opts.requireEnabled=true] - when false, allow emit even if config.enabled=false (for tests/admin)
 */
export function emitEvent(dir, body, opts = {}) {
  ensureDirs(dir);
  const cfg = loadAuditMtcConfig(dir);
  const requireEnabled = opts.requireEnabled !== false;
  if (requireEnabled && !cfg.enabled) {
    const e = new Error(
      "audit-mtc disabled: run `cc audit mtc enable` to activate (or pass --force for one-off admin/CI use)",
    );
    e.code = "AUDIT_MTC_DISABLED";
    throw e;
  }
  if (!body || typeof body !== "object") {
    throw new TypeError("emitEvent: body must be an object");
  }
  if (!body.event_type || !body.operation) {
    throw new TypeError(
      "emitEvent: body.event_type and body.operation required",
    );
  }

  const keys = loadOrCreateIssuerKey(dir);
  const eventId = makeEventId();
  const occurredAt = body.occurred_at || new Date().toISOString();

  const normalizedBody = {
    event_type: body.event_type,
    operation: body.operation,
    actor: body.actor || null,
    target: body.target || null,
    details: body.details || null,
    risk_level: body.risk_level || "low",
    occurred_at: occurredAt,
  };
  const contentHash = encodeHashStr(sha256(jcs(normalizedBody)));

  const signingInput = Buffer.concat([
    Buffer.from("audit-event/v1\n", "utf-8"),
    Buffer.from(contentHash, "utf-8"),
  ]);
  const sig = ed25519.signRaw(signingInput, keys.secretKey);

  const record = {
    schema: SCHEMA_EVENT,
    event_id: eventId,
    body: normalizedBody,
    content_hash: contentHash,
    ed25519_sig: {
      alg: "Ed25519",
      pubkey_id: ed25519.pubkeyId(keys.publicKey),
      sig: sig.toString("base64url"),
    },
    queued_at: new Date().toISOString(),
  };

  const filePath = path.join(stagingDir(dir), `${eventId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  return { eventId, path: filePath, record };
}

// ─────────────────────────────────────────────────────────────────────
// Track 2: reconcile — close current batch, build tree, write envelopes.
// Idempotent: re-running with no staging events is a no-op; caller can
// drive it on a timer (config.batch_interval_seconds) without coordination.
// ─────────────────────────────────────────────────────────────────────

function nextBatchId(dir) {
  const existing = fs.existsSync(batchesDir(dir))
    ? fs.readdirSync(batchesDir(dir)).filter((n) => /^\d{6}$/.test(n))
    : [];
  if (existing.length === 0) return "000001";
  const max = existing
    .map((n) => parseInt(n, 10))
    .reduce((a, b) => Math.max(a, b), 0);
  return String(max + 1).padStart(6, "0");
}

function listStagingEvents(dir) {
  const sd = stagingDir(dir);
  if (!fs.existsSync(sd)) return [];
  return fs
    .readdirSync(sd)
    .filter((n) => n.endsWith(".json"))
    .sort() // event_id is time-prefixed → sort = chronological
    .map((n) => {
      const full = path.join(sd, n);
      const expectedId = n.slice(0, -".json".length);
      try {
        const obj = JSON.parse(fs.readFileSync(full, "utf-8"));
        if (obj.schema !== SCHEMA_EVENT) {
          return {
            eventId: null,
            file: full,
            error: `unexpected schema: ${obj.schema}`,
          };
        }
        if (obj.event_id !== expectedId) {
          return {
            eventId: null,
            file: full,
            error: `filename/event_id mismatch (file=${expectedId}, body=${obj.event_id})`,
          };
        }
        return { eventId: obj.event_id, file: full, record: obj };
      } catch (err) {
        return { eventId: null, file: full, error: err.message };
      }
    });
}

/**
 * Close the current batch: scan staging, build Merkle tree, emit landmark +
 * one envelope per event, write manifest, and remove staging files.
 *
 * Returns `{ skipped: true }` when staging is empty (Q-OPS-1 idempotency).
 *
 * @param {string} dir
 * @param {object} [opts]
 * @param {string} [opts.namespace] - override config.namespace_prefix
 * @param {string} [opts.issuer]    - override config.issuer
 */
export function closeBatch(dir, opts = {}) {
  ensureDirs(dir);
  const cfg = loadAuditMtcConfig(dir);
  const events = listStagingEvents(dir);

  // Skip malformed entries — collected so caller can surface them
  const malformed = events.filter((e) => e.error);
  const valid = events.filter((e) => !e.error);

  if (valid.length === 0) {
    return { skipped: true, reason: "no staged events", malformed };
  }

  const batchId = nextBatchId(dir);
  const namespacePrefix = opts.namespace || cfg.namespace_prefix;
  const namespace = `${namespacePrefix}/${batchId}`;
  const issuer = opts.issuer || cfg.issuer;
  const keys = loadOrCreateIssuerKey(dir);

  // Leaves: hash the realtime event record (already Ed25519-signed) so the
  // inclusion proof simultaneously proves "this event existed" + "in this batch".
  const rawLeaves = valid.map((e) => ({
    kind: "audit-event",
    subject: e.eventId,
    content_hash: e.record.content_hash,
    queued_at: e.record.queued_at,
    realtime_sig: e.record.ed25519_sig,
  }));

  const { landmark, envelopes, treeHeadId } = assembleBatch(rawLeaves, keys, {
    namespace,
    issuer,
  });

  // Atomic-ish write: stage in tmp dir under batches/, rename in.
  const finalDir = path.join(batchesDir(dir), batchId);
  if (fs.existsSync(finalDir)) {
    // Defensive: nextBatchId already ensures this is a fresh number;
    // if we're here it means a previous close crashed mid-rename — clean up.
    fs.rmSync(finalDir, { recursive: true, force: true });
  }
  const tmpDir = path.join(batchesDir(dir), `.${batchId}.tmp`);
  if (fs.existsSync(tmpDir))
    fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, "landmark.json"),
    JSON.stringify(landmark, null, 2),
    "utf-8",
  );
  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i];
    const eventId = valid[i].eventId;
    fs.writeFileSync(
      path.join(tmpDir, `envelope-${eventId}.json`),
      JSON.stringify(env, null, 2),
      "utf-8",
    );
  }

  const manifest = {
    schema: SCHEMA_MANIFEST,
    batch_id: batchId,
    namespace,
    issuer,
    tree_head_id: treeHeadId,
    tree_size: valid.length,
    closed_at: new Date().toISOString(),
    event_ids: valid.map((e) => e.eventId),
    envelope_files: valid.map((e) => `envelope-${e.eventId}.json`),
    malformed_skipped: malformed.map((m) => ({ file: m.file, error: m.error })),
  };
  fs.writeFileSync(
    path.join(tmpDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );

  fs.renameSync(tmpDir, finalDir);

  // Remove staging files only AFTER the rename succeeds (so a crash before
  // rename leaves staging intact and the next reconcile can retry).
  for (const e of valid) {
    try {
      fs.unlinkSync(e.file);
    } catch (_err) {
      /* file may have been removed concurrently — non-fatal */
    }
  }

  return {
    skipped: false,
    batchId,
    namespace,
    treeHeadId,
    treeSize: valid.length,
    eventIds: valid.map((e) => e.eventId),
    batchDir: finalDir,
    malformed: manifest.malformed_skipped,
  };
}

/**
 * Find which closed batch contains the given event id.
 * Returns { found: false } if event is still in staging or unknown.
 *
 * @param {string} dir
 * @param {string} eventId
 * @returns {{ found: boolean, batchId?: string, treeHeadId?: string, namespace?: string, leafIndex?: number, envelopePath?: string, staging?: boolean }}
 */
export function reconcileCheck(dir, eventId) {
  ensureDirs(dir);
  if (!eventId || typeof eventId !== "string") {
    throw new TypeError("reconcileCheck: eventId required");
  }

  // Still in staging?
  const stagingFile = path.join(stagingDir(dir), `${eventId}.json`);
  if (fs.existsSync(stagingFile)) {
    return { found: false, staging: true };
  }

  const bd = batchesDir(dir);
  if (!fs.existsSync(bd)) return { found: false };
  const batches = fs
    .readdirSync(bd)
    .filter((n) => /^\d{6}$/.test(n))
    .sort();
  for (const batchId of batches) {
    const manifestPath = path.join(bd, batchId, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (_err) {
      continue;
    }
    const idx = (manifest.event_ids || []).indexOf(eventId);
    if (idx >= 0) {
      return {
        found: true,
        batchId,
        treeHeadId: manifest.tree_head_id,
        namespace: manifest.namespace,
        leafIndex: idx,
        envelopePath: path.join(bd, batchId, `envelope-${eventId}.json`),
      };
    }
  }
  return { found: false };
}

/**
 * Snapshot of queue + last-batch state. Cheap to compute, suitable for `cc audit mtc status`.
 */
export function getStatus(dir) {
  ensureDirs(dir);
  const cfg = loadAuditMtcConfig(dir);
  const staging = listStagingEvents(dir);
  const bd = batchesDir(dir);
  const batches = fs.existsSync(bd)
    ? fs
        .readdirSync(bd)
        .filter((n) => /^\d{6}$/.test(n))
        .sort()
    : [];
  let lastBatch = null;
  if (batches.length > 0) {
    const lastId = batches[batches.length - 1];
    const manifestPath = path.join(bd, lastId, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        lastBatch = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } catch (_err) {
        /* malformed — treat as no-last-batch */
      }
    }
  }
  // Find oldest queued_at across valid records — guard against the
  // alphabetically-first staging entry being malformed.
  const oldestValid = staging.find((e) => e.record && e.record.queued_at);
  return {
    config: cfg,
    staging: {
      count: staging.length,
      malformed: staging.filter((e) => e.error).length,
      oldest_queued_at: oldestValid ? oldestValid.record.queued_at : null,
    },
    batches: {
      count: batches.length,
      last_batch_id: batches.length ? batches[batches.length - 1] : null,
      last_closed_at: lastBatch ? lastBatch.closed_at : null,
      last_tree_size: lastBatch ? lastBatch.tree_size : null,
      last_tree_head_id: lastBatch ? lastBatch.tree_head_id : null,
    },
  };
}

export const _internals = {
  CONFIG_DEFAULTS,
  SCHEMA_EVENT,
  SCHEMA_MANIFEST,
  configPath,
  stagingDir,
  batchesDir,
  keyPath,
  nextBatchId,
  listStagingEvents,
};
