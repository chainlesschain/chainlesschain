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

/* ── V2 Surface (Phase 68-71) ─────────────────────────────
 * Strictly additive. Two parallel state machines:
 *   - HSM device maturity (4 states, retired terminal)
 *   - Satellite transmission lifecycle (5 states, 3 terminals)
 * Per-operator active-device cap + per-device pending-transmission cap.
 * Auto-flip: stale devices → retired; stuck sending transmissions → failed.
 */

export const HSM_MATURITY_V2 = Object.freeze({
  PROVISIONAL: "provisional",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});

export const TRANSMISSION_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  CANCELED: "canceled",
});

const _HSM_TRANSITIONS_V2 = new Map([
  [
    HSM_MATURITY_V2.PROVISIONAL,
    new Set([HSM_MATURITY_V2.ACTIVE, HSM_MATURITY_V2.RETIRED]),
  ],
  [
    HSM_MATURITY_V2.ACTIVE,
    new Set([HSM_MATURITY_V2.DEGRADED, HSM_MATURITY_V2.RETIRED]),
  ],
  [
    HSM_MATURITY_V2.DEGRADED,
    new Set([HSM_MATURITY_V2.ACTIVE, HSM_MATURITY_V2.RETIRED]),
  ],
]);
const _HSM_TERMINAL_V2 = new Set([HSM_MATURITY_V2.RETIRED]);

const _TRANSMISSION_TRANSITIONS_V2 = new Map([
  [
    TRANSMISSION_V2.QUEUED,
    new Set([
      TRANSMISSION_V2.SENDING,
      TRANSMISSION_V2.CANCELED,
      TRANSMISSION_V2.FAILED,
    ]),
  ],
  [
    TRANSMISSION_V2.SENDING,
    new Set([
      TRANSMISSION_V2.CONFIRMED,
      TRANSMISSION_V2.FAILED,
      TRANSMISSION_V2.CANCELED,
    ]),
  ],
]);
const _TRANSMISSION_TERMINAL_V2 = new Set([
  TRANSMISSION_V2.CONFIRMED,
  TRANSMISSION_V2.FAILED,
  TRANSMISSION_V2.CANCELED,
]);

export const TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR = 8;
export const TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE = 20;
export const TS_DEFAULT_DEVICE_IDLE_MS = 30 * 86400000;
export const TS_DEFAULT_TRANSMISSION_STUCK_MS = 2 * 60000;

let _tsMaxActiveDevicesPerOperator = TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR;
let _tsMaxPendingTransmissionsPerDevice =
  TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE;
let _tsDeviceIdleMs = TS_DEFAULT_DEVICE_IDLE_MS;
let _tsTransmissionStuckMs = TS_DEFAULT_TRANSMISSION_STUCK_MS;

const _devicesV2 = new Map();
const _transmissionsV2 = new Map();

function _positiveIntV2(n, label) {
  const f = Math.floor(n);
  if (!Number.isFinite(f) || f <= 0)
    throw new Error(`${label} must be a positive integer`);
  return f;
}

export function getMaxActiveDevicesPerOperator() {
  return _tsMaxActiveDevicesPerOperator;
}
export function setMaxActiveDevicesPerOperator(n) {
  _tsMaxActiveDevicesPerOperator = _positiveIntV2(
    n,
    "maxActiveDevicesPerOperator",
  );
  return _tsMaxActiveDevicesPerOperator;
}
export function getMaxPendingTransmissionsPerDevice() {
  return _tsMaxPendingTransmissionsPerDevice;
}
export function setMaxPendingTransmissionsPerDevice(n) {
  _tsMaxPendingTransmissionsPerDevice = _positiveIntV2(
    n,
    "maxPendingTransmissionsPerDevice",
  );
  return _tsMaxPendingTransmissionsPerDevice;
}
export function getDeviceIdleMs() {
  return _tsDeviceIdleMs;
}
export function setDeviceIdleMs(n) {
  _tsDeviceIdleMs = _positiveIntV2(n, "deviceIdleMs");
  return _tsDeviceIdleMs;
}
export function getTransmissionStuckMs() {
  return _tsTransmissionStuckMs;
}
export function setTransmissionStuckMs(n) {
  _tsTransmissionStuckMs = _positiveIntV2(n, "transmissionStuckMs");
  return _tsTransmissionStuckMs;
}

export function getActiveDeviceCount(operator) {
  let c = 0;
  for (const d of _devicesV2.values()) {
    if (d.status === HSM_MATURITY_V2.RETIRED) continue;
    if (d.status === HSM_MATURITY_V2.PROVISIONAL) continue;
    if (operator !== undefined && d.operator !== operator) continue;
    c++;
  }
  return c;
}

export function getPendingTransmissionCount(deviceId) {
  let c = 0;
  for (const t of _transmissionsV2.values()) {
    if (_TRANSMISSION_TERMINAL_V2.has(t.status)) continue;
    if (deviceId !== undefined && t.deviceId !== deviceId) continue;
    c++;
  }
  return c;
}

const _VALID_VENDORS = new Set(Object.values(HSM_VENDOR));

export function registerDeviceV2({
  id,
  operator,
  vendor,
  initialStatus,
  metadata,
} = {}) {
  if (!id) throw new Error("id required");
  if (!operator) throw new Error("operator required");
  if (!vendor || !_VALID_VENDORS.has(vendor)) throw new Error("invalid vendor");
  if (_devicesV2.has(id)) throw new Error(`device ${id} already exists`);
  const status = initialStatus ?? HSM_MATURITY_V2.PROVISIONAL;
  if (!Object.values(HSM_MATURITY_V2).includes(status))
    throw new Error(`invalid initial status ${status}`);
  const countsActive =
    status !== HSM_MATURITY_V2.RETIRED &&
    status !== HSM_MATURITY_V2.PROVISIONAL;
  if (
    countsActive &&
    getActiveDeviceCount(operator) >= _tsMaxActiveDevicesPerOperator
  )
    throw new Error(`operator ${operator} active device cap reached`);
  const now = _now();
  const d = {
    id,
    operator,
    vendor,
    status,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    activatedAt: status === HSM_MATURITY_V2.ACTIVE ? now : null,
    lastUsedAt: now,
  };
  _devicesV2.set(id, d);
  return { ...d, metadata: { ...d.metadata } };
}

export function getDeviceV2(id) {
  const d = _devicesV2.get(id);
  return d ? { ...d, metadata: { ...d.metadata } } : null;
}

export function listDevicesV2({ operator, status } = {}) {
  const out = [];
  for (const d of _devicesV2.values()) {
    if (operator !== undefined && d.operator !== operator) continue;
    if (status !== undefined && d.status !== status) continue;
    out.push({ ...d, metadata: { ...d.metadata } });
  }
  return out;
}

export function setDeviceMaturityV2(id, nextStatus, { reason, metadata } = {}) {
  const d = _devicesV2.get(id);
  if (!d) throw new Error(`device ${id} not found`);
  if (_HSM_TERMINAL_V2.has(d.status))
    throw new Error(`device ${id} is terminal (${d.status})`);
  const allowed = _HSM_TRANSITIONS_V2.get(d.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${d.status} → ${nextStatus}`);
  const wasActive =
    d.status !== HSM_MATURITY_V2.PROVISIONAL &&
    d.status !== HSM_MATURITY_V2.RETIRED;
  const willBeActive =
    nextStatus !== HSM_MATURITY_V2.PROVISIONAL &&
    nextStatus !== HSM_MATURITY_V2.RETIRED;
  if (!wasActive && willBeActive) {
    if (getActiveDeviceCount(d.operator) >= _tsMaxActiveDevicesPerOperator)
      throw new Error(`operator ${d.operator} active device cap reached`);
  }
  d.status = nextStatus;
  d.updatedAt = _now();
  if (reason !== undefined) d.reason = reason;
  if (metadata) d.metadata = { ...d.metadata, ...metadata };
  if (nextStatus === HSM_MATURITY_V2.ACTIVE && !d.activatedAt)
    d.activatedAt = d.updatedAt;
  return { ...d, metadata: { ...d.metadata } };
}

export function activateDevice(id, opts) {
  return setDeviceMaturityV2(id, HSM_MATURITY_V2.ACTIVE, opts);
}
export function degradeDevice(id, opts) {
  return setDeviceMaturityV2(id, HSM_MATURITY_V2.DEGRADED, opts);
}
export function retireDevice(id, opts) {
  return setDeviceMaturityV2(id, HSM_MATURITY_V2.RETIRED, opts);
}

export function touchDeviceUsage(id) {
  const d = _devicesV2.get(id);
  if (!d) throw new Error(`device ${id} not found`);
  d.lastUsedAt = _now();
  return { ...d, metadata: { ...d.metadata } };
}

export function enqueueTransmissionV2({
  id,
  deviceId,
  provider,
  payload,
  metadata,
} = {}) {
  if (!id) throw new Error("id required");
  if (!deviceId) throw new Error("deviceId required");
  if (!provider) throw new Error("provider required");
  if (!payload) throw new Error("payload required");
  const d = _devicesV2.get(deviceId);
  if (!d) throw new Error(`device ${deviceId} not found`);
  if (_transmissionsV2.has(id))
    throw new Error(`transmission ${id} already exists`);
  if (
    getPendingTransmissionCount(deviceId) >= _tsMaxPendingTransmissionsPerDevice
  )
    throw new Error(`device ${deviceId} pending transmission cap reached`);
  const now = _now();
  const t = {
    id,
    deviceId,
    provider,
    payload,
    status: TRANSMISSION_V2.QUEUED,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    startedAt: null,
  };
  _transmissionsV2.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}

export function getTransmissionV2(id) {
  const t = _transmissionsV2.get(id);
  return t ? { ...t, metadata: { ...t.metadata } } : null;
}

export function listTransmissionsV2({ deviceId, status } = {}) {
  const out = [];
  for (const t of _transmissionsV2.values()) {
    if (deviceId !== undefined && t.deviceId !== deviceId) continue;
    if (status !== undefined && t.status !== status) continue;
    out.push({ ...t, metadata: { ...t.metadata } });
  }
  return out;
}

export function setTransmissionStatusV2(
  id,
  nextStatus,
  { reason, metadata } = {},
) {
  const t = _transmissionsV2.get(id);
  if (!t) throw new Error(`transmission ${id} not found`);
  if (_TRANSMISSION_TERMINAL_V2.has(t.status))
    throw new Error(`transmission ${id} is terminal (${t.status})`);
  const allowed = _TRANSMISSION_TRANSITIONS_V2.get(t.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${t.status} → ${nextStatus}`);
  t.status = nextStatus;
  t.updatedAt = _now();
  if (reason !== undefined) t.reason = reason;
  if (metadata) t.metadata = { ...t.metadata, ...metadata };
  if (nextStatus === TRANSMISSION_V2.SENDING && !t.startedAt)
    t.startedAt = t.updatedAt;
  return { ...t, metadata: { ...t.metadata } };
}

export function startTransmission(id, opts) {
  return setTransmissionStatusV2(id, TRANSMISSION_V2.SENDING, opts);
}
export function confirmTransmission(id, opts) {
  return setTransmissionStatusV2(id, TRANSMISSION_V2.CONFIRMED, opts);
}
export function failTransmission(id, opts) {
  return setTransmissionStatusV2(id, TRANSMISSION_V2.FAILED, opts);
}
export function cancelTransmission(id, opts) {
  return setTransmissionStatusV2(id, TRANSMISSION_V2.CANCELED, opts);
}

export function autoRetireIdleDevices({ now } = {}) {
  const cutoff = (now ?? _now()) - _tsDeviceIdleMs;
  const flipped = [];
  for (const d of _devicesV2.values()) {
    if (
      d.status !== HSM_MATURITY_V2.ACTIVE &&
      d.status !== HSM_MATURITY_V2.DEGRADED
    )
      continue;
    if ((d.lastUsedAt ?? d.createdAt) > cutoff) continue;
    d.status = HSM_MATURITY_V2.RETIRED;
    d.updatedAt = now ?? _now();
    d.reason = "auto_retire_idle";
    flipped.push(d.id);
  }
  return flipped;
}

export function autoFailStuckTransmissions({ now } = {}) {
  const cutoff = (now ?? _now()) - _tsTransmissionStuckMs;
  const flipped = [];
  for (const t of _transmissionsV2.values()) {
    if (t.status !== TRANSMISSION_V2.SENDING) continue;
    if (!t.startedAt || t.startedAt > cutoff) continue;
    t.status = TRANSMISSION_V2.FAILED;
    t.updatedAt = now ?? _now();
    t.reason = "auto_fail_stuck";
    flipped.push(t.id);
  }
  return flipped;
}

function _zeroByEnum(enumObj) {
  const out = {};
  for (const v of Object.values(enumObj)) out[v] = 0;
  return out;
}

export function getTrustSecurityStatsV2() {
  const devices = [..._devicesV2.values()];
  const transmissions = [..._transmissionsV2.values()];
  const devicesByStatus = _zeroByEnum(HSM_MATURITY_V2);
  for (const d of devices) devicesByStatus[d.status]++;
  const transmissionsByStatus = _zeroByEnum(TRANSMISSION_V2);
  for (const t of transmissions) transmissionsByStatus[t.status]++;
  return {
    totalDevicesV2: devices.length,
    totalTransmissionsV2: transmissions.length,
    maxActiveDevicesPerOperator: _tsMaxActiveDevicesPerOperator,
    maxPendingTransmissionsPerDevice: _tsMaxPendingTransmissionsPerDevice,
    deviceIdleMs: _tsDeviceIdleMs,
    transmissionStuckMs: _tsTransmissionStuckMs,
    devicesByStatus,
    transmissionsByStatus,
  };
}

export function _resetStateV2() {
  _devicesV2.clear();
  _transmissionsV2.clear();
  _tsMaxActiveDevicesPerOperator = TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR;
  _tsMaxPendingTransmissionsPerDevice =
    TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE;
  _tsDeviceIdleMs = TS_DEFAULT_DEVICE_IDLE_MS;
  _tsTransmissionStuckMs = TS_DEFAULT_TRANSMISSION_STUCK_MS;
}

// =====================================================================
// trust-security V2 governance overlay (iter18)
// =====================================================================
export const TRUSTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const TRUSTGOV_CHECK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  VERIFYING: "verifying",
  VERIFIED: "verified",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _trustgovPTrans = new Map([
  [
    TRUSTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE,
      TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TRUSTGOV_PROFILE_MATURITY_V2.SUSPENDED,
      TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TRUSTGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE,
      TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _trustgovPTerminal = new Set([TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _trustgovJTrans = new Map([
  [
    TRUSTGOV_CHECK_LIFECYCLE_V2.QUEUED,
    new Set([
      TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING,
      TRUSTGOV_CHECK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING,
    new Set([
      TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFIED,
      TRUSTGOV_CHECK_LIFECYCLE_V2.FAILED,
      TRUSTGOV_CHECK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFIED, new Set()],
  [TRUSTGOV_CHECK_LIFECYCLE_V2.FAILED, new Set()],
  [TRUSTGOV_CHECK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _trustgovPsV2 = new Map();
const _trustgovJsV2 = new Map();
let _trustgovMaxActive = 8,
  _trustgovMaxPending = 20,
  _trustgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _trustgovStuckMs = 60 * 1000;
function _trustgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _trustgovCheckP(from, to) {
  const a = _trustgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid trustgov profile transition ${from} → ${to}`);
}
function _trustgovCheckJ(from, to) {
  const a = _trustgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid trustgov check transition ${from} → ${to}`);
}
function _trustgovCountActive(owner) {
  let c = 0;
  for (const p of _trustgovPsV2.values())
    if (p.owner === owner && p.status === TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _trustgovCountPending(profileId) {
  let c = 0;
  for (const j of _trustgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TRUSTGOV_CHECK_LIFECYCLE_V2.QUEUED ||
        j.status === TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING)
    )
      c++;
  return c;
}
export function setMaxActiveTrustgovProfilesPerOwnerV2(n) {
  _trustgovMaxActive = _trustgovPos(n, "maxActiveTrustgovProfilesPerOwner");
}
export function getMaxActiveTrustgovProfilesPerOwnerV2() {
  return _trustgovMaxActive;
}
export function setMaxPendingTrustgovChecksPerProfileV2(n) {
  _trustgovMaxPending = _trustgovPos(n, "maxPendingTrustgovChecksPerProfile");
}
export function getMaxPendingTrustgovChecksPerProfileV2() {
  return _trustgovMaxPending;
}
export function setTrustgovProfileIdleMsV2(n) {
  _trustgovIdleMs = _trustgovPos(n, "trustgovProfileIdleMs");
}
export function getTrustgovProfileIdleMsV2() {
  return _trustgovIdleMs;
}
export function setTrustgovCheckStuckMsV2(n) {
  _trustgovStuckMs = _trustgovPos(n, "trustgovCheckStuckMs");
}
export function getTrustgovCheckStuckMsV2() {
  return _trustgovStuckMs;
}
export function _resetStateTrustSecurityGovV2() {
  _trustgovPsV2.clear();
  _trustgovJsV2.clear();
  _trustgovMaxActive = 8;
  _trustgovMaxPending = 20;
  _trustgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _trustgovStuckMs = 60 * 1000;
}
export function registerTrustgovProfileV2({ id, owner, level, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_trustgovPsV2.has(id))
    throw new Error(`trustgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    level: level || "medium",
    status: TRUSTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _trustgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateTrustgovProfileV2(id) {
  const p = _trustgovPsV2.get(id);
  if (!p) throw new Error(`trustgov profile ${id} not found`);
  const isInitial = p.status === TRUSTGOV_PROFILE_MATURITY_V2.PENDING;
  _trustgovCheckP(p.status, TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _trustgovCountActive(p.owner) >= _trustgovMaxActive)
    throw new Error(
      `max active trustgov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendTrustgovProfileV2(id) {
  const p = _trustgovPsV2.get(id);
  if (!p) throw new Error(`trustgov profile ${id} not found`);
  _trustgovCheckP(p.status, TRUSTGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = TRUSTGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveTrustgovProfileV2(id) {
  const p = _trustgovPsV2.get(id);
  if (!p) throw new Error(`trustgov profile ${id} not found`);
  _trustgovCheckP(p.status, TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TRUSTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchTrustgovProfileV2(id) {
  const p = _trustgovPsV2.get(id);
  if (!p) throw new Error(`trustgov profile ${id} not found`);
  if (_trustgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal trustgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getTrustgovProfileV2(id) {
  const p = _trustgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listTrustgovProfilesV2() {
  return [..._trustgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createTrustgovCheckV2({
  id,
  profileId,
  subject,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_trustgovJsV2.has(id))
    throw new Error(`trustgov check ${id} already exists`);
  if (!_trustgovPsV2.has(profileId))
    throw new Error(`trustgov profile ${profileId} not found`);
  if (_trustgovCountPending(profileId) >= _trustgovMaxPending)
    throw new Error(
      `max pending trustgov checks for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    subject: subject || "",
    status: TRUSTGOV_CHECK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _trustgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function verifyingTrustgovCheckV2(id) {
  const j = _trustgovJsV2.get(id);
  if (!j) throw new Error(`trustgov check ${id} not found`);
  _trustgovCheckJ(j.status, TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING);
  const now = Date.now();
  j.status = TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeCheckTrustgovV2(id) {
  const j = _trustgovJsV2.get(id);
  if (!j) throw new Error(`trustgov check ${id} not found`);
  _trustgovCheckJ(j.status, TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFIED);
  const now = Date.now();
  j.status = TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFIED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failTrustgovCheckV2(id, reason) {
  const j = _trustgovJsV2.get(id);
  if (!j) throw new Error(`trustgov check ${id} not found`);
  _trustgovCheckJ(j.status, TRUSTGOV_CHECK_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TRUSTGOV_CHECK_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelTrustgovCheckV2(id, reason) {
  const j = _trustgovJsV2.get(id);
  if (!j) throw new Error(`trustgov check ${id} not found`);
  _trustgovCheckJ(j.status, TRUSTGOV_CHECK_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TRUSTGOV_CHECK_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getTrustgovCheckV2(id) {
  const j = _trustgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listTrustgovChecksV2() {
  return [..._trustgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleTrustgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _trustgovPsV2.values())
    if (
      p.status === TRUSTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _trustgovIdleMs
    ) {
      p.status = TRUSTGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTrustgovChecksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _trustgovJsV2.values())
    if (
      j.status === TRUSTGOV_CHECK_LIFECYCLE_V2.VERIFYING &&
      j.startedAt != null &&
      t - j.startedAt >= _trustgovStuckMs
    ) {
      j.status = TRUSTGOV_CHECK_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getTrustSecurityGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(TRUSTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _trustgovPsV2.values()) profilesByStatus[p.status]++;
  const checksByStatus = {};
  for (const v of Object.values(TRUSTGOV_CHECK_LIFECYCLE_V2))
    checksByStatus[v] = 0;
  for (const j of _trustgovJsV2.values()) checksByStatus[j.status]++;
  return {
    totalTrustgovProfilesV2: _trustgovPsV2.size,
    totalTrustgovChecksV2: _trustgovJsV2.size,
    maxActiveTrustgovProfilesPerOwner: _trustgovMaxActive,
    maxPendingTrustgovChecksPerProfile: _trustgovMaxPending,
    trustgovProfileIdleMs: _trustgovIdleMs,
    trustgovCheckStuckMs: _trustgovStuckMs,
    profilesByStatus,
    checksByStatus,
  };
}
