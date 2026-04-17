import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  SEVERITY,
  INCIDENT_STATUS,
  DETECTION_ALGORITHM,
  ROLLBACK_TYPE,
  ensureAiOpsTables,
  updateBaseline,
  getBaseline,
  listBaselines,
  detectAnomaly,
  createIncident,
  getIncident,
  acknowledgeIncident,
  resolveIncident,
  closeIncident,
  listIncidents,
  createPlaybook,
  getPlaybook,
  togglePlaybook,
  recordPlaybookResult,
  listPlaybooks,
  generatePostmortem,
  getOpsStats,
  _resetState,
  // V2 surface
  PLAYBOOK_MATURITY_V2,
  REMEDIATION_LIFECYCLE_V2,
  AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER,
  AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER,
  AIOPS_DEFAULT_PLAYBOOK_STALE_MS,
  AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS,
  getDefaultMaxActivePlaybooksPerOwnerV2,
  getMaxActivePlaybooksPerOwnerV2,
  setMaxActivePlaybooksPerOwnerV2,
  getDefaultMaxPendingRemediationsPerOwnerV2,
  getMaxPendingRemediationsPerOwnerV2,
  setMaxPendingRemediationsPerOwnerV2,
  getDefaultPlaybookStaleMsV2,
  getPlaybookStaleMsV2,
  setPlaybookStaleMsV2,
  getDefaultRemediationTimeoutMsV2,
  getRemediationTimeoutMsV2,
  setRemediationTimeoutMsV2,
  registerPlaybookV2,
  getPlaybookV2,
  setPlaybookMaturityV2,
  activatePlaybook,
  deprecatePlaybookV2,
  retirePlaybook,
  touchPlaybookActivity,
  submitRemediationV2,
  getRemediationV2,
  setRemediationStatusV2,
  startRemediation,
  completeRemediation,
  failRemediation,
  abortRemediation,
  getActivePlaybookCount,
  getPendingRemediationCount,
  autoRetireStalePlaybooks,
  autoTimeoutStuckRemediations,
  getAiOpsStatsV2,
  _resetStateV2,
} from "../../src/lib/aiops.js";

describe("aiops", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureAiOpsTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureAiOpsTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("ops_incidents")).toBe(true);
      expect(db.tables.has("ops_remediation_playbooks")).toBe(true);
      expect(db.tables.has("ops_metrics_baseline")).toBe(true);
    });

    it("is idempotent", () => {
      ensureAiOpsTables(db);
      expect(db.tables.has("ops_incidents")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 severity levels", () => {
      expect(Object.keys(SEVERITY)).toHaveLength(4);
    });

    it("has 4 incident statuses", () => {
      expect(Object.keys(INCIDENT_STATUS)).toHaveLength(4);
    });

    it("has 2 detection algorithms", () => {
      expect(Object.keys(DETECTION_ALGORITHM)).toHaveLength(2);
    });

    it("has 5 rollback types", () => {
      expect(Object.keys(ROLLBACK_TYPE)).toHaveLength(5);
    });
  });

  /* ── Baselines ───────────────────────────────────── */

  describe("updateBaseline", () => {
    it("computes mean and stddev", () => {
      const r = updateBaseline(db, "cpu_usage", [10, 20, 30, 40, 50]);
      expect(r.updated).toBe(true);
      expect(r.baseline.mean).toBe(30);
      expect(r.baseline.std_dev).toBeGreaterThan(0);
      expect(r.baseline.sample_count).toBe(5);
    });

    it("computes Q1 and Q3", () => {
      const r = updateBaseline(db, "mem", [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(r.baseline.q1).toBe(3); // floor(8*0.25)=2 → sorted[2]=3
      expect(r.baseline.q3).toBe(7); // floor(8*0.75)=6 → sorted[6]=7
    });

    it("updates existing baseline", () => {
      updateBaseline(db, "disk", [10, 20, 30]);
      const r = updateBaseline(db, "disk", [100, 200, 300]);
      expect(r.updated).toBe(true);
      expect(r.baseline.mean).toBe(200);
    });

    it("rejects missing metric name", () => {
      const r = updateBaseline(db, "", [1, 2]);
      expect(r.updated).toBe(false);
    });

    it("rejects empty values", () => {
      const r = updateBaseline(db, "cpu", []);
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("empty_values");
    });
  });

  describe("getBaseline / listBaselines", () => {
    it("retrieves baseline", () => {
      updateBaseline(db, "cpu", [10, 20, 30]);
      const b = getBaseline(db, "cpu");
      expect(b.metric_name).toBe("cpu");
      expect(b.mean).toBe(20);
    });

    it("returns null for unknown metric", () => {
      expect(getBaseline(db, "nope")).toBeNull();
    });

    it("lists all baselines", () => {
      updateBaseline(db, "cpu", [10, 20]);
      updateBaseline(db, "mem", [50, 60]);
      expect(listBaselines(db)).toHaveLength(2);
    });
  });

  /* ── Anomaly Detection ───────────────────────────── */

  describe("detectAnomaly", () => {
    beforeEach(() => {
      // mean=50, stddev≈14.14
      updateBaseline(db, "cpu", [30, 35, 40, 45, 50, 55, 60, 65, 70]);
    });

    it("detects z-score anomaly", () => {
      const r = detectAnomaly(db, {
        metricName: "cpu",
        value: 200,
        algorithm: "z_score",
      });
      expect(r.anomaly).toBe(true);
      expect(r.score).toBeGreaterThan(3);
      expect(r.incidentId).toBeTruthy();
    });

    it("returns normal for value within range", () => {
      const r = detectAnomaly(db, {
        metricName: "cpu",
        value: 52,
        algorithm: "z_score",
      });
      expect(r.anomaly).toBe(false);
    });

    it("detects IQR anomaly", () => {
      const r = detectAnomaly(db, {
        metricName: "cpu",
        value: 200,
        algorithm: "iqr",
      });
      expect(r.anomaly).toBe(true);
    });

    it("returns normal for IQR within range", () => {
      const r = detectAnomaly(db, {
        metricName: "cpu",
        value: 50,
        algorithm: "iqr",
      });
      expect(r.anomaly).toBe(false);
    });

    it("auto-creates incident on anomaly", () => {
      const r = detectAnomaly(db, { metricName: "cpu", value: 200 });
      expect(r.incidentId).toBeTruthy();
      const inc = getIncident(db, r.incidentId);
      expect(inc.status).toBe("open");
      expect(inc.anomaly_metric).toBe("cpu");
    });

    it("assigns severity based on score", () => {
      // Very extreme value should get P0 or P1
      const r = detectAnomaly(db, { metricName: "cpu", value: 500 });
      expect(["P0", "P1"]).toContain(r.severity);
    });

    it("rejects missing metric", () => {
      const r = detectAnomaly(db, { value: 100 });
      expect(r.anomaly).toBe(false);
      expect(r.reason).toBe("missing_metric_name");
    });

    it("rejects unknown baseline", () => {
      const r = detectAnomaly(db, { metricName: "unknown", value: 100 });
      expect(r.anomaly).toBe(false);
      expect(r.reason).toBe("no_baseline");
    });

    it("rejects unknown algorithm", () => {
      const r = detectAnomaly(db, {
        metricName: "cpu",
        value: 100,
        algorithm: "ewma",
      });
      expect(r.anomaly).toBe(false);
      expect(r.reason).toBe("unknown_algorithm");
    });
  });

  /* ── Incidents ───────────────────────────────────── */

  describe("createIncident", () => {
    it("creates an incident", () => {
      const r = createIncident(db, {
        anomalyMetric: "cpu",
        severity: "P1",
        description: "CPU spike",
      });
      expect(r.incidentId).toBeTruthy();
      const i = getIncident(db, r.incidentId);
      expect(i.severity).toBe("P1");
      expect(i.status).toBe("open");
      expect(i.anomaly_metric).toBe("cpu");
    });

    it("defaults to P3 for invalid severity", () => {
      const { incidentId } = createIncident(db, { severity: "P9" });
      expect(getIncident(db, incidentId).severity).toBe("P3");
    });
  });

  describe("incident lifecycle", () => {
    let incId;
    beforeEach(() => {
      incId = createIncident(db, {
        severity: "P2",
        description: "test",
      }).incidentId;
    });

    it("acknowledges open incident", () => {
      const r = acknowledgeIncident(db, incId);
      expect(r.acknowledged).toBe(true);
      expect(getIncident(db, incId).status).toBe("acknowledged");
      expect(getIncident(db, incId).acknowledged_at).toBeTruthy();
    });

    it("rejects acknowledging non-open incident", () => {
      acknowledgeIncident(db, incId);
      const r = acknowledgeIncident(db, incId);
      expect(r.acknowledged).toBe(false);
      expect(r.reason).toBe("not_open");
    });

    it("resolves open incident", () => {
      const r = resolveIncident(db, incId);
      expect(r.resolved).toBe(true);
      expect(getIncident(db, incId).status).toBe("resolved");
    });

    it("resolves acknowledged incident", () => {
      acknowledgeIncident(db, incId);
      const r = resolveIncident(db, incId);
      expect(r.resolved).toBe(true);
    });

    it("closes resolved incident", () => {
      resolveIncident(db, incId);
      const r = closeIncident(db, incId);
      expect(r.closed).toBe(true);
      expect(getIncident(db, incId).status).toBe("closed");
    });

    it("rejects closing non-resolved incident", () => {
      const r = closeIncident(db, incId);
      expect(r.closed).toBe(false);
      expect(r.reason).toBe("not_resolved");
    });

    it("returns not_found for unknown id", () => {
      expect(acknowledgeIncident(db, "nope").reason).toBe("not_found");
      expect(resolveIncident(db, "nope").reason).toBe("not_found");
      expect(closeIncident(db, "nope").reason).toBe("not_found");
    });
  });

  describe("listIncidents", () => {
    it("lists all incidents", () => {
      createIncident(db, { severity: "P0" });
      createIncident(db, { severity: "P2" });
      expect(listIncidents(db)).toHaveLength(2);
    });

    it("filters by severity", () => {
      createIncident(db, { severity: "P0" });
      createIncident(db, { severity: "P2" });
      expect(listIncidents(db, { severity: "P0" })).toHaveLength(1);
    });

    it("filters by status", () => {
      const { incidentId } = createIncident(db, {});
      createIncident(db, {});
      acknowledgeIncident(db, incidentId);
      expect(listIncidents(db, { status: "acknowledged" })).toHaveLength(1);
      expect(listIncidents(db, { status: "open" })).toHaveLength(1);
    });
  });

  /* ── Playbooks ───────────────────────────────────── */

  describe("createPlaybook", () => {
    it("creates a playbook", () => {
      const r = createPlaybook(db, {
        name: "restart-service",
        triggerCondition: '{"metric":"cpu","threshold":90}',
        steps: '["stop service","clear cache","start service"]',
      });
      expect(r.playbookId).toBeTruthy();
      const p = getPlaybook(db, r.playbookId);
      expect(p.name).toBe("restart-service");
      expect(p.enabled).toBe(1);
    });

    it("rejects missing name", () => {
      const r = createPlaybook(db, {});
      expect(r.playbookId).toBeNull();
    });
  });

  describe("togglePlaybook", () => {
    it("disables and enables", () => {
      const { playbookId } = createPlaybook(db, { name: "test" });
      togglePlaybook(db, playbookId, false);
      expect(getPlaybook(db, playbookId).enabled).toBe(0);
      togglePlaybook(db, playbookId, true);
      expect(getPlaybook(db, playbookId).enabled).toBe(1);
    });

    it("rejects unknown id", () => {
      const r = togglePlaybook(db, "nope", true);
      expect(r.toggled).toBe(false);
    });
  });

  describe("recordPlaybookResult", () => {
    it("increments success count", () => {
      const { playbookId } = createPlaybook(db, { name: "test" });
      recordPlaybookResult(db, playbookId, true);
      recordPlaybookResult(db, playbookId, true);
      recordPlaybookResult(db, playbookId, false);
      const p = getPlaybook(db, playbookId);
      expect(p.success_count).toBe(2);
      expect(p.failure_count).toBe(1);
    });
  });

  describe("listPlaybooks", () => {
    it("lists playbooks", () => {
      createPlaybook(db, { name: "a" });
      createPlaybook(db, { name: "b" });
      expect(listPlaybooks(db)).toHaveLength(2);
    });

    it("filters by enabled", () => {
      const { playbookId } = createPlaybook(db, { name: "a" });
      createPlaybook(db, { name: "b" });
      togglePlaybook(db, playbookId, false);
      expect(listPlaybooks(db, { enabled: true })).toHaveLength(1);
      expect(listPlaybooks(db, { enabled: false })).toHaveLength(1);
    });
  });

  /* ── Postmortem ──────────────────────────────────── */

  describe("generatePostmortem", () => {
    it("generates postmortem for resolved incident", () => {
      const { incidentId } = createIncident(db, {
        anomalyMetric: "cpu",
        severity: "P1",
        description: "CPU overload",
      });
      acknowledgeIncident(db, incidentId);
      resolveIncident(db, incidentId);
      const r = generatePostmortem(db, incidentId);
      expect(r.generated).toBe(true);
      expect(r.postmortem.severity).toBe("P1");
      expect(r.postmortem.timeline.timeToResolveMs).toBeGreaterThanOrEqual(0);
      expect(r.postmortem.timeline.timeToAcknowledgeMs).toBeGreaterThanOrEqual(
        0,
      );
    });

    it("stores postmortem in incident", () => {
      const { incidentId } = createIncident(db, {});
      resolveIncident(db, incidentId);
      generatePostmortem(db, incidentId);
      const i = getIncident(db, incidentId);
      expect(i.postmortem).toBeTruthy();
      expect(JSON.parse(i.postmortem).incidentId).toBe(incidentId);
    });

    it("rejects non-resolved incident", () => {
      const { incidentId } = createIncident(db, {});
      const r = generatePostmortem(db, incidentId);
      expect(r.generated).toBe(false);
      expect(r.reason).toBe("not_resolved");
    });

    it("rejects unknown id", () => {
      const r = generatePostmortem(db, "nope");
      expect(r.generated).toBe(false);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getOpsStats", () => {
    it("returns zeros when empty", () => {
      const s = getOpsStats(db);
      expect(s.incidents.total).toBe(0);
      expect(s.playbooks.total).toBe(0);
      expect(s.baselines.total).toBe(0);
    });

    it("computes correct stats", () => {
      createIncident(db, { severity: "P0" });
      const { incidentId } = createIncident(db, { severity: "P2" });
      resolveIncident(db, incidentId);
      createPlaybook(db, { name: "a" });
      const { playbookId } = createPlaybook(db, { name: "b" });
      recordPlaybookResult(db, playbookId, true);
      updateBaseline(db, "cpu", [10, 20, 30]);

      const s = getOpsStats(db);
      expect(s.incidents.total).toBe(2);
      expect(s.incidents.bySeverity.P0).toBe(1);
      expect(s.incidents.bySeverity.P2).toBe(1);
      expect(s.incidents.byStatus.open).toBe(1);
      expect(s.incidents.byStatus.resolved).toBe(1);
      expect(s.playbooks.total).toBe(2);
      expect(s.playbooks.totalSuccess).toBe(1);
      expect(s.baselines.total).toBe(1);
      expect(s.baselines.metrics).toContain("cpu");
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
 * Phase 25 AIOps V2 — 4-state playbook + 5-state remediation
 * ═════════════════════════════════════════════════════════════ */

describe("aiops V2 (Phase 25)", () => {
  let db;

  beforeEach(() => {
    _resetState();
    _resetStateV2();
    db = new MockDatabase();
    ensureAiOpsTables(db);
  });

  describe("Frozen enums + defaults", () => {
    it("PLAYBOOK_MATURITY_V2 is frozen and exposes 4 states", () => {
      expect(Object.isFrozen(PLAYBOOK_MATURITY_V2)).toBe(true);
      expect(PLAYBOOK_MATURITY_V2.DRAFT).toBe("draft");
      expect(PLAYBOOK_MATURITY_V2.ACTIVE).toBe("active");
      expect(PLAYBOOK_MATURITY_V2.DEPRECATED).toBe("deprecated");
      expect(PLAYBOOK_MATURITY_V2.RETIRED).toBe("retired");
    });

    it("REMEDIATION_LIFECYCLE_V2 is frozen and exposes 5 states", () => {
      expect(Object.isFrozen(REMEDIATION_LIFECYCLE_V2)).toBe(true);
      expect(REMEDIATION_LIFECYCLE_V2.PENDING).toBe("pending");
      expect(REMEDIATION_LIFECYCLE_V2.EXECUTING).toBe("executing");
      expect(REMEDIATION_LIFECYCLE_V2.SUCCEEDED).toBe("succeeded");
      expect(REMEDIATION_LIFECYCLE_V2.FAILED).toBe("failed");
      expect(REMEDIATION_LIFECYCLE_V2.ABORTED).toBe("aborted");
    });

    it("exposes all four defaults", () => {
      expect(AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER).toBe(50);
      expect(AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER).toBe(10);
      expect(AIOPS_DEFAULT_PLAYBOOK_STALE_MS).toBe(90 * 86400000);
      expect(AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS).toBe(30 * 60 * 1000);
      expect(getDefaultMaxActivePlaybooksPerOwnerV2()).toBe(50);
      expect(getDefaultMaxPendingRemediationsPerOwnerV2()).toBe(10);
      expect(getDefaultPlaybookStaleMsV2()).toBe(90 * 86400000);
      expect(getDefaultRemediationTimeoutMsV2()).toBe(30 * 60 * 1000);
    });
  });

  describe("Config mutators", () => {
    it("setMaxActivePlaybooksPerOwnerV2 floors + rejects bad", () => {
      expect(setMaxActivePlaybooksPerOwnerV2(20)).toBe(20);
      expect(getMaxActivePlaybooksPerOwnerV2()).toBe(20);
      expect(setMaxActivePlaybooksPerOwnerV2(7.9)).toBe(7);
      expect(() => setMaxActivePlaybooksPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setMaxActivePlaybooksPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActivePlaybooksPerOwnerV2(NaN)).toThrow();
    });

    it("setMaxPendingRemediationsPerOwnerV2 floors + rejects bad", () => {
      expect(setMaxPendingRemediationsPerOwnerV2(5)).toBe(5);
      expect(getMaxPendingRemediationsPerOwnerV2()).toBe(5);
      expect(setMaxPendingRemediationsPerOwnerV2(3.4)).toBe(3);
      expect(() => setMaxPendingRemediationsPerOwnerV2(0)).toThrow();
    });

    it("setPlaybookStaleMsV2 + setRemediationTimeoutMsV2 validate", () => {
      expect(setPlaybookStaleMsV2(1000)).toBe(1000);
      expect(getPlaybookStaleMsV2()).toBe(1000);
      expect(setRemediationTimeoutMsV2(5000)).toBe(5000);
      expect(getRemediationTimeoutMsV2()).toBe(5000);
      expect(() => setPlaybookStaleMsV2(0)).toThrow();
      expect(() => setRemediationTimeoutMsV2(-10)).toThrow();
    });

    it("_resetStateV2 restores all four config defaults + clears maps", () => {
      setMaxActivePlaybooksPerOwnerV2(5);
      setMaxPendingRemediationsPerOwnerV2(2);
      setPlaybookStaleMsV2(100);
      setRemediationTimeoutMsV2(200);
      registerPlaybookV2(db, { playbookId: "p1", ownerId: "svc1" });
      _resetStateV2();
      expect(getMaxActivePlaybooksPerOwnerV2()).toBe(50);
      expect(getMaxPendingRemediationsPerOwnerV2()).toBe(10);
      expect(getPlaybookStaleMsV2()).toBe(90 * 86400000);
      expect(getRemediationTimeoutMsV2()).toBe(30 * 60 * 1000);
      expect(getPlaybookV2("p1")).toBe(null);
    });
  });

  describe("registerPlaybookV2", () => {
    it("tags DRAFT by default + lastUsedAt", () => {
      const rec = registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        name: "restart-service",
        now: 1000,
      });
      expect(rec.status).toBe("draft");
      expect(rec.playbookId).toBe("p1");
      expect(rec.ownerId).toBe("svc1");
      expect(rec.createdAt).toBe(1000);
      expect(rec.lastUsedAt).toBe(1000);
    });

    it("can register directly as ACTIVE via initialStatus", () => {
      const rec = registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
      expect(rec.status).toBe("active");
    });

    it("throws missing playbookId", () => {
      expect(() => registerPlaybookV2(db, { ownerId: "svc1" })).toThrow(
        /playbookId/,
      );
    });

    it("throws missing ownerId", () => {
      expect(() => registerPlaybookV2(db, { playbookId: "p1" })).toThrow(
        /ownerId/,
      );
    });

    it("throws on duplicate playbookId", () => {
      registerPlaybookV2(db, { playbookId: "p1", ownerId: "svc1" });
      expect(() =>
        registerPlaybookV2(db, { playbookId: "p1", ownerId: "svc2" }),
      ).toThrow(/already/);
    });

    it("rejects initial status 'retired'", () => {
      expect(() =>
        registerPlaybookV2(db, {
          playbookId: "p1",
          ownerId: "svc1",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("rejects invalid initial status", () => {
      expect(() =>
        registerPlaybookV2(db, {
          playbookId: "p1",
          ownerId: "svc1",
          initialStatus: "bogus",
        }),
      ).toThrow(/Invalid initial status/);
    });

    it("enforces per-owner active cap when registering ACTIVE", () => {
      setMaxActivePlaybooksPerOwnerV2(2);
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
      });
      expect(() =>
        registerPlaybookV2(db, {
          playbookId: "p3",
          ownerId: "svc1",
          initialStatus: "active",
        }),
      ).toThrow(/Max active playbooks/);
      // Other owner unaffected
      expect(() =>
        registerPlaybookV2(db, {
          playbookId: "p4",
          ownerId: "svc2",
          initialStatus: "active",
        }),
      ).not.toThrow();
      // Draft doesn't count toward cap
      expect(() =>
        registerPlaybookV2(db, { playbookId: "p5", ownerId: "svc1" }),
      ).not.toThrow();
    });
  });

  describe("setPlaybookMaturityV2", () => {
    beforeEach(() => {
      registerPlaybookV2(db, { playbookId: "p1", ownerId: "svc1" });
    });

    it("full traversal draft → active → deprecated → retired", () => {
      expect(setPlaybookMaturityV2(db, "p1", "active").status).toBe("active");
      expect(setPlaybookMaturityV2(db, "p1", "deprecated").status).toBe(
        "deprecated",
      );
      expect(setPlaybookMaturityV2(db, "p1", "retired").status).toBe("retired");
    });

    it("deprecated → active revive", () => {
      setPlaybookMaturityV2(db, "p1", "active");
      setPlaybookMaturityV2(db, "p1", "deprecated");
      expect(activatePlaybook(db, "p1").status).toBe("active");
    });

    it("draft → retired directly allowed", () => {
      expect(retirePlaybook(db, "p1").status).toBe("retired");
    });

    it("draft → deprecated is blocked", () => {
      expect(() => setPlaybookMaturityV2(db, "p1", "deprecated")).toThrow(
        /Invalid transition/,
      );
    });

    it("terminal retired cannot transition", () => {
      retirePlaybook(db, "p1");
      expect(() => setPlaybookMaturityV2(db, "p1", "active")).toThrow(
        /terminal/,
      );
    });

    it("throws on unknown playbook", () => {
      expect(() => setPlaybookMaturityV2(db, "unknown", "active")).toThrow(
        /not registered/,
      );
    });

    it("throws on invalid status", () => {
      expect(() => setPlaybookMaturityV2(db, "p1", "bogus")).toThrow(
        /Invalid playbook status/,
      );
    });

    it("enforces per-owner active cap on transition to active", () => {
      setMaxActivePlaybooksPerOwnerV2(1);
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
      });
      expect(() => setPlaybookMaturityV2(db, "p1", "active")).toThrow(
        /Max active playbooks/,
      );
    });

    it("merges patch.metadata", () => {
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        metadata: { criticality: "high", tags: ["db"] },
      });
      setPlaybookMaturityV2(db, "p2", "active", {
        reason: "approved",
        metadata: { criticality: "critical", approver: "sre-lead" },
      });
      const rec = getPlaybookV2("p2");
      expect(rec.reason).toBe("approved");
      expect(rec.metadata.criticality).toBe("critical");
      expect(rec.metadata.tags).toEqual(["db"]);
      expect(rec.metadata.approver).toBe("sre-lead");
    });

    it("getPlaybookV2 returns null for unknown", () => {
      expect(getPlaybookV2("bogus")).toBe(null);
    });
  });

  describe("touchPlaybookActivity", () => {
    it("bumps lastUsedAt", async () => {
      const rec = registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        now: 1000,
      });
      expect(rec.lastUsedAt).toBe(1000);
      await new Promise((r) => setTimeout(r, 5));
      const touched = touchPlaybookActivity("p1");
      expect(touched.lastUsedAt).toBeGreaterThan(1000);
    });

    it("throws on unknown", () => {
      expect(() => touchPlaybookActivity("unknown")).toThrow(/not registered/);
    });
  });

  describe("submitRemediationV2", () => {
    beforeEach(() => {
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
    });

    it("tags PENDING + all fields preserved", () => {
      const rec = submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
      expect(rec.status).toBe("pending");
      expect(rec.playbookId).toBe("p1");
      expect(rec.ownerId).toBe("svc1");
      expect(rec.startedAt).toBe(null);
      expect(rec.completedAt).toBe(null);
    });

    it("throws on missing fields", () => {
      expect(() =>
        submitRemediationV2(db, { playbookId: "p1", ownerId: "svc1" }),
      ).toThrow(/remediationId/);
      expect(() =>
        submitRemediationV2(db, { remediationId: "r1", ownerId: "svc1" }),
      ).toThrow(/playbookId/);
      expect(() =>
        submitRemediationV2(db, { remediationId: "r1", playbookId: "p1" }),
      ).toThrow(/ownerId/);
    });

    it("throws on duplicate remediationId", () => {
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r1",
          playbookId: "p1",
          ownerId: "svc2",
        }),
      ).toThrow(/already/);
    });

    it("throws when playbook unregistered in V2", () => {
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r1",
          playbookId: "unknown",
          ownerId: "svc1",
        }),
      ).toThrow(/Playbook not registered/);
    });

    it("rejects if playbook is retired", () => {
      retirePlaybook(db, "p1");
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r1",
          playbookId: "p1",
          ownerId: "svc1",
        }),
      ).toThrow(/retired/);
    });

    it("rejects if playbook is in draft (not yet activated)", () => {
      registerPlaybookV2(db, { playbookId: "p-draft", ownerId: "svc1" });
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r1",
          playbookId: "p-draft",
          ownerId: "svc1",
        }),
      ).toThrow(/draft/);
    });

    it("allows deprecated playbook (grace period)", () => {
      setPlaybookMaturityV2(db, "p1", "deprecated");
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r1",
          playbookId: "p1",
          ownerId: "svc1",
        }),
      ).not.toThrow();
    });

    it("enforces per-owner pending+executing cap", () => {
      setMaxPendingRemediationsPerOwnerV2(2);
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p1",
        ownerId: "svc1",
      });
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r3",
          playbookId: "p1",
          ownerId: "svc1",
        }),
      ).toThrow(/Max pending remediations/);
      // Other owner unaffected
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r4",
          playbookId: "p1",
          ownerId: "svc2",
        }),
      ).not.toThrow();
    });

    it("completed remediations don't count toward cap", () => {
      setMaxPendingRemediationsPerOwnerV2(2);
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p1",
        ownerId: "svc1",
      });
      startRemediation(db, "r1");
      completeRemediation(db, "r1");
      expect(() =>
        submitRemediationV2(db, {
          remediationId: "r3",
          playbookId: "p1",
          ownerId: "svc1",
        }),
      ).not.toThrow();
    });
  });

  describe("setRemediationStatusV2", () => {
    beforeEach(() => {
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
    });

    it("full happy path: pending → executing → succeeded", () => {
      const r1 = setRemediationStatusV2(db, "r1", "executing");
      expect(r1.status).toBe("executing");
      expect(r1.startedAt).toBeGreaterThan(0);
      const r2 = setRemediationStatusV2(db, "r1", "succeeded");
      expect(r2.status).toBe("succeeded");
      expect(r2.completedAt).toBeGreaterThan(0);
    });

    it("executing → failed", () => {
      startRemediation(db, "r1");
      expect(failRemediation(db, "r1").status).toBe("failed");
    });

    it("pending → aborted (direct)", () => {
      expect(abortRemediation(db, "r1").status).toBe("aborted");
    });

    it("executing → aborted", () => {
      startRemediation(db, "r1");
      expect(abortRemediation(db, "r1").status).toBe("aborted");
    });

    it("pending → succeeded blocked (must go through executing)", () => {
      expect(() => completeRemediation(db, "r1")).toThrow(/Invalid transition/);
    });

    it("terminal succeeded cannot transition", () => {
      startRemediation(db, "r1");
      completeRemediation(db, "r1");
      expect(() => setRemediationStatusV2(db, "r1", "executing")).toThrow(
        /terminal/,
      );
    });

    it("terminal failed cannot transition", () => {
      startRemediation(db, "r1");
      failRemediation(db, "r1");
      expect(() => setRemediationStatusV2(db, "r1", "executing")).toThrow(
        /terminal/,
      );
    });

    it("throws on unknown remediation", () => {
      expect(() => setRemediationStatusV2(db, "unknown", "executing")).toThrow(
        /not registered/,
      );
    });

    it("throws on invalid status", () => {
      expect(() => setRemediationStatusV2(db, "r1", "bogus")).toThrow(
        /Invalid remediation status/,
      );
    });

    it("merges patch.metadata", () => {
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p1",
        ownerId: "svc1",
        metadata: { runner: "sre-bot", retries: 0 },
      });
      setRemediationStatusV2(db, "r2", "executing", {
        reason: "auto",
        metadata: { retries: 1, hostname: "host-42" },
      });
      const rec = getRemediationV2("r2");
      expect(rec.reason).toBe("auto");
      expect(rec.metadata.retries).toBe(1);
      expect(rec.metadata.runner).toBe("sre-bot");
      expect(rec.metadata.hostname).toBe("host-42");
    });

    it("getRemediationV2 returns null for unknown", () => {
      expect(getRemediationV2("bogus")).toBe(null);
    });
  });

  describe("Counts", () => {
    beforeEach(() => {
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
      });
      registerPlaybookV2(db, {
        playbookId: "p3",
        ownerId: "svc2",
        initialStatus: "active",
      });
      registerPlaybookV2(db, { playbookId: "p4", ownerId: "svc1" });
    });

    it("getActivePlaybookCount — global + per-owner", () => {
      expect(getActivePlaybookCount()).toBe(3);
      expect(getActivePlaybookCount("svc1")).toBe(2);
      expect(getActivePlaybookCount("svc2")).toBe(1);
      expect(getActivePlaybookCount("svc3")).toBe(0);
    });

    it("only ACTIVE counts (draft/deprecated/retired excluded)", () => {
      deprecatePlaybookV2(db, "p1");
      retirePlaybook(db, "p2");
      expect(getActivePlaybookCount("svc1")).toBe(0);
    });

    it("getPendingRemediationCount — global + per-owner", () => {
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
      });
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p1",
        ownerId: "svc1",
      });
      submitRemediationV2(db, {
        remediationId: "r3",
        playbookId: "p3",
        ownerId: "svc2",
      });
      expect(getPendingRemediationCount()).toBe(3);
      expect(getPendingRemediationCount("svc1")).toBe(2);
      expect(getPendingRemediationCount("svc2")).toBe(1);
      startRemediation(db, "r1");
      expect(getPendingRemediationCount("svc1")).toBe(2); // executing still counts
      completeRemediation(db, "r1");
      expect(getPendingRemediationCount("svc1")).toBe(1);
    });
  });

  describe("autoRetireStalePlaybooks", () => {
    it("flips stale ACTIVE to retired with reason='stale'", () => {
      setPlaybookStaleMsV2(1000);
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
        now: 0,
      });
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
        now: 5000,
      });
      const flipped = autoRetireStalePlaybooks(db, 2000);
      expect(flipped).toEqual(["p1"]);
      expect(getPlaybookV2("p1").status).toBe("retired");
      expect(getPlaybookV2("p1").reason).toBe("stale");
      expect(getPlaybookV2("p2").status).toBe("active");
    });

    it("flips stale DRAFT + DEPRECATED", () => {
      setPlaybookStaleMsV2(1000);
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
        now: 0,
      });
      deprecatePlaybookV2(db, "p2");
      const flipped = autoRetireStalePlaybooks(db, 10000);
      expect(flipped.sort()).toEqual(["p1", "p2"]);
    });

    it("skips already retired", () => {
      setPlaybookStaleMsV2(100);
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      retirePlaybook(db, "p1");
      const flipped = autoRetireStalePlaybooks(db, 10_000);
      expect(flipped).toEqual([]);
    });

    it("skips fresh playbooks", () => {
      setPlaybookStaleMsV2(10000);
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      const flipped = autoRetireStalePlaybooks(db, 500);
      expect(flipped).toEqual([]);
    });
  });

  describe("autoTimeoutStuckRemediations", () => {
    beforeEach(() => {
      registerPlaybookV2(db, {
        playbookId: "p1",
        ownerId: "svc1",
        initialStatus: "active",
      });
    });

    it("flips stuck executing → failed with reason='timeout'", () => {
      setRemediationTimeoutMsV2(1000);
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      setRemediationStatusV2(db, "r1", "executing", { now: 0 });
      const flipped = autoTimeoutStuckRemediations(db, 2000);
      expect(flipped).toEqual(["r1"]);
      expect(getRemediationV2("r1").status).toBe("failed");
      expect(getRemediationV2("r1").reason).toBe("timeout");
      expect(getRemediationV2("r1").completedAt).toBe(2000);
    });

    it("skips non-executing remediations (pending/terminal)", () => {
      setRemediationTimeoutMsV2(100);
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      setRemediationStatusV2(db, "r2", "executing", { now: 0 });
      setRemediationStatusV2(db, "r2", "succeeded", { now: 50 });
      const flipped = autoTimeoutStuckRemediations(db, 10_000);
      expect(flipped).toEqual([]);
    });

    it("skips fresh executing remediations within threshold", () => {
      setRemediationTimeoutMsV2(10_000);
      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p1",
        ownerId: "svc1",
        now: 0,
      });
      setRemediationStatusV2(db, "r1", "executing", { now: 0 });
      const flipped = autoTimeoutStuckRemediations(db, 500);
      expect(flipped).toEqual([]);
    });
  });

  describe("getAiOpsStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const s = getAiOpsStatsV2();
      expect(s.totalPlaybooksV2).toBe(0);
      expect(s.totalRemediationsV2).toBe(0);
      expect(s.maxActivePlaybooksPerOwner).toBe(50);
      expect(s.maxPendingRemediationsPerOwner).toBe(10);
      expect(s.playbookStaleMs).toBe(90 * 86400000);
      expect(s.remediationTimeoutMs).toBe(30 * 60 * 1000);
      expect(s.playbooksByStatus).toEqual({
        draft: 0,
        active: 0,
        deprecated: 0,
        retired: 0,
      });
      expect(s.remediationsByStatus).toEqual({
        pending: 0,
        executing: 0,
        succeeded: 0,
        failed: 0,
        aborted: 0,
      });
    });

    it("aggregates across all states", () => {
      registerPlaybookV2(db, { playbookId: "p1", ownerId: "svc1" }); // draft
      registerPlaybookV2(db, {
        playbookId: "p2",
        ownerId: "svc1",
        initialStatus: "active",
      });
      registerPlaybookV2(db, {
        playbookId: "p3",
        ownerId: "svc1",
        initialStatus: "active",
      });
      deprecatePlaybookV2(db, "p3");
      registerPlaybookV2(db, { playbookId: "p4", ownerId: "svc1" });
      retirePlaybook(db, "p4");

      submitRemediationV2(db, {
        remediationId: "r1",
        playbookId: "p2",
        ownerId: "svc1",
      });
      submitRemediationV2(db, {
        remediationId: "r2",
        playbookId: "p2",
        ownerId: "svc1",
      });
      startRemediation(db, "r2");
      submitRemediationV2(db, {
        remediationId: "r3",
        playbookId: "p2",
        ownerId: "svc1",
      });
      startRemediation(db, "r3");
      completeRemediation(db, "r3");
      submitRemediationV2(db, {
        remediationId: "r4",
        playbookId: "p2",
        ownerId: "svc1",
      });
      abortRemediation(db, "r4");

      const s = getAiOpsStatsV2();
      expect(s.totalPlaybooksV2).toBe(4);
      expect(s.playbooksByStatus).toEqual({
        draft: 1,
        active: 1,
        deprecated: 1,
        retired: 1,
      });
      expect(s.totalRemediationsV2).toBe(4);
      expect(s.remediationsByStatus.pending).toBe(1);
      expect(s.remediationsByStatus.executing).toBe(1);
      expect(s.remediationsByStatus.succeeded).toBe(1);
      expect(s.remediationsByStatus.aborted).toBe(1);
      expect(s.remediationsByStatus.failed).toBe(0);
    });
  });
});
