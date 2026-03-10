/**
 * TenantManager unit tests — Phase 97
 *
 * Covers: initialize, createTenant, configureTenant, getUsage, recordUsage,
 *         manageSubscription, exportData, importData, getTenants, deleteTenant
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { TenantManager } = require("../tenant-manager");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("TenantManager", () => {
  let tm;
  let db;

  beforeEach(() => {
    tm = new TenantManager();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(tm.initialized).toBe(false);
    expect(tm._tenants.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await tm.initialize(db);
    expect(tm.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await tm.initialize(db);
    await tm.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── createTenant ─────────────────────────────────────────────────────────
  it("should create a tenant", async () => {
    await tm.initialize(db);
    const result = tm.createTenant("Acme Corp", {
      domain: "acme.com",
      plan: "pro",
    });
    expect(result.id).toMatch(/^tenant-/);
    expect(result.name).toBe("Acme Corp");
    expect(result.status).toBe("active");
    expect(result.plan).toBe("pro");
  });

  it("should emit saas:tenant-created event", async () => {
    await tm.initialize(db);
    const listener = vi.fn();
    tm.on("saas:tenant-created", listener);
    tm.createTenant("Test Corp");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test Corp" }),
    );
  });

  it("should use default free plan", async () => {
    await tm.initialize(db);
    const result = tm.createTenant("Free Org");
    expect(result.plan).toBe("free");
  });

  // ── configureTenant ──────────────────────────────────────────────────────
  it("should configure existing tenant", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Config Corp");
    const updated = tm.configureTenant(tenant.id, {
      maxUsers: 50,
      domain: "config.com",
    });
    expect(updated.config.maxUsers).toBe(50);
    expect(updated.domain).toBe("config.com");
  });

  it("should throw for unknown tenant configuration", async () => {
    await tm.initialize(db);
    expect(() => tm.configureTenant("unknown", {})).toThrow("not found");
  });

  // ── getUsage ─────────────────────────────────────────────────────────────
  it("should return default usage for new tenant", async () => {
    await tm.initialize(db);
    const usage = tm.getUsage("tenant-1");
    expect(usage.storage).toBe(0);
    expect(usage.apiCalls).toBe(0);
  });

  // ── recordUsage ──────────────────────────────────────────────────────────
  it("should record and accumulate usage", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Usage Corp");
    tm.recordUsage(tenant.id, "apiCalls", 100);
    tm.recordUsage(tenant.id, "apiCalls", 50);
    const usage = tm.getUsage(tenant.id);
    expect(usage.apiCalls).toBe(150);
  });

  it("should persist usage to database", async () => {
    await tm.initialize(db);
    tm.recordUsage("tenant-1", "storage", 1024);
    expect(db.prepare).toHaveBeenCalled();
    expect(db._prep.run).toHaveBeenCalled();
  });

  // ── manageSubscription ───────────────────────────────────────────────────
  it("should create a subscription", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Sub Corp");
    const sub = tm.manageSubscription(tenant.id, "pro");
    expect(sub.id).toMatch(/^sub-/);
    expect(sub.plan).toBe("pro");
    expect(sub.price).toBe(99);
    expect(sub.status).toBe("active");
  });

  it("should update tenant plan on subscription", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Plan Corp");
    tm.manageSubscription(tenant.id, "enterprise");
    const tenants = tm.getTenants();
    const updated = tenants.find((t) => t.id === tenant.id);
    expect(updated.plan).toBe("enterprise");
  });

  it("should emit saas:subscription-updated event", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Event Corp");
    const listener = vi.fn();
    tm.on("saas:subscription-updated", listener);
    tm.manageSubscription(tenant.id, "starter");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "starter" }),
    );
  });

  // ── exportData ───────────────────────────────────────────────────────────
  it("should export tenant data", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Export Corp");
    tm.recordUsage(tenant.id, "apiCalls", 100);
    const exported = tm.exportData(tenant.id);
    expect(exported.tenant.name).toBe("Export Corp");
    expect(exported.exportedAt).toBeDefined();
  });

  it("should return null for unknown tenant export", async () => {
    await tm.initialize(db);
    expect(tm.exportData("unknown")).toBeNull();
  });

  // ── importData ───────────────────────────────────────────────────────────
  it("should import data for existing tenant", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Import Corp");
    const result = tm.importData(tenant.id, { records: 100 });
    expect(result.imported).toBe(true);
    expect(result.tenantId).toBe(tenant.id);
  });

  it("should throw for unknown tenant import", async () => {
    await tm.initialize(db);
    expect(() => tm.importData("unknown", {})).toThrow("not found");
  });

  // ── getTenants ───────────────────────────────────────────────────────────
  it("should list all tenants", async () => {
    await tm.initialize(db);
    tm.createTenant("Corp A");
    tm.createTenant("Corp B");
    const tenants = tm.getTenants();
    expect(tenants.length).toBe(2);
  });

  it("should filter tenants by plan", async () => {
    await tm.initialize(db);
    tm.createTenant("Free Corp", { plan: "free" });
    tm.createTenant("Pro Corp", { plan: "pro" });
    const proTenants = tm.getTenants({ plan: "pro" });
    expect(proTenants.length).toBe(1);
    expect(proTenants[0].name).toBe("Pro Corp");
  });

  // ── deleteTenant ─────────────────────────────────────────────────────────
  it("should soft-delete a tenant", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Delete Corp");
    const result = tm.deleteTenant(tenant.id);
    expect(result).toBe(true);
  });

  it("should emit saas:tenant-deleted event", async () => {
    await tm.initialize(db);
    const tenant = tm.createTenant("Event Corp");
    const listener = vi.fn();
    tm.on("saas:tenant-deleted", listener);
    tm.deleteTenant(tenant.id);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenant.id }),
    );
  });

  it("should return false for unknown tenant deletion", async () => {
    await tm.initialize(db);
    expect(tm.deleteTenant("unknown")).toBe(false);
  });
});
