import { describe, it, expect } from "vitest";
import { ContextSourceLedger } from "../../src/lib/context-source-ledger.js";
describe("scoped context source accounting", () => {
  it("keeps session/turn attribution and estimates separate from observed counts", () => {
    const ledger = new ContextSourceLedger();
    ledger.record({
      sessionId: "a",
      turnId: "first",
      sourceType: "skill",
      tokenCount: 20,
    });
    ledger.record({
      sessionId: "b",
      turnId: "other",
      sourceType: "file",
      tokenCount: 100,
    });
    ledger.recordRead({
      sessionId: "a",
      turnId: "next",
      sourceType: "file",
      tokenCount: 5,
      tokenBasis: "observed",
    });
    expect(ledger.getTokenReport({ sessionId: "a" })).toEqual({
      total: 25,
      bySource: { skill: 20, file: 5 },
      byBasis: { estimated: 20, observed: 5 },
      entries: 2,
      currentRequestVerified: false,
      billingVerified: false,
    });
    expect(
      ledger.getTokenBreakdown({ sessionId: "a", turnId: "next" }),
    ).toEqual({ total: 5, bySource: { file: 5 } });
  });
  it("moves replaced entries between indexes without letting old-session cleanup delete new evidence", () => {
    const ledger = new ContextSourceLedger();
    ledger.record({
      entryId: "one",
      sessionId: "old",
      turnId: "old-turn",
      tokenCount: 2,
    });
    ledger.record({
      entryId: "one",
      sessionId: "new",
      turnId: "new-turn",
      tokenCount: 3,
    });
    ledger.clearSession("old");
    expect(ledger.getTokenReport({ sessionId: "new" }).total).toBe(3);
    expect(ledger.getStats()).toEqual({
      totalEntries: 1,
      sessionsTracked: 1,
      turnsTracked: 1,
    });
    ledger.clearSession("new");
    expect(ledger.getStats()).toEqual({
      totalEntries: 0,
      sessionsTracked: 0,
      turnsTracked: 0,
    });
  });
  it("handles unusual source names without prototype collisions and rejects invalid token counts", () => {
    const ledger = new ContextSourceLedger();
    ledger.record({ sourceType: "__proto__", tokenCount: 7 });
    expect(
      Object.hasOwn(ledger.getTokenBreakdown().bySource, "__proto__"),
    ).toBe(true);
    for (const tokenCount of [-1, NaN, Infinity, "12"])
      expect(() => ledger.record({ tokenCount })).toThrow(TypeError);
  });
});
