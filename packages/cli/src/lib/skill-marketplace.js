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
}
