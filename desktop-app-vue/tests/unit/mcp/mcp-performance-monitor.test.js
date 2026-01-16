/**
 * MCP Performance Monitor Unit Tests
 *
 * Tests for performance tracking and metrics collection.
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

  describe("Connection Time Tracking", () => {
    it("should record connection time", () => {
      monitor.recordConnectionTime("filesystem", 250);

      const times = monitor.getConnectionTimes();
      expect(times["filesystem"]).toBe(250);
    });

    it("should update connection time on reconnection", () => {
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordConnectionTime("filesystem", 180);

      const times = monitor.getConnectionTimes();
      expect(times["filesystem"]).toBe(180);
    });

    it("should track multiple servers", () => {
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordConnectionTime("postgres", 350);
      monitor.recordConnectionTime("git", 200);

      const times = monitor.getConnectionTimes();
      expect(Object.keys(times).length).toBe(3);
    });
  });

  describe("Tool Latency Tracking", () => {
    it("should record tool call latency", () => {
      monitor.recordToolLatency("filesystem", "read_file", 45);

      const latencies = monitor.getToolLatencies();
      expect(latencies["filesystem"]["read_file"]).toBeDefined();
    });

    it("should accumulate multiple latencies for same tool", () => {
      monitor.recordToolLatency("filesystem", "read_file", 45);
      monitor.recordToolLatency("filesystem", "read_file", 55);
      monitor.recordToolLatency("filesystem", "read_file", 50);

      const latencies = monitor.getToolLatencies();
      expect(latencies["filesystem"]["read_file"].count).toBe(3);
    });

    it("should calculate average latency", () => {
      monitor.recordToolLatency("filesystem", "read_file", 40);
      monitor.recordToolLatency("filesystem", "read_file", 60);

      const latencies = monitor.getToolLatencies();
      expect(latencies["filesystem"]["read_file"].avg).toBe(50);
    });

    it("should track min and max latency", () => {
      monitor.recordToolLatency("filesystem", "read_file", 40);
      monitor.recordToolLatency("filesystem", "read_file", 60);
      monitor.recordToolLatency("filesystem", "read_file", 50);

      const latencies = monitor.getToolLatencies();
      expect(latencies["filesystem"]["read_file"].min).toBe(40);
      expect(latencies["filesystem"]["read_file"].max).toBe(60);
    });

    it("should calculate P95 latency", () => {
      // Add 100 latency measurements
      for (let i = 1; i <= 100; i++) {
        monitor.recordToolLatency("filesystem", "read_file", i);
      }

      const latencies = monitor.getToolLatencies();
      // P95 should be around 95
      expect(latencies["filesystem"]["read_file"].p95).toBeGreaterThanOrEqual(
        94,
      );
      expect(latencies["filesystem"]["read_file"].p95).toBeLessThanOrEqual(96);
    });
  });

  describe("Error Tracking", () => {
    it("should record errors", () => {
      monitor.recordError(
        "filesystem",
        "read_file",
        new Error("File not found"),
      );

      const errors = monitor.getErrorCounts();
      expect(errors["filesystem"]).toBe(1);
    });

    it("should accumulate errors", () => {
      monitor.recordError("filesystem", "read_file", new Error("Error 1"));
      monitor.recordError("filesystem", "write_file", new Error("Error 2"));
      monitor.recordError("filesystem", "read_file", new Error("Error 3"));

      const errors = monitor.getErrorCounts();
      expect(errors["filesystem"]).toBe(3);
    });

    it("should store recent error details", () => {
      monitor.recordError("filesystem", "read_file", new Error("Test error"));

      const recentErrors = monitor.getRecentErrors(10);
      expect(recentErrors.length).toBe(1);
      expect(recentErrors[0].serverName).toBe("filesystem");
      expect(recentErrors[0].toolName).toBe("read_file");
      expect(recentErrors[0].error).toBe("Test error");
    });

    it("should limit recent errors to 100", () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordError("server", "tool", new Error(`Error ${i}`));
      }

      const recentErrors = monitor.getRecentErrors(200);
      expect(recentErrors.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Memory Usage Tracking", () => {
    it("should record memory usage", () => {
      monitor.recordMemoryUsage("filesystem", 1024 * 1024 * 30); // 30 MB

      const memory = monitor.getMemoryUsage();
      expect(memory["filesystem"]).toBeDefined();
    });

    it("should track memory history", () => {
      monitor.recordMemoryUsage("filesystem", 30 * 1024 * 1024);
      monitor.recordMemoryUsage("filesystem", 35 * 1024 * 1024);
      monitor.recordMemoryUsage("filesystem", 32 * 1024 * 1024);

      const memory = monitor.getMemoryUsage();
      expect(memory["filesystem"].current).toBe(32 * 1024 * 1024);
    });
  });

  describe("Performance Summary", () => {
    beforeEach(() => {
      // Set up some test data
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordConnectionTime("postgres", 400);

      monitor.recordToolLatency("filesystem", "read_file", 50);
      monitor.recordToolLatency("filesystem", "read_file", 60);
      monitor.recordToolLatency("filesystem", "write_file", 80);

      monitor.recordError("postgres", "query", new Error("Connection timeout"));
    });

    it("should generate performance summary", () => {
      const summary = monitor.getSummary();

      expect(summary.servers).toBeDefined();
      expect(summary.totalToolCalls).toBeDefined();
      expect(summary.avgLatency).toBeDefined();
      expect(summary.errorRate).toBeDefined();
    });

    it("should include server-specific metrics", () => {
      const summary = monitor.getSummary();

      expect(summary.servers["filesystem"]).toBeDefined();
      expect(summary.servers["filesystem"].connectionTime).toBe(250);
    });

    it("should calculate overall error rate", () => {
      const summary = monitor.getSummary();

      expect(summary.errorRate).toBeDefined();
      expect(typeof summary.errorRate).toBe("number");
    });
  });

  describe("Performance Report", () => {
    beforeEach(() => {
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordToolLatency("filesystem", "read_file", 50);
    });

    it("should generate formatted report", () => {
      const report = monitor.getFormattedReport();

      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
    });

    it("should include connection times in report", () => {
      const report = monitor.getFormattedReport();

      expect(report).toContain("filesystem");
      expect(report).toContain("250");
    });
  });

  describe("Baseline Tracking", () => {
    it("should set and get baseline", () => {
      const baseline = {
        connectionTime: 500,
        toolLatency: 100,
        errorRate: 0.01,
      };

      monitor.setBaseline(baseline);

      const retrieved = monitor.getBaseline();
      expect(retrieved).toEqual(baseline);
    });

    it("should compare against baseline", () => {
      const baseline = {
        connectionTime: 500,
        toolLatency: 100,
      };

      monitor.setBaseline(baseline);
      monitor.recordConnectionTime("filesystem", 300); // Better than baseline
      monitor.recordToolLatency("filesystem", "read_file", 150); // Worse than baseline

      const comparison = monitor.compareToBaseline();

      expect(comparison.connectionTime.status).toBe("better");
      expect(comparison.toolLatency.status).toBe("worse");
    });
  });

  describe("POC Success Criteria", () => {
    it("should evaluate connection time criteria", () => {
      monitor.recordConnectionTime("filesystem", 300); // < 500ms target

      const evaluation = monitor.evaluatePOCCriteria();

      expect(evaluation.connectionTime.passed).toBe(true);
    });

    it("should fail connection time criteria if too slow", () => {
      monitor.recordConnectionTime("filesystem", 1200); // > 1000ms acceptable

      const evaluation = monitor.evaluatePOCCriteria();

      expect(evaluation.connectionTime.passed).toBe(false);
    });

    it("should evaluate tool latency criteria", () => {
      monitor.recordToolLatency("filesystem", "read_file", 80); // < 100ms target

      const evaluation = monitor.evaluatePOCCriteria();

      expect(evaluation.toolLatency.passed).toBe(true);
    });

    it("should evaluate error rate criteria", () => {
      // 100 calls, 0 errors
      for (let i = 0; i < 100; i++) {
        monitor.recordToolLatency("filesystem", "read_file", 50);
      }

      const evaluation = monitor.evaluatePOCCriteria();

      expect(evaluation.errorRate.passed).toBe(true);
    });
  });

  describe("Reset", () => {
    it("should reset all metrics", () => {
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordToolLatency("filesystem", "read_file", 50);
      monitor.recordError("filesystem", "read_file", new Error("Test"));

      monitor.reset();

      expect(Object.keys(monitor.getConnectionTimes()).length).toBe(0);
      expect(Object.keys(monitor.getToolLatencies()).length).toBe(0);
      expect(Object.keys(monitor.getErrorCounts()).length).toBe(0);
    });
  });

  describe("Export", () => {
    it("should export metrics as JSON", () => {
      monitor.recordConnectionTime("filesystem", 250);
      monitor.recordToolLatency("filesystem", "read_file", 50);

      const exported = monitor.exportMetrics();
      const parsed = JSON.parse(exported);

      expect(parsed.connectionTimes).toBeDefined();
      expect(parsed.toolLatencies).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });
  });
});
