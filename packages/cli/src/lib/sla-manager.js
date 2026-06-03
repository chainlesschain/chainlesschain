/**
 * SLA Manager — cross-org service-level agreements with tier-based
 * thresholds, metric recording, violation detection and compensation
 * calculation (Phase 61 design, CLI port).
 *
 * The Desktop build plugs SLA monitoring into live federation telemetry.
 * The CLI doesn't have a federation fixture, so operators drive metrics
 * in manually via `sla record`; everything else (tiers, violation
 * detection, compensation formula, reports) is identical to the Desktop
 * implementation.
 */

import crypto from "crypto";

/* ── Tier catalog ──────────────────────────────────────────── */

export const SLA_TIERS = Object.freeze({
  GOLD: Object.freeze({
    name: "gold",
    availability: 0.999,
    maxResponseTime: 100,
    minThroughput: 1000,
    maxErrorRate: 0.001,
    compensationRate: 0.05,
  }),
  SILVER: Object.freeze({
    name: "silver",
    availability: 0.995,
    maxResponseTime: 200,
    minThroughput: 500,
    maxErrorRate: 0.005,
    compensationRate: 0.03,
  }),
  BRONZE: Object.freeze({
    name: "bronze",
    availability: 0.99,
    maxResponseTime: 500,
    minThroughput: 200,
    maxErrorRate: 0.01,
    compensationRate: 0.01,
  }),
});

const TIER_INDEX = new Map(Object.values(SLA_TIERS).map((t) => [t.name, t]));

export function resolveTier(name) {
  if (!name) return null;
  return TIER_INDEX.get(String(name).toLowerCase()) || null;
}

export function listTiers() {
  return Object.values(SLA_TIERS).map((t) => ({ ...t }));
}

export const SLA_TERMS = Object.freeze({
  AVAILABILITY: "availability",
  RESPONSE_TIME: "response_time",
  THROUGHPUT: "throughput",
  ERROR_RATE: "error_rate",
});

export const VIOLATION_SEVERITY = Object.freeze({
  MINOR: "minor",
  MODERATE: "moderate",
  MAJOR: "major",
  CRITICAL: "critical",
});

export const SLA_STATUS = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  TERMINATED: "terminated",
});

function _classifySeverity(deviationPercent) {
  const d = Math.abs(deviationPercent);
  if (d > 50) return VIOLATION_SEVERITY.CRITICAL;
  if (d > 25) return VIOLATION_SEVERITY.MAJOR;
  if (d > 10) return VIOLATION_SEVERITY.MODERATE;
  return VIOLATION_SEVERITY.MINOR;
}

/* ── In-memory stores ─────────────────────────────────────── */
const _contracts = new Map();
const _metrics = new Map(); // slaId → [{term, value, recordedAt}]
const _violations = new Map(); // violationId → record
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSlaTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sla_contracts (
      sla_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      terms TEXT NOT NULL,
      monthly_fee REAL DEFAULT 0,
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sla_metrics (
      metric_id TEXT PRIMARY KEY,
      sla_id TEXT NOT NULL,
      term TEXT NOT NULL,
      value REAL NOT NULL,
      recorded_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sla_violations (
      violation_id TEXT PRIMARY KEY,
      sla_id TEXT NOT NULL,
      term TEXT NOT NULL,
      severity TEXT NOT NULL,
      expected_value REAL NOT NULL,
      actual_value REAL NOT NULL,
      deviation_percent REAL,
      compensation_amount REAL,
      occurred_at INTEGER NOT NULL,
      resolved_at INTEGER
    )
  `);
}

/* ── Contracts ─────────────────────────────────────────────── */

export function createSLA(db, config = {}) {
  const orgId = config.orgId;
  if (!orgId) throw new Error("orgId is required");
  const tier = resolveTier(config.tier || "silver");
  if (!tier) {
    throw new Error(
      `Unknown SLA tier: ${config.tier} (known: gold/silver/bronze)`,
    );
  }
  const durationMs = Number(config.duration ?? 30 * 86400000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("duration must be a positive number (ms)");
  }
  const monthlyFee = Number(config.monthlyFee ?? 0);
  if (monthlyFee < 0) throw new Error("monthlyFee must be >= 0");

  const now = Date.now();
  const slaId = crypto.randomUUID();
  // Terms merge tier defaults with caller overrides (caller can tighten
  // individual thresholds without abandoning the tier).
  const terms = {
    availability: tier.availability,
    maxResponseTime: tier.maxResponseTime,
    minThroughput: tier.minThroughput,
    maxErrorRate: tier.maxErrorRate,
    ...(config.terms || {}),
  };

  const contract = {
    slaId,
    orgId,
    tier: tier.name,
    terms,
    monthlyFee,
    startDate: now,
    endDate: now + durationMs,
    status: SLA_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _contracts.set(slaId, contract);

  db.prepare(
    `INSERT INTO sla_contracts (sla_id, org_id, tier, terms, monthly_fee, start_date, end_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    slaId,
    orgId,
    tier.name,
    JSON.stringify(terms),
    monthlyFee,
    now,
    now + durationMs,
    contract.status,
    now,
    now,
  );

  const { _seq: _omit, ...rest } = contract;
  void _omit;
  return rest;
}

export function listSLAs(opts = {}) {
  let rows = [..._contracts.values()];
  if (opts.orgId) rows = rows.filter((c) => c.orgId === opts.orgId);
  if (opts.status) rows = rows.filter((c) => c.status === opts.status);
  if (opts.tier) rows = rows.filter((c) => c.tier === opts.tier);
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map((c) => {
    const { _seq: _omit, ...rest } = c;
    void _omit;
    return rest;
  });
}

export function getSLA(slaId) {
  const contract = _contracts.get(slaId);
  if (!contract) throw new Error(`SLA not found: ${slaId}`);
  const { _seq: _omit, ...rest } = contract;
  void _omit;
  return rest;
}

export function terminateSLA(db, slaId) {
  const contract = _contracts.get(slaId);
  if (!contract) throw new Error(`SLA not found: ${slaId}`);
  contract.status = SLA_STATUS.TERMINATED;
  contract.updatedAt = Date.now();
  db.prepare(
    `UPDATE sla_contracts SET status = ?, updated_at = ? WHERE sla_id = ?`,
  ).run(contract.status, contract.updatedAt, slaId);
  return { slaId, status: contract.status };
}

/* ── Metrics ───────────────────────────────────────────────── */

const VALID_TERMS = new Set(Object.values(SLA_TERMS));

export function recordMetric(db, slaId, term, value, opts = {}) {
  if (!_contracts.has(slaId)) {
    throw new Error(`SLA not found: ${slaId}`);
  }
  if (!VALID_TERMS.has(term)) {
    throw new Error(
      `Unknown SLA term: ${term} (known: ${[...VALID_TERMS].join("/")})`,
    );
  }
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error("metric value must be finite");

  const metricId = crypto.randomUUID();
  const recordedAt = Number(opts.recordedAt ?? Date.now());
  const metric = { metricId, slaId, term, value: v, recordedAt };

  if (!_metrics.has(slaId)) _metrics.set(slaId, []);
  _metrics.get(slaId).push(metric);

  db.prepare(
    `INSERT INTO sla_metrics (metric_id, sla_id, term, value, recorded_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(metricId, slaId, term, v, recordedAt);

  return metric;
}

function _aggregateMetrics(metrics, term) {
  const values = metrics.filter((m) => m.term === term).map((m) => m.value);
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  const sorted = [...values].sort((a, b) => a - b);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return {
    count: values.length,
    mean: sum / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[p95Idx],
  };
}

export function getSLAMetrics(slaId) {
  if (!_contracts.has(slaId)) {
    throw new Error(`SLA not found: ${slaId}`);
  }
  const raw = _metrics.get(slaId) || [];
  const result = { slaId, totalSamples: raw.length, byTerm: {} };
  for (const term of VALID_TERMS) {
    const agg = _aggregateMetrics(raw, term);
    if (agg) result.byTerm[term] = agg;
  }
  return result;
}

/* ── Violations ────────────────────────────────────────────── */

// Deviation is "% worse than threshold". For availability/throughput (higher
// is better) deviation = (expected - actual) / expected × 100. For
// response_time/error_rate (lower is better) deviation = (actual - expected)
// / expected × 100. A positive deviation means the term is violated.
function _computeDeviation(term, expected, actual) {
  if (expected === 0) return 0;
  switch (term) {
    case SLA_TERMS.AVAILABILITY:
    case SLA_TERMS.THROUGHPUT:
      return ((expected - actual) / expected) * 100;
    case SLA_TERMS.RESPONSE_TIME:
    case SLA_TERMS.ERROR_RATE:
      return ((actual - expected) / expected) * 100;
    default:
      return 0;
  }
}

function _expectedFor(terms, term) {
  switch (term) {
    case SLA_TERMS.AVAILABILITY:
      return terms.availability;
    case SLA_TERMS.RESPONSE_TIME:
      return terms.maxResponseTime;
    case SLA_TERMS.THROUGHPUT:
      return terms.minThroughput;
    case SLA_TERMS.ERROR_RATE:
      return terms.maxErrorRate;
    default:
      return null;
  }
}

export function checkViolations(db, slaId) {
  const contract = _contracts.get(slaId);
  if (!contract) throw new Error(`SLA not found: ${slaId}`);

  const metrics = _metrics.get(slaId) || [];
  const found = [];
  const now = Date.now();

  for (const term of VALID_TERMS) {
    const expected = _expectedFor(contract.terms, term);
    if (expected == null) continue;
    const agg = _aggregateMetrics(metrics, term);
    if (!agg) continue;

    // Use p95 for response time (tail matters); mean for everything else.
    const actual = term === SLA_TERMS.RESPONSE_TIME ? agg.p95 : agg.mean;
    const deviation = _computeDeviation(term, expected, actual);
    if (deviation <= 0) continue; // within SLA

    const severity = _classifySeverity(deviation);
    const violationId = crypto.randomUUID();
    const violation = {
      violationId,
      slaId,
      term,
      severity,
      expectedValue: expected,
      actualValue: Number(actual.toFixed(6)),
      deviationPercent: Number(deviation.toFixed(4)),
      compensationAmount: null,
      occurredAt: now,
      resolvedAt: null,
    };
    _violations.set(violationId, violation);
    db.prepare(
      `INSERT INTO sla_violations (violation_id, sla_id, term, severity, expected_value, actual_value, deviation_percent, compensation_amount, occurred_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      violationId,
      slaId,
      term,
      severity,
      expected,
      violation.actualValue,
      violation.deviationPercent,
      null,
      now,
      null,
    );
    found.push(violation);
  }

  return {
    slaId,
    checkedAt: now,
    totalViolations: found.length,
    violations: found,
  };
}

export function listViolations(opts = {}) {
  let rows = [..._violations.values()];
  if (opts.slaId) rows = rows.filter((v) => v.slaId === opts.slaId);
  if (opts.severity) rows = rows.filter((v) => v.severity === opts.severity);
  rows.sort((a, b) => b.occurredAt - a.occurredAt);
  const limit = opts.limit || 50;
  return rows.slice(0, limit);
}

export function calculateCompensation(db, violationId) {
  const violation = _violations.get(violationId);
  if (!violation) throw new Error(`Violation not found: ${violationId}`);
  const contract = _contracts.get(violation.slaId);
  if (!contract) {
    throw new Error(`SLA not found for violation: ${violation.slaId}`);
  }
  const tier = resolveTier(contract.tier);

  // baseCompensation = monthlyFee × compensationRate
  // deviationMultiplier ∈ [0, 2], capped at 50% deviation
  // finalCompensation = base × multiplier
  const base = contract.monthlyFee * tier.compensationRate;
  const multiplier = Math.min(violation.deviationPercent / 50, 2.0);
  const amount = Number((base * multiplier).toFixed(4));

  violation.compensationAmount = amount;
  db.prepare(
    `UPDATE sla_violations SET compensation_amount = ? WHERE violation_id = ?`,
  ).run(amount, violationId);

  return {
    violationId,
    slaId: violation.slaId,
    severity: violation.severity,
    base: Number(base.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    amount,
  };
}

/* ── Reports ───────────────────────────────────────────────── */

export function generateReport(slaId, opts = {}) {
  const contract = _contracts.get(slaId);
  if (!contract) throw new Error(`SLA not found: ${slaId}`);

  const start = Number(opts.startDate ?? contract.startDate);
  const end = Number(opts.endDate ?? Date.now());
  if (end < start) throw new Error("endDate must be >= startDate");

  const allMetrics = _metrics.get(slaId) || [];
  const inWindow = allMetrics.filter(
    (m) => m.recordedAt >= start && m.recordedAt <= end,
  );
  const metricsByTerm = {};
  for (const term of VALID_TERMS) {
    const agg = _aggregateMetrics(inWindow, term);
    if (agg) metricsByTerm[term] = agg;
  }

  const violations = [..._violations.values()].filter(
    (v) => v.slaId === slaId && v.occurredAt >= start && v.occurredAt <= end,
  );
  const severityCounts = { minor: 0, moderate: 0, major: 0, critical: 0 };
  let totalCompensation = 0;
  for (const v of violations) {
    severityCounts[v.severity] = (severityCounts[v.severity] || 0) + 1;
    if (v.compensationAmount) totalCompensation += v.compensationAmount;
  }

  // Compliance = % of terms that had NO violation in window
  const termsWithViolation = new Set(violations.map((v) => v.term));
  const compliantTerms = [...VALID_TERMS].filter(
    (t) => !termsWithViolation.has(t),
  );
  const compliance =
    VALID_TERMS.size > 0 ? compliantTerms.length / VALID_TERMS.size : 1;

  return {
    slaId,
    orgId: contract.orgId,
    tier: contract.tier,
    period: { startDate: start, endDate: end },
    metrics: metricsByTerm,
    violations: {
      total: violations.length,
      bySeverity: severityCounts,
      totalCompensation: Number(totalCompensation.toFixed(4)),
    },
    compliance: Number(compliance.toFixed(4)),
  };
}

/* ── State reset (tests) ───────────────────────────────────── */

export function _resetState() {
  _contracts.clear();
  _metrics.clear();
  _violations.clear();
  _seq = 0;
  _maxActiveSlasPerOrg = DEFAULT_MAX_ACTIVE_SLAS_PER_ORG;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 (Phase 61) — Frozen enums + contract/violation state
 * machines + active-per-org cap + auto-expire + stats-v2.
 * Strictly additive on top of the legacy surface above.
 * ═══════════════════════════════════════════════════════════════ */

export const SLA_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  TERMINATED: "terminated",
});

export const SLA_TIER_V2 = Object.freeze({
  GOLD: "gold",
  SILVER: "silver",
  BRONZE: "bronze",
});

export const SLA_TERM_V2 = Object.freeze({
  AVAILABILITY: "availability",
  RESPONSE_TIME: "response_time",
  THROUGHPUT: "throughput",
  ERROR_RATE: "error_rate",
});

export const VIOLATION_SEVERITY_V2 = Object.freeze({
  MINOR: "minor",
  MODERATE: "moderate",
  MAJOR: "major",
  CRITICAL: "critical",
});

export const VIOLATION_STATUS_V2 = Object.freeze({
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  WAIVED: "waived",
});

const DEFAULT_MAX_ACTIVE_SLAS_PER_ORG = 1;
let _maxActiveSlasPerOrg = DEFAULT_MAX_ACTIVE_SLAS_PER_ORG;
export const SLA_DEFAULT_MAX_ACTIVE_PER_ORG = DEFAULT_MAX_ACTIVE_SLAS_PER_ORG;

export function setMaxActiveSlasPerOrg(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("maxActiveSlasPerOrg must be a positive integer");
  }
  _maxActiveSlasPerOrg = Math.floor(n);
  return _maxActiveSlasPerOrg;
}

export function getMaxActiveSlasPerOrg() {
  return _maxActiveSlasPerOrg;
}

// Contract state machine: active → { expired, terminated }; both terminal.
const _contractTerminal = new Set([
  SLA_STATUS_V2.EXPIRED,
  SLA_STATUS_V2.TERMINATED,
]);
const _contractAllowed = new Map([
  [
    SLA_STATUS_V2.ACTIVE,
    new Set([SLA_STATUS_V2.EXPIRED, SLA_STATUS_V2.TERMINATED]),
  ],
  [SLA_STATUS_V2.EXPIRED, new Set([])],
  [SLA_STATUS_V2.TERMINATED, new Set([])],
]);

// Violation state machine: open → { acknowledged, resolved, waived };
// acknowledged → { resolved, waived }; resolved/waived terminal.
const _violationTerminal = new Set([
  VIOLATION_STATUS_V2.RESOLVED,
  VIOLATION_STATUS_V2.WAIVED,
]);
const _violationAllowed = new Map([
  [
    VIOLATION_STATUS_V2.OPEN,
    new Set([
      VIOLATION_STATUS_V2.ACKNOWLEDGED,
      VIOLATION_STATUS_V2.RESOLVED,
      VIOLATION_STATUS_V2.WAIVED,
    ]),
  ],
  [
    VIOLATION_STATUS_V2.ACKNOWLEDGED,
    new Set([VIOLATION_STATUS_V2.RESOLVED, VIOLATION_STATUS_V2.WAIVED]),
  ],
  [VIOLATION_STATUS_V2.RESOLVED, new Set([])],
  [VIOLATION_STATUS_V2.WAIVED, new Set([])],
]);

export function getActiveSlaCountForOrg(orgId) {
  let count = 0;
  for (const c of _contracts.values()) {
    if (c.orgId === orgId && c.status === SLA_STATUS_V2.ACTIVE) count++;
  }
  return count;
}

/**
 * createSLAV2 — like createSLA but enforces per-org active-contract cap
 * and rejects unknown tier/status at the boundary. Augments stored
 * contract with in-memory V2 fields (violationStatus doesn't apply here;
 * see recordViolation*).
 */
export function createSLAV2(db, config = {}) {
  const orgId = config.orgId;
  if (!orgId) throw new Error("orgId is required");

  const activeCount = getActiveSlaCountForOrg(orgId);
  if (activeCount >= _maxActiveSlasPerOrg) {
    throw new Error(
      `Max active SLAs per org reached: ${activeCount}/${_maxActiveSlasPerOrg}`,
    );
  }

  return createSLA(db, config);
}

export function setSLAStatus(db, slaId, newStatus) {
  const contract = _contracts.get(slaId);
  if (!contract) throw new Error(`SLA not found: ${slaId}`);

  if (!Object.values(SLA_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown SLA status: ${newStatus}`);
  }

  const allowed = _contractAllowed.get(contract.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid SLA status transition: ${contract.status} → ${newStatus}`,
    );
  }

  contract.status = newStatus;
  contract.updatedAt = Date.now();
  db.prepare(
    `UPDATE sla_contracts SET status = ?, updated_at = ? WHERE sla_id = ?`,
  ).run(contract.status, contract.updatedAt, slaId);

  const { _seq: _omit, ...rest } = contract;
  void _omit;
  return rest;
}

export function expireSLA(db, slaId) {
  return setSLAStatus(db, slaId, SLA_STATUS_V2.EXPIRED);
}

/**
 * autoExpireSLAs — bulk-flip ACTIVE contracts whose endDate < now to
 * EXPIRED. Returns the list of flipped contracts.
 */
export function autoExpireSLAs(db, nowMs = Date.now()) {
  const flipped = [];
  for (const contract of _contracts.values()) {
    if (contract.status === SLA_STATUS_V2.ACTIVE && contract.endDate < nowMs) {
      contract.status = SLA_STATUS_V2.EXPIRED;
      contract.updatedAt = nowMs;
      db.prepare(
        `UPDATE sla_contracts SET status = ?, updated_at = ? WHERE sla_id = ?`,
      ).run(contract.status, contract.updatedAt, contract.slaId);
      const { _seq: _omit, ...rest } = contract;
      void _omit;
      flipped.push(rest);
    }
  }
  return flipped;
}

export function setViolationStatus(db, violationId, newStatus, patch = {}) {
  const violation = _violations.get(violationId);
  if (!violation) throw new Error(`Violation not found: ${violationId}`);

  if (!Object.values(VIOLATION_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown violation status: ${newStatus}`);
  }

  const current = violation.v2Status || VIOLATION_STATUS_V2.OPEN;
  const allowed = _violationAllowed.get(current);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid violation status transition: ${current} → ${newStatus}`,
    );
  }

  violation.v2Status = newStatus;
  if (typeof patch.note === "string") {
    violation.note = patch.note;
  }
  if (_violationTerminal.has(newStatus)) {
    violation.resolvedAt = Date.now();
    db.prepare(
      `UPDATE sla_violations SET resolved_at = ? WHERE violation_id = ?`,
    ).run(violation.resolvedAt, violationId);
  }

  return { ...violation };
}

export function acknowledgeViolation(db, violationId, note) {
  return setViolationStatus(db, violationId, VIOLATION_STATUS_V2.ACKNOWLEDGED, {
    note,
  });
}

export function resolveViolation(db, violationId, note) {
  return setViolationStatus(db, violationId, VIOLATION_STATUS_V2.RESOLVED, {
    note,
  });
}

export function waiveViolation(db, violationId, note) {
  return setViolationStatus(db, violationId, VIOLATION_STATUS_V2.WAIVED, {
    note,
  });
}

export function getSLAStatsV2() {
  const contracts = [..._contracts.values()];
  const violations = [..._violations.values()];

  const byStatus = {};
  for (const s of Object.values(SLA_STATUS_V2)) byStatus[s] = 0;
  for (const c of contracts) byStatus[c.status] = (byStatus[c.status] || 0) + 1;

  const byTier = {};
  for (const t of Object.values(SLA_TIER_V2)) byTier[t] = 0;
  for (const c of contracts) byTier[c.tier] = (byTier[c.tier] || 0) + 1;

  const bySeverity = {};
  for (const s of Object.values(VIOLATION_SEVERITY_V2)) bySeverity[s] = 0;
  for (const v of violations)
    bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;

  const byTerm = {};
  for (const t of Object.values(SLA_TERM_V2)) byTerm[t] = 0;
  for (const v of violations) byTerm[v.term] = (byTerm[v.term] || 0) + 1;

  const byViolationStatus = {};
  for (const s of Object.values(VIOLATION_STATUS_V2)) byViolationStatus[s] = 0;
  for (const v of violations) {
    const s = v.v2Status || VIOLATION_STATUS_V2.OPEN;
    byViolationStatus[s] = (byViolationStatus[s] || 0) + 1;
  }

  let totalCompensation = 0;
  for (const v of violations) {
    if (v.compensationAmount) totalCompensation += v.compensationAmount;
  }

  const activeOrgs = new Set();
  for (const c of contracts) {
    if (c.status === SLA_STATUS_V2.ACTIVE) activeOrgs.add(c.orgId);
  }

  return {
    totalContracts: contracts.length,
    activeContracts: byStatus[SLA_STATUS_V2.ACTIVE] || 0,
    activeOrgs: activeOrgs.size,
    maxActiveSlasPerOrg: _maxActiveSlasPerOrg,
    byStatus,
    byTier,
    violations: {
      total: violations.length,
      byTerm,
      bySeverity,
      byStatus: byViolationStatus,
      totalCompensation: Number(totalCompensation.toFixed(4)),
    },
  };
}

// =====================================================================
// sla-manager V2 governance overlay (iter16)
// =====================================================================
export const SLAGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  BREACHED: "breached",
  ARCHIVED: "archived",
});
export const SLAGOV_MEASUREMENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  MEASURING: "measuring",
  MEASURED: "measured",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _slagovPTrans = new Map([
  [
    SLAGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SLAGOV_PROFILE_MATURITY_V2.ACTIVE,
      SLAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SLAGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SLAGOV_PROFILE_MATURITY_V2.BREACHED,
      SLAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SLAGOV_PROFILE_MATURITY_V2.BREACHED,
    new Set([
      SLAGOV_PROFILE_MATURITY_V2.ACTIVE,
      SLAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SLAGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _slagovPTerminal = new Set([SLAGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _slagovJTrans = new Map([
  [
    SLAGOV_MEASUREMENT_LIFECYCLE_V2.QUEUED,
    new Set([
      SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING,
      SLAGOV_MEASUREMENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING,
    new Set([
      SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURED,
      SLAGOV_MEASUREMENT_LIFECYCLE_V2.FAILED,
      SLAGOV_MEASUREMENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURED, new Set()],
  [SLAGOV_MEASUREMENT_LIFECYCLE_V2.FAILED, new Set()],
  [SLAGOV_MEASUREMENT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _slagovPsV2 = new Map();
const _slagovJsV2 = new Map();
let _slagovMaxActive = 8,
  _slagovMaxPending = 20,
  _slagovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _slagovStuckMs = 60 * 1000;
function _slagovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _slagovCheckP(from, to) {
  const a = _slagovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid slagov profile transition ${from} → ${to}`);
}
function _slagovCheckJ(from, to) {
  const a = _slagovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid slagov measurement transition ${from} → ${to}`);
}
function _slagovCountActive(owner) {
  let c = 0;
  for (const p of _slagovPsV2.values())
    if (p.owner === owner && p.status === SLAGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _slagovCountPending(profileId) {
  let c = 0;
  for (const j of _slagovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SLAGOV_MEASUREMENT_LIFECYCLE_V2.QUEUED ||
        j.status === SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING)
    )
      c++;
  return c;
}
export function setMaxActiveSlagovProfilesPerOwnerV2(n) {
  _slagovMaxActive = _slagovPos(n, "maxActiveSlagovProfilesPerOwner");
}
export function getMaxActiveSlagovProfilesPerOwnerV2() {
  return _slagovMaxActive;
}
export function setMaxPendingSlagovMeasurementsPerProfileV2(n) {
  _slagovMaxPending = _slagovPos(n, "maxPendingSlagovMeasurementsPerProfile");
}
export function getMaxPendingSlagovMeasurementsPerProfileV2() {
  return _slagovMaxPending;
}
export function setSlagovProfileIdleMsV2(n) {
  _slagovIdleMs = _slagovPos(n, "slagovProfileIdleMs");
}
export function getSlagovProfileIdleMsV2() {
  return _slagovIdleMs;
}
export function setSlagovMeasurementStuckMsV2(n) {
  _slagovStuckMs = _slagovPos(n, "slagovMeasurementStuckMs");
}
export function getSlagovMeasurementStuckMsV2() {
  return _slagovStuckMs;
}
export function _resetStateSlaManagerV2() {
  _slagovPsV2.clear();
  _slagovJsV2.clear();
  _slagovMaxActive = 8;
  _slagovMaxPending = 20;
  _slagovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _slagovStuckMs = 60 * 1000;
}
export function registerSlagovProfileV2({ id, owner, tier, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_slagovPsV2.has(id))
    throw new Error(`slagov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    tier: tier || "standard",
    status: SLAGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _slagovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSlagovProfileV2(id) {
  const p = _slagovPsV2.get(id);
  if (!p) throw new Error(`slagov profile ${id} not found`);
  const isInitial = p.status === SLAGOV_PROFILE_MATURITY_V2.PENDING;
  _slagovCheckP(p.status, SLAGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _slagovCountActive(p.owner) >= _slagovMaxActive)
    throw new Error(`max active slagov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SLAGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function breachSlagovProfileV2(id) {
  const p = _slagovPsV2.get(id);
  if (!p) throw new Error(`slagov profile ${id} not found`);
  _slagovCheckP(p.status, SLAGOV_PROFILE_MATURITY_V2.BREACHED);
  p.status = SLAGOV_PROFILE_MATURITY_V2.BREACHED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSlagovProfileV2(id) {
  const p = _slagovPsV2.get(id);
  if (!p) throw new Error(`slagov profile ${id} not found`);
  _slagovCheckP(p.status, SLAGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SLAGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSlagovProfileV2(id) {
  const p = _slagovPsV2.get(id);
  if (!p) throw new Error(`slagov profile ${id} not found`);
  if (_slagovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal slagov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSlagovProfileV2(id) {
  const p = _slagovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSlagovProfilesV2() {
  return [..._slagovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSlagovMeasurementV2({
  id,
  profileId,
  metric,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_slagovJsV2.has(id))
    throw new Error(`slagov measurement ${id} already exists`);
  if (!_slagovPsV2.has(profileId))
    throw new Error(`slagov profile ${profileId} not found`);
  if (_slagovCountPending(profileId) >= _slagovMaxPending)
    throw new Error(
      `max pending slagov measurements for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    metric: metric || "",
    status: SLAGOV_MEASUREMENT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _slagovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function measuringSlagovMeasurementV2(id) {
  const j = _slagovJsV2.get(id);
  if (!j) throw new Error(`slagov measurement ${id} not found`);
  _slagovCheckJ(j.status, SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING);
  const now = Date.now();
  j.status = SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeMeasurementSlagovV2(id) {
  const j = _slagovJsV2.get(id);
  if (!j) throw new Error(`slagov measurement ${id} not found`);
  _slagovCheckJ(j.status, SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURED);
  const now = Date.now();
  j.status = SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSlagovMeasurementV2(id, reason) {
  const j = _slagovJsV2.get(id);
  if (!j) throw new Error(`slagov measurement ${id} not found`);
  _slagovCheckJ(j.status, SLAGOV_MEASUREMENT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SLAGOV_MEASUREMENT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSlagovMeasurementV2(id, reason) {
  const j = _slagovJsV2.get(id);
  if (!j) throw new Error(`slagov measurement ${id} not found`);
  _slagovCheckJ(j.status, SLAGOV_MEASUREMENT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SLAGOV_MEASUREMENT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSlagovMeasurementV2(id) {
  const j = _slagovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSlagovMeasurementsV2() {
  return [..._slagovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoBreachIdleSlagovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _slagovPsV2.values())
    if (
      p.status === SLAGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _slagovIdleMs
    ) {
      p.status = SLAGOV_PROFILE_MATURITY_V2.BREACHED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSlagovMeasurementsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _slagovJsV2.values())
    if (
      j.status === SLAGOV_MEASUREMENT_LIFECYCLE_V2.MEASURING &&
      j.startedAt != null &&
      t - j.startedAt >= _slagovStuckMs
    ) {
      j.status = SLAGOV_MEASUREMENT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSlaManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SLAGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _slagovPsV2.values()) profilesByStatus[p.status]++;
  const measurementsByStatus = {};
  for (const v of Object.values(SLAGOV_MEASUREMENT_LIFECYCLE_V2))
    measurementsByStatus[v] = 0;
  for (const j of _slagovJsV2.values()) measurementsByStatus[j.status]++;
  return {
    totalSlagovProfilesV2: _slagovPsV2.size,
    totalSlagovMeasurementsV2: _slagovJsV2.size,
    maxActiveSlagovProfilesPerOwner: _slagovMaxActive,
    maxPendingSlagovMeasurementsPerProfile: _slagovMaxPending,
    slagovProfileIdleMs: _slagovIdleMs,
    slagovMeasurementStuckMs: _slagovStuckMs,
    profilesByStatus,
    measurementsByStatus,
  };
}
