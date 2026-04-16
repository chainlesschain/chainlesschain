/**
 * Unit tests for skill-marketplace (Phase 65 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureMarketplaceTables,
  listServiceStatus,
  listInvocationStatus,
  publishService,
  getService,
  listServices,
  updateServiceStatus,
  recordInvocation,
  listInvocations,
  getInvocationStats,
  SERVICE_STATUS,
  INVOCATION_STATUS,
  _resetState,
} from "../../src/lib/skill-marketplace.js";

describe("skill-marketplace", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureMarketplaceTables(db);
  });

  /* ── Schema / catalogs ─────────────────────────────────────── */

  describe("ensureMarketplaceTables", () => {
    it("creates skill_services + skill_invocations tables", () => {
      expect(db.tables.has("skill_services")).toBe(true);
      expect(db.tables.has("skill_invocations")).toBe(true);
    });

    it("is idempotent", () => {
      ensureMarketplaceTables(db);
      ensureMarketplaceTables(db);
      expect(db.tables.has("skill_services")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureMarketplaceTables(null)).not.toThrow();
    });
  });

  describe("Catalogs", () => {
    it("lists 4 service statuses", () => {
      const statuses = listServiceStatus();
      expect(statuses).toHaveLength(4);
      expect(statuses).toEqual([
        "draft",
        "published",
        "deprecated",
        "suspended",
      ]);
    });

    it("lists 5 invocation statuses", () => {
      const statuses = listInvocationStatus();
      expect(statuses).toHaveLength(5);
      expect(statuses).toContain("pending");
      expect(statuses).toContain("success");
      expect(statuses).toContain("timeout");
    });
  });

  /* ── Services ──────────────────────────────────────────────── */

  describe("publishService", () => {
    it("creates a published service with generated id", () => {
      const s = publishService(db, { name: "weather-api" });
      expect(s.id).toBeDefined();
      expect(s.name).toBe("weather-api");
      expect(s.version).toBe("1.0.0");
      expect(s.status).toBe(SERVICE_STATUS.PUBLISHED);
      expect(s.invocationCount).toBe(0);
    });

    it("honors provided version, description, endpoint, owner, pricing", () => {
      const s = publishService(db, {
        name: "weather-api",
        version: "2.1.0",
        description: "Weather forecast service",
        endpoint: "https://api.weather.example/v2",
        owner: "did:example:alice",
        pricing: { model: "per-call", amount: 0.01 },
      });
      expect(s.version).toBe("2.1.0");
      expect(s.description).toBe("Weather forecast service");
      expect(s.endpoint).toBe("https://api.weather.example/v2");
      expect(s.owner).toBe("did:example:alice");
      expect(s.pricing).toEqual({ model: "per-call", amount: 0.01 });
    });

    it("accepts explicit draft status", () => {
      const s = publishService(db, { name: "x", status: "draft" });
      expect(s.status).toBe(SERVICE_STATUS.DRAFT);
    });

    it("rejects missing name", () => {
      expect(() => publishService(db, {})).toThrow(/name is required/);
      expect(() => publishService(db, { name: "  " })).toThrow(
        /name is required/,
      );
    });

    it("rejects invalid status", () => {
      expect(() => publishService(db, { name: "x", status: "bogus" })).toThrow(
        /Invalid status/,
      );
    });

    it("persists to DB with serialized pricing", () => {
      const s = publishService(db, {
        name: "svc",
        pricing: { tier: "gold" },
      });
      const row = db
        .prepare("SELECT * FROM skill_services WHERE id = ?")
        .get(s.id);
      expect(row).toBeTruthy();
      expect(row.name).toBe("svc");
      expect(row.pricing).toBe(JSON.stringify({ tier: "gold" }));
    });

    it("strips internal _seq from returned service", () => {
      const s = publishService(db, { name: "svc" });
      expect(s).not.toHaveProperty("_seq");
    });
  });

  describe("getService / listServices", () => {
    beforeEach(() => {
      publishService(db, { name: "alpha", owner: "did:a" });
      publishService(db, {
        name: "beta",
        owner: "did:b",
        status: "draft",
      });
      publishService(db, { name: "alpha-v2", owner: "did:a" });
    });

    it("getService returns null for unknown id", () => {
      expect(getService("nope")).toBeNull();
    });

    it("listServices returns most-recent first", () => {
      const rows = listServices();
      expect(rows).toHaveLength(3);
      expect(rows[0].name).toBe("alpha-v2");
      expect(rows[2].name).toBe("alpha");
    });

    it("filters by status", () => {
      const drafts = listServices({ status: "draft" });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].name).toBe("beta");
    });

    it("rejects unknown status filter", () => {
      expect(() => listServices({ status: "weird" })).toThrow(/Unknown status/);
    });

    it("filters by owner", () => {
      const rows = listServices({ owner: "did:a" });
      expect(rows).toHaveLength(2);
      expect(rows.every((s) => s.owner === "did:a")).toBe(true);
    });

    it("filters by name substring (case-insensitive)", () => {
      const rows = listServices({ name: "ALPHA" });
      expect(rows).toHaveLength(2);
    });

    it("respects limit", () => {
      expect(listServices({ limit: 1 })).toHaveLength(1);
    });
  });

  describe("updateServiceStatus", () => {
    let serviceId;

    beforeEach(() => {
      const s = publishService(db, { name: "svc", status: "draft" });
      serviceId = s.id;
    });

    it("allows DRAFT → PUBLISHED", () => {
      const s = updateServiceStatus(db, serviceId, "published");
      expect(s.status).toBe(SERVICE_STATUS.PUBLISHED);
    });

    it("allows PUBLISHED → DEPRECATED", () => {
      updateServiceStatus(db, serviceId, "published");
      const s = updateServiceStatus(db, serviceId, "deprecated");
      expect(s.status).toBe(SERVICE_STATUS.DEPRECATED);
    });

    it("rejects invalid transition (DRAFT → DEPRECATED)", () => {
      expect(() => updateServiceStatus(db, serviceId, "deprecated")).toThrow(
        /Cannot transition/,
      );
    });

    it("rejects unknown status", () => {
      expect(() => updateServiceStatus(db, serviceId, "bogus")).toThrow(
        /Invalid status/,
      );
    });

    it("rejects unknown service id", () => {
      expect(() => updateServiceStatus(db, "nope", "published")).toThrow(
        /Service not found/,
      );
    });

    it("SUSPENDED → DRAFT is allowed (re-draft)", () => {
      updateServiceStatus(db, serviceId, "suspended");
      const s = updateServiceStatus(db, serviceId, "draft");
      expect(s.status).toBe(SERVICE_STATUS.DRAFT);
    });
  });

  /* ── Invocations ───────────────────────────────────────────── */

  describe("recordInvocation", () => {
    let serviceId;

    beforeEach(() => {
      const s = publishService(db, { name: "svc" });
      serviceId = s.id;
    });

    it("records a success invocation and increments service count", () => {
      const inv = recordInvocation(db, {
        serviceId,
        callerId: "did:caller",
        status: "success",
        durationMs: 42,
      });
      expect(inv.id).toBeDefined();
      expect(inv.status).toBe(INVOCATION_STATUS.SUCCESS);
      expect(inv.durationMs).toBe(42);

      const svc = getService(serviceId);
      expect(svc.invocationCount).toBe(1);
    });

    it("defaults to success status", () => {
      const inv = recordInvocation(db, { serviceId });
      expect(inv.status).toBe(INVOCATION_STATUS.SUCCESS);
    });

    it("rejects invocation on non-PUBLISHED service", () => {
      updateServiceStatus(db, serviceId, "deprecated");
      expect(() => recordInvocation(db, { serviceId })).toThrow(
        /Cannot invoke non-published/,
      );
    });

    it("rejects missing serviceId", () => {
      expect(() => recordInvocation(db, {})).toThrow(/serviceId is required/);
    });

    it("rejects unknown serviceId", () => {
      expect(() => recordInvocation(db, { serviceId: "nope" })).toThrow(
        /Service not found/,
      );
    });

    it("rejects invalid status", () => {
      expect(() =>
        recordInvocation(db, { serviceId, status: "weird" }),
      ).toThrow(/Invalid invocation status/);
    });

    it("rejects negative durationMs", () => {
      expect(() => recordInvocation(db, { serviceId, durationMs: -1 })).toThrow(
        /Invalid durationMs/,
      );
    });

    it("persists to DB with serialized input/output", () => {
      const inv = recordInvocation(db, {
        serviceId,
        input: { query: "weather" },
        output: { temp: 20 },
      });
      const row = db
        .prepare("SELECT * FROM skill_invocations WHERE id = ?")
        .get(inv.id);
      expect(row.input).toBe(JSON.stringify({ query: "weather" }));
      expect(row.output).toBe(JSON.stringify({ temp: 20 }));
    });

    it("strips internal _seq from returned invocation", () => {
      const inv = recordInvocation(db, { serviceId });
      expect(inv).not.toHaveProperty("_seq");
    });
  });

  describe("listInvocations", () => {
    let svcA;
    let svcB;

    beforeEach(() => {
      svcA = publishService(db, { name: "alpha" }).id;
      svcB = publishService(db, { name: "beta" }).id;
      recordInvocation(db, {
        serviceId: svcA,
        callerId: "did:c1",
        status: "success",
      });
      recordInvocation(db, {
        serviceId: svcA,
        callerId: "did:c2",
        status: "failed",
      });
      recordInvocation(db, {
        serviceId: svcB,
        callerId: "did:c1",
        status: "success",
      });
    });

    it("lists all invocations by default (most-recent first)", () => {
      const rows = listInvocations();
      expect(rows).toHaveLength(3);
    });

    it("filters by serviceId", () => {
      const rows = listInvocations({ serviceId: svcA });
      expect(rows).toHaveLength(2);
      expect(rows.every((i) => i.serviceId === svcA)).toBe(true);
    });

    it("filters by callerId", () => {
      const rows = listInvocations({ callerId: "did:c1" });
      expect(rows).toHaveLength(2);
    });

    it("filters by status", () => {
      const rows = listInvocations({ status: "failed" });
      expect(rows).toHaveLength(1);
    });

    it("rejects unknown status filter", () => {
      expect(() => listInvocations({ status: "weird" })).toThrow(
        /Unknown invocation status/,
      );
    });

    it("respects limit", () => {
      expect(listInvocations({ limit: 1 })).toHaveLength(1);
    });
  });

  describe("getInvocationStats", () => {
    let svcId;

    beforeEach(() => {
      svcId = publishService(db, { name: "svc" }).id;
    });

    it("returns zero stats when no invocations", () => {
      const stats = getInvocationStats();
      expect(stats.total).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });

    it("counts invocations by status", () => {
      recordInvocation(db, { serviceId: svcId, status: "success" });
      recordInvocation(db, { serviceId: svcId, status: "success" });
      recordInvocation(db, { serviceId: svcId, status: "failed" });
      recordInvocation(db, { serviceId: svcId, status: "timeout" });
      const stats = getInvocationStats();
      expect(stats.total).toBe(4);
      expect(stats.counts.success).toBe(2);
      expect(stats.counts.failed).toBe(1);
      expect(stats.counts.timeout).toBe(1);
      expect(stats.successRate).toBe(0.5);
    });

    it("computes avg duration from success-only samples", () => {
      recordInvocation(db, {
        serviceId: svcId,
        status: "success",
        durationMs: 100,
      });
      recordInvocation(db, {
        serviceId: svcId,
        status: "success",
        durationMs: 200,
      });
      recordInvocation(db, {
        serviceId: svcId,
        status: "failed",
        durationMs: 9999, // excluded
      });
      const stats = getInvocationStats();
      expect(stats.avgDurationMs).toBe(150);
    });

    it("scopes to a single service", () => {
      const svcB = publishService(db, { name: "beta" }).id;
      recordInvocation(db, { serviceId: svcId, status: "success" });
      recordInvocation(db, { serviceId: svcB, status: "failed" });
      const statsA = getInvocationStats({ serviceId: svcId });
      expect(statsA.total).toBe(1);
      expect(statsA.scopedToService).toBe(svcId);
      const statsAll = getInvocationStats();
      expect(statsAll.total).toBe(2);
      expect(statsAll.scopedToService).toBeNull();
    });

    it("successRate is 0 when total is 0 for a scoped service", () => {
      const stats = getInvocationStats({ serviceId: svcId });
      expect(stats.total).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });
});
