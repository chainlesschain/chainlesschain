/**
 * MCP Performance Monitor Unit Tests
 *
 * Tests for performance tracking and metrics collection.
 * Updated to match actual MCPPerformanceMonitor implementation API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MCPPerformanceMonitor = require("../../../src/main/mcp/mcp-performance-monitor");

describe("MCPPerformanceMonitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new MCPPerformanceMonitor();
  });

  afterEach(() => {
    monitor = null;
  });

  describe("Connection Recording", () => {
    it("should record successful connection", () => {
      monitor.recordConnection("filesystem", 250, true);

      const summary = monitor.getSummary();
      expect(summary.connections.total).toBe(1);
      expect(summary.connections.successful).toBe(1);
      expect(summary.connections.failed).toBe(0);
    });

    it("should record failed connection", () => {
      monitor.recordConnection("filesystem", 500, false);

      const summary = monitor.getSummary();
      expect(summary.connections.total).toBe(1);
      expect(summary.connections.successful).toBe(0);
      expect(summary.connections.failed).toBe(1);
    });

    it("should track connection times", () => {
      monitor.recordConnection("filesystem", 250, true);
      monitor.recordConnection("postgres", 350, true);
      monitor.recordConnection("git", 200, true);

      const summary = monitor.getSummary();
      expect(summary.connections.total).toBe(3);
      expect(summary.connections.avgTime).toBeCloseTo(266.67, 0);
    });

    it("should calculate connection success rate", () => {
      monitor.recordConnection("server1", 100, true);
      monitor.recordConnection("server2", 200, true);
      monitor.recordConnection("server3", 300, false);

      const summary = monitor.getSummary();
      expect(summary.connections.successRate).toBe("66.7%");
    });

    it("should retain a bounded recent connection window", () => {
      monitor = new MCPPerformanceMonitor({ maxConnectionSamples: 2 });
      monitor.recordConnection("server1", 10, true);
      monitor.recordConnection("server2", 20, true);
      monitor.recordConnection("server3", 30, true);

      const summary = monitor.getSummary();
      expect(summary.connections.total).toBe(3);
      expect(summary.connections.avgTime).toBe(25);
      expect(summary.retention.retained.connectionSamples).toBe(2);
      expect(summary.retention.stats.connectionSamplesDropped).toBe(1);
    });
  });

  describe("Tool Call Recording", () => {
    it("should record tool call", () => {
      monitor.recordToolCall("filesystem", "read_file", 45, true);

      const summary = monitor.getSummary();
      expect(summary.toolCalls.total).toBe(1);
      expect(summary.toolCalls.successful).toBe(1);
    });

    it("should accumulate multiple tool calls", () => {
      monitor.recordToolCall("filesystem", "read_file", 45, true);
      monitor.recordToolCall("filesystem", "read_file", 55, true);
      monitor.recordToolCall("filesystem", "read_file", 50, true);

      const summary = monitor.getSummary();
      expect(summary.toolCalls.total).toBe(3);

      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      expect(toolStats.count).toBe(3);
    });

    it("should calculate average latency", () => {
      monitor.recordToolCall("filesystem", "read_file", 40, true);
      monitor.recordToolCall("filesystem", "read_file", 60, true);

      const summary = monitor.getSummary();
      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      expect(toolStats.avgLatency).toBe(50);
    });

    it("should track min and max latency", () => {
      monitor.recordToolCall("filesystem", "read_file", 40, true);
      monitor.recordToolCall("filesystem", "read_file", 60, true);
      monitor.recordToolCall("filesystem", "read_file", 50, true);

      const summary = monitor.getSummary();
      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      expect(toolStats.minLatency).toBe(40);
      expect(toolStats.maxLatency).toBe(60);
    });

    it("should calculate P95 latency", () => {
      // Add 100 latency measurements
      for (let i = 1; i <= 100; i++) {
        monitor.recordToolCall("filesystem", "read_file", i, true);
      }

      const summary = monitor.getSummary();
      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      // P95 should be around 95
      expect(toolStats.p95Latency).toBeGreaterThanOrEqual(94);
      expect(toolStats.p95Latency).toBeLessThanOrEqual(96);
    });

    it("should track errors per tool", () => {
      monitor.recordToolCall("filesystem", "read_file", 50, true);
      monitor.recordToolCall("filesystem", "read_file", 50, false);
      monitor.recordToolCall("filesystem", "read_file", 50, false);

      const summary = monitor.getSummary();
      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      expect(toolStats.errors).toBe(2);
    });

    it("should bound latency samples while preserving exact call counts", () => {
      monitor = new MCPPerformanceMonitor({ maxLatencySamplesPerSeries: 2 });
      monitor.recordToolCall("filesystem", "read_file", 10, true);
      monitor.recordToolCall("filesystem", "read_file", 20, true);
      monitor.recordToolCall("filesystem", "read_file", 30, true);

      const summary = monitor.getSummary();
      const toolStats = summary.byTool.find((t) => t.name === "read_file");
      expect(toolStats.count).toBe(3);
      expect(toolStats.avgLatency).toBe(25);
      expect(summary.retention.stats.toolLatencySamplesDropped).toBe(1);
      expect(summary.retention.stats.serverLatencySamplesDropped).toBe(1);
    });

    it("should aggregate high-cardinality tool and server names", () => {
      monitor = new MCPPerformanceMonitor({
        maxToolSeries: 3,
        maxServerSeries: 2,
      });

      for (let index = 1; index <= 4; index++) {
        monitor.recordToolCall(
          `server-${index}`,
          `tool-${index}`,
          index * 10,
          true,
        );
      }

      const summary = monitor.getSummary();
      expect(summary.byTool).toHaveLength(3);
      expect(summary.byServer).toHaveLength(2);
      expect(
        summary.byTool.find((item) => item.name === "__other__").count,
      ).toBe(2);
      expect(
        summary.byServer.find((item) => item.name === "__other__").count,
      ).toBe(3);
      expect(summary.retention.stats.overflowToolCalls).toBe(2);
      expect(summary.retention.stats.overflowServerCalls).toBe(3);
    });

    it("should hash oversized series names instead of retaining them", () => {
      monitor = new MCPPerformanceMonitor({ maxSeriesNameBytes: 8 });
      const oversizedName = "sensitive-tool-name";
      monitor.recordToolCall("server", oversizedName, 10, true);

      const summary = monitor.getSummary();
      expect(summary.byTool[0].name).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(summary.byTool[0].name).not.toContain(oversizedName);
      expect(summary.retention.stats.seriesNamesHashed).toBe(1);
    });
  });

  describe("Server Statistics", () => {
    it("should track by server", () => {
      monitor.recordToolCall("filesystem", "read_file", 50, true);
      monitor.recordToolCall("filesystem", "write_file", 80, true);
      monitor.recordToolCall("postgres", "query", 100, true);

      const summary = monitor.getSummary();
      expect(summary.byServer.length).toBe(2);

      const fsStats = summary.byServer.find((s) => s.name === "filesystem");
      expect(fsStats.count).toBe(2);

      const pgStats = summary.byServer.find((s) => s.name === "postgres");
      expect(pgStats.count).toBe(1);
    });
  });

  describe("Error Recording", () => {
    it("should record errors", () => {
      monitor.recordError("tool_call", new Error("File not found"), {
        serverName: "filesystem",
        toolName: "read_file",
      });

      const summary = monitor.getSummary();
      expect(summary.errors.total).toBe(1);
    });

    it("should accumulate errors", () => {
      monitor.recordError("tool_call", new Error("Error 1"), {});
      monitor.recordError("tool_call", new Error("Error 2"), {});
      monitor.recordError("connection", new Error("Error 3"), {});

      const summary = monitor.getSummary();
      expect(summary.errors.total).toBe(3);
    });

    it("should store recent error details", () => {
      monitor.recordError("tool_call", new Error("Test error"), {
        serverName: "filesystem",
        toolName: "read_file",
      });

      const summary = monitor.getSummary();
      expect(summary.errors.recent.length).toBe(1);
      expect(summary.errors.recent[0].type).toBe("tool_call");
      expect(summary.errors.recent[0].message).toBe("Test error");
    });

    it("should limit recent errors to 100", () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordError("tool_call", new Error(`Error ${i}`), {});
      }

      const summary = monitor.getSummary();
      // Internal storage limits to 100
      expect(summary.errors.total).toBeLessThanOrEqual(100);
    });

    it("should bound retained error count and payload bytes", () => {
      monitor = new MCPPerformanceMonitor({
        maxErrors: 2,
        maxErrorTextBytes: 8,
        maxErrorContextBytes: 24,
      });
      const context = { secret: "x".repeat(100) };

      monitor.recordError(
        "tool_call",
        new Error("first-error-message"),
        context,
      );
      let summary = monitor.getSummary();
      expect(summary.errors.recent[0].context).toMatchObject({
        truncated: true,
        byteLength: expect.any(Number),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(JSON.stringify(summary.errors.recent[0].context)).not.toContain(
        context.secret,
      );

      monitor.recordError("tool_call", new Error("second-error-message"), {});
      monitor.recordError("tool_call", new Error("third-error-message"), {});
      context.secret = "mutated-after-recording";

      summary = monitor.getSummary();
      expect(summary.errors.total).toBe(2);
      expect(
        Buffer.byteLength(summary.errors.recent[0].message, "utf8"),
      ).toBeLessThanOrEqual(8);
      expect(summary.retention.stats.errorsDropped).toBe(1);
      expect(summary.retention.stats.errorPayloadsTruncated).toBeGreaterThan(0);
    });
  });

  describe("Memory Sampling", () => {
    it("should sample memory usage", () => {
      const sample = monitor.sampleMemory();

      expect(sample).toBeDefined();
      expect(sample.heapUsed).toBeDefined();
      expect(sample.heapTotal).toBeDefined();
      expect(sample.rss).toBeDefined();
      expect(sample.timestamp).toBeDefined();
    });

    it("should accumulate memory samples", () => {
      monitor.sampleMemory();
      monitor.sampleMemory();
      monitor.sampleMemory();

      const summary = monitor.getSummary();
      expect(summary.memory.avgHeapUsed).toBeGreaterThan(0);
    });

    it("should retain only the configured memory sample window", () => {
      monitor = new MCPPerformanceMonitor({ maxMemorySamples: 2 });
      monitor.sampleMemory();
      monitor.sampleMemory();
      monitor.sampleMemory();

      const summary = monitor.getSummary();
      expect(summary.retention.retained.memorySamples).toBe(2);
      expect(summary.retention.stats.memorySamplesDropped).toBe(1);
    });
  });

  describe("Performance Summary", () => {
    beforeEach(() => {
      // Set up some test data
      monitor.recordConnection("filesystem", 250, true);
      monitor.recordConnection("postgres", 400, true);

      monitor.recordToolCall("filesystem", "read_file", 50, true);
      monitor.recordToolCall("filesystem", "read_file", 60, true);
      monitor.recordToolCall("filesystem", "write_file", 80, true);

      monitor.recordError("connection", new Error("Connection timeout"), {
        serverName: "postgres",
      });
    });

    it("should generate performance summary", () => {
      const summary = monitor.getSummary();

      expect(summary.connections).toBeDefined();
      expect(summary.toolCalls).toBeDefined();
      expect(summary.byTool).toBeDefined();
      expect(summary.byServer).toBeDefined();
      expect(summary.memory).toBeDefined();
      expect(summary.errors).toBeDefined();
    });

    it("should include connection stats", () => {
      const summary = monitor.getSummary();

      expect(summary.connections.total).toBe(2);
      expect(summary.connections.avgTime).toBe(325);
    });

    it("should include tool call stats", () => {
      const summary = monitor.getSummary();

      expect(summary.toolCalls.total).toBe(3);
      expect(summary.toolCalls.successful).toBe(3);
    });
  });

  describe("Performance Report", () => {
    beforeEach(() => {
      monitor.recordConnection("filesystem", 250, true);
      monitor.recordToolCall("filesystem", "read_file", 50, true);
    });

    it("should generate formatted report", () => {
      const report = monitor.generateReport();

      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
    });

    it("should include connection metrics in report", () => {
      const report = monitor.generateReport();

      expect(report).toContain("CONNECTION METRICS");
      expect(report).toContain("250");
    });

    it("should include tool call metrics in report", () => {
      const report = monitor.generateReport();

      expect(report).toContain("TOOL CALL METRICS");
    });
  });

  describe("Baseline Setting", () => {
    it("should set direct call baseline", () => {
      monitor.setBaseline("directCall", 10);

      const summary = monitor.getSummary();
      expect(summary.baselines.directCall).toBe(10);
    });

    it("should set stdio call baseline", () => {
      monitor.setBaseline("stdioCall", 50);

      const summary = monitor.getSummary();
      expect(summary.baselines.stdioCall).toBe(50);
    });

    it("should calculate overhead when both baselines set", () => {
      monitor.setBaseline("directCall", 10);
      monitor.setBaseline("stdioCall", 50);

      const summary = monitor.getSummary();
      expect(summary.baselines.overhead).toBe(40);
    });

    it("should reject unknown baseline dimensions", () => {
      expect(() => monitor.setBaseline("attacker-controlled", 10)).toThrow(
        "Unsupported MCP performance baseline",
      );
      expect(Object.keys(monitor.getSummary().baselines)).toEqual([
        "directCall",
        "stdioCall",
        "overhead",
      ]);
    });
  });

  describe("Reset", () => {
    it("should reset all metrics", () => {
      monitor.recordConnection("filesystem", 250, true);
      monitor.recordToolCall("filesystem", "read_file", 50, true);
      monitor.recordError("tool_call", new Error("Test"), {});

      monitor.reset();

      const summary = monitor.getSummary();
      expect(summary.connections.total).toBe(0);
      expect(summary.toolCalls.total).toBe(0);
      expect(summary.errors.total).toBe(0);
      expect(summary.retention.stats).toMatchObject({
        connectionSamplesDropped: 0,
        toolLatencySamplesDropped: 0,
        errorsDropped: 0,
      });
    });
  });

  describe("Events", () => {
    it("should emit connection-recorded event", () => {
      const handler = vi.fn();
      monitor.on("connection-recorded", handler);

      monitor.recordConnection("filesystem", 250, true);

      expect(handler).toHaveBeenCalledWith({
        serverName: "filesystem",
        duration: 250,
        success: true,
      });
    });

    it("should emit tool-call-recorded event", () => {
      const handler = vi.fn();
      monitor.on("tool-call-recorded", handler);

      monitor.recordToolCall("filesystem", "read_file", 50, true, { test: 1 });

      expect(handler).toHaveBeenCalledWith({
        serverName: "filesystem",
        toolName: "read_file",
        duration: 50,
        success: true,
        metadata: { test: 1 },
      });
    });

    it("should emit error-recorded event", () => {
      const handler = vi.fn();
      monitor.on("error-recorded", handler);

      const error = new Error("Test error");
      monitor.recordError("tool_call", error, { serverName: "filesystem" });

      expect(handler).toHaveBeenCalledWith({
        type: "tool_call",
        error,
        context: { serverName: "filesystem" },
      });
    });
  });
});
