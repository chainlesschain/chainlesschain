import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AdvancedCryptoManager } = require("../advanced-crypto-manager.js");

describe("AdvancedCryptoManager._capComputeResults", () => {
  let mgr;

  beforeEach(() => {
    mgr = new AdvancedCryptoManager();
    mgr.maxComputeResults = 3;
  });

  it("keeps only the most recent results as new ones are added (cap-then-set)", () => {
    // Mirrors verifiableCompute: _capComputeResults() then .set(resultId, ...)
    for (let i = 0; i < 10; i++) {
      mgr._capComputeResults();
      mgr._computeResults.set(`r${i}`, { i });
    }
    expect(mgr._computeResults.size).toBe(3);
    expect(mgr._computeResults.has("r9")).toBe(true); // newest
    expect(mgr._computeResults.has("r8")).toBe(true);
    expect(mgr._computeResults.has("r7")).toBe(true);
    expect(mgr._computeResults.has("r6")).toBe(false); // evicted
    expect(mgr._computeResults.has("r0")).toBe(false);
  });

  it("does nothing while under the cap", () => {
    mgr._computeResults.set("a", {});
    mgr._capComputeResults();
    expect(mgr._computeResults.size).toBe(1);
  });

  it("never grows past the cap under sustained inserts", () => {
    for (let i = 0; i < 1000; i++) {
      mgr._capComputeResults();
      mgr._computeResults.set(`k${i}`, {});
    }
    expect(mgr._computeResults.size).toBe(3);
  });
});
