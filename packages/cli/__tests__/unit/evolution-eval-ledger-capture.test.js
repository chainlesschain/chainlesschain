import { describe, expect, it } from "vitest";
import { EVOLUTION_LEDGER_MAX_EVENTS } from "../../src/lib/evolution/evolution-ledger.js";
import {
  captureEvolutionEvalLedger,
  readEvolutionEvalLedger,
} from "../../src/lib/evolution/evolution-eval-ledger-capture.js";

describe("complete Eval Ledger census kernel", () => {
  it("includes events beyond the old 10,000-event default instead of hiding occupied slots", () => {
    const events = Array.from({ length: 10001 }, (_, index) => ({
      sequence: index + 1,
      type:
        index === 10000 ? "evolution.eval-attempt.admitted" : "other-domain",
    }));
    const methods = {
      verify: () => ({
        ledgerId: "test",
        epoch: "test",
        headDigest: "test",
        sequence: events.length,
      }),
      read({ limit, afterSequence }) {
        expect(afterSequence).toBe(0);
        expect(limit).toBe(EVOLUTION_LEDGER_MAX_EVENTS);
        return events.slice(0, limit);
      },
    };
    expect(readEvolutionEvalLedger(methods).at(-1).type).toBe(
      "evolution.eval-attempt.admitted",
    );
  });
  it("rejects prefix truncation and gaps even when the before/after head is stable", () => {
    const verify = () => ({
      ledgerId: "test",
      epoch: "test",
      headDigest: "test",
      sequence: 3,
    });
    expect(() =>
      readEvolutionEvalLedger({
        verify,
        read: () => [{ sequence: 1 }, { sequence: 2 }],
      }),
    ).toThrow(/complete contiguous/);
    expect(() =>
      readEvolutionEvalLedger({
        verify,
        read: () => [{ sequence: 1 }, { sequence: 3 }, { sequence: 4 }],
      }),
    ).toThrow(/complete contiguous/);
  });
  it("retries a changed bookend but rejects repeated movement or epoch substitution", () => {
    let reads = 0;
    const methods = {
      verify() {
        return {
          ledgerId: "test",
          epoch: reads === 1 ? "changed" : "test",
          headDigest: "test",
          sequence: 1,
        };
      },
      read() {
        reads++;
        return [{ sequence: 1 }];
      },
    };
    expect(readEvolutionEvalLedger(methods)).toHaveLength(1);
    expect(reads).toBe(3);
    let current = 0;
    expect(() =>
      readEvolutionEvalLedger({
        verify: () => ({ sequence: current++ }),
        read: () => [],
      }),
    ).toThrow(/changed during Eval census/);
  });
  it("does not capture fabricated or Proxy journals", () => {
    expect(() =>
      captureEvolutionEvalLedger({
        read() {},
        verify() {},
        appendDomainEvent() {},
      }),
    ).toThrow(/genuine Ledger/);
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
        },
        getPrototypeOf() {
          traps++;
        },
      },
    );
    expect(() => captureEvolutionEvalLedger(proxy)).toThrow(/genuine Ledger/);
    expect(traps).toBe(0);
  });
});
