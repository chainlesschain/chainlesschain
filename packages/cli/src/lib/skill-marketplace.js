/**
 * Skill Marketplace — CLI port of Phase 65 skill-service-protocol + skill-invoker
 * (docs/design/modules/37_技能市场系统.md).
 *
 * The Desktop build drives real remote skill invocation via LLMSession + P2P
 * agent mesh: PUBLISHED services get called over Matrix / libp2p / HTTP, with
 * streaming output routed through Context Engineering. The CLI can't host the
 * P2P agent mesh, so this port ships the tractable scaffolding:
 *
 *   - Skill service lifecycle (publish → publish/deprecate/suspend) with
 *     SQLite persistence.
 *   - Invocation record-keeping (SUCCESS / FAILED / TIMEOUT) — actual remote
 *     call is a pluggable handler; default is a local stub.
 *   - Invocation stats (count, success rate, avg duration).
 *   - Catalogs: SERVICE_STATUS, INVOCATION_STATUS.
 *
 * Real P2P invocation, streaming output and Context Engineering injection are
 * Desktop-only.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const SERVICE_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  DEPRECATED: "deprecated",
  SUSPENDED: "suspended",
});

export const INVOCATION_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  TIMEOUT: "timeout",
});

const VALID_SERVICE_STATUS = new Set(Object.values(SERVICE_STATUS));
const VALID_INVOCATION_STATUS = new Set(Object.values(INVOCATION_STATUS));

// Only DRAFT services can be published; any service can be
// deprecated/suspended; deprecated/suspended can re-publish to DRAFT again
// (re-draft) or back to PUBLISHED (re-publish).
const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [SERVICE_STATUS.DRAFT]: [SERVICE_STATUS.PUBLISHED, SERVICE_STATUS.SUSPENDED],
  [SERVICE_STATUS.PUBLISHED]: [
    SERVICE_STATUS.DEPRECATED,
    SERVICE_STATUS.SUSPENDED,
  ],
  [SERVICE_STATUS.DEPRECATED]: [
    SERVICE_STATUS.PUBLISHED,
    SERVICE_STATUS.SUSPENDED,
  ],
  [SERVICE_STATUS.SUSPENDED]: [
    SERVICE_STATUS.DRAFT,
    SERVICE_STATUS.PUBLISHED,
    SERVICE_STATUS.DEPRECATED,
  ],
});

/* ── State ─────────────────────────────────────────────────── */

const _services = new Map();
const _invocations = new Map();
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureMarketplaceTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT DEFAULT '1.0.0',
      description TEXT,
      endpoint TEXT,
      pricing TEXT,
      status TEXT DEFAULT 'draft',
      owner TEXT,
      invocation_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_invocations (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      caller_id TEXT,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending',
      duration_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_skill_services_status ON skill_services(status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_skill_invocations_service ON skill_invocations(service_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_skill_invocations_status ON skill_invocations(status)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listServiceStatus() {
  return Object.values(SERVICE_STATUS);
}

export function listInvocationStatus() {
  return Object.values(INVOCATION_STATUS);
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/* ── Services ──────────────────────────────────────────────── */

export function publishService(db, config = {}) {
  const name = String(config.name || "").trim();
  if (!name) throw new Error("name is required");

  const version = String(config.version || "1.0.0").trim();
  const description = String(config.description || "").trim();
  const endpoint = config.endpoint ? String(config.endpoint).trim() : null;
  const pricing = config.pricing || null;
  const owner = config.owner ? String(config.owner).trim() : null;

  const initialStatus = String(
    config.status || SERVICE_STATUS.PUBLISHED,
  ).toLowerCase();
  if (!VALID_SERVICE_STATUS.has(initialStatus)) {
    throw new Error(
      `Invalid status: ${config.status} (known: ${[...VALID_SERVICE_STATUS].join("/")})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  const service = {
    id,
    name,
    version,
    description,
    endpoint,
    pricing,
    status: initialStatus,
    owner,
    invocationCount: 0,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _services.set(id, service);

  if (db) {
    db.prepare(
      `INSERT INTO skill_services (id, name, version, description, endpoint, pricing, status, owner, invocation_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      version,
      description,
      endpoint,
      pricing ? JSON.stringify(pricing) : null,
      initialStatus,
      owner,
      0,
      now,
      now,
    );
  }

  return _strip(service);
}

export function getService(serviceId) {
  const s = _services.get(serviceId);
  return s ? _strip(s) : null;
}

export function listServices(opts = {}) {
  let rows = [..._services.values()];
  if (opts.status) {
    const st = String(opts.status).toLowerCase();
    if (!VALID_SERVICE_STATUS.has(st)) {
      throw new Error(`Unknown status: ${opts.status}`);
    }
    rows = rows.filter((s) => s.status === st);
  }
  if (opts.owner) {
    rows = rows.filter((s) => s.owner === opts.owner);
  }
  if (opts.name) {
    const needle = String(opts.name).toLowerCase();
    rows = rows.filter((s) => s.name.toLowerCase().includes(needle));
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

function _mustGetService(serviceId) {
  const s = _services.get(serviceId);
  if (!s) throw new Error(`Service not found: ${serviceId}`);
  return s;
}

function _persistService(db, serviceId, fields) {
  if (!db) return;
  const setClauses = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(fields).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  );
  db.prepare(`UPDATE skill_services SET ${setClauses} WHERE id = ?`).run(
    ...values,
    serviceId,
  );
}

export function updateServiceStatus(db, serviceId, nextStatus) {
  const service = _mustGetService(serviceId);
  const target = String(nextStatus || "").toLowerCase();
  if (!VALID_SERVICE_STATUS.has(target)) {
    throw new Error(
      `Invalid status: ${nextStatus} (known: ${[...VALID_SERVICE_STATUS].join("/")})`,
    );
  }
  const allowed = ALLOWED_STATUS_TRANSITIONS[service.status] || [];
  if (!allowed.includes(target)) {
    throw new Error(
      `Cannot transition service from ${service.status} → ${target}`,
    );
  }
  const now = Date.now();
  service.status = target;
  service.updatedAt = now;
  _persistService(db, serviceId, {
    status: target,
    updated_at: now,
  });
  return _strip(service);
}

/* ── Invocations ───────────────────────────────────────────── */

export function recordInvocation(db, config = {}) {
  const serviceId = String(config.serviceId || "").trim();
  if (!serviceId) throw new Error("serviceId is required");
  const service = _mustGetService(serviceId);
  if (service.status !== SERVICE_STATUS.PUBLISHED) {
    throw new Error(
      `Cannot invoke non-published service (status=${service.status})`,
    );
  }

  const callerId = config.callerId ? String(config.callerId).trim() : null;
  const input = config.input ?? null;
  const output = config.output ?? null;
  const status = String(
    config.status || INVOCATION_STATUS.SUCCESS,
  ).toLowerCase();
  if (!VALID_INVOCATION_STATUS.has(status)) {
    throw new Error(
      `Invalid invocation status: ${config.status} (known: ${[...VALID_INVOCATION_STATUS].join("/")})`,
    );
  }

  const durationMs =
    config.durationMs == null ? null : Number(config.durationMs);
  if (durationMs != null && (Number.isNaN(durationMs) || durationMs < 0)) {
    throw new Error(`Invalid durationMs: ${config.durationMs}`);
  }

  const error = config.error ? String(config.error) : null;
  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  const invocation = {
    id,
    serviceId,
    callerId,
    input,
    output,
    status,
    durationMs,
    error,
    createdAt: now,
    _seq: ++_seq,
  };
  _invocations.set(id, invocation);

  // Increment service.invocationCount
  service.invocationCount = (service.invocationCount || 0) + 1;
  service.updatedAt = now;

  if (db) {
    db.prepare(
      `INSERT INTO skill_invocations (id, service_id, caller_id, input, output, status, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      serviceId,
      callerId,
      input == null ? null : JSON.stringify(input),
      output == null ? null : JSON.stringify(output),
      status,
      durationMs,
      error,
      now,
    );
    _persistService(db, serviceId, {
      invocation_count: service.invocationCount,
      updated_at: now,
    });
  }

  return _strip(invocation);
}

export function listInvocations(opts = {}) {
  let rows = [..._invocations.values()];
  if (opts.serviceId) {
    rows = rows.filter((i) => i.serviceId === opts.serviceId);
  }
  if (opts.callerId) {
    rows = rows.filter((i) => i.callerId === opts.callerId);
  }
  if (opts.status) {
    const st = String(opts.status).toLowerCase();
    if (!VALID_INVOCATION_STATUS.has(st)) {
      throw new Error(`Unknown invocation status: ${opts.status}`);
    }
    rows = rows.filter((i) => i.status === st);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

export function getInvocationStats(opts = {}) {
  let rows = [..._invocations.values()];
  if (opts.serviceId) {
    rows = rows.filter((i) => i.serviceId === opts.serviceId);
  }
  const total = rows.length;
  const counts = {
    success: 0,
    failed: 0,
    timeout: 0,
    pending: 0,
    running: 0,
  };
  let totalDuration = 0;
  let durationSamples = 0;
  for (const inv of rows) {
    if (counts[inv.status] != null) counts[inv.status]++;
    if (inv.durationMs != null && inv.status === INVOCATION_STATUS.SUCCESS) {
      totalDuration += inv.durationMs;
      durationSamples++;
    }
  }
  const successRate = total > 0 ? counts.success / total : 0;
  const avgDurationMs =
    durationSamples > 0 ? totalDuration / durationSamples : 0;

  return {
    total,
    counts,
    successRate: Number(successRate.toFixed(3)),
    avgDurationMs: Number(avgDurationMs.toFixed(1)),
    scopedToService: opts.serviceId || null,
  };
}

/* ── Reset (tests) ─────────────────────────────────────────── */

export function _resetState() {
  _services.clear();
  _invocations.clear();
  _seq = 0;
  _maxConcurrentInvocationsPerService =
    DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_SERVICE;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 (Phase 65) — Frozen enums + async invocation lifecycle +
 * per-service concurrency cap + patch-merged setInvocationStatus +
 * stats-v2. Strictly additive on top of the legacy surface above.
 * ═══════════════════════════════════════════════════════════════ */

export const SERVICE_STATUS_V2 = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  DEPRECATED: "deprecated",
  SUSPENDED: "suspended",
});

export const INVOCATION_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  TIMEOUT: "timeout",
});

export const PRICING_MODEL_V2 = Object.freeze({
  FREE: "free",
  PAY_PER_CALL: "pay_per_call",
  SUBSCRIPTION: "subscription",
  TIERED: "tiered",
});

const DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_SERVICE = 10;
let _maxConcurrentInvocationsPerService =
  DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_SERVICE;
export const MARKETPLACE_DEFAULT_MAX_CONCURRENT_INVOCATIONS =
  DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_SERVICE;

export function setMaxConcurrentInvocations(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("maxConcurrentInvocations must be a positive integer");
  }
  _maxConcurrentInvocationsPerService = Math.floor(n);
  return _maxConcurrentInvocationsPerService;
}

export function getMaxConcurrentInvocations() {
  return _maxConcurrentInvocationsPerService;
}

export function getActiveInvocationCount(serviceId) {
  let count = 0;
  for (const inv of _invocations.values()) {
    if (
      (serviceId == null || inv.serviceId === serviceId) &&
      (inv.status === INVOCATION_STATUS_V2.PENDING ||
        inv.status === INVOCATION_STATUS_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

// Invocation state machine:
//   pending → { running, failed, timeout }
//   running → { success, failed, timeout }
//   success/failed/timeout are terminal.
const _invocationTerminal = new Set([
  INVOCATION_STATUS_V2.SUCCESS,
  INVOCATION_STATUS_V2.FAILED,
  INVOCATION_STATUS_V2.TIMEOUT,
]);
const _invocationAllowed = new Map([
  [
    INVOCATION_STATUS_V2.PENDING,
    new Set([
      INVOCATION_STATUS_V2.RUNNING,
      INVOCATION_STATUS_V2.FAILED,
      INVOCATION_STATUS_V2.TIMEOUT,
    ]),
  ],
  [
    INVOCATION_STATUS_V2.RUNNING,
    new Set([
      INVOCATION_STATUS_V2.SUCCESS,
      INVOCATION_STATUS_V2.FAILED,
      INVOCATION_STATUS_V2.TIMEOUT,
    ]),
  ],
  [INVOCATION_STATUS_V2.SUCCESS, new Set([])],
  [INVOCATION_STATUS_V2.FAILED, new Set([])],
  [INVOCATION_STATUS_V2.TIMEOUT, new Set([])],
]);

/**
 * beginInvocationV2 — creates a PENDING invocation row (no output/duration).
 * Caller drives the transition via startInvocation (→ RUNNING),
 * completeInvocation (→ SUCCESS), failInvocation / timeoutInvocation,
 * or the generic setInvocationStatus.
 */
export function beginInvocationV2(db, config = {}) {
  const serviceId = String(config.serviceId || "").trim();
  if (!serviceId) throw new Error("serviceId is required");
  const service = _mustGetService(serviceId);
  if (service.status !== SERVICE_STATUS_V2.PUBLISHED) {
    throw new Error(
      `Cannot invoke non-published service (status=${service.status})`,
    );
  }

  const activeCount = getActiveInvocationCount(serviceId);
  if (activeCount >= _maxConcurrentInvocationsPerService) {
    throw new Error(
      `Max concurrent invocations reached: ${activeCount}/${_maxConcurrentInvocationsPerService}`,
    );
  }

  const callerId = config.callerId ? String(config.callerId).trim() : null;
  const input = config.input ?? null;
  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  const invocation = {
    id,
    serviceId,
    callerId,
    input,
    output: null,
    status: INVOCATION_STATUS_V2.PENDING,
    durationMs: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    _seq: ++_seq,
  };
  _invocations.set(id, invocation);

  if (db) {
    db.prepare(
      `INSERT INTO skill_invocations (id, service_id, caller_id, input, output, status, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      serviceId,
      callerId,
      input == null ? null : JSON.stringify(input),
      null,
      INVOCATION_STATUS_V2.PENDING,
      null,
      null,
      now,
    );
  }

  return _strip(invocation);
}

function _mustGetInvocation(invocationId) {
  const inv = _invocations.get(invocationId);
  if (!inv) throw new Error(`Invocation not found: ${invocationId}`);
  return inv;
}

function _persistInvocation(db, invocationId, fields) {
  if (!db) return;
  const setClauses = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(fields).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  );
  db.prepare(`UPDATE skill_invocations SET ${setClauses} WHERE id = ?`).run(
    ...values,
    invocationId,
  );
}

export function startInvocation(db, invocationId, opts = {}) {
  return setInvocationStatus(db, invocationId, INVOCATION_STATUS_V2.RUNNING, {
    startedAt: Number(opts.now ?? Date.now()),
  });
}

export function completeInvocationV2(db, invocationId, opts = {}) {
  return setInvocationStatus(db, invocationId, INVOCATION_STATUS_V2.SUCCESS, {
    output: opts.output ?? null,
    durationMs: opts.durationMs == null ? null : Number(opts.durationMs),
  });
}

export function failInvocationV2(db, invocationId, errorMessage, opts = {}) {
  return setInvocationStatus(db, invocationId, INVOCATION_STATUS_V2.FAILED, {
    error: errorMessage ? String(errorMessage) : null,
    durationMs: opts.durationMs == null ? null : Number(opts.durationMs),
  });
}

export function timeoutInvocationV2(db, invocationId, opts = {}) {
  return setInvocationStatus(db, invocationId, INVOCATION_STATUS_V2.TIMEOUT, {
    error: opts.error ? String(opts.error) : "timeout",
    durationMs: opts.durationMs == null ? null : Number(opts.durationMs),
  });
}

export function setInvocationStatus(db, invocationId, newStatus, patch = {}) {
  const inv = _mustGetInvocation(invocationId);

  if (!Object.values(INVOCATION_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown invocation status: ${newStatus}`);
  }

  const allowed = _invocationAllowed.get(inv.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid invocation status transition: ${inv.status} → ${newStatus}`,
    );
  }

  const now = Date.now();
  inv.status = newStatus;

  const dbFields = { status: newStatus };

  if (patch.output !== undefined) {
    inv.output = patch.output;
    dbFields.output =
      patch.output == null ? null : JSON.stringify(patch.output);
  }
  if (patch.error !== undefined) {
    inv.error = patch.error;
    dbFields.error = patch.error;
  }
  if (patch.durationMs !== undefined) {
    const d = patch.durationMs == null ? null : Number(patch.durationMs);
    if (d != null && (Number.isNaN(d) || d < 0)) {
      throw new Error(`Invalid durationMs: ${patch.durationMs}`);
    }
    inv.durationMs = d;
    dbFields.duration_ms = d;
  }
  if (patch.startedAt !== undefined) {
    inv.startedAt = patch.startedAt;
  }

  if (_invocationTerminal.has(newStatus) && inv.completedAt == null) {
    inv.completedAt = now;
    // Bump the service's invocation counter once on terminal.
    const service = _services.get(inv.serviceId);
    if (service) {
      service.invocationCount = (service.invocationCount || 0) + 1;
      service.updatedAt = now;
      _persistService(db, inv.serviceId, {
        invocation_count: service.invocationCount,
        updated_at: now,
      });
    }
  }

  _persistInvocation(db, invocationId, dbFields);

  return _strip(inv);
}

export function getMarketplaceStatsV2() {
  const services = [..._services.values()];
  const invocations = [..._invocations.values()];

  const servicesByStatus = {};
  for (const s of Object.values(SERVICE_STATUS_V2)) servicesByStatus[s] = 0;
  for (const s of services)
    servicesByStatus[s.status] = (servicesByStatus[s.status] || 0) + 1;

  const invocationsByStatus = {};
  for (const s of Object.values(INVOCATION_STATUS_V2))
    invocationsByStatus[s] = 0;
  for (const inv of invocations)
    invocationsByStatus[inv.status] =
      (invocationsByStatus[inv.status] || 0) + 1;

  const servicesByPricing = {};
  for (const p of Object.values(PRICING_MODEL_V2)) servicesByPricing[p] = 0;
  for (const s of services) {
    const model =
      s.pricing && typeof s.pricing === "object" && s.pricing.model
        ? String(s.pricing.model)
        : PRICING_MODEL_V2.FREE;
    if (servicesByPricing[model] == null) servicesByPricing[model] = 0;
    servicesByPricing[model]++;
  }

  let totalDuration = 0;
  let durationSamples = 0;
  for (const inv of invocations) {
    if (inv.durationMs != null && inv.status === INVOCATION_STATUS_V2.SUCCESS) {
      totalDuration += inv.durationMs;
      durationSamples++;
    }
  }
  const avgDurationMs =
    durationSamples > 0
      ? Number((totalDuration / durationSamples).toFixed(1))
      : 0;
  const successRate =
    invocations.length > 0
      ? Number(
          (
            invocationsByStatus[INVOCATION_STATUS_V2.SUCCESS] /
            invocations.length
          ).toFixed(3),
        )
      : 0;

  return {
    totalServices: services.length,
    totalInvocations: invocations.length,
    activeInvocations: getActiveInvocationCount(),
    maxConcurrentInvocations: _maxConcurrentInvocationsPerService,
    servicesByStatus,
    invocationsByStatus,
    servicesByPricing,
    avgDurationMs,
    successRate,
  };
}

// =====================================================================
// skill-marketplace V2 governance overlay (iter16)
// =====================================================================
export const MKTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const MKTGOV_ORDER_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _mktgovPTrans = new Map([
  [
    MKTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      MKTGOV_PROFILE_MATURITY_V2.ACTIVE,
      MKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MKTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      MKTGOV_PROFILE_MATURITY_V2.SUSPENDED,
      MKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MKTGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      MKTGOV_PROFILE_MATURITY_V2.ACTIVE,
      MKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [MKTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _mktgovPTerminal = new Set([MKTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _mktgovJTrans = new Map([
  [
    MKTGOV_ORDER_LIFECYCLE_V2.QUEUED,
    new Set([
      MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING,
      MKTGOV_ORDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING,
    new Set([
      MKTGOV_ORDER_LIFECYCLE_V2.PROCESSED,
      MKTGOV_ORDER_LIFECYCLE_V2.FAILED,
      MKTGOV_ORDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MKTGOV_ORDER_LIFECYCLE_V2.PROCESSED, new Set()],
  [MKTGOV_ORDER_LIFECYCLE_V2.FAILED, new Set()],
  [MKTGOV_ORDER_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _mktgovPsV2 = new Map();
const _mktgovJsV2 = new Map();
let _mktgovMaxActive = 10,
  _mktgovMaxPending = 25,
  _mktgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _mktgovStuckMs = 60 * 1000;
function _mktgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _mktgovCheckP(from, to) {
  const a = _mktgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mktgov profile transition ${from} → ${to}`);
}
function _mktgovCheckJ(from, to) {
  const a = _mktgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid mktgov order transition ${from} → ${to}`);
}
function _mktgovCountActive(owner) {
  let c = 0;
  for (const p of _mktgovPsV2.values())
    if (p.owner === owner && p.status === MKTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _mktgovCountPending(profileId) {
  let c = 0;
  for (const j of _mktgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === MKTGOV_ORDER_LIFECYCLE_V2.QUEUED ||
        j.status === MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING)
    )
      c++;
  return c;
}
export function setMaxActiveMktgovProfilesPerOwnerV2(n) {
  _mktgovMaxActive = _mktgovPos(n, "maxActiveMktgovProfilesPerOwner");
}
export function getMaxActiveMktgovProfilesPerOwnerV2() {
  return _mktgovMaxActive;
}
export function setMaxPendingMktgovOrdersPerProfileV2(n) {
  _mktgovMaxPending = _mktgovPos(n, "maxPendingMktgovOrdersPerProfile");
}
export function getMaxPendingMktgovOrdersPerProfileV2() {
  return _mktgovMaxPending;
}
export function setMktgovProfileIdleMsV2(n) {
  _mktgovIdleMs = _mktgovPos(n, "mktgovProfileIdleMs");
}
export function getMktgovProfileIdleMsV2() {
  return _mktgovIdleMs;
}
export function setMktgovOrderStuckMsV2(n) {
  _mktgovStuckMs = _mktgovPos(n, "mktgovOrderStuckMs");
}
export function getMktgovOrderStuckMsV2() {
  return _mktgovStuckMs;
}
export function _resetStateSkillMarketplaceV2() {
  _mktgovPsV2.clear();
  _mktgovJsV2.clear();
  _mktgovMaxActive = 10;
  _mktgovMaxPending = 25;
  _mktgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _mktgovStuckMs = 60 * 1000;
}
export function registerMktgovProfileV2({
  id,
  owner,
  category,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_mktgovPsV2.has(id))
    throw new Error(`mktgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    category: category || "general",
    status: MKTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mktgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateMktgovProfileV2(id) {
  const p = _mktgovPsV2.get(id);
  if (!p) throw new Error(`mktgov profile ${id} not found`);
  const isInitial = p.status === MKTGOV_PROFILE_MATURITY_V2.PENDING;
  _mktgovCheckP(p.status, MKTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _mktgovCountActive(p.owner) >= _mktgovMaxActive)
    throw new Error(`max active mktgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = MKTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendMktgovProfileV2(id) {
  const p = _mktgovPsV2.get(id);
  if (!p) throw new Error(`mktgov profile ${id} not found`);
  _mktgovCheckP(p.status, MKTGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = MKTGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveMktgovProfileV2(id) {
  const p = _mktgovPsV2.get(id);
  if (!p) throw new Error(`mktgov profile ${id} not found`);
  _mktgovCheckP(p.status, MKTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = MKTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchMktgovProfileV2(id) {
  const p = _mktgovPsV2.get(id);
  if (!p) throw new Error(`mktgov profile ${id} not found`);
  if (_mktgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal mktgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getMktgovProfileV2(id) {
  const p = _mktgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listMktgovProfilesV2() {
  return [..._mktgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createMktgovOrderV2({
  id,
  profileId,
  listingId,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_mktgovJsV2.has(id)) throw new Error(`mktgov order ${id} already exists`);
  if (!_mktgovPsV2.has(profileId))
    throw new Error(`mktgov profile ${profileId} not found`);
  if (_mktgovCountPending(profileId) >= _mktgovMaxPending)
    throw new Error(
      `max pending mktgov orders for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    listingId: listingId || "",
    status: MKTGOV_ORDER_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mktgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function processingMktgovOrderV2(id) {
  const j = _mktgovJsV2.get(id);
  if (!j) throw new Error(`mktgov order ${id} not found`);
  _mktgovCheckJ(j.status, MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING);
  const now = Date.now();
  j.status = MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeOrderMktgovV2(id) {
  const j = _mktgovJsV2.get(id);
  if (!j) throw new Error(`mktgov order ${id} not found`);
  _mktgovCheckJ(j.status, MKTGOV_ORDER_LIFECYCLE_V2.PROCESSED);
  const now = Date.now();
  j.status = MKTGOV_ORDER_LIFECYCLE_V2.PROCESSED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failMktgovOrderV2(id, reason) {
  const j = _mktgovJsV2.get(id);
  if (!j) throw new Error(`mktgov order ${id} not found`);
  _mktgovCheckJ(j.status, MKTGOV_ORDER_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = MKTGOV_ORDER_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelMktgovOrderV2(id, reason) {
  const j = _mktgovJsV2.get(id);
  if (!j) throw new Error(`mktgov order ${id} not found`);
  _mktgovCheckJ(j.status, MKTGOV_ORDER_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = MKTGOV_ORDER_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getMktgovOrderV2(id) {
  const j = _mktgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listMktgovOrdersV2() {
  return [..._mktgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleMktgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _mktgovPsV2.values())
    if (
      p.status === MKTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _mktgovIdleMs
    ) {
      p.status = MKTGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMktgovOrdersV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _mktgovJsV2.values())
    if (
      j.status === MKTGOV_ORDER_LIFECYCLE_V2.PROCESSING &&
      j.startedAt != null &&
      t - j.startedAt >= _mktgovStuckMs
    ) {
      j.status = MKTGOV_ORDER_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSkillMarketplaceGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(MKTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _mktgovPsV2.values()) profilesByStatus[p.status]++;
  const ordersByStatus = {};
  for (const v of Object.values(MKTGOV_ORDER_LIFECYCLE_V2))
    ordersByStatus[v] = 0;
  for (const j of _mktgovJsV2.values()) ordersByStatus[j.status]++;
  return {
    totalMktgovProfilesV2: _mktgovPsV2.size,
    totalMktgovOrdersV2: _mktgovJsV2.size,
    maxActiveMktgovProfilesPerOwner: _mktgovMaxActive,
    maxPendingMktgovOrdersPerProfile: _mktgovMaxPending,
    mktgovProfileIdleMs: _mktgovIdleMs,
    mktgovOrderStuckMs: _mktgovStuckMs,
    profilesByStatus,
    ordersByStatus,
  };
}
