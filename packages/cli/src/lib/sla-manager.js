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
}
