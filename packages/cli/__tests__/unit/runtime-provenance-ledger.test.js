import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_PROVENANCE_MAX_ENTRIES,
  RuntimeProvenanceLedger,
} from "../../src/lib/runtime-provenance-ledger.js";

describe("runtime provenance ledger retention", () => {
  it("retains a hash-anchored suffix with absolute monotonic indexes", () => {
    const genesisHash = "a".repeat(64);
    const ledger = new RuntimeProvenanceLedger({
      genesisHash,
      maxEntries: 3,
    });
    const recorded = Array.from({ length: 6 }, (_, index) =>
      ledger.record(
        "test.event",
        {
          traceId: `trace-${index}`,
          span: `span-${index}`,
          value: index,
        },
        "unit-test",
      ),
    );

    expect(recorded.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ledger.getProvenance().map((entry) => entry.index)).toEqual([
      3, 4, 5,
    ]);
    expect(ledger.getTraceEntries("trace-2")).toEqual([]);
    expect(ledger.getSpanEntries("span-2")).toEqual([]);
    expect(ledger.getTraceEntries("trace-4")).toEqual([recorded[4]]);
    expect(ledger.getSpanEntries("span-5")).toEqual([recorded[5]]);
    expect(ledger.verifyIntegrity()).toBe(true);

    const exported = ledger.export();
    expect(exported).toMatchObject({
      genesisHash: recorded[2].hash,
      originalGenesisHash: genesisHash,
      lastHash: recorded[5].hash,
      entries: [recorded[3], recorded[4], recorded[5]],
      verified: true,
      verificationScope: "retained-window",
      totalEntries: 6,
      retainedEntries: 3,
      evictedEntries: 3,
      truncated: true,
      anchor: {
        hash: recorded[2].hash,
        evictedThroughIndex: 2,
        firstRetainedIndex: 3,
      },
    });
  });

  it("indexes only retained members of a shared trace and span", () => {
    const ledger = new RuntimeProvenanceLedger({ maxEntries: 3 });
    const recorded = Array.from({ length: 5 }, (_, value) =>
      ledger.record("test.event", { traceId: "trace", span: "span", value }),
    );

    expect(ledger.getTraceEntries("trace")).toEqual(recorded.slice(2));
    expect(ledger.getSpanEntries("span")).toEqual(recorded.slice(2));
    expect(ledger.getProvenance({ traceId: "trace" })).toEqual(
      recorded.slice(2),
    );
    expect(ledger.getProvenance({ span: "span" })).toEqual(recorded.slice(2));
  });

  it("keeps storage bounded far beyond the configured capacity", () => {
    const maxEntries = 32;
    const totalEntries = 5_000;
    const ledger = new RuntimeProvenanceLedger({ maxEntries });
    for (let index = 0; index < totalEntries; index += 1) {
      ledger.record("stress.event", {
        traceId: `trace-${index}`,
        span: `span-${index}`,
      });
    }

    const retained = ledger.getProvenance();
    expect(retained).toHaveLength(maxEntries);
    expect(retained[0].index).toBe(totalEntries - maxEntries);
    expect(retained.at(-1).index).toBe(totalEntries - 1);
    expect(ledger.getTraceEntries("trace-0")).toEqual([]);
    expect(ledger.getSpanEntries(`span-${totalEntries - 1}`)).toEqual([
      retained.at(-1),
    ]);
    expect(ledger.export()).toMatchObject({
      totalEntries,
      retainedEntries: maxEntries,
      evictedEntries: totalEntries - maxEntries,
      truncated: true,
      verified: true,
      anchor: {
        evictedThroughIndex: totalEntries - maxEntries - 1,
        firstRetainedIndex: totalEntries - maxEntries,
      },
    });
  });

  it("snapshots and freezes entries before exposing eviction keys", () => {
    const maxEntries = 8;
    const ledger = new RuntimeProvenanceLedger({ maxEntries });
    const metadata = {
      nested: { label: "before" },
      values: [1, 2],
    };
    const first = ledger.record("test.event", {
      traceId: "trace-0",
      span: "span-0",
      metadata,
    });

    metadata.nested.label = "after";
    metadata.values.push(3);
    expect(first.metadata).toEqual({
      nested: { label: "before" },
      values: [1, 2],
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metadata)).toBe(true);
    expect(Object.isFrozen(first.metadata.nested)).toBe(true);

    for (const [key, value] of [
      ["index", 99_999],
      ["traceId", "poisoned-trace"],
      ["span", "poisoned-span"],
      ["hash", "f".repeat(64)],
    ]) {
      expect(() => {
        first[key] = value;
      }).toThrow(TypeError);
    }
    expect(() => {
      first.metadata.nested.label = "poisoned";
    }).toThrow(TypeError);

    for (let index = 1; index < 1_000; index += 1) {
      ledger.record("test.event", {
        traceId: `trace-${index}`,
        span: `span-${index}`,
      });
    }

    expect(ledger._entries).toHaveLength(maxEntries);
    expect(ledger._entriesByIndex.size).toBe(maxEntries);
    expect(ledger._traceIndex.size).toBe(maxEntries);
    expect(ledger._spanIndex.size).toBe(maxEntries);
    expect(ledger.getTraceEntries("poisoned-trace")).toEqual([]);
    expect(ledger.getSpanEntries("poisoned-span")).toEqual([]);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it("reports complete verification before its first eviction", () => {
    const ledger = new RuntimeProvenanceLedger();
    const entry = ledger.record("test.event", { traceId: "trace" });
    const exported = ledger.export();

    expect(DEFAULT_RUNTIME_PROVENANCE_MAX_ENTRIES).toBe(4_096);
    expect(exported).toMatchObject({
      genesisHash: entry.prevHash,
      originalGenesisHash: entry.prevHash,
      lastHash: entry.hash,
      entries: [entry],
      verified: true,
      verificationScope: "complete",
      totalEntries: 1,
      retainedEntries: 1,
      evictedEntries: 0,
      truncated: false,
      anchor: {
        hash: entry.prevHash,
        evictedThroughIndex: null,
        firstRetainedIndex: 0,
      },
    });
  });

  it("rejects invalid retention limits", () => {
    for (const maxEntries of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => new RuntimeProvenanceLedger({ maxEntries })).toThrow(
        /maxEntries must be a positive integer/u,
      );
    }
  });
});
