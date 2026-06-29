/**
 * UsageReportGenerator — cost-analysis projection guard tests
 *
 * Focus: generateCostAnalysis divides totalCostUsd by daysInPeriod, but the
 * IPC channel report:get-cost-analysis passes startDate/endDate straight from
 * the renderer with NO validation. A zero-length, reversed, or missing range
 * must not yield Infinity / NaN / negative cost projections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { UsageReportGenerator } = require("../usage-report-generator");

const DAY = 24 * 60 * 60 * 1000;

function makeGen() {
  // generateCostAnalysis only touches the DB via _getLLMStats, which we stub —
  // a dummy database satisfies the constructor's required-param check.
  const gen = new UsageReportGenerator({ database: {} });
  vi.spyOn(gen, "_getLLMStats").mockResolvedValue({
    totalCostUsd: 100,
    totalCostCny: 700,
    totalTokens: 1000,
    totalCalls: 10,
    byProvider: [],
    byModel: [],
    cacheHitRate: 50,
  });
  return gen;
}

describe("UsageReportGenerator.generateCostAnalysis daysInPeriod guard", () => {
  let gen;
  beforeEach(() => {
    gen = makeGen();
  });

  it("computes finite projections for a normal (10-day) period", async () => {
    const r = await gen.generateCostAnalysis(0, 10 * DAY);
    expect(r.projections.daily).toBeCloseTo(10); // 100 / 10 days
    expect(r.projections.weekly).toBeCloseTo(70);
    expect(r.projections.monthly).toBeCloseTo(300);
  });

  it("does not produce Infinity for a zero-length period (start === end)", async () => {
    const r = await gen.generateCostAnalysis(5000, 5000);
    expect(Number.isFinite(r.projections.daily)).toBe(true);
    expect(r.projections.daily).toBe(0);
    expect(r.projections.weekly).toBe(0);
    expect(r.projections.monthly).toBe(0);
  });

  it("does not produce negative projections for a reversed period (start > end)", async () => {
    const r = await gen.generateCostAnalysis(20 * DAY, 0);
    expect(r.projections.daily).toBe(0);
    expect(r.projections.monthly).toBe(0);
  });

  it("does not produce NaN when dates are missing", async () => {
    const r = await gen.generateCostAnalysis(undefined, undefined);
    expect(Number.isFinite(r.projections.daily)).toBe(true);
    expect(r.projections.daily).toBe(0);
  });
});
