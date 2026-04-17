import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  SLA_TIERS,
  SLA_TERMS,
  VIOLATION_SEVERITY,
  SLA_STATUS,
  resolveTier,
  listTiers,
  ensureSlaTables,
  createSLA,
  listSLAs,
  getSLA,
  terminateSLA,
  recordMetric,
  getSLAMetrics,
  checkViolations,
  listViolations,
  calculateCompensation,
  generateReport,
  _resetState,
  // V2
  SLA_STATUS_V2,
  SLA_TIER_V2,
  SLA_TERM_V2,
  VIOLATION_SEVERITY_V2,
  VIOLATION_STATUS_V2,
  SLA_DEFAULT_MAX_ACTIVE_PER_ORG,
  setMaxActiveSlasPerOrg,
  getMaxActiveSlasPerOrg,
  getActiveSlaCountForOrg,
  createSLAV2,
  setSLAStatus,
  expireSLA,
  autoExpireSLAs,
  setViolationStatus,
  acknowledgeViolation,
  resolveViolation,
  waiveViolation,
  getSLAStatsV2,
} from "../../src/lib/sla-manager.js";

describe("sla-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSlaTables(db);
  });

  describe("schema", () => {
    it("creates three tables", () => {
      expect(db.tables.has("sla_contracts")).toBe(true);
      expect(db.tables.has("sla_metrics")).toBe(true);
      expect(db.tables.has("sla_violations")).toBe(true);
    });

    it("is idempotent", () => {
      ensureSlaTables(db);
      expect(db.tables.has("sla_contracts")).toBe(true);
    });
  });

  describe("tiers", () => {
    it("defines gold/silver/bronze", () => {
      expect(Object.keys(SLA_TIERS)).toEqual(["GOLD", "SILVER", "BRONZE"]);
    });

    it("is frozen", () => {
      expect(Object.isFrozen(SLA_TIERS)).toBe(true);
    });

    it("resolveTier is case-insensitive", () => {
      expect(resolveTier("gold").name).toBe("gold");
      expect(resolveTier("Silver").name).toBe("silver");
      expect(resolveTier("BRONZE").name).toBe("bronze");
    });

    it("resolveTier returns null for unknown", () => {
      expect(resolveTier("platinum")).toBe(null);
      expect(resolveTier("")).toBe(null);
      expect(resolveTier(null)).toBe(null);
    });

    it("listTiers returns copies", () => {
      const tiers = listTiers();
      expect(tiers.length).toBe(3);
      tiers[0].name = "mutated";
      expect(SLA_TIERS.GOLD.name).toBe("gold");
    });

    it("stricter tier has tighter thresholds", () => {
      expect(SLA_TIERS.GOLD.availability).toBeGreaterThan(
        SLA_TIERS.BRONZE.availability,
      );
      expect(SLA_TIERS.GOLD.maxResponseTime).toBeLessThan(
        SLA_TIERS.BRONZE.maxResponseTime,
      );
    });
  });

  describe("createSLA", () => {
    it("creates with default silver tier", () => {
      const c = createSLA(db, { orgId: "org:acme" });
      expect(c.slaId).toBeDefined();
      expect(c.tier).toBe("silver");
      expect(c.orgId).toBe("org:acme");
      expect(c.status).toBe(SLA_STATUS.ACTIVE);
      expect(c.terms.availability).toBe(SLA_TIERS.SILVER.availability);
    });

    it("accepts explicit tier + monthly fee", () => {
      const c = createSLA(db, {
        orgId: "org:gold-corp",
        tier: "gold",
        monthlyFee: 5000,
      });
      expect(c.tier).toBe("gold");
      expect(c.monthlyFee).toBe(5000);
      expect(c.terms.availability).toBe(SLA_TIERS.GOLD.availability);
    });

    it("merges caller term overrides", () => {
      const c = createSLA(db, {
        orgId: "org:x",
        tier: "bronze",
        terms: { maxResponseTime: 250 },
      });
      expect(c.terms.maxResponseTime).toBe(250);
      expect(c.terms.availability).toBe(SLA_TIERS.BRONZE.availability);
    });

    it("throws without orgId", () => {
      expect(() => createSLA(db, {})).toThrow(/orgId/);
    });

    it("throws on unknown tier", () => {
      expect(() => createSLA(db, { orgId: "org:x", tier: "diamond" })).toThrow(
        /Unknown SLA tier/,
      );
    });

    it("throws on non-positive duration", () => {
      expect(() => createSLA(db, { orgId: "org:x", duration: 0 })).toThrow(
        /duration/,
      );
      expect(() => createSLA(db, { orgId: "org:x", duration: -1 })).toThrow(
        /duration/,
      );
    });

    it("throws on negative monthlyFee", () => {
      expect(() => createSLA(db, { orgId: "org:x", monthlyFee: -100 })).toThrow(
        /monthlyFee/,
      );
    });

    it("persists to sla_contracts", () => {
      createSLA(db, { orgId: "org:x" });
      expect((db.data.get("sla_contracts") || []).length).toBe(1);
    });

    it("strips internal fields", () => {
      const c = createSLA(db, { orgId: "org:x" });
      expect(c._seq).toBeUndefined();
    });

    it("generates unique IDs", () => {
      const a = createSLA(db, { orgId: "org:x" });
      const b = createSLA(db, { orgId: "org:x" });
      expect(a.slaId).not.toBe(b.slaId);
    });
  });

  describe("listSLAs / getSLA", () => {
    it("returns empty when none", () => {
      expect(listSLAs()).toEqual([]);
    });

    it("sorts most-recent first", () => {
      const a = createSLA(db, { orgId: "org:a" });
      const b = createSLA(db, { orgId: "org:b" });
      const c = createSLA(db, { orgId: "org:c" });
      const list = listSLAs();
      expect(list[0].slaId).toBe(c.slaId);
      expect(list[2].slaId).toBe(a.slaId);
    });

    it("filters by orgId", () => {
      createSLA(db, { orgId: "org:a" });
      createSLA(db, { orgId: "org:b" });
      createSLA(db, { orgId: "org:a" });
      const list = listSLAs({ orgId: "org:a" });
      expect(list.length).toBe(2);
      expect(list.every((c) => c.orgId === "org:a")).toBe(true);
    });

    it("filters by tier", () => {
      createSLA(db, { orgId: "org:a", tier: "gold" });
      createSLA(db, { orgId: "org:b", tier: "bronze" });
      expect(listSLAs({ tier: "gold" }).length).toBe(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) createSLA(db, { orgId: `org:${i}` });
      expect(listSLAs({ limit: 2 }).length).toBe(2);
    });

    it("getSLA returns single contract", () => {
      const c = createSLA(db, { orgId: "org:x" });
      expect(getSLA(c.slaId).slaId).toBe(c.slaId);
    });

    it("getSLA throws for unknown id", () => {
      expect(() => getSLA("unknown")).toThrow(/not found/);
    });
  });

  describe("terminateSLA", () => {
    it("changes status to terminated", () => {
      const c = createSLA(db, { orgId: "org:x" });
      const r = terminateSLA(db, c.slaId);
      expect(r.status).toBe(SLA_STATUS.TERMINATED);
      expect(getSLA(c.slaId).status).toBe(SLA_STATUS.TERMINATED);
    });

    it("throws on unknown id", () => {
      expect(() => terminateSLA(db, "unknown")).toThrow(/not found/);
    });
  });

  describe("recordMetric", () => {
    it("records a metric against an active SLA", () => {
      const c = createSLA(db, { orgId: "org:x" });
      const m = recordMetric(db, c.slaId, "availability", 0.996);
      expect(m.term).toBe("availability");
      expect(m.value).toBe(0.996);
      expect(m.slaId).toBe(c.slaId);
    });

    it("throws on unknown sla", () => {
      expect(() => recordMetric(db, "unknown", "availability", 0.99)).toThrow(
        /not found/,
      );
    });

    it("throws on unknown term", () => {
      const c = createSLA(db, { orgId: "org:x" });
      expect(() => recordMetric(db, c.slaId, "happiness_index", 0.5)).toThrow(
        /Unknown SLA term/,
      );
    });

    it("throws on non-finite value", () => {
      const c = createSLA(db, { orgId: "org:x" });
      expect(() => recordMetric(db, c.slaId, "availability", NaN)).toThrow(
        /finite/,
      );
    });
  });

  describe("getSLAMetrics", () => {
    it("returns empty by-term when no metrics", () => {
      const c = createSLA(db, { orgId: "org:x" });
      const m = getSLAMetrics(c.slaId);
      expect(m.totalSamples).toBe(0);
      expect(m.byTerm).toEqual({});
    });

    it("aggregates mean/min/max/p95 per term", () => {
      const c = createSLA(db, { orgId: "org:x" });
      for (const v of [100, 120, 150, 200, 250]) {
        recordMetric(db, c.slaId, "response_time", v);
      }
      const m = getSLAMetrics(c.slaId);
      expect(m.byTerm.response_time.count).toBe(5);
      expect(m.byTerm.response_time.mean).toBe(164);
      expect(m.byTerm.response_time.min).toBe(100);
      expect(m.byTerm.response_time.max).toBe(250);
    });

    it("throws on unknown sla", () => {
      expect(() => getSLAMetrics("unknown")).toThrow(/not found/);
    });
  });

  describe("checkViolations", () => {
    it("reports no violations when metrics are within terms", () => {
      const c = createSLA(db, { orgId: "org:x", tier: "silver" });
      // silver: availability >= 0.995, p95 <= 200ms, throughput >= 500, error <= 0.005
      recordMetric(db, c.slaId, "availability", 0.998);
      recordMetric(db, c.slaId, "response_time", 150);
      recordMetric(db, c.slaId, "throughput", 800);
      recordMetric(db, c.slaId, "error_rate", 0.002);
      const r = checkViolations(db, c.slaId);
      expect(r.totalViolations).toBe(0);
    });

    it("flags availability violations", () => {
      const c = createSLA(db, { orgId: "org:x", tier: "gold" });
      // gold expects availability >= 0.999; feed 0.95 → ~4.9% deviation (minor)
      recordMetric(db, c.slaId, "availability", 0.95);
      const r = checkViolations(db, c.slaId);
      expect(r.totalViolations).toBe(1);
      expect(r.violations[0].term).toBe("availability");
      expect(r.violations[0].severity).toBe(VIOLATION_SEVERITY.MINOR);
    });

    it("classifies critical deviations", () => {
      const c = createSLA(db, { orgId: "org:x", tier: "silver" });
      // silver p95 <= 200ms; feed 500ms → 150% deviation (critical)
      for (let i = 0; i < 5; i++) {
        recordMetric(db, c.slaId, "response_time", 500);
      }
      const r = checkViolations(db, c.slaId);
      const rt = r.violations.find((v) => v.term === "response_time");
      expect(rt.severity).toBe(VIOLATION_SEVERITY.CRITICAL);
    });

    it("persists to sla_violations", () => {
      const c = createSLA(db, { orgId: "org:x", tier: "gold" });
      recordMetric(db, c.slaId, "availability", 0.9);
      checkViolations(db, c.slaId);
      expect((db.data.get("sla_violations") || []).length).toBeGreaterThan(0);
    });

    it("throws on unknown sla", () => {
      expect(() => checkViolations(db, "unknown")).toThrow(/not found/);
    });
  });

  describe("listViolations", () => {
    it("returns empty when none", () => {
      expect(listViolations()).toEqual([]);
    });

    it("filters by slaId and severity", () => {
      const a = createSLA(db, { orgId: "org:a", tier: "gold" });
      const b = createSLA(db, { orgId: "org:b", tier: "gold" });
      recordMetric(db, a.slaId, "availability", 0.9);
      recordMetric(db, b.slaId, "availability", 0.95);
      checkViolations(db, a.slaId);
      checkViolations(db, b.slaId);
      expect(listViolations({ slaId: a.slaId }).length).toBe(1);
      expect(listViolations({ severity: "minor" }).length).toBeGreaterThan(0);
    });
  });

  describe("calculateCompensation", () => {
    it("computes base × multiplier", () => {
      const c = createSLA(db, {
        orgId: "org:x",
        tier: "gold",
        monthlyFee: 10000,
      });
      recordMetric(db, c.slaId, "availability", 0.9);
      const r = checkViolations(db, c.slaId);
      const v = r.violations[0];
      const comp = calculateCompensation(db, v.violationId);
      // base = 10000 × 0.05 = 500; dev ≈ 9.9% → multiplier ≈ 0.198; amount ≈ 99
      expect(comp.base).toBeCloseTo(500, 0);
      expect(comp.amount).toBeGreaterThan(0);
      expect(comp.amount).toBeLessThan(500);
    });

    it("caps multiplier at 2.0 for extreme deviations", () => {
      const c = createSLA(db, {
        orgId: "org:x",
        tier: "silver",
        monthlyFee: 1000,
      });
      // Drive response_time to extreme outlier (>100% deviation)
      for (let i = 0; i < 5; i++) {
        recordMetric(db, c.slaId, "response_time", 2000);
      }
      const r = checkViolations(db, c.slaId);
      const v = r.violations.find((x) => x.term === "response_time");
      const comp = calculateCompensation(db, v.violationId);
      expect(comp.multiplier).toBeLessThanOrEqual(2.0);
    });

    it("throws on unknown violation", () => {
      expect(() => calculateCompensation(db, "unknown")).toThrow(
        /Violation not found/,
      );
    });
  });

  describe("generateReport", () => {
    it("computes compliance and violation summary", () => {
      const c = createSLA(db, {
        orgId: "org:x",
        tier: "silver",
        monthlyFee: 1000,
      });
      recordMetric(db, c.slaId, "availability", 0.998);
      recordMetric(db, c.slaId, "throughput", 700);
      recordMetric(db, c.slaId, "response_time", 500); // violates
      checkViolations(db, c.slaId);
      const r = generateReport(c.slaId);
      expect(r.slaId).toBe(c.slaId);
      expect(r.tier).toBe("silver");
      expect(r.metrics.availability).toBeDefined();
      expect(r.violations.total).toBeGreaterThan(0);
      // Compliance = (4 terms - terms with violations) / 4
      expect(r.compliance).toBeLessThan(1);
      expect(r.compliance).toBeGreaterThan(0);
    });

    it("reports 100% compliance when no violations", () => {
      const c = createSLA(db, { orgId: "org:x" });
      recordMetric(db, c.slaId, "availability", 0.999);
      const r = generateReport(c.slaId);
      expect(r.compliance).toBe(1);
      expect(r.violations.total).toBe(0);
    });

    it("respects startDate/endDate window", () => {
      const c = createSLA(db, { orgId: "org:x" });
      const t0 = Date.now();
      recordMetric(db, c.slaId, "availability", 0.5, { recordedAt: t0 - 1000 });
      recordMetric(db, c.slaId, "availability", 0.99, { recordedAt: t0 });
      const r = generateReport(c.slaId, {
        startDate: t0 - 500,
        endDate: t0 + 500,
      });
      expect(r.metrics.availability.count).toBe(1);
      expect(r.metrics.availability.mean).toBe(0.99);
    });

    it("throws on unknown sla", () => {
      expect(() => generateReport("unknown")).toThrow(/not found/);
    });

    it("throws when endDate < startDate", () => {
      const c = createSLA(db, { orgId: "org:x" });
      expect(() =>
        generateReport(c.slaId, { startDate: 1000, endDate: 500 }),
      ).toThrow(/startDate/);
    });
  });

  describe("SLA_TERMS constants", () => {
    it("exposes 4 canonical terms", () => {
      expect(Object.values(SLA_TERMS).sort()).toEqual([
        "availability",
        "error_rate",
        "response_time",
        "throughput",
      ]);
    });

    it("VIOLATION_SEVERITY has 4 levels", () => {
      expect(Object.values(VIOLATION_SEVERITY).sort()).toEqual([
        "critical",
        "major",
        "minor",
        "moderate",
      ]);
    });
  });
});

describe("sla-manager V2 (Phase 61)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSlaTables(db);
  });

  describe("frozen enums", () => {
    it("SLA_STATUS_V2 has 3 states", () => {
      expect(Object.values(SLA_STATUS_V2).sort()).toEqual([
        "active",
        "expired",
        "terminated",
      ]);
      expect(Object.isFrozen(SLA_STATUS_V2)).toBe(true);
    });

    it("SLA_TIER_V2 has 3 tiers", () => {
      expect(Object.values(SLA_TIER_V2).sort()).toEqual([
        "bronze",
        "gold",
        "silver",
      ]);
      expect(Object.isFrozen(SLA_TIER_V2)).toBe(true);
    });

    it("SLA_TERM_V2 has 4 terms", () => {
      expect(Object.values(SLA_TERM_V2).sort()).toEqual([
        "availability",
        "error_rate",
        "response_time",
        "throughput",
      ]);
      expect(Object.isFrozen(SLA_TERM_V2)).toBe(true);
    });

    it("VIOLATION_SEVERITY_V2 has 4 levels", () => {
      expect(Object.values(VIOLATION_SEVERITY_V2).sort()).toEqual([
        "critical",
        "major",
        "minor",
        "moderate",
      ]);
      expect(Object.isFrozen(VIOLATION_SEVERITY_V2)).toBe(true);
    });

    it("VIOLATION_STATUS_V2 has 4 states", () => {
      expect(Object.values(VIOLATION_STATUS_V2).sort()).toEqual([
        "acknowledged",
        "open",
        "resolved",
        "waived",
      ]);
      expect(Object.isFrozen(VIOLATION_STATUS_V2)).toBe(true);
    });

    it("SLA_DEFAULT_MAX_ACTIVE_PER_ORG is 1", () => {
      expect(SLA_DEFAULT_MAX_ACTIVE_PER_ORG).toBe(1);
    });
  });

  describe("setMaxActiveSlasPerOrg / getMaxActiveSlasPerOrg", () => {
    it("defaults to 1", () => {
      expect(getMaxActiveSlasPerOrg()).toBe(1);
    });

    it("accepts positive integer", () => {
      setMaxActiveSlasPerOrg(5);
      expect(getMaxActiveSlasPerOrg()).toBe(5);
    });

    it("floors non-integer input", () => {
      setMaxActiveSlasPerOrg(3.7);
      expect(getMaxActiveSlasPerOrg()).toBe(3);
    });

    it("rejects <1 / NaN / non-number", () => {
      expect(() => setMaxActiveSlasPerOrg(0)).toThrow(/positive integer/);
      expect(() => setMaxActiveSlasPerOrg(-1)).toThrow(/positive integer/);
      expect(() => setMaxActiveSlasPerOrg(NaN)).toThrow(/positive integer/);
      expect(() => setMaxActiveSlasPerOrg("5")).toThrow(/positive integer/);
    });

    it("is reset by _resetState", () => {
      setMaxActiveSlasPerOrg(10);
      _resetState();
      expect(getMaxActiveSlasPerOrg()).toBe(1);
    });
  });

  describe("createSLAV2 + getActiveSlaCountForOrg", () => {
    it("creates an ACTIVE contract and increments org count", () => {
      const c = createSLAV2(db, { orgId: "org-a", tier: "gold" });
      expect(c.status).toBe(SLA_STATUS_V2.ACTIVE);
      expect(getActiveSlaCountForOrg("org-a")).toBe(1);
      expect(getActiveSlaCountForOrg("org-b")).toBe(0);
    });

    it("rejects second ACTIVE contract for same org at default cap", () => {
      createSLAV2(db, { orgId: "org-a", tier: "gold" });
      expect(() => createSLAV2(db, { orgId: "org-a", tier: "silver" })).toThrow(
        /Max active SLAs per org reached/,
      );
    });

    it("allows second contract after first is terminated", () => {
      const first = createSLAV2(db, { orgId: "org-a", tier: "gold" });
      setSLAStatus(db, first.slaId, SLA_STATUS_V2.TERMINATED);
      expect(() =>
        createSLAV2(db, { orgId: "org-a", tier: "silver" }),
      ).not.toThrow();
    });

    it("allows multiple orgs independently", () => {
      createSLAV2(db, { orgId: "org-a", tier: "gold" });
      createSLAV2(db, { orgId: "org-b", tier: "silver" });
      expect(getActiveSlaCountForOrg("org-a")).toBe(1);
      expect(getActiveSlaCountForOrg("org-b")).toBe(1);
    });

    it("rejects missing orgId", () => {
      expect(() => createSLAV2(db)).toThrow(/orgId is required/);
    });
  });

  describe("setSLAStatus state machine", () => {
    it("active → expired is allowed", () => {
      const c = createSLAV2(db, { orgId: "org-a" });
      const out = setSLAStatus(db, c.slaId, SLA_STATUS_V2.EXPIRED);
      expect(out.status).toBe("expired");
    });

    it("active → terminated is allowed", () => {
      const c = createSLAV2(db, { orgId: "org-a" });
      const out = setSLAStatus(db, c.slaId, SLA_STATUS_V2.TERMINATED);
      expect(out.status).toBe("terminated");
    });

    it("rejects transition from terminal state", () => {
      const c = createSLAV2(db, { orgId: "org-a" });
      setSLAStatus(db, c.slaId, SLA_STATUS_V2.EXPIRED);
      expect(() => setSLAStatus(db, c.slaId, SLA_STATUS_V2.TERMINATED)).toThrow(
        /Invalid SLA status transition/,
      );
    });

    it("rejects unknown status", () => {
      const c = createSLAV2(db, { orgId: "org-a" });
      expect(() => setSLAStatus(db, c.slaId, "foo")).toThrow(
        /Unknown SLA status/,
      );
    });

    it("rejects unknown slaId", () => {
      expect(() => setSLAStatus(db, "nope", SLA_STATUS_V2.EXPIRED)).toThrow(
        /not found/,
      );
    });

    it("expireSLA is a shortcut", () => {
      const c = createSLAV2(db, { orgId: "org-a" });
      const out = expireSLA(db, c.slaId);
      expect(out.status).toBe("expired");
    });
  });

  describe("autoExpireSLAs", () => {
    it("flips ACTIVE contracts past endDate to EXPIRED", () => {
      const c = createSLAV2(db, { orgId: "org-a", duration: 1 });
      const flipped = autoExpireSLAs(db, Date.now() + 10000);
      expect(flipped).toHaveLength(1);
      expect(flipped[0].slaId).toBe(c.slaId);
      expect(flipped[0].status).toBe("expired");
    });

    it("leaves future-dated ACTIVE contracts alone", () => {
      createSLAV2(db, { orgId: "org-a", duration: 1_000_000 });
      const flipped = autoExpireSLAs(db, Date.now());
      expect(flipped).toHaveLength(0);
    });

    it("is a no-op for already-terminal contracts", () => {
      const c = createSLAV2(db, { orgId: "org-a", duration: 1 });
      setSLAStatus(db, c.slaId, SLA_STATUS_V2.TERMINATED);
      const flipped = autoExpireSLAs(db, Date.now() + 10000);
      expect(flipped).toHaveLength(0);
    });
  });

  describe("violation status machine", () => {
    function seedViolation() {
      const c = createSLAV2(db, { orgId: "org-a", tier: "gold" });
      recordMetric(db, c.slaId, "availability", 0.5);
      const { violations } = checkViolations(db, c.slaId);
      return violations[0];
    }

    it("open → acknowledged → resolved", () => {
      const v = seedViolation();
      const a = acknowledgeViolation(db, v.violationId, "investigating");
      expect(a.v2Status).toBe("acknowledged");
      expect(a.note).toBe("investigating");
      const r = resolveViolation(db, v.violationId, "patched");
      expect(r.v2Status).toBe("resolved");
      expect(r.resolvedAt).toBeTruthy();
    });

    it("open → waived (skip ack)", () => {
      const v = seedViolation();
      const w = waiveViolation(db, v.violationId, "scheduled maintenance");
      expect(w.v2Status).toBe("waived");
      expect(w.resolvedAt).toBeTruthy();
    });

    it("rejects resolved → acknowledged", () => {
      const v = seedViolation();
      resolveViolation(db, v.violationId);
      expect(() => acknowledgeViolation(db, v.violationId)).toThrow(
        /Invalid violation status transition/,
      );
    });

    it("rejects unknown status", () => {
      const v = seedViolation();
      expect(() => setViolationStatus(db, v.violationId, "pending")).toThrow(
        /Unknown violation status/,
      );
    });

    it("rejects unknown violationId", () => {
      expect(() =>
        setViolationStatus(db, "nope", VIOLATION_STATUS_V2.ACKNOWLEDGED),
      ).toThrow(/not found/);
    });
  });

  describe("getSLAStatsV2", () => {
    it("returns zero-state shape with all enum keys initialised", () => {
      const stats = getSLAStatsV2();
      expect(stats.totalContracts).toBe(0);
      expect(stats.activeContracts).toBe(0);
      expect(stats.activeOrgs).toBe(0);
      expect(stats.maxActiveSlasPerOrg).toBe(1);
      for (const s of Object.values(SLA_STATUS_V2)) {
        expect(stats.byStatus[s]).toBe(0);
      }
      for (const t of Object.values(SLA_TIER_V2)) {
        expect(stats.byTier[t]).toBe(0);
      }
      expect(stats.violations.total).toBe(0);
      for (const t of Object.values(SLA_TERM_V2)) {
        expect(stats.violations.byTerm[t]).toBe(0);
      }
      for (const s of Object.values(VIOLATION_SEVERITY_V2)) {
        expect(stats.violations.bySeverity[s]).toBe(0);
      }
      for (const s of Object.values(VIOLATION_STATUS_V2)) {
        expect(stats.violations.byStatus[s]).toBe(0);
      }
    });

    it("aggregates contracts and violations", () => {
      const c = createSLAV2(db, { orgId: "org-a", tier: "gold" });
      recordMetric(db, c.slaId, "availability", 0.5);
      checkViolations(db, c.slaId);

      const stats = getSLAStatsV2();
      expect(stats.totalContracts).toBe(1);
      expect(stats.activeContracts).toBe(1);
      expect(stats.activeOrgs).toBe(1);
      expect(stats.byStatus.active).toBe(1);
      expect(stats.byTier.gold).toBe(1);
      expect(stats.violations.total).toBe(1);
      expect(stats.violations.byTerm.availability).toBe(1);
      expect(stats.violations.byStatus.open).toBe(1);
    });
  });
});
