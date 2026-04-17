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
