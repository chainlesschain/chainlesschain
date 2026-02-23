/**
 * UnifiedPerformanceCollector Unit Tests
 *
 * Covers:
 * - initialize() stores dependency refs
 * - start() begins collection interval
 * - stop() clears interval
 * - _collect() gathers from all sources into unified format
 * - getTimeSeries('system.cpu', { granularity: 'raw' }) returns [{ timestamp, value }]
 * - getDashboardSummary() returns KPIs object
 * - registerMetric(name, opts) adds custom metric
 * - recordMetric(name, value) records value for custom metric
 * - recordMetric counter type accumulates values
 * - receiveRendererMetrics(data) updates renderer metrics in buffer
 * - getSnapshot() returns latest buffer entry
 * - Ring buffer: after maxSamples, oldest entries are removed
 * - getTimeSeries with from/to filters correctly filters by time range
 * - _aggregateByGranularity() averages within time buckets
 * - getDashboardSummary() queries activeConnections from MCP monitor
 * - receiveRendererMetrics() ignores invalid input
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  UnifiedPerformanceCollector,
} = require("../unified-performance-collector.js");

describe("UnifiedPerformanceCollector", () => {
  let collector;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new UnifiedPerformanceCollector();
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------------

  describe("constructor", () => {
    it("creates instance with empty buffer", () => {
      expect(collector.buffer).toEqual([]);
      expect(collector.running).toBe(false);
      expect(collector._intervalId).toBeNull();
    });

    it("has maxSamples of 8640 by default", () => {
      expect(collector.maxSamples).toBe(8640);
    });

    it("has collectionInterval of 10000ms by default", () => {
      expect(collector.collectionInterval).toBe(10000);
    });

    it("initializes renderer metrics to zero values", () => {
      expect(collector.rendererMetrics.fps).toBe(0);
      expect(collector.rendererMetrics.domNodes).toBe(0);
      expect(collector.rendererMetrics.jsHeap.used).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("stores all dependency references", () => {
      const mockPerfMonitor = { getSummary: vi.fn() };
      const mockMcpMonitor = { getActiveConnections: vi.fn() };
      const mockFileMetrics = { getDiskUsage: vi.fn() };
      const mockTokenTracker = { getStats: vi.fn() };

      collector.initialize({
        performanceMonitor: mockPerfMonitor,
        mcpPerformanceMonitor: mockMcpMonitor,
        filePerformanceMetrics: mockFileMetrics,
        tokenTracker: mockTokenTracker,
      });

      expect(collector.deps.performanceMonitor).toBe(mockPerfMonitor);
      expect(collector.deps.mcpPerformanceMonitor).toBe(mockMcpMonitor);
      expect(collector.deps.filePerformanceMetrics).toBe(mockFileMetrics);
      expect(collector.deps.tokenTracker).toBe(mockTokenTracker);
    });

    it("sets null deps when none provided", () => {
      collector.initialize({});
      expect(collector.deps.performanceMonitor).toBeNull();
      expect(collector.deps.tokenTracker).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // start() / stop()
  // ----------------------------------------------------------------

  describe("start() / stop()", () => {
    it("start() sets running to true", () => {
      collector.start();
      expect(collector.running).toBe(true);
    });

    it("start() triggers immediate _collect() call", () => {
      const collectSpy = vi.spyOn(collector, "_collect");
      collector.start();
      expect(collectSpy).toHaveBeenCalledOnce();
    });

    it("start() sets up periodic collection interval", () => {
      const collectSpy = vi.spyOn(collector, "_collect");
      collector.start();

      vi.advanceTimersByTime(10000); // advance one interval
      expect(collectSpy).toHaveBeenCalledTimes(2); // initial + 1 tick

      vi.advanceTimersByTime(10000);
      expect(collectSpy).toHaveBeenCalledTimes(3);
    });

    it("start() is idempotent — second call does not add a second interval", () => {
      collector.start();
      const firstId = collector._intervalId;
      collector.start();
      expect(collector._intervalId).toBe(firstId);
    });

    it("stop() sets running to false", () => {
      collector.start();
      collector.stop();
      expect(collector.running).toBe(false);
    });

    it("stop() clears the interval", () => {
      collector.start();
      collector.stop();
      expect(collector._intervalId).toBeNull();
    });

    it("stop() is safe to call when not running", () => {
      expect(() => collector.stop()).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // _collect()
  // ----------------------------------------------------------------

  describe("_collect()", () => {
    it("pushes a sample into the buffer on each call", () => {
      collector._collect();
      expect(collector.buffer.length).toBe(1);

      collector._collect();
      expect(collector.buffer.length).toBe(2);
    });

    it("sample has the expected shape", () => {
      collector._collect();
      const sample = collector.buffer[0];

      expect(typeof sample.timestamp).toBe("number");
      expect(sample.system).toBeDefined();
      expect(sample.llm).toBeDefined();
      expect(sample.ipc).toBeDefined();
      expect(sample.renderer).toBeDefined();
      expect(sample.custom).toBeDefined();
    });

    it('emits a "sample" event with the collected data', () => {
      const listener = vi.fn();
      collector.on("sample", listener);

      collector._collect();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].system).toBeDefined();
    });

    it("collects system metrics from performanceMonitor.getSummary()", () => {
      const mockMonitor = {
        getSummary: vi.fn(() => ({
          cpu: { current: 42 },
          memory: { current: 65 },
          ipc: { averageCallTime: 10, slowCalls: 0, totalCalls: 100 },
        })),
      };
      collector.initialize({ performanceMonitor: mockMonitor });

      collector._collect();

      const sample = collector.buffer[0];
      expect(sample.system.cpu).toBe(42);
      expect(sample.system.memory).toBe(65);
    });

    it("collects LLM metrics from tokenTracker.getStats()", () => {
      const mockTokenTracker = {
        getStats: vi.fn(() => ({
          totalCalls: 10,
          totalTokens: 5000,
          avgLatency: 1200,
        })),
      };
      collector.initialize({ tokenTracker: mockTokenTracker });

      collector._collect();

      const sample = collector.buffer[0];
      expect(sample.llm.calls).toBe(10);
      expect(sample.llm.tokens).toBe(5000);
      expect(sample.llm.latency).toBe(1200);
    });

    it("collects disk usage from filePerformanceMetrics when available", () => {
      const mockMonitor = {
        getSummary: vi.fn(() => ({
          cpu: { current: 0 },
          memory: { current: 0 },
          ipc: {},
        })),
      };
      const mockFileMetrics = {
        getDiskUsage: vi.fn(() => ({ usage: 75 })),
      };
      collector.initialize({
        performanceMonitor: mockMonitor,
        filePerformanceMetrics: mockFileMetrics,
      });

      collector._collect();

      const sample = collector.buffer[0];
      expect(sample.system.disk).toBe(75);
    });

    it("includes custom metrics in samples", () => {
      collector.registerMetric("http.requests", {
        type: "counter",
        description: "HTTP requests",
      });
      collector.recordMetric("http.requests", 50);

      collector._collect();

      const sample = collector.buffer[0];
      expect(sample.custom["http.requests"]).toBe(50);
    });
  });

  // ----------------------------------------------------------------
  // getTimeSeries()
  // ----------------------------------------------------------------

  describe("getTimeSeries()", () => {
    it("returns empty array when buffer is empty", () => {
      const series = collector.getTimeSeries("system.cpu");
      expect(series).toEqual([]);
    });

    it("returns [{ timestamp, value }] for system.cpu in raw granularity", () => {
      // Inject samples directly
      const now = Date.now();
      collector.buffer = [
        {
          timestamp: now - 2000,
          system: { cpu: 30, memory: 50, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: now - 1000,
          system: { cpu: 45, memory: 60, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: now,
          system: { cpu: 70, memory: 80, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
      ];

      const series = collector.getTimeSeries("system.cpu", {
        granularity: "raw",
      });

      expect(series.length).toBe(3);
      expect(series[0].value).toBe(30);
      expect(series[1].value).toBe(45);
      expect(series[2].value).toBe(70);
    });

    it("returns 0 for non-existent metric path", () => {
      collector._collect();
      const series = collector.getTimeSeries("system.nonexistent");
      expect(series[0].value).toBe(0);
    });

    it("filters by from/to time range", () => {
      const base = 1000000;
      collector.buffer = [
        {
          timestamp: base,
          system: { cpu: 10, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: base + 1000,
          system: { cpu: 20, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: base + 2000,
          system: { cpu: 30, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: base + 3000,
          system: { cpu: 40, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
      ];

      const series = collector.getTimeSeries("system.cpu", {
        from: base + 1000,
        to: base + 2000,
      });

      expect(series.length).toBe(2);
      expect(series[0].value).toBe(20);
      expect(series[1].value).toBe(30);
    });

    it("aggregates samples by 1m granularity (averages within buckets)", () => {
      const bucketStart = Math.floor(Date.now() / 60000) * 60000;
      // Three samples in the same 1-minute bucket
      collector.buffer = [
        {
          timestamp: bucketStart + 100,
          system: { cpu: 10, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: bucketStart + 200,
          system: { cpu: 20, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: bucketStart + 300,
          system: { cpu: 30, memory: 0, disk: 0 },
          llm: {},
          ipc: {},
          renderer: {},
          custom: {},
        },
      ];

      const series = collector.getTimeSeries("system.cpu", {
        granularity: "1m",
      });

      // Should produce one bucket with average = (10+20+30)/3 = 20
      expect(series.length).toBe(1);
      expect(series[0].value).toBeCloseTo(20, 5);
    });

    it("navigates nested path for llm.latency", () => {
      const now = Date.now();
      collector.buffer = [
        {
          timestamp: now,
          system: {},
          llm: { calls: 5, tokens: 100, latency: 2500 },
          ipc: {},
          renderer: {},
          custom: {},
        },
      ];

      const series = collector.getTimeSeries("llm.latency", {
        granularity: "raw",
      });
      expect(series[0].value).toBe(2500);
    });

    it("navigates renderer.fps metric path", () => {
      const now = Date.now();
      collector.buffer = [
        {
          timestamp: now,
          system: {},
          llm: {},
          ipc: {},
          renderer: { fps: 60, domNodes: 0, jsHeap: {} },
          custom: {},
        },
      ];

      const series = collector.getTimeSeries("renderer.fps", {
        granularity: "raw",
      });
      expect(series[0].value).toBe(60);
    });
  });

  // ----------------------------------------------------------------
  // getDashboardSummary()
  // ----------------------------------------------------------------

  describe("getDashboardSummary()", () => {
    it("returns object with all expected KPI keys", () => {
      const summary = collector.getDashboardSummary("1h");

      expect(typeof summary.totalAICalls).toBe("number");
      expect(typeof summary.totalTokens).toBe("number");
      expect(typeof summary.avgLatency).toBe("number");
      expect(typeof summary.errorRate).toBe("number");
      expect(typeof summary.activeConnections).toBe("number");
      expect(typeof summary.uptime).toBe("number");
      expect(typeof summary.avgCpu).toBe("number");
      expect(typeof summary.avgMemory).toBe("number");
      expect(typeof summary.sampleCount).toBe("number");
      expect(summary.period).toBe("1h");
    });

    it("calculates avgCpu from buffer samples within period", () => {
      const now = Date.now();
      collector.buffer = [
        {
          timestamp: now - 100,
          system: { cpu: 20, memory: 40, disk: 0 },
          llm: { latency: 0 },
          ipc: {},
          renderer: {},
          custom: {},
        },
        {
          timestamp: now - 200,
          system: { cpu: 60, memory: 60, disk: 0 },
          llm: { latency: 0 },
          ipc: {},
          renderer: {},
          custom: {},
        },
      ];

      const summary = collector.getDashboardSummary("1h");
      expect(summary.avgCpu).toBe(40); // (20 + 60) / 2
    });

    it("queries activeConnections from mcpPerformanceMonitor", () => {
      const mockMcpMonitor = { getActiveConnections: vi.fn(() => 7) };
      collector.initialize({ mcpPerformanceMonitor: mockMcpMonitor });

      const summary = collector.getDashboardSummary();
      expect(summary.activeConnections).toBe(7);
    });

    it("activeConnections is 0 when no MCP monitor", () => {
      collector.initialize({});
      const summary = collector.getDashboardSummary();
      expect(summary.activeConnections).toBe(0);
    });

    it("defaults to 1h period when none specified", () => {
      const summary = collector.getDashboardSummary();
      expect(summary.period).toBe("1h");
    });
  });

  // ----------------------------------------------------------------
  // registerMetric() / recordMetric()
  // ----------------------------------------------------------------

  describe("registerMetric() / recordMetric()", () => {
    it("registerMetric() adds metric to customMetricDefs", () => {
      collector.registerMetric("cache.hit.rate", {
        type: "gauge",
        description: "Cache hit rate",
      });
      expect(collector.customMetricDefs.has("cache.hit.rate")).toBe(true);
    });

    it("registerMetric() initializes value to 0", () => {
      collector.registerMetric("my.gauge", { type: "gauge" });
      expect(collector.customMetricValues.get("my.gauge")).toBe(0);
    });

    it("recordMetric() sets gauge value", () => {
      collector.registerMetric("latency.p99", { type: "gauge" });
      collector.recordMetric("latency.p99", 350);
      expect(collector.customMetricValues.get("latency.p99")).toBe(350);
    });

    it("recordMetric() replaces gauge value on subsequent calls", () => {
      collector.registerMetric("score", { type: "gauge" });
      collector.recordMetric("score", 10);
      collector.recordMetric("score", 99);
      expect(collector.customMetricValues.get("score")).toBe(99);
    });

    it("counter type accumulates additions instead of replacing", () => {
      collector.registerMetric("event.count", { type: "counter" });
      collector.recordMetric("event.count", 5);
      collector.recordMetric("event.count", 3);
      expect(collector.customMetricValues.get("event.count")).toBe(8);
    });

    it("auto-registers metric as gauge when recording unregistered metric", () => {
      collector.recordMetric("auto.metric", 42);
      expect(collector.customMetricDefs.has("auto.metric")).toBe(true);
      expect(collector.customMetricValues.get("auto.metric")).toBe(42);
    });
  });

  // ----------------------------------------------------------------
  // receiveRendererMetrics()
  // ----------------------------------------------------------------

  describe("receiveRendererMetrics()", () => {
    it("updates fps, domNodes, and jsHeap", () => {
      collector.receiveRendererMetrics({
        fps: 60,
        domNodes: 1234,
        jsHeap: { used: 50000000, total: 100000000, limit: 200000000 },
      });

      expect(collector.rendererMetrics.fps).toBe(60);
      expect(collector.rendererMetrics.domNodes).toBe(1234);
      expect(collector.rendererMetrics.jsHeap.used).toBe(50000000);
    });

    it("partially updates — unspecified fields remain unchanged", () => {
      collector.receiveRendererMetrics({ fps: 30 });
      expect(collector.rendererMetrics.fps).toBe(30);
      expect(collector.rendererMetrics.domNodes).toBe(0); // unchanged
    });

    it("ignores non-object input", () => {
      expect(() => collector.receiveRendererMetrics(null)).not.toThrow();
      expect(() => collector.receiveRendererMetrics("invalid")).not.toThrow();
      expect(() => collector.receiveRendererMetrics(42)).not.toThrow();
    });

    it("emits renderer-metrics event", () => {
      const listener = vi.fn();
      collector.on("renderer-metrics", listener);

      collector.receiveRendererMetrics({ fps: 55 });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("ignores non-numeric fps values", () => {
      collector.receiveRendererMetrics({ fps: "not-a-number" });
      expect(collector.rendererMetrics.fps).toBe(0); // unchanged
    });
  });

  // ----------------------------------------------------------------
  // getSnapshot()
  // ----------------------------------------------------------------

  describe("getSnapshot()", () => {
    it("returns snapshot with zero defaults when buffer is empty", () => {
      const snap = collector.getSnapshot();

      expect(snap.system).toEqual({ cpu: 0, memory: 0, disk: 0 });
      expect(snap.llm).toEqual({ calls: 0, tokens: 0, latency: 0 });
      expect(snap.ipc).toEqual({ avgLatency: 0, slowCalls: 0 });
      expect(typeof snap.bufferSize).toBe("number");
      expect(typeof snap.running).toBe("boolean");
      expect(typeof snap.uptime).toBe("number");
    });

    it("returns latest buffer entry system data", () => {
      collector.buffer = [
        {
          timestamp: 1000,
          system: { cpu: 10, memory: 20, disk: 5 },
          llm: { calls: 1, tokens: 100, latency: 500 },
          ipc: { avgLatency: 5, slowCalls: 0 },
          renderer: {},
          custom: {},
        },
        {
          timestamp: 2000,
          system: { cpu: 90, memory: 80, disk: 50 },
          llm: { calls: 5, tokens: 2000, latency: 3000 },
          ipc: { avgLatency: 20, slowCalls: 1 },
          renderer: {},
          custom: {},
        },
      ];

      const snap = collector.getSnapshot();
      // Should use LAST buffer entry
      expect(snap.system.cpu).toBe(90);
      expect(snap.llm.latency).toBe(3000);
    });

    it("bufferSize reflects actual buffer length", () => {
      collector._collect();
      collector._collect();
      const snap = collector.getSnapshot();
      expect(snap.bufferSize).toBe(2);
    });
  });

  // ----------------------------------------------------------------
  // Ring buffer behavior
  // ----------------------------------------------------------------

  describe("ring buffer (maxSamples)", () => {
    it("drops oldest sample when maxSamples is exceeded", () => {
      collector.maxSamples = 3;

      for (let i = 0; i < 5; i++) {
        collector._collect();
      }

      expect(collector.buffer.length).toBe(3);
    });

    it("keeps most recent samples when buffer overflows", () => {
      collector.maxSamples = 2;

      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      collector._collect(); // oldest

      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      collector._collect();

      vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
      collector._collect(); // newest

      expect(collector.buffer.length).toBe(2);
      // The most recent two should remain
      expect(collector.buffer[1].timestamp).toBe(
        new Date("2026-01-01T00:00:02.000Z").getTime(),
      );
    });
  });
});
