/**
 * Tenant SaaS — CLI port of Phase 97 多租户SaaS引擎
 * (docs/design/modules/62_多租户SaaS引擎.md).
 *
 * The Desktop build drives multi-tenancy with database-level isolation
 * (separate SQLite file per tenant under `db_path`), subdomain routing,
 * and a billing UI integrated with payment gateways. The CLI can't host
 * subdomain routing or payment collection, so this port ships the
 * tractable scaffolding:
 *
 *   - TenantStore: create/configure/list/show/delete (soft by default).
 *   - UsageStore: record + aggregate by period + metric.
 *   - SubscriptionStore: create / get-active / cancel / list.
 *   - Plan catalog: 4 tiers (free / starter / pro / enterprise) with quotas.
 *   - Quota check: compares current-period usage against active-plan limits.
 *   - Import/Export: JSON snapshot of tenant + subs + usage.
 *   - Stats: per-plan distribution, totals per metric.
 *
 * What does NOT port: physical per-tenant database files (Desktop uses
 * `db_path` — CLI uses logical `tenant_id` columns instead), subdomain
 * routing, payment gateway integration, tenant admin dashboard.
 */

import crypto from "crypto";

/* ── Plan Catalog ──────────────────────────────────────────── */

// Quotas copied from design doc §2.2. Enterprise uses Number.POSITIVE_INFINITY
// to mean "unlimited" — exported as null in JSON-facing results.
export const PLANS = Object.freeze({
  free: Object.freeze({
    id: "free",
    name: "Free",
    monthlyFee: 0,
    quotas: Object.freeze({
      api_calls: 1000,
      storage_bytes: 100 * 1024 * 1024, // 100 MB
      ai_requests: 50,
    }),
    features: Object.freeze(["basic"]),
  }),
  starter: Object.freeze({
    id: "starter",
    name: "Starter",
    monthlyFee: 99,
    quotas: Object.freeze({
      api_calls: 10000,
      storage_bytes: 1024 * 1024 * 1024, // 1 GB
      ai_requests: 500,
    }),
    features: Object.freeze(["basic", "collaboration"]),
  }),
  pro: Object.freeze({
    id: "pro",
    name: "Pro",
    monthlyFee: 399,
    quotas: Object.freeze({
      api_calls: 100000,
      storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
      ai_requests: 5000,
    }),
    features: Object.freeze([
      "basic",
      "collaboration",
      "advanced_analytics",
      "custom_domain",
    ]),
  }),
  enterprise: Object.freeze({
    id: "enterprise",
    name: "Enterprise",
    monthlyFee: null, // custom
    quotas: Object.freeze({
      api_calls: Number.POSITIVE_INFINITY,
      storage_bytes: Number.POSITIVE_INFINITY,
      ai_requests: Number.POSITIVE_INFINITY,
    }),
    features: Object.freeze([
      "basic",
      "collaboration",
      "advanced_analytics",
      "custom_domain",
      "sso",
      "sla",
      "priority_support",
    ]),
  }),
});

export const METRICS = Object.freeze({
  api_calls: Object.freeze({
    id: "api_calls",
    name: "API Calls",
    unit: "calls",
  }),
  storage_bytes: Object.freeze({
    id: "storage_bytes",
    name: "Storage",
    unit: "bytes",
  }),
  ai_requests: Object.freeze({
    id: "ai_requests",
    name: "AI Requests",
    unit: "requests",
  }),
});

export const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  PAST_DUE: "past_due",
});

/* ── State ─────────────────────────────────────────────────── */

const _tenants = new Map(); // id → tenant
const _subscriptions = new Map(); // id → subscription
const _usage = new Map(); // id → usage record
// Secondary indexes
const _slugIndex = new Map(); // slug → tenantId
const _tenantSubs = new Map(); // tenantId → Set<subscriptionId>
const _tenantUsage = new Map(); // tenantId → Set<usageId>
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureTenantTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS saas_tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      config TEXT,
      status TEXT DEFAULT 'active',
      plan TEXT DEFAULT 'free',
      db_path TEXT,
      owner_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS saas_usage (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      period TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      started_at INTEGER NOT NULL,
      expires_at INTEGER,
      cancelled_at INTEGER,
      payment_method TEXT,
      amount REAL,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_tenants_slug ON saas_tenants(slug)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_tenants_status ON saas_tenants(status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_usage_tenant ON saas_usage(tenant_id, period)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_usage_metric ON saas_usage(metric, period)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_sub_tenant ON saas_subscriptions(tenant_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_saas_sub_status ON saas_subscriptions(status)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

function _cloneQuotas(quotas) {
  const out = {};
  for (const [key, value] of Object.entries(quotas)) {
    // Infinity is not JSON-safe — emit as null for external consumers.
    out[key] = value === Number.POSITIVE_INFINITY ? null : value;
  }
  return out;
}

export function listPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    monthlyFee: p.monthlyFee,
    quotas: _cloneQuotas(p.quotas),
    features: [...p.features],
  }));
}

export function getPlan(planId) {
  const p = PLANS[planId];
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    monthlyFee: p.monthlyFee,
    quotas: _cloneQuotas(p.quotas),
    features: [...p.features],
  };
}

export function listMetrics() {
  return Object.values(METRICS).map((m) => ({ ...m }));
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

function _periodForNow(now) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/* ── Tenants ───────────────────────────────────────────────── */

function _persistTenant(db, tenant) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO saas_tenants
     (id, name, slug, config, status, plan, db_path, owner_id,
      created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tenant.id,
    tenant.name,
    tenant.slug,
    tenant.config ? JSON.stringify(tenant.config) : null,
    tenant.status,
    tenant.plan,
    tenant.dbPath || null,
    tenant.ownerId || null,
    tenant.createdAt,
    tenant.updatedAt,
    tenant.deletedAt || null,
  );
}

export function createTenant(db, config = {}) {
  const name = String(config.name || "").trim();
  if (!name) throw new Error("tenant name is required");

  const slug = String(config.slug || "").trim();
  if (!slug) throw new Error("tenant slug is required");
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
    throw new Error(
      "tenant slug must be lowercase alphanumeric with optional hyphens",
    );
  }
  if (_slugIndex.has(slug)) {
    throw new Error(`Tenant slug already exists: ${slug}`);
  }

  const plan = String(config.plan || "free");
  if (!PLANS[plan]) {
    throw new Error(`Unknown plan: ${plan}`);
  }

  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  if (_tenants.has(id)) {
    throw new Error(`Tenant already exists: ${id}`);
  }

  const tenant = {
    id,
    name,
    slug,
    config: config.config || null,
    status: TENANT_STATUS.ACTIVE,
    plan,
    dbPath: config.dbPath || null,
    ownerId: config.ownerId || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    _seq: ++_seq,
  };
  _tenants.set(id, tenant);
  _slugIndex.set(slug, id);
  _tenantSubs.set(id, new Set());
  _tenantUsage.set(id, new Set());
  _persistTenant(db, tenant);
  return _strip(tenant);
}

export function configureTenant(db, id, updates = {}) {
  const tenant = _tenants.get(String(id || ""));
  if (!tenant) throw new Error(`Tenant not found: ${id}`);
  if (tenant.status === TENANT_STATUS.DELETED) {
    throw new Error(`Cannot configure deleted tenant: ${id}`);
  }

  const now = Number(updates.now ?? Date.now());
  if ("config" in updates) {
    tenant.config = updates.config || null;
  }
  if ("status" in updates && updates.status !== undefined) {
    const status = String(updates.status);
    if (!Object.values(TENANT_STATUS).includes(status)) {
      throw new Error(`Unknown tenant status: ${status}`);
    }
    tenant.status = status;
  }
  if ("plan" in updates && updates.plan !== undefined) {
    const plan = String(updates.plan);
    if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);
    tenant.plan = plan;
  }
  if ("name" in updates && updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name) throw new Error("tenant name cannot be empty");
    tenant.name = name;
  }
  tenant.updatedAt = now;
  _persistTenant(db, tenant);
  return _strip(tenant);
}

export function getTenant(id) {
  const t = _tenants.get(String(id || ""));
  return t ? _strip(t) : null;
}

export function getTenantBySlug(slug) {
  const id = _slugIndex.get(String(slug || ""));
  return id ? getTenant(id) : null;
}

export function listTenants(options = {}) {
  const rows = Array.from(_tenants.values());
  let filtered = rows;
  if (options.status) {
    filtered = filtered.filter((t) => t.status === options.status);
  }
  if (options.plan) {
    filtered = filtered.filter((t) => t.plan === options.plan);
  }
  if (options.ownerSubstr) {
    const needle = String(options.ownerSubstr).toLowerCase();
    filtered = filtered.filter((t) =>
      (t.ownerId || "").toLowerCase().includes(needle),
    );
  }
  filtered.sort((a, b) => a._seq - b._seq);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : filtered.length;
  return filtered.slice(0, limit).map(_strip);
}

export function deleteTenant(db, id, options = {}) {
  const tenant = _tenants.get(String(id || ""));
  if (!tenant) throw new Error(`Tenant not found: ${id}`);

  const now = Number(options.now ?? Date.now());
  if (options.hardDelete) {
    _tenants.delete(tenant.id);
    _slugIndex.delete(tenant.slug);
    // Cascade remove subscriptions + usage
    const subs = _tenantSubs.get(tenant.id) || new Set();
    for (const sid of subs) _subscriptions.delete(sid);
    _tenantSubs.delete(tenant.id);
    const usage = _tenantUsage.get(tenant.id) || new Set();
    for (const uid of usage) _usage.delete(uid);
    _tenantUsage.delete(tenant.id);
    if (db) {
      db.prepare("DELETE FROM saas_tenants WHERE id = ?").run(tenant.id);
      db.prepare("DELETE FROM saas_subscriptions WHERE tenant_id = ?").run(
        tenant.id,
      );
      db.prepare("DELETE FROM saas_usage WHERE tenant_id = ?").run(tenant.id);
    }
    return { deleted: true, hard: true, tenantId: tenant.id };
  }

  tenant.status = TENANT_STATUS.DELETED;
  tenant.deletedAt = now;
  tenant.updatedAt = now;
  _persistTenant(db, tenant);
  return { deleted: true, hard: false, tenantId: tenant.id, deletedAt: now };
}

/* ── Usage ─────────────────────────────────────────────────── */

function _persistUsage(db, record) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO saas_usage
     (id, tenant_id, metric, value, period, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.tenantId,
    record.metric,
    record.value,
    record.period,
    record.recordedAt,
  );
}

export function recordUsage(db, tenantId, metric, value, options = {}) {
  const tenant = _tenants.get(String(tenantId || ""));
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  if (!METRICS[metric]) {
    throw new Error(
      `Unknown metric: ${metric} (expected ${Object.keys(METRICS).join(" | ")})`,
    );
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Usage value must be a non-negative finite number`);
  }

  const now = Number(options.now ?? Date.now());
  const period = options.period || _periodForNow(now);
  const id = options.id || crypto.randomUUID();

  const record = {
    id,
    tenantId: tenant.id,
    metric,
    value: numeric,
    period,
    recordedAt: now,
    _seq: ++_seq,
  };
  _usage.set(id, record);
  if (!_tenantUsage.has(tenant.id)) _tenantUsage.set(tenant.id, new Set());
  _tenantUsage.get(tenant.id).add(id);
  _persistUsage(db, record);
  return _strip(record);
}

export function getUsage(tenantId, options = {}) {
  const tenant = _tenants.get(String(tenantId || ""));
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const ids = _tenantUsage.get(tenant.id) || new Set();
  const rows = Array.from(ids)
    .map((uid) => _usage.get(uid))
    .filter(Boolean);

  const filtered = rows.filter((r) => {
    if (options.period && r.period !== options.period) return false;
    if (options.metric && r.metric !== options.metric) return false;
    return true;
  });

  // Aggregate by metric
  const byMetric = {};
  for (const metricId of Object.keys(METRICS)) {
    byMetric[metricId] = 0;
  }
  for (const r of filtered) {
    byMetric[r.metric] = (byMetric[r.metric] || 0) + r.value;
  }

  return {
    tenantId: tenant.id,
    period: options.period || null,
    byMetric,
    recordCount: filtered.length,
  };
}

export function listUsage(options = {}) {
  const rows = Array.from(_usage.values());
  let filtered = rows;
  if (options.tenantId) {
    filtered = filtered.filter((r) => r.tenantId === options.tenantId);
  }
  if (options.metric) {
    filtered = filtered.filter((r) => r.metric === options.metric);
  }
  if (options.period) {
    filtered = filtered.filter((r) => r.period === options.period);
  }
  filtered.sort((a, b) => b.recordedAt - a.recordedAt);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : filtered.length;
  return filtered.slice(0, limit).map(_strip);
}

/* ── Subscriptions ─────────────────────────────────────────── */

function _persistSubscription(db, sub) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO saas_subscriptions
     (id, tenant_id, plan, status, started_at, expires_at, cancelled_at,
      payment_method, amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sub.id,
    sub.tenantId,
    sub.plan,
    sub.status,
    sub.startedAt,
    sub.expiresAt || null,
    sub.cancelledAt || null,
    sub.paymentMethod ? JSON.stringify(sub.paymentMethod) : null,
    sub.amount ?? null,
    sub.createdAt,
  );
}

export function subscribe(db, tenantId, plan, options = {}) {
  const tenant = _tenants.get(String(tenantId || ""));
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (tenant.status === TENANT_STATUS.DELETED) {
    throw new Error(`Cannot subscribe deleted tenant: ${tenantId}`);
  }
  if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);

  const now = Number(options.now ?? Date.now());
  // Cancel any existing active subscription on this tenant (one-at-a-time).
  const existing = getActiveSubscription(tenant.id);
  if (existing) {
    const existingSub = _subscriptions.get(existing.id);
    if (existingSub) {
      existingSub.status = SUBSCRIPTION_STATUS.CANCELLED;
      existingSub.cancelledAt = now;
      _persistSubscription(db, existingSub);
    }
  }

  const id = options.id || crypto.randomUUID();
  const amount =
    options.amount !== undefined
      ? Number(options.amount)
      : PLANS[plan].monthlyFee;
  const durationMs =
    options.durationMs !== undefined
      ? Number(options.durationMs)
      : 30 * 24 * 60 * 60 * 1000; // 30 days default
  const expiresAt = durationMs > 0 ? now + durationMs : null;

  const sub = {
    id,
    tenantId: tenant.id,
    plan,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    startedAt: now,
    expiresAt,
    cancelledAt: null,
    paymentMethod: options.paymentMethod || null,
    amount,
    createdAt: now,
    _seq: ++_seq,
  };
  _subscriptions.set(id, sub);
  if (!_tenantSubs.has(tenant.id)) _tenantSubs.set(tenant.id, new Set());
  _tenantSubs.get(tenant.id).add(id);

  // Keep tenant.plan in sync with the active subscription.
  tenant.plan = plan;
  tenant.updatedAt = now;
  _persistTenant(db, tenant);
  _persistSubscription(db, sub);
  return _strip(sub);
}

export function getActiveSubscription(tenantId) {
  const ids = _tenantSubs.get(String(tenantId || "")) || new Set();
  const active = Array.from(ids)
    .map((sid) => _subscriptions.get(sid))
    .filter((s) => s && s.status === SUBSCRIPTION_STATUS.ACTIVE)
    .sort((a, b) => b.startedAt - a.startedAt);
  return active.length ? _strip(active[0]) : null;
}

export function cancelSubscription(db, tenantId, options = {}) {
  const active = getActiveSubscription(tenantId);
  if (!active) {
    throw new Error(`No active subscription for tenant: ${tenantId}`);
  }
  const sub = _subscriptions.get(active.id);
  const now = Number(options.now ?? Date.now());
  sub.status = SUBSCRIPTION_STATUS.CANCELLED;
  sub.cancelledAt = now;
  _persistSubscription(db, sub);
  return _strip(sub);
}

export function listSubscriptions(options = {}) {
  const rows = Array.from(_subscriptions.values());
  let filtered = rows;
  if (options.tenantId) {
    filtered = filtered.filter((s) => s.tenantId === options.tenantId);
  }
  if (options.status) {
    filtered = filtered.filter((s) => s.status === options.status);
  }
  if (options.plan) {
    filtered = filtered.filter((s) => s.plan === options.plan);
  }
  filtered.sort((a, b) => b.startedAt - a.startedAt);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : filtered.length;
  return filtered.slice(0, limit).map(_strip);
}

/* ── Quota Check ───────────────────────────────────────────── */

export function checkQuota(tenantId, metric, options = {}) {
  const tenant = _tenants.get(String(tenantId || ""));
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (!METRICS[metric]) {
    throw new Error(`Unknown metric: ${metric}`);
  }

  const plan = PLANS[tenant.plan] || PLANS.free;
  const limit = plan.quotas[metric];
  const now = Number(options.now ?? Date.now());
  const period = options.period || _periodForNow(now);

  const usage = getUsage(tenant.id, { period, metric });
  const used = usage.byMetric[metric] || 0;

  const isUnlimited = limit === Number.POSITIVE_INFINITY;
  return {
    tenantId: tenant.id,
    plan: tenant.plan,
    metric,
    period,
    limit: isUnlimited ? null : limit,
    used,
    remaining: isUnlimited ? null : Math.max(0, limit - used),
    unlimited: isUnlimited,
    exceeded: isUnlimited ? false : used > limit,
  };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getSaasStats() {
  const tenants = Array.from(_tenants.values());
  const byStatus = {};
  for (const status of Object.values(TENANT_STATUS)) byStatus[status] = 0;
  const byPlan = {};
  for (const p of Object.keys(PLANS)) byPlan[p] = 0;
  for (const t of tenants) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPlan[t.plan] = (byPlan[t.plan] || 0) + 1;
  }

  const byMetric = {};
  for (const metricId of Object.keys(METRICS)) byMetric[metricId] = 0;
  for (const record of _usage.values()) {
    byMetric[record.metric] = (byMetric[record.metric] || 0) + record.value;
  }

  const activeSubs = Array.from(_subscriptions.values()).filter(
    (s) => s.status === SUBSCRIPTION_STATUS.ACTIVE,
  ).length;

  return {
    tenantCount: tenants.length,
    byStatus,
    byPlan,
    subscriptionCount: _subscriptions.size,
    activeSubscriptions: activeSubs,
    usageRecordCount: _usage.size,
    totalUsage: byMetric,
  };
}

/* ── Import / Export ───────────────────────────────────────── */

export function exportTenant(tenantId) {
  const tenant = _tenants.get(String(tenantId || ""));
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  return {
    tenant: _strip(tenant),
    subscriptions: listSubscriptions({ tenantId: tenant.id }),
    usage: listUsage({ tenantId: tenant.id }),
    exportedAt: Date.now(),
  };
}

export function importTenant(db, data) {
  if (!data || typeof data !== "object") {
    throw new Error("import data must be an object");
  }
  const { tenant, subscriptions = [], usage = [] } = data;
  if (!tenant || !tenant.name || !tenant.slug) {
    throw new Error("import data must include tenant with name + slug");
  }

  let tenantId = tenant.id;
  let skippedTenant = false;
  if (tenantId && _tenants.has(tenantId)) {
    // Tenant already exists — import is idempotent at tenant level.
    skippedTenant = true;
  } else if (_slugIndex.has(tenant.slug)) {
    // Slug collision — skip tenant, skip all related data.
    return {
      tenantId: null,
      importedSubscriptions: 0,
      importedUsage: 0,
      skippedSubscriptions: subscriptions.length,
      skippedUsage: usage.length,
      skippedTenant: true,
      reason: "slug_collision",
    };
  } else {
    const created = createTenant(db, {
      id: tenantId,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan || "free",
      config: tenant.config || null,
      ownerId: tenant.ownerId || null,
    });
    tenantId = created.id;
  }

  let importedSubs = 0;
  let skippedSubs = 0;
  for (const sub of Array.isArray(subscriptions) ? subscriptions : []) {
    if (!sub || !sub.plan) {
      skippedSubs++;
      continue;
    }
    if (!PLANS[sub.plan]) {
      skippedSubs++;
      continue;
    }
    try {
      const s = subscribe(db, tenantId, sub.plan, {
        amount: sub.amount,
        paymentMethod: sub.paymentMethod,
        durationMs:
          sub.expiresAt && sub.startedAt
            ? sub.expiresAt - sub.startedAt
            : undefined,
      });
      if (sub.status && sub.status !== SUBSCRIPTION_STATUS.ACTIVE) {
        const persisted = _subscriptions.get(s.id);
        if (persisted) {
          persisted.status = sub.status;
          persisted.cancelledAt = sub.cancelledAt || null;
          _persistSubscription(db, persisted);
        }
      }
      importedSubs++;
    } catch {
      skippedSubs++;
    }
  }

  let importedUsage = 0;
  let skippedUsage = 0;
  for (const record of Array.isArray(usage) ? usage : []) {
    if (!record || !record.metric || record.value === undefined) {
      skippedUsage++;
      continue;
    }
    if (!METRICS[record.metric]) {
      skippedUsage++;
      continue;
    }
    try {
      recordUsage(db, tenantId, record.metric, record.value, {
        period: record.period,
      });
      importedUsage++;
    } catch {
      skippedUsage++;
    }
  }

  return {
    tenantId,
    skippedTenant,
    importedSubscriptions: importedSubs,
    skippedSubscriptions: skippedSubs,
    importedUsage,
    skippedUsage,
  };
}

/* ── Test Helpers ──────────────────────────────────────────── */

export function _resetState() {
  _tenants.clear();
  _subscriptions.clear();
  _usage.clear();
  _slugIndex.clear();
  _tenantSubs.clear();
  _tenantUsage.clear();
  _seq = 0;
}

/* ═══════════════════════════════════════════════════════════════
 * Phase 97 V2 — Tenant Maturity + Subscription Lifecycle
 * Strictly additive. Legacy surface above is preserved.
 * ═════════════════════════════════════════════════════════════ */

export const TENANT_MATURITY_V2 = Object.freeze({
  PROVISIONING: "provisioning",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
  CANCELLED: "cancelled",
});

export const SUBSCRIPTION_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const TENANT_TRANSITIONS_V2 = new Map([
  ["provisioning", new Set(["active", "cancelled"])],
  ["active", new Set(["suspended", "archived", "cancelled"])],
  ["suspended", new Set(["active", "archived", "cancelled"])],
  ["archived", new Set(["active", "cancelled"])],
]);
const TENANT_TERMINALS_V2 = new Set(["cancelled"]);

const SUBSCRIPTION_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "cancelled"])],
  ["active", new Set(["past_due", "cancelled", "expired"])],
  ["past_due", new Set(["active", "cancelled", "expired"])],
]);
const SUBSCRIPTION_TERMINALS_V2 = new Set(["cancelled", "expired"]);

export const SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN = 1000;
export const SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT = 5;
export const SAAS_DEFAULT_TENANT_IDLE_MS = 180 * 86400000; // 180 days
export const SAAS_DEFAULT_PAST_DUE_GRACE_MS = 7 * 86400000; // 7 days

let _maxActiveTenantsPerPlanV2 = SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN;
let _maxSubscriptionsPerTenantV2 = SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT;
let _tenantIdleMsV2 = SAAS_DEFAULT_TENANT_IDLE_MS;
let _pastDueGraceMsV2 = SAAS_DEFAULT_PAST_DUE_GRACE_MS;

const _tenantStatesV2 = new Map(); // tenantId → V2 record
const _subscriptionStatesV2 = new Map(); // subId → V2 record

function _positiveIntV2(n, label) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(num);
}

function _validTenantStatusV2(s) {
  return (
    s === "provisioning" ||
    s === "active" ||
    s === "suspended" ||
    s === "archived" ||
    s === "cancelled"
  );
}

function _validSubscriptionStatusV2(s) {
  return (
    s === "pending" ||
    s === "active" ||
    s === "past_due" ||
    s === "cancelled" ||
    s === "expired"
  );
}

export function getDefaultMaxActiveTenantsPerPlanV2() {
  return SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN;
}
export function getMaxActiveTenantsPerPlanV2() {
  return _maxActiveTenantsPerPlanV2;
}
export function setMaxActiveTenantsPerPlanV2(n) {
  _maxActiveTenantsPerPlanV2 = _positiveIntV2(n, "maxActiveTenantsPerPlan");
  return _maxActiveTenantsPerPlanV2;
}

export function getDefaultMaxSubscriptionsPerTenantV2() {
  return SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT;
}
export function getMaxSubscriptionsPerTenantV2() {
  return _maxSubscriptionsPerTenantV2;
}
export function setMaxSubscriptionsPerTenantV2(n) {
  _maxSubscriptionsPerTenantV2 = _positiveIntV2(n, "maxSubscriptionsPerTenant");
  return _maxSubscriptionsPerTenantV2;
}

export function getDefaultTenantIdleMsV2() {
  return SAAS_DEFAULT_TENANT_IDLE_MS;
}
export function getTenantIdleMsV2() {
  return _tenantIdleMsV2;
}
export function setTenantIdleMsV2(ms) {
  _tenantIdleMsV2 = _positiveIntV2(ms, "tenantIdleMs");
  return _tenantIdleMsV2;
}

export function getDefaultPastDueGraceMsV2() {
  return SAAS_DEFAULT_PAST_DUE_GRACE_MS;
}
export function getPastDueGraceMsV2() {
  return _pastDueGraceMsV2;
}
export function setPastDueGraceMsV2(ms) {
  _pastDueGraceMsV2 = _positiveIntV2(ms, "pastDueGraceMs");
  return _pastDueGraceMsV2;
}

/* ── Tenant V2 ──────────────────────────────────────────────── */

export function registerTenantV2(db, config = {}) {
  void db;
  const tenantId = String(config.tenantId || "").trim();
  if (!tenantId) throw new Error("tenantId is required");
  const plan = String(config.plan || "").trim();
  if (!plan) throw new Error("plan is required");
  if (_tenantStatesV2.has(tenantId)) {
    throw new Error(`Tenant already registered in V2: ${tenantId}`);
  }

  const now = Number(config.now ?? Date.now());
  const initialStatus = config.initialStatus || "provisioning";
  if (!_validTenantStatusV2(initialStatus)) {
    throw new Error(`Invalid initial status: ${initialStatus}`);
  }
  if (TENANT_TERMINALS_V2.has(initialStatus)) {
    throw new Error(
      `Cannot register tenant in terminal status '${initialStatus}'`,
    );
  }

  if (initialStatus === "active") {
    let activeCount = 0;
    for (const rec of _tenantStatesV2.values()) {
      if (rec.plan === plan && rec.status === "active") activeCount += 1;
    }
    if (activeCount >= _maxActiveTenantsPerPlanV2) {
      throw new Error(
        `Max active tenants per plan reached (${_maxActiveTenantsPerPlanV2})`,
      );
    }
  }

  const record = {
    tenantId,
    plan,
    ownerId: config.ownerId ? String(config.ownerId) : null,
    status: initialStatus,
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    reason: null,
  };
  _tenantStatesV2.set(tenantId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getTenantV2(tenantId) {
  const rec = _tenantStatesV2.get(String(tenantId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setTenantMaturityV2(db, tenantId, newStatus, patch = {}) {
  void db;
  const id = String(tenantId || "");
  const record = _tenantStatesV2.get(id);
  if (!record) throw new Error(`Tenant not registered in V2: ${id}`);
  if (!_validTenantStatusV2(newStatus)) {
    throw new Error(`Invalid tenant status: ${newStatus}`);
  }
  if (TENANT_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Tenant is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = TENANT_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }

  if (newStatus === "active" && record.status !== "active") {
    let activeCount = 0;
    for (const rec of _tenantStatesV2.values()) {
      if (rec.plan === record.plan && rec.status === "active") activeCount += 1;
    }
    if (activeCount >= _maxActiveTenantsPerPlanV2) {
      throw new Error(
        `Max active tenants per plan reached (${_maxActiveTenantsPerPlanV2})`,
      );
    }
  }

  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function activateTenant(db, tenantId, reason) {
  return setTenantMaturityV2(db, tenantId, "active", { reason });
}
export function suspendTenant(db, tenantId, reason) {
  return setTenantMaturityV2(db, tenantId, "suspended", { reason });
}
export function archiveTenantV2(db, tenantId, reason) {
  return setTenantMaturityV2(db, tenantId, "archived", { reason });
}
export function cancelTenant(db, tenantId, reason) {
  return setTenantMaturityV2(db, tenantId, "cancelled", { reason });
}

export function touchTenantActivity(tenantId) {
  const rec = _tenantStatesV2.get(String(tenantId || ""));
  if (!rec) throw new Error(`Tenant not registered in V2: ${tenantId}`);
  rec.lastActivityAt = Date.now();
  return { ...rec, metadata: { ...rec.metadata } };
}

/* ── Subscription V2 ────────────────────────────────────────── */

export function registerSubscriptionV2(db, config = {}) {
  void db;
  const subscriptionId = String(config.subscriptionId || "").trim();
  if (!subscriptionId) throw new Error("subscriptionId is required");
  const tenantId = String(config.tenantId || "").trim();
  if (!tenantId) throw new Error("tenantId is required");
  const plan = String(config.plan || "").trim();
  if (!plan) throw new Error("plan is required");

  if (_subscriptionStatesV2.has(subscriptionId)) {
    throw new Error(`Subscription already registered in V2: ${subscriptionId}`);
  }

  const tenant = _tenantStatesV2.get(tenantId);
  if (!tenant) {
    throw new Error(`Tenant not registered in V2: ${tenantId}`);
  }
  if (
    tenant.status === "cancelled" ||
    tenant.status === "archived" ||
    tenant.status === "suspended"
  ) {
    throw new Error(`Tenant is ${tenant.status}, cannot register subscription`);
  }

  let openCount = 0;
  for (const rec of _subscriptionStatesV2.values()) {
    if (
      rec.tenantId === tenantId &&
      !SUBSCRIPTION_TERMINALS_V2.has(rec.status)
    ) {
      openCount += 1;
    }
  }
  if (openCount >= _maxSubscriptionsPerTenantV2) {
    throw new Error(
      `Max subscriptions per tenant reached (${_maxSubscriptionsPerTenantV2})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const record = {
    subscriptionId,
    tenantId,
    plan,
    status: "pending",
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    expiresAt: config.expiresAt ? Number(config.expiresAt) : null,
    pastDueAt: null,
    reason: null,
  };
  _subscriptionStatesV2.set(subscriptionId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getSubscriptionV2(subscriptionId) {
  const rec = _subscriptionStatesV2.get(String(subscriptionId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setSubscriptionStatusV2(
  db,
  subscriptionId,
  newStatus,
  patch = {},
) {
  void db;
  const id = String(subscriptionId || "");
  const record = _subscriptionStatesV2.get(id);
  if (!record) throw new Error(`Subscription not registered in V2: ${id}`);
  if (!_validSubscriptionStatusV2(newStatus)) {
    throw new Error(`Invalid subscription status: ${newStatus}`);
  }
  if (SUBSCRIPTION_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Subscription is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = SUBSCRIPTION_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }
  const now = Number(patch.now ?? Date.now());
  record.status = newStatus;
  record.updatedAt = now;
  if (newStatus === "active" && record.activatedAt === null) {
    record.activatedAt = now;
  }
  if (newStatus === "past_due" && record.pastDueAt === null) {
    record.pastDueAt = now;
  }
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function activateSubscription(db, subscriptionId, reason) {
  return setSubscriptionStatusV2(db, subscriptionId, "active", { reason });
}
export function markSubscriptionPastDue(db, subscriptionId, reason) {
  return setSubscriptionStatusV2(db, subscriptionId, "past_due", { reason });
}
export function cancelSubscriptionV2(db, subscriptionId, reason) {
  return setSubscriptionStatusV2(db, subscriptionId, "cancelled", { reason });
}
export function expireSubscription(db, subscriptionId, reason) {
  return setSubscriptionStatusV2(db, subscriptionId, "expired", { reason });
}

/* ── Counts ─────────────────────────────────────────────────── */

export function getActiveTenantCount(plan) {
  let n = 0;
  for (const rec of _tenantStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (plan !== undefined && rec.plan !== String(plan)) continue;
    n += 1;
  }
  return n;
}

export function getOpenSubscriptionCount(tenantId) {
  let n = 0;
  for (const rec of _subscriptionStatesV2.values()) {
    if (SUBSCRIPTION_TERMINALS_V2.has(rec.status)) continue;
    if (tenantId !== undefined && rec.tenantId !== String(tenantId)) continue;
    n += 1;
  }
  return n;
}

/* ── Auto-flip Bulk Ops ─────────────────────────────────────── */

export function autoArchiveIdleTenants(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _tenantStatesV2.values()) {
    if (rec.status !== "active" && rec.status !== "suspended") continue;
    if (now - rec.lastActivityAt > _tenantIdleMsV2) {
      rec.status = "archived";
      rec.updatedAt = now;
      rec.reason = "idle";
      flipped.push(rec.tenantId);
    }
  }
  return flipped;
}

export function autoExpirePastDueSubscriptions(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _subscriptionStatesV2.values()) {
    if (rec.status !== "past_due") continue;
    const pastDueAt = rec.pastDueAt ?? rec.updatedAt;
    if (now - pastDueAt > _pastDueGraceMsV2) {
      rec.status = "expired";
      rec.updatedAt = now;
      rec.reason = "past_due_grace_expired";
      flipped.push(rec.subscriptionId);
    }
  }
  return flipped;
}

/* ── Stats V2 ───────────────────────────────────────────────── */

export function getSaasStatsV2() {
  const tenantsByStatus = {
    provisioning: 0,
    active: 0,
    suspended: 0,
    archived: 0,
    cancelled: 0,
  };
  const subscriptionsByStatus = {
    pending: 0,
    active: 0,
    past_due: 0,
    cancelled: 0,
    expired: 0,
  };
  for (const rec of _tenantStatesV2.values()) {
    if (tenantsByStatus[rec.status] !== undefined) {
      tenantsByStatus[rec.status] += 1;
    }
  }
  for (const rec of _subscriptionStatesV2.values()) {
    if (subscriptionsByStatus[rec.status] !== undefined) {
      subscriptionsByStatus[rec.status] += 1;
    }
  }
  return {
    totalTenantsV2: _tenantStatesV2.size,
    totalSubscriptionsV2: _subscriptionStatesV2.size,
    maxActiveTenantsPerPlan: _maxActiveTenantsPerPlanV2,
    maxSubscriptionsPerTenant: _maxSubscriptionsPerTenantV2,
    tenantIdleMs: _tenantIdleMsV2,
    pastDueGraceMs: _pastDueGraceMsV2,
    tenantsByStatus,
    subscriptionsByStatus,
  };
}

/* ── Reset V2 (tests) ───────────────────────────────────────── */

export function _resetStateV2() {
  _tenantStatesV2.clear();
  _subscriptionStatesV2.clear();
  _maxActiveTenantsPerPlanV2 = SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN;
  _maxSubscriptionsPerTenantV2 = SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT;
  _tenantIdleMsV2 = SAAS_DEFAULT_TENANT_IDLE_MS;
  _pastDueGraceMsV2 = SAAS_DEFAULT_PAST_DUE_GRACE_MS;
}
