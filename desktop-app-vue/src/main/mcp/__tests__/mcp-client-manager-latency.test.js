import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { MCPClientManager } = require("../mcp-client-manager.js");

describe("MCPClientManager._recordLatency rolling window", () => {
  let mgr;

  beforeEach(() => {
    mgr = new MCPClientManager();
    mgr.maxLatencySamples = 5;
  });

  it("bounds the per-tool latency array to maxLatencySamples (drops oldest)", () => {
    for (let i = 1; i <= 10; i++) mgr._recordLatency("toolA", i);
    const arr = mgr.metrics.toolCallLatencies.get("toolA");
    expect(arr).toHaveLength(5);
    expect(arr).toEqual([6, 7, 8, 9, 10]);
  });

  it("tracks each tool independently", () => {
    mgr._recordLatency("a", 1);
    mgr._recordLatency("b", 2);
    expect(mgr.metrics.toolCallLatencies.get("a")).toEqual([1]);
    expect(mgr.metrics.toolCallLatencies.get("b")).toEqual([2]);
  });

  it("does not grow past the cap under sustained load", () => {
    for (let i = 0; i < 5000; i++) mgr._recordLatency("hot", i);
    expect(mgr.metrics.toolCallLatencies.get("hot").length).toBe(5);
  });

  it("getMetrics still summarizes the bounded window without throwing", () => {
    for (let i = 1; i <= 10; i++) mgr._recordLatency("toolA", i * 10);
    const m = mgr.getMetrics();
    expect(m).toBeTruthy();
    expect(m.toolLatencies.toolA.count).toBe(5); // window size, not cumulative
    expect(Number(m.toolLatencies.toolA.max)).toBe(100);
  });
});
