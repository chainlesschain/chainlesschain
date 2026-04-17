/**
 * Trust & Security — CLI port of Phase 68-71 信任安全系统
 * (docs/design/modules/39_信任安全系统.md).
 *
 * Desktop uses TPM/TEE/SE hardware trust root, PQC migration manager,
 * Iridium satellite comms, and multi-vendor HSM adapters.
 * CLI port ships:
 *
 *   - Trust attestation CRUD (TPM/TEE/SE anchors, simulated challenge-response)
 *   - PQC interop test records (algorithm compatibility tracking)
 *   - Satellite message queue (simulated send/confirm lifecycle)
 *   - HSM device registry (discover/sign simulation)
 *
 * What does NOT port: real TPM/TEE/SE hardware, actual PQC key exchange,
 * real satellite transceivers, USB HSM drivers.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const TRUST_ANCHOR = Object.freeze({
  TPM: "tpm",
  TEE: "tee",
  SECURE_ELEMENT: "secure_element",
});

export const ATTESTATION_STATUS = Object.freeze({
  VALID: "valid",
  EXPIRED: "expired",
  FAILED: "failed",
  PENDING: "pending",
});

export const SATELLITE_PROVIDER = Object.freeze({
  IRIDIUM: "iridium",
  STARLINK: "starlink",
  BEIDOU: "beidou",
});

export const SAT_MESSAGE_STATUS = Object.freeze({
  QUEUED: "queued",
  SENT: "sent",
  CONFIRMED: "confirmed",
  FAILED: "failed",
});

export const HSM_VENDOR = Object.freeze({
  YUBIKEY: "yubikey",
  LEDGER: "ledger",
  TREZOR: "trezor",
  GENERIC: "generic",
});

export const COMPLIANCE_LEVEL = Object.freeze({
  FIPS_140_2: "fips_140_2",
  FIPS_140_3: "fips_140_3",
  CC_EAL4: "cc_eal4",
});

/* ── State ─────────────────────────────────────────────── */

let _attestations = new Map();
let _interopTests = new Map();
let _satMessages = new Map();
let _hsmDevices = new Map();

function _id() {
  return crypto.randomUUID();
}
function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ────────────────────────────────────────────── */

export function ensureTrustSecurityTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS trust_attestations (
    id TEXT PRIMARY KEY,
    anchor TEXT NOT NULL,
    challenge TEXT,
    response TEXT,
    status TEXT DEFAULT 'pending',
    device_fingerprint TEXT,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS pqc_interop_tests (
    id TEXT PRIMARY KEY,
    algorithm TEXT NOT NULL,
    peer TEXT,
    result TEXT,
    compatible INTEGER DEFAULT 0,
    latency_ms INTEGER,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS satellite_messages (
    id TEXT PRIMARY KEY,
    payload TEXT,
    provider TEXT DEFAULT 'iridium',
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'queued',
    sent_at INTEGER,
    confirmed_at INTEGER,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS hsm_devices (
    id TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    model TEXT,
    serial_number TEXT,
    compliance_level TEXT,
    firmware_version TEXT,
    last_seen INTEGER,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _attestations.clear();
  _interopTests.clear();
  _satMessages.clear();
  _hsmDevices.clear();

  const tables = [
    ["trust_attestations", _attestations],
    ["pqc_interop_tests", _interopTests],
    ["satellite_messages", _satMessages],
    ["hsm_devices", _hsmDevices],
  ];
  for (const [table, map] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r.id, r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Phase 68: Trust Root Attestation ──────────────────── */

const VALID_ANCHORS = new Set(Object.values(TRUST_ANCHOR));

export function attest(db, { anchor, challenge, deviceFingerprint } = {}) {
  if (!anchor || !VALID_ANCHORS.has(anchor))
    return { attestationId: null, reason: "invalid_anchor" };

  const id = _id();
  const now = _now();
  const ch = challenge || crypto.randomBytes(32).toString("hex");

  // Simulated attestation: TPM → always valid, TEE → valid, SE → valid
  const response = crypto
    .createHash("sha256")
    .update(ch + anchor)
    .digest("hex")
    .slice(0, 32);
  const status = "valid";

  const att = {
    id,
    anchor,
    challenge: ch,
    response,
    status,
    device_fingerprint: deviceFingerprint || null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO trust_attestations (id, anchor, challenge, response, status, device_fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, anchor, ch, response, status, att.device_fingerprint, now);

  _attestations.set(id, att);
  return { attestationId: id, status, response };
}

export function getAttestation(db, id) {
  const a = _attestations.get(id);
  return a ? { ...a } : null;
}

export function listAttestations(db, { anchor, status, limit = 50 } = {}) {
  let atts = [..._attestations.values()];
  if (anchor) atts = atts.filter((a) => a.anchor === anchor);
  if (status) atts = atts.filter((a) => a.status === status);
  return atts
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((a) => ({ ...a }));
}

/* ── Phase 69: PQC Interop Tests ──────────────────────── */

export function runInteropTest(db, algorithm, { peer, latencyMs } = {}) {
  if (!algorithm) return { testId: null, reason: "missing_algorithm" };

  const id = _id();
  const now = _now();

  // Simulated compatibility check
  const supportedAlgos = [
    "ml-kem-768",
    "ml-kem-1024",
    "ml-dsa-65",
    "ml-dsa-87",
    "slh-dsa-128s",
    "slh-dsa-128f",
  ];
  const compatible = supportedAlgos.includes(algorithm.toLowerCase()) ? 1 : 0;
  const result = compatible ? "pass" : "unsupported";
  const lat = latencyMs || Math.floor(Math.random() * 50 + 5);

  const test = {
    id,
    algorithm,
    peer: peer || null,
    result,
    compatible,
    latency_ms: lat,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO pqc_interop_tests (id, algorithm, peer, result, compatible, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, algorithm, test.peer, result, compatible, lat, now);

  _interopTests.set(id, test);
  return { testId: id, compatible: !!compatible, result, latencyMs: lat };
}

export function listInteropTests(db, { algorithm, limit = 50 } = {}) {
  let tests = [..._interopTests.values()];
  if (algorithm)
    tests = tests.filter(
      (t) => t.algorithm.toLowerCase() === algorithm.toLowerCase(),
    );
  return tests
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((t) => ({ ...t }));
}

/* ── Phase 70: Satellite Messages ─────────────────────── */

const VALID_SAT_PROVIDERS = new Set(Object.values(SATELLITE_PROVIDER));

export function sendSatelliteMessage(db, payload, { provider, priority } = {}) {
  if (!payload) return { messageId: null, reason: "missing_payload" };

  const prov = provider || "iridium";
  if (!VALID_SAT_PROVIDERS.has(prov))
    return { messageId: null, reason: "invalid_provider" };

  const prio = Math.min(Math.max(priority || 5, 1), 10);
  const id = _id();
  const now = _now();

  const msg = {
    id,
    payload,
    provider: prov,
    priority: prio,
    status: "queued",
    sent_at: null,
    confirmed_at: null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO satellite_messages (id, payload, provider, priority, status, sent_at, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, payload, prov, prio, "queued", null, null, now);

  _satMessages.set(id, msg);
  return { messageId: id };
}

export function updateSatMessageStatus(db, id, status) {
  const validTransitions = {
    queued: ["sent", "failed"],
    sent: ["confirmed", "failed"],
    failed: ["queued"], // retry
  };

  const m = _satMessages.get(id);
  if (!m) return { updated: false, reason: "not_found" };

  const allowed = validTransitions[m.status];
  if (!allowed || !allowed.includes(status))
    return { updated: false, reason: "invalid_transition" };

  m.status = status;
  if (status === "sent") m.sent_at = _now();
  if (status === "confirmed") m.confirmed_at = _now();

  db.prepare(
    "UPDATE satellite_messages SET status = ?, sent_at = ?, confirmed_at = ? WHERE id = ?",
  ).run(m.status, m.sent_at, m.confirmed_at, id);

  return { updated: true };
}

export function getSatMessage(db, id) {
  const m = _satMessages.get(id);
  return m ? { ...m } : null;
}

export function listSatMessages(db, { provider, status, limit = 50 } = {}) {
  let msgs = [..._satMessages.values()];
  if (provider) msgs = msgs.filter((m) => m.provider === provider);
  if (status) msgs = msgs.filter((m) => m.status === status);
  return msgs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

/* ── Phase 71: HSM Devices ────────────────────────────── */

const VALID_HSM_VENDORS = new Set(Object.values(HSM_VENDOR));

export function registerHsmDevice(
  db,
  vendor,
  { model, serialNumber, complianceLevel, firmwareVersion } = {},
) {
  if (!vendor || !VALID_HSM_VENDORS.has(vendor))
    return { deviceId: null, reason: "invalid_vendor" };

  const id = _id();
  const now = _now();

  const dev = {
    id,
    vendor,
    model: model || null,
    serial_number: serialNumber || null,
    compliance_level: complianceLevel || null,
    firmware_version: firmwareVersion || null,
    last_seen: now,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO hsm_devices (id, vendor, model, serial_number, compliance_level, firmware_version, last_seen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    vendor,
    dev.model,
    dev.serial_number,
    dev.compliance_level,
    dev.firmware_version,
    now,
    now,
  );

  _hsmDevices.set(id, dev);
  return { deviceId: id };
}

export function removeHsmDevice(db, id) {
  const d = _hsmDevices.get(id);
  if (!d) return { removed: false, reason: "not_found" };
  db.prepare("DELETE FROM hsm_devices WHERE id = ?").run(id);
  _hsmDevices.delete(id);
  return { removed: true };
}

export function getHsmDevice(db, id) {
  const d = _hsmDevices.get(id);
  return d ? { ...d } : null;
}

export function listHsmDevices(db, { vendor, limit = 50 } = {}) {
  let devs = [..._hsmDevices.values()];
  if (vendor) devs = devs.filter((d) => d.vendor === vendor);
  return devs
    .sort((a, b) => b.last_seen - a.last_seen)
    .slice(0, limit)
    .map((d) => ({ ...d }));
}

export function signWithHsm(db, deviceId, { data, algorithm } = {}) {
  const d = _hsmDevices.get(deviceId);
  if (!d) return { signature: null, reason: "device_not_found" };
  if (!data) return { signature: null, reason: "missing_data" };

  // Simulated HSM signature
  const algo = algorithm || "ecdsa-p256";
  const sig = crypto
    .createHash("sha256")
    .update(data + d.id + algo)
    .digest("hex");

  d.last_seen = _now();
  db.prepare("UPDATE hsm_devices SET last_seen = ? WHERE id = ?").run(
    d.last_seen,
    deviceId,
  );

  return { signature: sig, algorithm: algo, deviceId };
}

/* ── Stats ─────────────────────────────────────────────── */

export function getTrustSecurityStats(db) {
  const atts = [..._attestations.values()];
  const tests = [..._interopTests.values()];
  const msgs = [..._satMessages.values()];
  const devs = [..._hsmDevices.values()];

  return {
    attestations: {
      total: atts.length,
      valid: atts.filter((a) => a.status === "valid").length,
      byAnchor: atts.reduce((acc, a) => {
        acc[a.anchor] = (acc[a.anchor] || 0) + 1;
        return acc;
      }, {}),
    },
    interopTests: {
      total: tests.length,
      compatible: tests.filter((t) => t.compatible).length,
      avgLatencyMs:
        tests.length > 0
          ? Math.round(
              tests.reduce((s, t) => s + (t.latency_ms || 0), 0) / tests.length,
            )
          : 0,
    },
    satellite: {
      total: msgs.length,
      queued: msgs.filter((m) => m.status === "queued").length,
      confirmed: msgs.filter((m) => m.status === "confirmed").length,
    },
    hsm: {
      total: devs.length,
      byVendor: devs.reduce((acc, d) => {
        acc[d.vendor] = (acc[d.vendor] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _attestations.clear();
  _interopTests.clear();
  _satMessages.clear();
  _hsmDevices.clear();
}
