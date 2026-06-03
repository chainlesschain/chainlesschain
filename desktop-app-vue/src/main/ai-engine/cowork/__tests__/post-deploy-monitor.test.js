/**
 * PostDeployMonitor unit tests — v3.0
 *
 * Coverage: initialize (no db), startMonitoring, stopMonitoring,
 *           getWatcherStatus, getStats, getConfig/configure,
 *           destroy(), MONITOR_STATUS constants
 *
 * IMPORTANT: startMonitoring() creates setInterval + setTimeout timers.
 *            Always call monitor.destroy() in afterEach to prevent leaks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
const { PostDeployMonitor, MONITOR_STATUS } = require("../post-deploy-monitor");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostDeployMonitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new PostDeployMonitor();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Always destroy to clear any active setInterval / setTimeout handles
    monitor.destroy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // initialize()
  // ──────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true without requiring a db parameter", async () => {
      await monitor.initialize();

      expect(monitor.initialized).toBe(true);
    });

    it("should accept optional deps and set them", async () => {
      const errorMonitor = { getRecentErrors: vi.fn() };
      await monitor.initialize({ errorMonitor });

      expect(monitor.errorMonitor).toBe(errorMonitor);
    });

    it("should be idempotent on double initialize", async () => {
      await monitor.initialize({ errorMonitor: { id: 1 } });
      const firstMonitor = monitor.errorMonitor;

      await monitor.initialize({ errorMonitor: { id: 2 } }); // second call is no-op

      expect(monitor.errorMonitor).toBe(firstMonitor);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // startMonitoring()
  // ──────────────────────────────────────────────────────────────────────────
  describe("startMonitoring()", () => {
    beforeEach(async () => {
      await monitor.initialize();
    });

    it("should return a watchId and WATCHING status", () => {
      const result = monitor.startMonitoring({
        deployId: "deploy-001",
        windowMs: 60000,
      });

      expect(result).toHaveProperty("watchId");
      expect(typeof result.watchId).toBe("string");
      expect(result.watchId.length).toBeGreaterThan(0);
      expect(result.status).toBe(MONITOR_STATUS.WATCHING);
    });

    it("should reflect the passed deployId in the result", () => {
      const result = monitor.startMonitoring({
        deployId: "deploy-abc",
        windowMs: 60000,
      });

      expect(result.deployId).toBe("deploy-abc");
    });

    it("should return the configured windowMs in the result", () => {
      const result = monitor.startMonitoring({
        deployId: "deploy-xyz",
        windowMs: 90000,
      });

      expect(result.windowMs).toBe(90000);
    });

    it("should throw if not initialized", () => {
      const uninit = new PostDeployMonitor();
      // afterEach destroy() is safe even on uninitialized instance

      expect(() =>
        uninit.startMonitoring({ deployId: "d1", windowMs: 1000 }),
      ).toThrow("PostDeployMonitor not initialized");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // stopMonitoring()
  // ──────────────────────────────────────────────────────────────────────────
  describe("stopMonitoring()", () => {
    beforeEach(async () => {
      await monitor.initialize();
    });

    it("should return a status object for a known watchId", () => {
      const { watchId } = monitor.startMonitoring({
        deployId: "deploy-stop-1",
        windowMs: 60000,
      });

      const result = monitor.stopMonitoring(watchId);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("watchId", watchId);
      expect(result).toHaveProperty("finalStatus");
    });

    it("should return null for an unknown watchId", () => {
      const result = monitor.stopMonitoring("watch-nonexistent-9999");

      expect(result).toBeNull();
    });

    it("should remove the watcher from activeWatchers after stopping", () => {
      const { watchId } = monitor.startMonitoring({
        deployId: "deploy-stop-2",
        windowMs: 60000,
      });

      monitor.stopMonitoring(watchId);

      expect(monitor.getWatcherStatus(watchId)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getWatcherStatus()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getWatcherStatus()", () => {
    beforeEach(async () => {
      await monitor.initialize();
    });

    it("should return a status object for an active watcher", () => {
      const { watchId } = monitor.startMonitoring({
        deployId: "deploy-status-1",
        windowMs: 60000,
      });

      const status = monitor.getWatcherStatus(watchId);

      expect(status).not.toBeNull();
      expect(status).toHaveProperty("id", watchId);
      expect(status).toHaveProperty("deployId", "deploy-status-1");
      expect(status).toHaveProperty("status");
      expect(status).toHaveProperty("elapsed");
      expect(status).toHaveProperty("remaining");
    });

    it("should return elapsed as a non-negative number", () => {
      const { watchId } = monitor.startMonitoring({
        deployId: "deploy-status-2",
        windowMs: 60000,
      });

      const status = monitor.getWatcherStatus(watchId);

      expect(typeof status.elapsed).toBe("number");
      expect(status.elapsed).toBeGreaterThanOrEqual(0);
    });

    it("should return null for an unknown watchId", () => {
      const status = monitor.getWatcherStatus("watch-unknown-0000");

      expect(status).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getStats()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await monitor.initialize();
    });

    it("should return stats object with expected fields", () => {
      const stats = monitor.getStats();

      expect(stats).toHaveProperty("totalMonitored");
      expect(stats).toHaveProperty("activeWatchers");
      expect(stats).toHaveProperty("healthyCount");
      expect(stats).toHaveProperty("degradedCount");
      expect(stats).toHaveProperty("criticalCount");
    });

    it("should increment activeWatchers after startMonitoring", () => {
      expect(monitor.getStats().activeWatchers).toBe(0);

      monitor.startMonitoring({ deployId: "d-stats-1", windowMs: 60000 });

      expect(monitor.getStats().activeWatchers).toBe(1);
    });

    it("should decrement activeWatchers after stopMonitoring", () => {
      const { watchId } = monitor.startMonitoring({
        deployId: "d-stats-2",
        windowMs: 60000,
      });
      expect(monitor.getStats().activeWatchers).toBe(1);

      monitor.stopMonitoring(watchId);

      expect(monitor.getStats().activeWatchers).toBe(0);
    });

    it("should increment totalMonitored for each startMonitoring call", () => {
      expect(monitor.getStats().totalMonitored).toBe(0);

      const w1 = monitor.startMonitoring({
        deployId: "d-total-1",
        windowMs: 60000,
      });
      const w2 = monitor.startMonitoring({
        deployId: "d-total-2",
        windowMs: 60000,
      });

      expect(monitor.getStats().totalMonitored).toBe(2);

      // Cleanup
      monitor.stopMonitoring(w1.watchId);
      monitor.stopMonitoring(w2.watchId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getConfig() / configure()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    it("should return default config with expected keys", () => {
      const config = monitor.getConfig();

      expect(config).toHaveProperty("observationWindowMs");
      expect(config).toHaveProperty("errorRateThreshold");
      expect(config).toHaveProperty("latencyThresholdMs");
      expect(config).toHaveProperty("checkIntervalMs");
      expect(config).toHaveProperty("autoRollbackOnCritical");
    });

    it("should update a config field via configure()", () => {
      monitor.configure({ checkIntervalMs: 5000 });

      expect(monitor.getConfig().checkIntervalMs).toBe(5000);
    });

    it("should return the updated config from configure()", () => {
      const returned = monitor.configure({ errorRateThreshold: 0.1 });

      expect(returned.errorRateThreshold).toBe(0.1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // MONITOR_STATUS constants
  // ──────────────────────────────────────────────────────────────────────────
  describe("MONITOR_STATUS", () => {
    it("should have WATCHING, HEALTHY, DEGRADED keys", () => {
      expect(MONITOR_STATUS).toHaveProperty("WATCHING");
      expect(MONITOR_STATUS).toHaveProperty("HEALTHY");
      expect(MONITOR_STATUS).toHaveProperty("DEGRADED");
    });

    it("should also have IDLE and CRITICAL keys", () => {
      expect(MONITOR_STATUS).toHaveProperty("IDLE");
      expect(MONITOR_STATUS).toHaveProperty("CRITICAL");
    });

    it("should have string values for all keys", () => {
      for (const [, value] of Object.entries(MONITOR_STATUS)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});
