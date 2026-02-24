/**
 * AlertManager 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  AlertManager,
  ALERT_CHANNELS,
  ALERT_STATUS,
} = require("../alert-manager");

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
  };
}

describe("AlertManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new AlertManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (manager.initialized) {
      manager.destroy();
    }
  });

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
    });

    it("should accept config overrides", async () => {
      await manager.initialize(db, { enabled: true, rateLimitPerMinute: 5 });
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await manager.initialize(db);
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
    });
  });

  describe("sendAlert()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should send an in-app alert and return SENT status", async () => {
      const result = await manager.sendAlert({
        type: "anomaly",
        severity: "P1",
        title: "High Error Rate",
        message: "Error rate exceeded threshold",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      expect(result.status).toBe(ALERT_STATUS.SENT);
    });

    it("should return SUPPRESSED when disabled", async () => {
      manager.configure({ enabled: false });
      const result = await manager.sendAlert({
        type: "anomaly",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      expect(result.status).toBe(ALERT_STATUS.SUPPRESSED);
    });

    it("should deduplicate identical alerts", async () => {
      const alert = {
        type: "anomaly",
        severity: "P1",
        incidentId: "inc-dedup",
        channels: [ALERT_CHANNELS.IN_APP],
      };
      await manager.sendAlert(alert);
      const second = await manager.sendAlert({ ...alert });
      expect(second.status).toBe(ALERT_STATUS.SUPPRESSED);
      expect(second.reason).toBe("duplicate");
    });

    it("should emit in-app:notify event for in-app channel", async () => {
      const listener = vi.fn();
      manager.on("in-app:notify", listener);
      await manager.sendAlert({
        type: "anomaly",
        severity: "P1",
        title: "Test Alert",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should increment totalAlerts stat", async () => {
      await manager.sendAlert({ type: "a", channels: [ALERT_CHANNELS.IN_APP] });
      await manager.sendAlert({ type: "b", channels: [ALERT_CHANNELS.IN_APP] });
      const stats = manager.getStats();
      expect(stats.totalAlerts).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getAlerts()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return empty array initially", () => {
      expect(manager.getAlerts()).toEqual([]);
    });

    it("should return sent alerts in history", async () => {
      await manager.sendAlert({
        type: "incident",
        severity: "P0",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      const alerts = manager.getAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by severity", async () => {
      await manager.sendAlert({
        type: "a",
        severity: "P0",
        incidentId: "i1",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      await manager.sendAlert({
        type: "b",
        severity: "P3",
        incidentId: "i2",
        channels: [ALERT_CHANNELS.IN_APP],
      });
      const p0 = manager.getAlerts({ severity: "P0" });
      p0.forEach((a) => expect(a.severity).toBe("P0"));
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return stats with required fields", () => {
      const stats = manager.getStats();
      expect(stats).toHaveProperty("totalAlerts");
      expect(stats).toHaveProperty("suppressedCount");
      expect(stats).toHaveProperty("historySize");
    });
  });

  describe("configureAlerts()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should update defaultChannels", () => {
      manager.configureAlerts({ defaultChannels: [ALERT_CHANNELS.IN_APP] });
      expect(manager.getConfig().defaultChannels).toContain(
        ALERT_CHANNELS.IN_APP,
      );
    });
  });

  describe("Constants", () => {
    it("ALERT_CHANNELS should have IN_APP", () => {
      expect(ALERT_CHANNELS.IN_APP).toBe("in-app");
    });

    it("ALERT_STATUS should have SENT, SUPPRESSED, FAILED", () => {
      expect(ALERT_STATUS.SENT).toBeTruthy();
      expect(ALERT_STATUS.SUPPRESSED).toBeTruthy();
      expect(ALERT_STATUS.FAILED).toBeTruthy();
    });
  });
});
