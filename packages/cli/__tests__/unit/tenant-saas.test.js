/**
 * Unit tests for tenant-saas (Phase 97 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
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
