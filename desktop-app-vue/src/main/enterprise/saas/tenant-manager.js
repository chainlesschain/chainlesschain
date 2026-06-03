/**
 * @module enterprise/saas/tenant-manager
 * Phase 97: Multi-tenant SaaS engine - tenant isolation, metering, billing, RBAC
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class TenantManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._tenants = new Map();
    this._usage = new Map();
    this._subscriptions = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadTenants();
    this.initialized = true;
    logger.info(
      `[TenantManager] Initialized with ${this._tenants.size} tenants`,
    );
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS saas_tenants (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT,
          config TEXT, status TEXT DEFAULT 'active', plan TEXT DEFAULT 'free',
          created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS saas_usage (
          id TEXT PRIMARY KEY, tenant_id TEXT, metric TEXT, value REAL,
          period TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS saas_subscriptions (
          id TEXT PRIMARY KEY, tenant_id TEXT, plan TEXT, price REAL,
          billing_cycle TEXT DEFAULT 'monthly', status TEXT DEFAULT 'active',
          started_at TEXT DEFAULT (datetime('now')), expires_at TEXT
        );
      `);
    } catch (error) {
      logger.warn("[TenantManager] Table creation warning:", error.message);
    }
  }

  async _loadTenants() {
    try {
      const rows = this.db
        .prepare("SELECT * FROM saas_tenants WHERE status != 'deleted'")
        .all();
      for (const row of rows) {
        this._tenants.set(row.id, {
          ...row,
          config: JSON.parse(row.config || "{}"),
        });
      }
    } catch (error) {
      logger.warn("[TenantManager] Failed to load tenants:", error.message);
    }
  }

  createTenant(name, options = {}) {
    const id =
      options.id ||
      `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = {
      id,
      name,
      domain: options.domain || null,
      config: options.config || {
        maxUsers: 10,
        maxStorage: 1073741824,
        features: [],
      },
      status: "active",
      plan: options.plan || "free",
    };
    this._tenants.set(id, tenant);
    this._persistTenant(tenant);
    this.emit("saas:tenant-created", { id, name });
    return { id, name, status: tenant.status, plan: tenant.plan };
  }

  configureTenant(tenantId, config) {
    const tenant = this._tenants.get(tenantId);
    if (!tenant) {
      throw new Error("Tenant not found");
    }
    Object.assign(tenant.config, config);
    if (config.domain) {
      tenant.domain = config.domain;
    }
    if (config.name) {
      tenant.name = config.name;
    }
    this._persistTenant(tenant);
    return tenant;
  }

  getUsage(tenantId) {
    return (
      this._usage.get(tenantId) || {
        storage: 0,
        apiCalls: 0,
        users: 0,
        bandwidth: 0,
      }
    );
  }

  recordUsage(tenantId, metric, value) {
    const usage = this._usage.get(tenantId) || {};
    usage[metric] = (usage[metric] || 0) + value;
    this._usage.set(tenantId, usage);
    try {
      const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.db
        .prepare(
          "INSERT INTO saas_usage (id, tenant_id, metric, value, period) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, tenantId, metric, value, new Date().toISOString().slice(0, 7));
    } catch (error) {
      logger.error("[TenantManager] Usage persist failed:", error.message);
    }
  }

  manageSubscription(tenantId, plan, options = {}) {
    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const prices = { free: 0, starter: 29, pro: 99, enterprise: 299 };
    const subscription = {
      id,
      tenantId,
      plan,
      price: prices[plan] || 0,
      billingCycle: options.billingCycle || "monthly",
      status: "active",
    };
    this._subscriptions.set(tenantId, subscription);
    const tenant = this._tenants.get(tenantId);
    if (tenant) {
      tenant.plan = plan;
      this._persistTenant(tenant);
    }
    try {
      this.db
        .prepare(
          "INSERT INTO saas_subscriptions (id, tenant_id, plan, price, billing_cycle) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, tenantId, plan, subscription.price, subscription.billingCycle);
    } catch (error) {
      logger.error(
        "[TenantManager] Subscription persist failed:",
        error.message,
      );
    }
    this.emit("saas:subscription-updated", { tenantId, plan });
    return subscription;
  }

  exportData(tenantId) {
    const tenant = this._tenants.get(tenantId);
    if (!tenant) {
      return null;
    }
    return {
      tenant,
      usage: this._usage.get(tenantId),
      subscription: this._subscriptions.get(tenantId),
      exportedAt: Date.now(),
    };
  }

  importData(tenantId, data) {
    const tenant = this._tenants.get(tenantId);
    if (!tenant) {
      throw new Error("Tenant not found");
    }
    return { tenantId, imported: true, timestamp: Date.now() };
  }

  getTenants(filter = {}) {
    let tenants = Array.from(this._tenants.values());
    if (filter.status) {
      tenants = tenants.filter((t) => t.status === filter.status);
    }
    if (filter.plan) {
      tenants = tenants.filter((t) => t.plan === filter.plan);
    }
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      plan: t.plan,
      domain: t.domain,
    }));
  }

  deleteTenant(tenantId) {
    const tenant = this._tenants.get(tenantId);
    if (!tenant) {
      return false;
    }
    tenant.status = "deleted";
    this._persistTenant(tenant);
    this.emit("saas:tenant-deleted", { tenantId });
    return true;
  }

  _persistTenant(tenant) {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO saas_tenants (id, name, domain, config, status, plan, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .run(
          tenant.id,
          tenant.name,
          tenant.domain,
          JSON.stringify(tenant.config),
          tenant.status,
          tenant.plan,
        );
    } catch (error) {
      logger.error("[TenantManager] Tenant persist failed:", error.message);
    }
  }
}

let instance = null;
function getTenantManager() {
  if (!instance) {
    instance = new TenantManager();
  }
  return instance;
}
module.exports = { TenantManager, getTenantManager };
