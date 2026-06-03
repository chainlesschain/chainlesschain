/**
 * Unit tests for tenant-saas (Phase 97 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  TENANT_MATURITY_V2,
  SUBSCRIPTION_LIFECYCLE_V2,
  SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN,
  SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT,
  SAAS_DEFAULT_TENANT_IDLE_MS,
  SAAS_DEFAULT_PAST_DUE_GRACE_MS,
  getDefaultMaxActiveTenantsPerPlanV2,
  getMaxActiveTenantsPerPlanV2,
  setMaxActiveTenantsPerPlanV2,
  getDefaultMaxSubscriptionsPerTenantV2,
  getMaxSubscriptionsPerTenantV2,
  setMaxSubscriptionsPerTenantV2,
  getDefaultTenantIdleMsV2,
  getTenantIdleMsV2,
  setTenantIdleMsV2,
  getDefaultPastDueGraceMsV2,
  getPastDueGraceMsV2,
  setPastDueGraceMsV2,
  registerTenantV2,
  getTenantV2,
  setTenantMaturityV2,
  activateTenant,
  suspendTenant,
  archiveTenantV2,
  cancelTenant,
  touchTenantActivity,
  registerSubscriptionV2,
  getSubscriptionV2,
  setSubscriptionStatusV2,
  activateSubscription,
  markSubscriptionPastDue,
  cancelSubscriptionV2,
  expireSubscription,
  getActiveTenantCount,
  getOpenSubscriptionCount,
  autoArchiveIdleTenants,
  autoExpirePastDueSubscriptions,
  getSaasStatsV2,
  _resetStateV2,
  ensureTenantTables,
  listPlans,
  getPlan,
  listMetrics,
  createTenant,
  configureTenant,
  getTenant,
  getTenantBySlug,
  listTenants,
  deleteTenant,
  recordUsage,
  getUsage,
  listUsage,
  subscribe,
  getActiveSubscription,
  cancelSubscription,
  listSubscriptions,
  checkQuota,
  getSaasStats,
  exportTenant,
  importTenant,
  PLANS,
  METRICS,
  TENANT_STATUS,
  SUBSCRIPTION_STATUS,
  _resetState,
} from "../../src/lib/tenant-saas.js";

describe("tenant-saas", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureTenantTables(db);
  });

  /* ── Schema / catalogs ─────────────────────────────────────── */

  describe("ensureTenantTables", () => {
    it("creates saas_tenants + saas_usage + saas_subscriptions tables", () => {
      expect(db.tables.has("saas_tenants")).toBe(true);
      expect(db.tables.has("saas_usage")).toBe(true);
      expect(db.tables.has("saas_subscriptions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureTenantTables(db);
      ensureTenantTables(db);
      expect(db.tables.has("saas_tenants")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureTenantTables(null)).not.toThrow();
    });
  });

  describe("Catalogs", () => {
    it("lists 4 standard plans", () => {
      const plans = listPlans();
      expect(plans).toHaveLength(4);
      const ids = plans.map((p) => p.id);
      expect(ids).toEqual(["free", "starter", "pro", "enterprise"]);
    });

    it("free plan has zero monthly fee", () => {
      const free = getPlan("free");
      expect(free.monthlyFee).toBe(0);
      expect(free.quotas.api_calls).toBe(1000);
    });

    it("enterprise plan has null monthlyFee and null unlimited quotas", () => {
      const ent = getPlan("enterprise");
      expect(ent.monthlyFee).toBeNull();
      // JSON-safe: Infinity → null
      expect(ent.quotas.api_calls).toBeNull();
      expect(ent.quotas.storage_bytes).toBeNull();
      expect(ent.quotas.ai_requests).toBeNull();
    });

    it("returns null for unknown plan", () => {
      expect(getPlan("diamond")).toBeNull();
    });

    it("lists 3 standard metrics", () => {
      const metrics = listMetrics();
      expect(metrics).toHaveLength(3);
      const ids = metrics.map((m) => m.id);
      expect(ids).toEqual(["api_calls", "storage_bytes", "ai_requests"]);
    });

    it("PLANS and METRICS are frozen", () => {
      expect(Object.isFrozen(PLANS)).toBe(true);
      expect(Object.isFrozen(METRICS)).toBe(true);
    });
  });

  /* ── createTenant ─────────────────────────────────────────── */

  describe("createTenant", () => {
    it("creates a tenant with defaults", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(t.id).toBeTruthy();
      expect(t.name).toBe("Acme");
      expect(t.slug).toBe("acme");
      expect(t.plan).toBe("free");
      expect(t.status).toBe(TENANT_STATUS.ACTIVE);
      expect(t.deletedAt).toBeNull();
    });

    it("accepts a custom plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme", plan: "pro" });
      expect(t.plan).toBe("pro");
    });

    it("persists to database", () => {
      createTenant(db, { name: "Acme", slug: "acme" });
      const rows = db.data.get("saas_tenants");
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Acme");
    });

    it("rejects blank name", () => {
      expect(() => createTenant(db, { name: "", slug: "acme" })).toThrow(
        /name is required/,
      );
    });

    it("rejects blank slug", () => {
      expect(() => createTenant(db, { name: "Acme", slug: "" })).toThrow(
        /slug is required/,
      );
    });

    it("rejects invalid slug characters", () => {
      expect(() =>
        createTenant(db, { name: "Acme", slug: "Acme Corp" }),
      ).toThrow(/slug must be lowercase/);
      expect(() => createTenant(db, { name: "Acme", slug: "-acme" })).toThrow(
        /slug must be/,
      );
      expect(() => createTenant(db, { name: "Acme", slug: "acme!" })).toThrow(
        /slug must be/,
      );
    });

    it("accepts valid slugs", () => {
      expect(() => createTenant(db, { name: "A", slug: "a" })).not.toThrow();
      expect(() =>
        createTenant(db, { name: "B", slug: "my-corp-1" }),
      ).not.toThrow();
    });

    it("rejects duplicate slug", () => {
      createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => createTenant(db, { name: "Other", slug: "acme" })).toThrow(
        /slug already exists/,
      );
    });

    it("rejects unknown plan", () => {
      expect(() =>
        createTenant(db, { name: "Acme", slug: "acme", plan: "diamond" }),
      ).toThrow(/Unknown plan/);
    });

    it("stores owner and config", () => {
      const t = createTenant(db, {
        name: "Acme",
        slug: "acme",
        ownerId: "user-1",
        config: { theme: "dark" },
      });
      expect(t.ownerId).toBe("user-1");
      expect(t.config).toEqual({ theme: "dark" });
    });
  });

  /* ── configureTenant ──────────────────────────────────────── */

  describe("configureTenant", () => {
    it("updates config", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const updated = configureTenant(db, t.id, { config: { theme: "light" } });
      expect(updated.config).toEqual({ theme: "light" });
      expect(updated.updatedAt).toBeGreaterThanOrEqual(t.createdAt);
    });

    it("updates plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const updated = configureTenant(db, t.id, { plan: "starter" });
      expect(updated.plan).toBe("starter");
    });

    it("updates status", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const updated = configureTenant(db, t.id, { status: "suspended" });
      expect(updated.status).toBe("suspended");
    });

    it("rejects unknown tenant", () => {
      expect(() => configureTenant(db, "nope", { plan: "pro" })).toThrow(
        /not found/,
      );
    });

    it("rejects unknown plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => configureTenant(db, t.id, { plan: "diamond" })).toThrow(
        /Unknown plan/,
      );
    });

    it("rejects unknown status", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => configureTenant(db, t.id, { status: "frozen" })).toThrow(
        /Unknown tenant status/,
      );
    });

    it("rejects configuring a deleted tenant", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      deleteTenant(db, t.id);
      expect(() => configureTenant(db, t.id, { plan: "pro" })).toThrow(
        /deleted/,
      );
    });
  });

  /* ── getTenant / listTenants ─────────────────────────────── */

  describe("getTenant / listTenants / getTenantBySlug", () => {
    it("returns null when tenant missing", () => {
      expect(getTenant("nope")).toBeNull();
      expect(getTenantBySlug("nope")).toBeNull();
    });

    it("finds tenant by slug", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(getTenantBySlug("acme").id).toBe(t.id);
    });

    it("lists all tenants sorted by creation order", () => {
      createTenant(db, { name: "A", slug: "a" });
      createTenant(db, { name: "B", slug: "b" });
      createTenant(db, { name: "C", slug: "c" });
      const list = listTenants();
      expect(list.map((t) => t.slug)).toEqual(["a", "b", "c"]);
    });

    it("filters by status", () => {
      const a = createTenant(db, { name: "A", slug: "a" });
      createTenant(db, { name: "B", slug: "b" });
      deleteTenant(db, a.id);
      const active = listTenants({ status: "active" });
      expect(active.map((t) => t.slug)).toEqual(["b"]);
    });

    it("filters by plan", () => {
      createTenant(db, { name: "A", slug: "a", plan: "pro" });
      createTenant(db, { name: "B", slug: "b", plan: "free" });
      const pros = listTenants({ plan: "pro" });
      expect(pros.map((t) => t.slug)).toEqual(["a"]);
    });

    it("filters by owner substring", () => {
      createTenant(db, { name: "A", slug: "a", ownerId: "alice-01" });
      createTenant(db, { name: "B", slug: "b", ownerId: "bob-02" });
      const list = listTenants({ ownerSubstr: "alice" });
      expect(list.map((t) => t.slug)).toEqual(["a"]);
    });

    it("honors limit", () => {
      for (let i = 0; i < 5; i++) {
        createTenant(db, { name: `T${i}`, slug: `t-${i}` });
      }
      expect(listTenants({ limit: 2 })).toHaveLength(2);
    });
  });

  /* ── deleteTenant ─────────────────────────────────────────── */

  describe("deleteTenant", () => {
    it("soft-deletes by default", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const result = deleteTenant(db, t.id);
      expect(result.deleted).toBe(true);
      expect(result.hard).toBe(false);
      expect(getTenant(t.id).status).toBe(TENANT_STATUS.DELETED);
      expect(getTenant(t.id).deletedAt).toBeTruthy();
    });

    it("hard-deletes and cascades subscriptions + usage", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "pro");
      recordUsage(db, t.id, "api_calls", 100);
      deleteTenant(db, t.id, { hardDelete: true });
      expect(getTenant(t.id)).toBeNull();
      expect(listSubscriptions({ tenantId: t.id })).toHaveLength(0);
      expect(listUsage({ tenantId: t.id })).toHaveLength(0);
    });

    it("rejects unknown tenant", () => {
      expect(() => deleteTenant(db, "nope")).toThrow(/not found/);
    });
  });

  /* ── recordUsage / getUsage / listUsage ───────────────────── */

  describe("recordUsage", () => {
    it("records a usage sample", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const rec = recordUsage(db, t.id, "api_calls", 42, { period: "2026-04" });
      expect(rec.metric).toBe("api_calls");
      expect(rec.value).toBe(42);
      expect(rec.period).toBe("2026-04");
      expect(rec.tenantId).toBe(t.id);
    });

    it("derives period from now when not provided", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      // 2026-04-16 UTC
      const when = Date.UTC(2026, 3, 16);
      const rec = recordUsage(db, t.id, "api_calls", 1, { now: when });
      expect(rec.period).toBe("2026-04");
    });

    it("rejects unknown tenant", () => {
      expect(() => recordUsage(db, "nope", "api_calls", 1)).toThrow(
        /not found/,
      );
    });

    it("rejects unknown metric", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => recordUsage(db, t.id, "bandwidth", 1)).toThrow(
        /Unknown metric/,
      );
    });

    it("rejects negative value", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => recordUsage(db, t.id, "api_calls", -5)).toThrow(
        /non-negative/,
      );
    });

    it("rejects non-finite value", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() =>
        recordUsage(db, t.id, "api_calls", Number.POSITIVE_INFINITY),
      ).toThrow(/non-negative/);
    });
  });

  describe("getUsage", () => {
    it("aggregates usage by metric across records", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 10, { period: "2026-04" });
      recordUsage(db, t.id, "api_calls", 20, { period: "2026-04" });
      recordUsage(db, t.id, "ai_requests", 5, { period: "2026-04" });
      const usage = getUsage(t.id, { period: "2026-04" });
      expect(usage.byMetric.api_calls).toBe(30);
      expect(usage.byMetric.ai_requests).toBe(5);
      expect(usage.byMetric.storage_bytes).toBe(0);
      expect(usage.recordCount).toBe(3);
    });

    it("filters by period", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 10, { period: "2026-03" });
      recordUsage(db, t.id, "api_calls", 20, { period: "2026-04" });
      const april = getUsage(t.id, { period: "2026-04" });
      expect(april.byMetric.api_calls).toBe(20);
    });

    it("filters by metric", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 10);
      recordUsage(db, t.id, "ai_requests", 5);
      const calls = getUsage(t.id, { metric: "api_calls" });
      expect(calls.byMetric.api_calls).toBe(10);
      expect(calls.byMetric.ai_requests).toBe(0);
    });
  });

  describe("listUsage", () => {
    it("sorts records newest first", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 1, { now: 100 });
      recordUsage(db, t.id, "api_calls", 2, { now: 200 });
      recordUsage(db, t.id, "api_calls", 3, { now: 150 });
      const list = listUsage({ tenantId: t.id });
      expect(list.map((r) => r.recordedAt)).toEqual([200, 150, 100]);
    });

    it("honors limit + filter combo", () => {
      const a = createTenant(db, { name: "A", slug: "a" });
      const b = createTenant(db, { name: "B", slug: "b" });
      recordUsage(db, a.id, "api_calls", 1);
      recordUsage(db, a.id, "ai_requests", 2);
      recordUsage(db, b.id, "api_calls", 3);
      expect(listUsage({ tenantId: a.id })).toHaveLength(2);
      expect(listUsage({ metric: "api_calls" })).toHaveLength(2);
      expect(listUsage({ limit: 1 })).toHaveLength(1);
    });
  });

  /* ── subscribe / cancelSubscription / getActiveSubscription ── */

  describe("subscribe", () => {
    it("creates an active subscription and syncs tenant.plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const sub = subscribe(db, t.id, "pro", { amount: 399 });
      expect(sub.plan).toBe("pro");
      expect(sub.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(sub.amount).toBe(399);
      expect(sub.expiresAt).toBeGreaterThan(sub.startedAt);
      // tenant.plan updated
      expect(getTenant(t.id).plan).toBe("pro");
    });

    it("defaults amount from plan monthly fee", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const sub = subscribe(db, t.id, "starter");
      expect(sub.amount).toBe(99);
    });

    it("cancels existing active subscription when a new one is created", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const first = subscribe(db, t.id, "starter");
      subscribe(db, t.id, "pro");
      // first should now be cancelled
      const all = listSubscriptions({ tenantId: t.id });
      expect(all).toHaveLength(2);
      const firstReloaded = all.find((s) => s.id === first.id);
      expect(firstReloaded.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
      expect(firstReloaded.cancelledAt).toBeTruthy();
    });

    it("rejects unknown tenant", () => {
      expect(() => subscribe(db, "nope", "pro")).toThrow(/not found/);
    });

    it("rejects unknown plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => subscribe(db, t.id, "diamond")).toThrow(/Unknown plan/);
    });

    it("rejects subscribing a deleted tenant", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      deleteTenant(db, t.id);
      expect(() => subscribe(db, t.id, "pro")).toThrow(/deleted/);
    });
  });

  describe("getActiveSubscription", () => {
    it("returns null when no active subscription", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(getActiveSubscription(t.id)).toBeNull();
    });

    it("returns the most recent active subscription", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "starter");
      const pro = subscribe(db, t.id, "pro");
      expect(getActiveSubscription(t.id).id).toBe(pro.id);
    });
  });

  describe("cancelSubscription", () => {
    it("cancels the active subscription", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "pro");
      const cancelled = cancelSubscription(db, t.id);
      expect(cancelled.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
      expect(getActiveSubscription(t.id)).toBeNull();
    });

    it("rejects when no active subscription", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => cancelSubscription(db, t.id)).toThrow(/No active/);
    });
  });

  describe("listSubscriptions", () => {
    it("sorts newest first", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "starter", { now: 100 });
      subscribe(db, t.id, "pro", { now: 200 });
      const list = listSubscriptions({ tenantId: t.id });
      expect(list[0].plan).toBe("pro");
    });

    it("filters by status", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "starter");
      subscribe(db, t.id, "pro");
      const active = listSubscriptions({
        tenantId: t.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      });
      expect(active).toHaveLength(1);
      expect(active[0].plan).toBe("pro");
    });

    it("filters by plan", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "starter");
      subscribe(db, t.id, "pro");
      const pros = listSubscriptions({ plan: "pro" });
      expect(pros).toHaveLength(1);
    });
  });

  /* ── checkQuota ───────────────────────────────────────────── */

  describe("checkQuota", () => {
    it("computes remaining against free plan defaults", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 100, { period: "2026-04" });
      const q = checkQuota(t.id, "api_calls", { period: "2026-04" });
      expect(q.plan).toBe("free");
      expect(q.limit).toBe(1000);
      expect(q.used).toBe(100);
      expect(q.remaining).toBe(900);
      expect(q.exceeded).toBe(false);
      expect(q.unlimited).toBe(false);
    });

    it("marks exceeded when over quota", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      recordUsage(db, t.id, "api_calls", 1500, { period: "2026-04" });
      const q = checkQuota(t.id, "api_calls", { period: "2026-04" });
      expect(q.used).toBe(1500);
      expect(q.remaining).toBe(0);
      expect(q.exceeded).toBe(true);
    });

    it("marks enterprise quotas as unlimited", () => {
      const t = createTenant(db, {
        name: "Acme",
        slug: "acme",
        plan: "enterprise",
      });
      recordUsage(db, t.id, "api_calls", 1e9);
      const q = checkQuota(t.id, "api_calls");
      expect(q.unlimited).toBe(true);
      expect(q.limit).toBeNull();
      expect(q.remaining).toBeNull();
      expect(q.exceeded).toBe(false);
    });

    it("reflects plan change via subscribe", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "pro");
      const q = checkQuota(t.id, "api_calls");
      expect(q.plan).toBe("pro");
      expect(q.limit).toBe(100000);
    });

    it("rejects unknown metric", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      expect(() => checkQuota(t.id, "bandwidth")).toThrow(/Unknown metric/);
    });

    it("rejects unknown tenant", () => {
      expect(() => checkQuota("nope", "api_calls")).toThrow(/not found/);
    });
  });

  /* ── stats ─────────────────────────────────────────────────── */

  describe("getSaasStats", () => {
    it("summarizes empty store", () => {
      const stats = getSaasStats();
      expect(stats.tenantCount).toBe(0);
      expect(stats.subscriptionCount).toBe(0);
      expect(stats.usageRecordCount).toBe(0);
      expect(stats.byStatus.active).toBe(0);
      expect(stats.byPlan.free).toBe(0);
      expect(stats.totalUsage.api_calls).toBe(0);
    });

    it("counts tenants by status and plan", () => {
      const a = createTenant(db, { name: "A", slug: "a" });
      createTenant(db, { name: "B", slug: "b", plan: "pro" });
      createTenant(db, { name: "C", slug: "c", plan: "pro" });
      deleteTenant(db, a.id);
      const stats = getSaasStats();
      expect(stats.tenantCount).toBe(3);
      expect(stats.byStatus.active).toBe(2);
      expect(stats.byStatus.deleted).toBe(1);
      expect(stats.byPlan.pro).toBe(2);
      expect(stats.byPlan.free).toBe(1);
    });

    it("counts subscriptions and usage totals", () => {
      const t = createTenant(db, { name: "A", slug: "a" });
      subscribe(db, t.id, "pro");
      recordUsage(db, t.id, "api_calls", 100);
      recordUsage(db, t.id, "api_calls", 50);
      recordUsage(db, t.id, "ai_requests", 25);
      const stats = getSaasStats();
      expect(stats.subscriptionCount).toBe(1);
      expect(stats.activeSubscriptions).toBe(1);
      expect(stats.usageRecordCount).toBe(3);
      expect(stats.totalUsage.api_calls).toBe(150);
      expect(stats.totalUsage.ai_requests).toBe(25);
      expect(stats.totalUsage.storage_bytes).toBe(0);
    });
  });

  /* ── export / import ──────────────────────────────────────── */

  describe("exportTenant / importTenant", () => {
    it("exports tenant + subscriptions + usage", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, t.id, "pro");
      recordUsage(db, t.id, "api_calls", 100);
      const dump = exportTenant(t.id);
      expect(dump.tenant.id).toBe(t.id);
      expect(dump.subscriptions).toHaveLength(1);
      expect(dump.usage).toHaveLength(1);
      expect(dump.exportedAt).toBeTruthy();
    });

    it("round-trips via import", () => {
      const src = createTenant(db, { name: "Acme", slug: "acme" });
      subscribe(db, src.id, "pro");
      recordUsage(db, src.id, "api_calls", 42);
      const dump = exportTenant(src.id);

      _resetState();
      db = new MockDatabase();
      ensureTenantTables(db);
      const result = importTenant(db, dump);
      expect(result.tenantId).toBeTruthy();
      expect(result.importedSubscriptions).toBe(1);
      expect(result.importedUsage).toBe(1);
      const restored = getTenantBySlug("acme");
      expect(restored.name).toBe("Acme");
      expect(restored.plan).toBe("pro");
    });

    it("skips tenant on slug collision when id differs", () => {
      createTenant(db, { name: "Existing", slug: "taken" });
      const result = importTenant(db, {
        tenant: { name: "Other", slug: "taken" },
        subscriptions: [],
        usage: [],
      });
      expect(result.tenantId).toBeNull();
      expect(result.skippedTenant).toBe(true);
      expect(result.reason).toBe("slug_collision");
    });

    it("is idempotent when tenant with same id already exists", () => {
      const t = createTenant(db, { name: "Acme", slug: "acme" });
      const result = importTenant(db, {
        tenant: { id: t.id, name: "Acme", slug: "acme" },
        subscriptions: [],
        usage: [],
      });
      expect(result.skippedTenant).toBe(true);
      expect(result.tenantId).toBe(t.id);
    });

    it("skips subscriptions with unknown plans", () => {
      const result = importTenant(db, {
        tenant: { name: "Acme", slug: "acme" },
        subscriptions: [{ plan: "diamond" }, { plan: "pro" }],
        usage: [],
      });
      expect(result.importedSubscriptions).toBe(1);
      expect(result.skippedSubscriptions).toBe(1);
    });

    it("skips usage with unknown metrics", () => {
      const result = importTenant(db, {
        tenant: { name: "Acme", slug: "acme" },
        subscriptions: [],
        usage: [
          { metric: "bandwidth", value: 1 },
          { metric: "api_calls", value: 2 },
        ],
      });
      expect(result.importedUsage).toBe(1);
      expect(result.skippedUsage).toBe(1);
    });

    it("rejects invalid import data", () => {
      expect(() => importTenant(db, null)).toThrow(/must be an object/);
      expect(() => importTenant(db, { tenant: {} })).toThrow(/name \+ slug/);
    });

    it("rejects exporting unknown tenant", () => {
      expect(() => exportTenant("nope")).toThrow(/not found/);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
 * Phase 97 V2 — Tenant Maturity + Subscription Lifecycle
 * ═════════════════════════════════════════════════════════════ */

describe("Tenant SaaS V2 — Phase 97", () => {
  let db;
  beforeEach(() => {
    _resetStateV2();
    db = new MockDatabase();
  });

  describe("frozen enums + defaults", () => {
    it("exposes 5-state tenant maturity enum", () => {
      expect(Object.values(TENANT_MATURITY_V2)).toEqual([
        "provisioning",
        "active",
        "suspended",
        "archived",
        "cancelled",
      ]);
    });

    it("exposes 5-state subscription lifecycle enum", () => {
      expect(Object.values(SUBSCRIPTION_LIFECYCLE_V2)).toEqual([
        "pending",
        "active",
        "past_due",
        "cancelled",
        "expired",
      ]);
    });

    it("exposes V2 defaults", () => {
      expect(SAAS_DEFAULT_MAX_ACTIVE_TENANTS_PER_PLAN).toBe(1000);
      expect(SAAS_DEFAULT_MAX_SUBSCRIPTIONS_PER_TENANT).toBe(5);
      expect(SAAS_DEFAULT_TENANT_IDLE_MS).toBe(180 * 86400000);
      expect(SAAS_DEFAULT_PAST_DUE_GRACE_MS).toBe(7 * 86400000);
    });
  });

  describe("config mutators", () => {
    it("set/get max-active-tenants-per-plan floors and rejects", () => {
      setMaxActiveTenantsPerPlanV2(2.7);
      expect(getMaxActiveTenantsPerPlanV2()).toBe(2);
      expect(() => setMaxActiveTenantsPerPlanV2(0)).toThrow(/positive/);
      expect(() => setMaxActiveTenantsPerPlanV2("abc")).toThrow(/positive/);
    });

    it("set/get max-subscriptions-per-tenant floors and rejects", () => {
      setMaxSubscriptionsPerTenantV2(3.9);
      expect(getMaxSubscriptionsPerTenantV2()).toBe(3);
      expect(() => setMaxSubscriptionsPerTenantV2(-1)).toThrow(/positive/);
    });

    it("set/get tenant-idle-ms floors and rejects", () => {
      setTenantIdleMsV2(500.5);
      expect(getTenantIdleMsV2()).toBe(500);
      expect(() => setTenantIdleMsV2(0)).toThrow(/positive/);
    });

    it("set/get past-due-grace-ms resets with _resetStateV2", () => {
      setPastDueGraceMsV2(1000);
      _resetStateV2();
      expect(getPastDueGraceMsV2()).toBe(getDefaultPastDueGraceMsV2());
      expect(getMaxActiveTenantsPerPlanV2()).toBe(
        getDefaultMaxActiveTenantsPerPlanV2(),
      );
      expect(getMaxSubscriptionsPerTenantV2()).toBe(
        getDefaultMaxSubscriptionsPerTenantV2(),
      );
      expect(getTenantIdleMsV2()).toBe(getDefaultTenantIdleMsV2());
    });
  });

  describe("registerTenantV2", () => {
    it("tags PROVISIONING by default", () => {
      const r = registerTenantV2(db, { tenantId: "t1", plan: "pro" });
      expect(r.status).toBe("provisioning");
      expect(r.tenantId).toBe("t1");
      expect(r.plan).toBe("pro");
      expect(r.createdAt).toBeGreaterThan(0);
      expect(r.lastActivityAt).toBe(r.createdAt);
    });

    it("honors initialStatus active", () => {
      const r = registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      expect(r.status).toBe("active");
    });

    it("throws missing tenantId", () => {
      expect(() => registerTenantV2(db, { plan: "pro" })).toThrow(/tenantId/);
    });

    it("throws missing plan", () => {
      expect(() => registerTenantV2(db, { tenantId: "t1" })).toThrow(/plan/);
    });

    it("throws duplicate tenantId", () => {
      registerTenantV2(db, { tenantId: "t1", plan: "pro" });
      expect(() =>
        registerTenantV2(db, { tenantId: "t1", plan: "free" }),
      ).toThrow(/already registered/);
    });

    it("rejects terminal cancelled initial", () => {
      expect(() =>
        registerTenantV2(db, {
          tenantId: "t1",
          plan: "pro",
          initialStatus: "cancelled",
        }),
      ).toThrow(/terminal/);
    });

    it("rejects invalid initial status", () => {
      expect(() =>
        registerTenantV2(db, {
          tenantId: "t1",
          plan: "pro",
          initialStatus: "ghost",
        }),
      ).toThrow(/Invalid initial status/);
    });

    it("enforces per-plan active cap when initialStatus is active", () => {
      setMaxActiveTenantsPerPlanV2(2);
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
      });
      expect(() =>
        registerTenantV2(db, {
          tenantId: "t3",
          plan: "pro",
          initialStatus: "active",
        }),
      ).toThrow(/Max active tenants/);
      registerTenantV2(db, {
        tenantId: "t4",
        plan: "free",
        initialStatus: "active",
      });
      registerTenantV2(db, { tenantId: "t5", plan: "pro" });
    });

    it("provisioning does NOT count against active cap", () => {
      setMaxActiveTenantsPerPlanV2(1);
      registerTenantV2(db, { tenantId: "t1", plan: "pro" });
      registerTenantV2(db, { tenantId: "t2", plan: "pro" });
      registerTenantV2(db, { tenantId: "t3", plan: "pro" });
      expect(getActiveTenantCount("pro")).toBe(0);
    });
  });

  describe("setTenantMaturityV2", () => {
    beforeEach(() => {
      registerTenantV2(db, { tenantId: "t1", plan: "pro" });
    });

    it("provisioning → active → suspended → active → archived → active → cancelled", () => {
      expect(activateTenant(db, "t1").status).toBe("active");
      expect(suspendTenant(db, "t1").status).toBe("suspended");
      expect(activateTenant(db, "t1").status).toBe("active");
      expect(archiveTenantV2(db, "t1").status).toBe("archived");
      expect(activateTenant(db, "t1").status).toBe("active");
      expect(cancelTenant(db, "t1").status).toBe("cancelled");
    });

    it("provisioning → cancelled direct", () => {
      expect(cancelTenant(db, "t1").status).toBe("cancelled");
    });

    it("archived → cancelled direct", () => {
      activateTenant(db, "t1");
      archiveTenantV2(db, "t1");
      expect(cancelTenant(db, "t1").status).toBe("cancelled");
    });

    it("provisioning → suspended blocked (must pass through active)", () => {
      expect(() => suspendTenant(db, "t1")).toThrow(/Invalid transition/);
    });

    it("terminal cancelled cannot transition", () => {
      cancelTenant(db, "t1");
      expect(() => activateTenant(db, "t1")).toThrow(/terminal/);
    });

    it("unknown tenant throws", () => {
      expect(() => setTenantMaturityV2(db, "ghost", "active")).toThrow(
        /not registered/,
      );
    });

    it("invalid status rejected", () => {
      expect(() => setTenantMaturityV2(db, "t1", "ghost")).toThrow(
        /Invalid tenant status/,
      );
    });

    it("activate enforces per-plan cap", () => {
      setMaxActiveTenantsPerPlanV2(1);
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
      });
      expect(() => activateTenant(db, "t1")).toThrow(/Max active tenants/);
    });

    it("patch merges metadata + reason", () => {
      activateTenant(db, "t1");
      const r = setTenantMaturityV2(db, "t1", "suspended", {
        reason: "billing",
        metadata: { note: "grace" },
      });
      expect(r.reason).toBe("billing");
      expect(r.metadata).toEqual({ note: "grace" });
    });

    it("getTenantV2 returns null for unknown", () => {
      expect(getTenantV2("ghost")).toBeNull();
    });
  });

  describe("touchTenantActivity", () => {
    it("bumps lastActivityAt", async () => {
      const r = registerTenantV2(db, { tenantId: "t1", plan: "pro" });
      await new Promise((res) => setTimeout(res, 2));
      const r2 = touchTenantActivity("t1");
      expect(r2.lastActivityAt).toBeGreaterThan(r.lastActivityAt);
    });

    it("throws unknown", () => {
      expect(() => touchTenantActivity("ghost")).toThrow(/not registered/);
    });
  });

  describe("registerSubscriptionV2", () => {
    beforeEach(() => {
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
    });

    it("tags PENDING by default", () => {
      const r = registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
      expect(r.status).toBe("pending");
      expect(r.activatedAt).toBeNull();
    });

    it("each missing field throws", () => {
      expect(() =>
        registerSubscriptionV2(db, { tenantId: "t1", plan: "pro" }),
      ).toThrow(/subscriptionId/);
      expect(() =>
        registerSubscriptionV2(db, { subscriptionId: "s1", plan: "pro" }),
      ).toThrow(/tenantId/);
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s1",
          tenantId: "t1",
        }),
      ).toThrow(/plan/);
    });

    it("duplicate subscriptionId throws", () => {
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s1",
          tenantId: "t1",
          plan: "free",
        }),
      ).toThrow(/already registered/);
    });

    it("unregistered tenant throws", () => {
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s1",
          tenantId: "ghost",
          plan: "pro",
        }),
      ).toThrow(/Tenant not registered/);
    });

    it("suspended/archived/cancelled tenant rejected", () => {
      registerTenantV2(db, { tenantId: "t2", plan: "pro" });
      activateTenant(db, "t2");
      suspendTenant(db, "t2");
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s1",
          tenantId: "t2",
          plan: "pro",
        }),
      ).toThrow(/suspended/);

      registerTenantV2(db, { tenantId: "t3", plan: "pro" });
      activateTenant(db, "t3");
      archiveTenantV2(db, "t3");
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s2",
          tenantId: "t3",
          plan: "pro",
        }),
      ).toThrow(/archived/);
    });

    it("provisioning tenant allowed (grace before activation)", () => {
      registerTenantV2(db, { tenantId: "t4", plan: "pro" });
      const r = registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t4",
        plan: "pro",
      });
      expect(r.status).toBe("pending");
    });

    it("per-tenant open cap enforced", () => {
      setMaxSubscriptionsPerTenantV2(2);
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
      registerSubscriptionV2(db, {
        subscriptionId: "s2",
        tenantId: "t1",
        plan: "pro",
      });
      expect(() =>
        registerSubscriptionV2(db, {
          subscriptionId: "s3",
          tenantId: "t1",
          plan: "pro",
        }),
      ).toThrow(/Max subscriptions/);
    });

    it("terminal subscription excluded from cap", () => {
      setMaxSubscriptionsPerTenantV2(1);
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
      cancelSubscriptionV2(db, "s1");
      registerSubscriptionV2(db, {
        subscriptionId: "s2",
        tenantId: "t1",
        plan: "pro",
      });
    });
  });

  describe("setSubscriptionStatusV2", () => {
    beforeEach(() => {
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
    });

    it("pending → active → past_due → active → expired", () => {
      expect(activateSubscription(db, "s1").status).toBe("active");
      expect(markSubscriptionPastDue(db, "s1").status).toBe("past_due");
      expect(activateSubscription(db, "s1").status).toBe("active");
      expect(expireSubscription(db, "s1").status).toBe("expired");
    });

    it("pending → cancelled direct", () => {
      expect(cancelSubscriptionV2(db, "s1").status).toBe("cancelled");
    });

    it("active → cancelled direct", () => {
      activateSubscription(db, "s1");
      expect(cancelSubscriptionV2(db, "s1").status).toBe("cancelled");
    });

    it("past_due → expired direct", () => {
      activateSubscription(db, "s1");
      markSubscriptionPastDue(db, "s1");
      expect(expireSubscription(db, "s1").status).toBe("expired");
    });

    it("pending → expired blocked (must go via active)", () => {
      expect(() => expireSubscription(db, "s1")).toThrow(/Invalid transition/);
    });

    it("cancelled terminal cannot transition", () => {
      cancelSubscriptionV2(db, "s1");
      expect(() => activateSubscription(db, "s1")).toThrow(/terminal/);
    });

    it("expired terminal cannot transition", () => {
      activateSubscription(db, "s1");
      expireSubscription(db, "s1");
      expect(() => activateSubscription(db, "s1")).toThrow(/terminal/);
    });

    it("unknown subscription throws", () => {
      expect(() => setSubscriptionStatusV2(db, "ghost", "active")).toThrow(
        /not registered/,
      );
    });

    it("invalid status rejected", () => {
      expect(() => setSubscriptionStatusV2(db, "s1", "ghost")).toThrow(
        /Invalid subscription status/,
      );
    });

    it("activatedAt stamped once, pastDueAt stamped once", () => {
      const r1 = activateSubscription(db, "s1");
      const stampedAt = r1.activatedAt;
      expect(stampedAt).toBeGreaterThan(0);
      markSubscriptionPastDue(db, "s1");
      const r2 = activateSubscription(db, "s1");
      expect(r2.activatedAt).toBe(stampedAt); // not overwritten on reactivation

      markSubscriptionPastDue(db, "s1");
      const r3 = getSubscriptionV2("s1");
      const pastDueFirst = r3.pastDueAt;
      activateSubscription(db, "s1");
      markSubscriptionPastDue(db, "s1");
      // pastDueAt was already set, stays
      expect(getSubscriptionV2("s1").pastDueAt).toBe(pastDueFirst);
    });

    it("patch merges metadata + reason", () => {
      const r = activateSubscription(db, "s1", "initial");
      expect(r.reason).toBe("initial");
      const r2 = setSubscriptionStatusV2(db, "s1", "past_due", {
        reason: "payment_failed",
        metadata: { attempt: 1 },
      });
      expect(r2.reason).toBe("payment_failed");
      expect(r2.metadata).toEqual({ attempt: 1 });
    });
  });

  describe("counts", () => {
    it("getActiveTenantCount scopes by plan + only ACTIVE", () => {
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
      });
      registerTenantV2(db, {
        tenantId: "t3",
        plan: "free",
        initialStatus: "active",
      });
      registerTenantV2(db, { tenantId: "t4", plan: "pro" });
      expect(getActiveTenantCount()).toBe(3);
      expect(getActiveTenantCount("pro")).toBe(2);
      expect(getActiveTenantCount("free")).toBe(1);
      expect(getActiveTenantCount("enterprise")).toBe(0);
    });

    it("getOpenSubscriptionCount scopes + terminal exclusion", () => {
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
      });
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
      registerSubscriptionV2(db, {
        subscriptionId: "s2",
        tenantId: "t1",
        plan: "pro",
      });
      cancelSubscriptionV2(db, "s2");
      registerSubscriptionV2(db, {
        subscriptionId: "s3",
        tenantId: "t2",
        plan: "pro",
      });
      expect(getOpenSubscriptionCount()).toBe(2);
      expect(getOpenSubscriptionCount("t1")).toBe(1);
      expect(getOpenSubscriptionCount("t2")).toBe(1);
    });
  });

  describe("autoArchiveIdleTenants", () => {
    it("flips idle active tenants", () => {
      setTenantIdleMsV2(100);
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
        now: 1000,
      });
      const flipped = autoArchiveIdleTenants(db, 2000);
      expect(flipped).toEqual(["t1"]);
      expect(getTenantV2("t1").status).toBe("archived");
    });

    it("flips idle suspended tenants", () => {
      setTenantIdleMsV2(100);
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        now: 1000,
      });
      activateTenant(db, "t1");
      suspendTenant(db, "t1");
      // touch activity so it's still 1000
      const flipped = autoArchiveIdleTenants(db, 100000);
      // lastActivityAt was initial 1000, now 100000 > 100ms
      expect(flipped).toContain("t1");
    });

    it("skips cancelled/archived/provisioning", () => {
      setTenantIdleMsV2(100);
      registerTenantV2(db, { tenantId: "t1", plan: "pro", now: 1000 });
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
        now: 1000,
      });
      archiveTenantV2(db, "t2");
      const flipped = autoArchiveIdleTenants(db, 2000);
      expect(flipped).not.toContain("t1"); // provisioning not flipped
      expect(flipped).not.toContain("t2"); // already archived
    });

    it("skips fresh tenants", () => {
      setTenantIdleMsV2(86400000); // 1 day
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      const flipped = autoArchiveIdleTenants(db);
      expect(flipped).toEqual([]);
    });
  });

  describe("autoExpirePastDueSubscriptions", () => {
    beforeEach(() => {
      registerTenantV2(db, {
        tenantId: "t1",
        plan: "pro",
        initialStatus: "active",
      });
      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t1",
        plan: "pro",
      });
    });

    it("flips past_due past grace", () => {
      setPastDueGraceMsV2(100);
      activateSubscription(db, "s1");
      markSubscriptionPastDue(db, "s1");
      const flipped = autoExpirePastDueSubscriptions(db, Date.now() + 1000);
      expect(flipped).toEqual(["s1"]);
      expect(getSubscriptionV2("s1").status).toBe("expired");
    });

    it("skips fresh past_due within grace", () => {
      setPastDueGraceMsV2(1000000);
      activateSubscription(db, "s1");
      markSubscriptionPastDue(db, "s1");
      const flipped = autoExpirePastDueSubscriptions(db);
      expect(flipped).toEqual([]);
    });

    it("skips non-past_due subscriptions", () => {
      setPastDueGraceMsV2(100);
      activateSubscription(db, "s1");
      const flipped = autoExpirePastDueSubscriptions(db, Date.now() + 1000);
      expect(flipped).toEqual([]);
    });
  });

  describe("getSaasStatsV2", () => {
    it("zero-init with all enum keys", () => {
      const s = getSaasStatsV2();
      expect(s.totalTenantsV2).toBe(0);
      expect(s.totalSubscriptionsV2).toBe(0);
      expect(s.maxActiveTenantsPerPlan).toBe(1000);
      expect(s.tenantsByStatus).toEqual({
        provisioning: 0,
        active: 0,
        suspended: 0,
        archived: 0,
        cancelled: 0,
      });
      expect(s.subscriptionsByStatus).toEqual({
        pending: 0,
        active: 0,
        past_due: 0,
        cancelled: 0,
        expired: 0,
      });
    });

    it("aggregates across all states", () => {
      registerTenantV2(db, { tenantId: "t1", plan: "pro" }); // provisioning
      registerTenantV2(db, {
        tenantId: "t2",
        plan: "pro",
        initialStatus: "active",
      });
      registerTenantV2(db, {
        tenantId: "t3",
        plan: "pro",
        initialStatus: "active",
      });
      suspendTenant(db, "t3");
      registerTenantV2(db, { tenantId: "t4", plan: "pro" });
      cancelTenant(db, "t4");

      registerSubscriptionV2(db, {
        subscriptionId: "s1",
        tenantId: "t2",
        plan: "pro",
      }); // pending
      registerSubscriptionV2(db, {
        subscriptionId: "s2",
        tenantId: "t2",
        plan: "pro",
      });
      activateSubscription(db, "s2");
      registerSubscriptionV2(db, {
        subscriptionId: "s3",
        tenantId: "t2",
        plan: "pro",
      });
      activateSubscription(db, "s3");
      markSubscriptionPastDue(db, "s3");
      registerSubscriptionV2(db, {
        subscriptionId: "s4",
        tenantId: "t2",
        plan: "pro",
      });
      cancelSubscriptionV2(db, "s4");
      registerSubscriptionV2(db, {
        subscriptionId: "s5",
        tenantId: "t2",
        plan: "pro",
      });
      activateSubscription(db, "s5");
      expireSubscription(db, "s5");

      const s = getSaasStatsV2();
      expect(s.totalTenantsV2).toBe(4);
      expect(s.tenantsByStatus).toEqual({
        provisioning: 1,
        active: 1,
        suspended: 1,
        archived: 0,
        cancelled: 1,
      });
      expect(s.totalSubscriptionsV2).toBe(5);
      expect(s.subscriptionsByStatus).toEqual({
        pending: 1,
        active: 1,
        past_due: 1,
        cancelled: 1,
        expired: 1,
      });
    });
  });
});
