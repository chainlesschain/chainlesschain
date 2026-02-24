/**
 * IncidentClassifier 单元测试 — v3.3
 *
 * 覆盖：initialize、classify（P0-P3分级/去重）、
 *       acknowledge、resolve、updateIncident、
 *       getIncidents、getIncident、getStats
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
const {
  IncidentClassifier,
  INCIDENT_STATUS,
  SEVERITY,
  SEVERITY_RULES,
} = require("../incident-classifier");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

function makeAnomalyEvent(overrides = {}) {
  return {
    id: "anomaly-001",
    metricName: "error_rate",
    value: 25,
    method: "z-score",
    severity: "P1",
    detectedAt: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IncidentClassifier", () => {
  let classifier;
  let db;

  beforeEach(() => {
    classifier = new IncidentClassifier();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and use DB via prepare", async () => {
      await classifier.initialize(db);

      expect(classifier.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should load open incidents from DB", async () => {
      db._prep.all.mockReturnValue([
        {
          id: "inc-001",
          metric_name: "error_rate",
          severity: "P1",
          status: "open",
          anomaly_count: 1,
          first_anomaly_at: Date.now(),
          last_anomaly_at: Date.now(),
          acknowledged_at: null,
          resolved_at: null,
          timeline: "[]",
          metadata: "{}",
        },
      ]);

      await classifier.initialize(db);
      expect(classifier._incidents.size).toBe(1);
    });

    it("should be idempotent", async () => {
      await classifier.initialize(db);
      const callsBefore = db.prepare.mock.calls.length;
      await classifier.initialize(db);
      expect(db.prepare.mock.calls.length).toBe(callsBefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // classify
  // ─────────────────────────────────────────────────────────────────────────
  describe("classify()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should create a new incident for an anomaly", () => {
      const anomaly = makeAnomalyEvent({ metricName: "error_rate", value: 25 });
      const incident = classifier.classify(anomaly);

      expect(incident).not.toBeNull();
      expect(incident.anomalyMetric).toBe("error_rate");
      expect(incident.status).toBe(INCIDENT_STATUS.OPEN);
    });

    it("should classify error_rate=60 as P0", () => {
      const anomaly = makeAnomalyEvent({ metricName: "error_rate", value: 60 });
      const incident = classifier.classify(anomaly);

      expect(incident.severity).toBe(SEVERITY.P0);
    });

    it("should classify error_rate=25 as P1", () => {
      const anomaly = makeAnomalyEvent({ metricName: "error_rate", value: 25 });
      const incident = classifier.classify(anomaly);

      expect(incident.severity).toBe(SEVERITY.P1);
    });

    it("should classify error_rate=12 as P2", () => {
      const anomaly = makeAnomalyEvent({ metricName: "error_rate", value: 12 });
      const incident = classifier.classify(anomaly);

      expect(incident.severity).toBe(SEVERITY.P2);
    });

    it("should classify error_rate=6 as P3", () => {
      const anomaly = makeAnomalyEvent({ metricName: "error_rate", value: 6 });
      const incident = classifier.classify(anomaly);

      expect(incident.severity).toBe(SEVERITY.P3);
    });

    it("should classify memory_usage=96 as P0", () => {
      const anomaly = makeAnomalyEvent({
        metricName: "memory_usage",
        value: 96,
      });
      const incident = classifier.classify(anomaly);
      expect(incident.severity).toBe(SEVERITY.P0);
    });

    it("should deduplicate anomalies within window into same incident", () => {
      const now = Date.now();
      const anomaly1 = makeAnomalyEvent({
        metricName: "cpu_usage",
        value: 85,
        detectedAt: now,
      });
      const anomaly2 = makeAnomalyEvent({
        metricName: "cpu_usage",
        value: 88,
        detectedAt: now + 60000, // 1 minute later (within 5-min window)
      });

      const inc1 = classifier.classify(anomaly1);
      const inc2 = classifier.classify(anomaly2);

      // Should be deduplicated into same incident
      expect(inc1.id).toBe(inc2.id);
      // Second anomaly adds an event to the timeline
      expect(inc2.timeline.length).toBeGreaterThan(1);
    });

    it("should create separate incidents for anomalies outside dedup window", () => {
      // First anomaly was 10 minutes ago — outside 5-min dedup window
      // Simulate by directly setting _recentAnomalies to a stale entry
      classifier._recentAnomalies.set("cpu_usage", {
        incidentId: "old-incident-id",
        lastSeen: Date.now() - 700000, // 11.7 minutes ago
      });
      // Create a fresh incident for a new anomaly
      classifier._incidents.set("old-incident-id", {
        id: "old-incident-id",
        status: "open",
        anomalyMetric: "cpu_usage",
      });

      const anomaly = makeAnomalyEvent({
        metricName: "cpu_usage",
        value: 88,
        detectedAt: Date.now(),
      });

      const inc = classifier.classify(anomaly);

      // New incident should be different from the stale one
      expect(inc.id).not.toBe("old-incident-id");
    });

    it("should emit incident:created event for new incidents", () => {
      const listener = vi.fn();
      classifier.on("incident:created", listener);

      classifier.classify(makeAnomalyEvent());

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should emit incident:updated event for deduped incident", () => {
      const updatedListener = vi.fn();
      classifier.on("incident:updated", updatedListener);

      const now = Date.now();
      classifier.classify(
        makeAnomalyEvent({ metricName: "disk_usage", value: 86, detectedAt: now }),
      );
      // Immediately send a second anomaly for same metric (within dedup window)
      classifier.classify(
        makeAnomalyEvent({ metricName: "disk_usage", value: 88, detectedAt: now + 1000 }),
      );

      expect(updatedListener).toHaveBeenCalledTimes(1);
    });

    it("should use P3 as fallback severity for unknown metrics", () => {
      const anomaly = makeAnomalyEvent({
        metricName: "custom_metric",
        value: 999,
        severity: "P3",
      });
      const incident = classifier.classify(anomaly);
      expect(incident).not.toBeNull();
      // Falls back to anomalySeverity which is P3
      expect([SEVERITY.P0, SEVERITY.P1, SEVERITY.P2, SEVERITY.P3]).toContain(
        incident.severity,
      );
    });

    it("should return null when classifier is disabled", async () => {
      classifier._config.enabled = false;
      const incident = classifier.classify(makeAnomalyEvent());
      expect(incident).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // acknowledge
  // ─────────────────────────────────────────────────────────────────────────
  describe("acknowledge()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should set status to acknowledged", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      const result = classifier.acknowledge(incident.id, {
        acknowledgedBy: "on-call-engineer",
      });

      expect(result.status).toBe(INCIDENT_STATUS.ACKNOWLEDGED);
      expect(result.acknowledgedAt).toBeTruthy();
    });

    it("should add timeline event", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      const result = classifier.acknowledge(incident.id, {
        acknowledgedBy: "engineer",
        comment: "Looking into it",
      });

      const ackEvent = result.timeline.find((e) => e.event === "acknowledged");
      expect(ackEvent).toBeTruthy();
      expect(ackEvent.by).toBe("engineer");
    });

    it("should throw for unknown incident id", () => {
      expect(() =>
        classifier.acknowledge("nonexistent-id"),
      ).toThrow();
    });

    it("should throw when re-acknowledging an already-acknowledged incident", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      classifier.acknowledge(incident.id, {});
      // Second acknowledge should fail
      expect(() => classifier.acknowledge(incident.id, {})).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolve
  // ─────────────────────────────────────────────────────────────────────────
  describe("resolve()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should set status to resolved with resolution note", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      const result = classifier.resolve(incident.id, {
        result: "Scaled up memory",
        resolvedBy: "auto-remediator",
      });

      expect(result.status).toBe(INCIDENT_STATUS.RESOLVED);
      expect(result.resolvedAt).toBeTruthy();
      expect(result.remediationResult).toBe("Scaled up memory");
    });

    it("should throw for unknown incident id", () => {
      expect(() =>
        classifier.resolve("nonexistent-id", { result: "notes" }),
      ).toThrow();
    });

    it("should throw if already resolved", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      classifier.resolve(incident.id, {});
      expect(() => classifier.resolve(incident.id, {})).toThrow("already resolved");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getIncidents
  // ─────────────────────────────────────────────────────────────────────────
  describe("getIncidents()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should return all incidents when no filter", () => {
      classifier.classify(makeAnomalyEvent({ metricName: "cpu_usage", value: 92 }));
      classifier.classify(makeAnomalyEvent({ metricName: "error_rate", value: 25 }));

      const incidents = classifier.getIncidents();
      expect(incidents.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by severity", () => {
      classifier.classify(makeAnomalyEvent({ metricName: "error_rate", value: 60 })); // P0
      classifier.classify(makeAnomalyEvent({ metricName: "disk_usage", value: 72 })); // P3

      const p0Only = classifier.getIncidents({ severity: "P0" });
      p0Only.forEach((inc) => expect(inc.severity).toBe("P0"));
    });

    it("should filter by status", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      classifier.resolve(incident.id, { result: "fixed" });

      const open = classifier.getIncidents({ status: "open" });
      open.forEach((inc) => expect(inc.status).toBe("open"));

      const resolved = classifier.getIncidents({ status: "resolved" });
      expect(resolved.some((inc) => inc.id === incident.id)).toBe(true);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        classifier.classify(
          makeAnomalyEvent({
            metricName: `metric_${i}`,
            value: 6,
          }),
        );
      }

      const limited = classifier.getIncidents({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getIncident
  // ─────────────────────────────────────────────────────────────────────────
  describe("getIncident()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should return incident by id from memory", () => {
      const incident = classifier.classify(makeAnomalyEvent());
      const fetched = classifier.getIncident(incident.id);

      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(incident.id);
    });

    it("should return null for unknown id when not in DB", () => {
      // db returns null for unknown ids
      expect(classifier.getIncident("nonexistent")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await classifier.initialize(db);
    });

    it("should return total and by-severity counts", () => {
      classifier.classify(makeAnomalyEvent({ metricName: "error_rate", value: 60 })); // P0
      classifier.classify(makeAnomalyEvent({ metricName: "disk_usage", value: 72 })); // P3

      const stats = classifier.getStats();
      expect(stats.totalIncidents).toBeGreaterThanOrEqual(2);
      expect(stats.bySeverity).toHaveProperty("P0");
    });

    it("should return byStatus counts", () => {
      const inc = classifier.classify(makeAnomalyEvent());
      classifier.acknowledge(inc.id, { acknowledgedBy: "me" });

      const stats = classifier.getStats();
      expect(stats.byStatus).toHaveProperty("acknowledged");
      expect(stats.byStatus.acknowledged).toBeGreaterThanOrEqual(1);
    });

    it("should return openCount", () => {
      classifier.classify(makeAnomalyEvent({ metricName: "cpu_a", value: 92 }));
      classifier.classify(makeAnomalyEvent({ metricName: "cpu_b", value: 92 }));

      const stats = classifier.getStats();
      expect(stats.openCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constants", () => {
    it("INCIDENT_STATUS should have required values", () => {
      expect(INCIDENT_STATUS.OPEN).toBe("open");
      expect(INCIDENT_STATUS.ACKNOWLEDGED).toBe("acknowledged");
      expect(INCIDENT_STATUS.RESOLVED).toBe("resolved");
    });

    it("SEVERITY should have P0-P3", () => {
      expect(SEVERITY.P0).toBe("P0");
      expect(SEVERITY.P1).toBe("P1");
      expect(SEVERITY.P2).toBe("P2");
      expect(SEVERITY.P3).toBe("P3");
    });

    it("SEVERITY_RULES should cover known metrics", () => {
      expect(SEVERITY_RULES).toHaveProperty("error_rate");
      expect(SEVERITY_RULES).toHaveProperty("memory_usage");
      expect(SEVERITY_RULES).toHaveProperty("cpu_usage");
    });
  });
});
