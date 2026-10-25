import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";
import { loadActualIndexCache } from "../helpers/evolution-index-cache-isolate.js";
import { captureEvolutionLedgerBatchReadWindow } from "../../src/lib/evolution/evolution-artifact-ports.js";

describe("compact trusted artifact index cache through real ports", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-index-cache-"),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture(name) {
    const value = openArtifactByteFixture(path.join(root, name));
    const window = captureEvolutionLedgerBatchReadWindow(
      value.ports.createEvolutionLedgerArtifactResolver({
        purpose: "evolution-ledger",
      }),
    );
    return { ...value, scan: () => window(() => undefined) };
  }

  function marker(entry, id, extras = {}) {
    return {
      ...entry,
      id: `cache-probe-${id}`,
      recordDigest: `sha256:${crypto.createHash("sha256").update(id).digest("hex")}`,
      ...extras,
    };
  }

  function write(value, rows) {
    fs.writeFileSync(
      value.store._indexFile(),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }

  function counts() {
    const result = { parse: 0, canonical: 0 };
    const parse = JSON.parse;
    const ownKeys = Reflect.ownKeys;
    vi.spyOn(JSON, "parse").mockImplementation((...args) => {
      const value = parse(...args);
      if (typeof value?.id === "string" && value.id.startsWith("cache-probe-"))
        result.parse += 1;
      return value;
    });
    vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
      // These extra rows are never requested or authenticated as artifacts.
      // Their ownKeys calls come from whole-index canonical validation only.
      if (typeof value?.id === "string" && value.id.startsWith("cache-probe-"))
        result.canonical += 1;
      return ownKeys(value);
    });
    return result;
  }

  it("retains both cold A/B layouts and preserves B across an A rewrite", () => {
    const a = fixture("A"),
      b = fixture("B");
    const expectedA = a.read(),
      expectedB = b.read();
    write(a, [a.entry, marker(a.entry, "A")]);
    write(b, [b.entry, marker(b.entry, "B")]);
    const observed = counts();
    a.scan();
    b.scan();
    a.scan();
    b.scan();
    expect(observed).toEqual({ parse: 2, canonical: 2 });
    write(a, [marker(a.entry, "A-rewritten"), a.entry]);
    a.scan();
    const afterRewrite = { ...observed };
    b.scan();
    expect(observed).toEqual(afterRewrite);
    expect(a.read()).toEqual(expectedA);
    expect(b.read()).toEqual(expectedB);
  });

  it("validates only new appended rows and recovers after a malformed suffix", () => {
    const a = fixture("append");
    const expected = a.read();
    const original = [
      a.entry,
      marker(a.entry, "unicode", {
        note: { 雪: "🪷", 10: "ten", 2: "two", 'quote"': "\\" },
      }),
    ];
    write(a, original);
    a.scan();
    const observed = counts();
    write(a, [...original, marker(a.entry, "suffix")]);
    a.scan();
    expect(observed).toEqual({ parse: 1, canonical: 1 });
    const valid = fs.readFileSync(a.store._indexFile());
    fs.appendFileSync(a.store._indexFile(), '{"id":"cache-probe-bad"}\n{x\n');
    expect(() => a.scan()).toThrow(/not JSON/u);
    fs.writeFileSync(a.store._indexFile(), valid);
    const before = { ...observed };
    a.scan();
    expect(observed).toEqual(before);
    expect(a.read()).toEqual(expected);
  });

  it("touches hits in the eight-layout LRU", () => {
    const stores = Array.from({ length: 8 }, (_, i) => fixture(`lru-${i}`));
    for (const [index, value] of stores.entries()) {
      write(value, [value.entry, marker(value.entry, `lru-${index}`)]);
      value.scan();
    }
    stores[0].scan();
    const ninth = fixture("lru-8");
    write(ninth, [ninth.entry, marker(ninth.entry, "lru-8")]);
    ninth.scan();
    const observed = counts();
    stores[0].scan();
    expect(observed).toEqual({ parse: 0, canonical: 0 });
    stores[1].scan();
    expect(observed).toEqual({ parse: 1, canonical: 1 });
  });

  it("reuses compact canonical bytes across six genuine-shaped 4096-row stores", () => {
    const stores = Array.from({ length: 6 }, (_, i) => fixture(`typed-${i}`));
    const expected = stores.map((value) => value.read());
    for (const [index, value] of stores.entries()) {
      write(value, [
        value.entry,
        ...Array.from({ length: 4095 }, (_, row) =>
          marker(value.entry, `typed-${index}-${row}`),
        ),
      ]);
    }
    const observed = counts();
    for (const value of stores) value.scan();
    expect(observed.canonical).toBe(6 * 4095);
    const first = { ...observed };
    for (const value of stores) value.scan();
    expect(observed.canonical).toBe(first.canonical);
    expect(observed.parse).toBeGreaterThan(first.parse);
    for (const [index, value] of stores.entries())
      expect(value.read()).toEqual(expected[index]);
  }, 180_000);

  it("preserves raw key order and exact fingerprints when the hot tier is absent", () => {
    const cache = loadActualIndexCache();
    const layout = Object.freeze({ rootDir: "compact-key-order" });
    const rows = [
      {
        id: "unicode-order",
        z: "雪🪷",
        10: "ten",
        2: "two",
        'quote"': "\\",
        a: { z: 1, a: 2 },
      },
    ];
    const bytes = Buffer.from(
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const cold = cache.run(layout, bytes);
    cache.dropHot();
    const before = { ...cache.counts };
    const compact = cache.run(layout, Buffer.from(bytes));
    expect(compact).toEqual(cold);
    expect(Object.keys(compact.entries[0])).toEqual(Object.keys(rows[0]));
    expect(Object.keys(compact.entries[0].a)).toEqual(["z", "a"]);
    expect(cache.counts.parse - before.parse).toBe(1);
    expect(cache.counts.canonical).toBe(before.canonical);
    expect(Object.isFrozen(compact.entries[0].a)).toBe(true);
    expect(cache.state().retainedIndexMemory).toBe(cache.state().sum);
    expect(cache.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("aliases fully validated canonical rows with only a largest-row scratch allocation", () => {
    const cache = loadActualIndexCache();
    const rows = [
      { id: "first", text: '雪 🦊 \\ " \n' },
      { id: "second", values: [null, true, 1.25, "x".repeat(120)] },
    ];
    const lines = rows.map((row) => cache.canonical(row));
    const bytes = Buffer.from(lines.join("\n") + "\n");
    const layout = Object.freeze({ rootDir: "canonical-alias" });
    const first = cache.run(layout, bytes);
    const state = cache.state();
    expect(state.entries).toMatchObject([
      { alias: true, rawBacking: bytes.buffer.byteLength },
    ]);
    expect(state.allocations.map(({ size }) => size)).toEqual([
      Math.max(...lines.map((line) => Buffer.byteLength(line))),
    ]);
    expect(state.entries[0].memory).toBe(
      state.reservations[0].candidateMemory -
        bytes.length -
        state.allocations[0].size,
    );
    expect(state.allocations[0].reservedIndexMemory).toBe(
      state.reservations[0].candidateMemory,
    );
    cache.dropHot();
    expect(cache.run(layout, Buffer.from(bytes))).toEqual(first);
    expect(cache.state().retainedIndexMemory).toBe(cache.state().sum);
    expect(cache.state().reservedIndexMemory).toBe(0);
  });

  it.each([false, true])(
    "keeps a mixed index dual when the legacy row is in the prefix: %s",
    (legacyPrefix) => {
      const cache = loadActualIndexCache();
      const canonical = cache.canonical({ id: "canonical", a: 1 });
      const legacy = JSON.stringify({ id: "legacy", z: "last", a: "first" });
      const layout = Object.freeze({ rootDir: "mixed" });
      const firstLine = legacyPrefix ? legacy : canonical;
      const secondLine = legacyPrefix ? canonical : legacy;
      const prefix = Buffer.from(firstLine + "\n");
      cache.run(layout, prefix);
      const before = cache.state();
      const bytes = Buffer.from(firstLine + "\n" + secondLine + "\n");
      const result = cache.run(layout, bytes);
      const state = cache.state();
      expect(state.entries[0].alias).toBe(false);
      expect(
        state.allocations
          .slice(before.allocations.length)
          .map(({ size }) => size),
      ).toEqual([
        Math.max(Buffer.byteLength(firstLine), Buffer.byteLength(secondLine)),
        bytes.length,
      ]);
      expect(state.reservations.at(-1).pinnedCompactMemory).toBe(
        before.entries[0].memory,
      );
      expect(state.promotions.at(-1).reservedIndexMemory).toBe(
        before.entries[0].memory +
          before.entries[0].hotMemory +
          Math.max(Buffer.byteLength(firstLine), Buffer.byteLength(secondLine)),
      );
      expect(result.entriesFingerprint).toBe(
        loadActualIndexCache().run({}, bytes).entriesFingerprint,
      );
      cache.dropHot();
      const decoded = cache.run(layout, Buffer.from(bytes));
      expect(Object.keys(decoded.entries[legacyPrefix ? 0 : 1])).toEqual([
        "id",
        "z",
        "a",
      ]);
      expect(state.peakAccounted).toBeLessThanOrEqual(112 * 1024 * 1024);
      expect(state.retainedIndexMemory).toBe(state.sum);
      expect(state.reservedIndexMemory).toBe(0);
    },
  );

  it("preserves an aliased prefix after invalid UTF-8, incomplete framing and malformed appends", () => {
    const cache = loadActualIndexCache();
    const layout = Object.freeze({ rootDir: "alias-failed-append" });
    const bytes = Buffer.from('{"id":"original"}\n');
    const original = cache.run(layout, bytes);
    for (const suffix of [
      Buffer.from([0xff, 10]),
      Buffer.from('{"id":"unfinished"}'),
      Buffer.from('{"id":"ok"}\n{x\n'),
    ]) {
      expect(() => cache.run(layout, Buffer.concat([bytes, suffix]))).toThrow();
      expect(cache.state().reservedIndexMemory).toBe(0);
      expect(cache.state().entries[0].alias).toBe(true);
      expect(cache.run(layout, Buffer.from(bytes))).toEqual(original);
    }
  });

  it("admits a canonical row at the original 16 KiB limit and reserves its exact largest-row scratch", () => {
    const cache = loadActualIndexCache();
    const empty = '{"id":"limit","value":""}';
    const line = cache.canonical({
      id: "limit",
      value: "x".repeat(16 * 1024 - Buffer.byteLength(empty)),
    });
    expect(Buffer.byteLength(line)).toBe(16 * 1024);
    const bytes = Buffer.from(line + "\n");
    const result = cache.run({}, bytes);
    expect(result.entries).toHaveLength(1);
    expect(cache.state().entries[0].alias).toBe(true);
    expect(cache.state().allocations.map(({ size }) => size)).toEqual([
      16 * 1024,
    ]);
    expect(cache.state().retainedIndexMemory).toBe(cache.state().sum);
    expect(cache.state().reservedIndexMemory).toBe(0);
  });

  it("accounts six 4096-row genuine shapes, pinned append overlap and failed reservations within 112 MiB", () => {
    const template = fixture("budget-template");
    const cache = loadActualIndexCache();
    const layouts = Array.from({ length: 6 }, (_, index) =>
      Object.freeze({ rootDir: `typed-budget-${index}` }),
    );
    const snapshots = layouts.map((_, index) =>
      Buffer.from(
        Array.from({ length: 4096 }, (_, row) =>
          JSON.stringify(marker(template.entry, `budget-${index}-${row}`)),
        ).join("\n") + "\n",
      ),
    );
    for (const [index, layout] of layouts.entries())
      cache.run(layout, snapshots[index]);
    const first = cache.state();
    expect(first.layouts).toBe(6);
    expect(first.retainedIndexMemory).toBe(first.sum);
    expect(first.peakAccounted).toBeLessThanOrEqual(112 * 1024 * 1024);
    const canonical = cache.counts.canonical;
    for (const [index, layout] of layouts.entries())
      cache.run(layout, snapshots[index]);
    expect(cache.counts.canonical).toBe(canonical);
    const suffix = Buffer.from(
      JSON.stringify(marker(template.entry, "budget-appended")) + "\n",
    );
    const appended = Buffer.concat([snapshots[0], suffix]);
    const beforeAppend = cache.counts.canonical;
    const result = cache.run(layouts[0], appended);
    expect(cache.counts.canonical - beforeAppend).toBe(1);
    expect(result.entriesFingerprint).toBe(
      loadActualIndexCache().run(
        Object.freeze({ rootDir: "cold-budget" }),
        appended,
      ).entriesFingerprint,
    );
    expect(() =>
      cache.run(
        layouts[0],
        Buffer.concat([appended, Buffer.from('{"id":"bad"}\n{x\n')]),
      ),
    ).toThrow(/not JSON/u);
    expect(cache.run(layouts[0], appended).entriesFingerprint).toBe(
      result.entriesFingerprint,
    );
    const final = cache.state();
    expect(final.layouts).toBe(6);
    expect(final.retainedIndexMemory).toBe(final.sum);
    expect(final.reservedIndexMemory).toBe(0);
    expect(final.peakAccounted).toBeLessThanOrEqual(112 * 1024 * 1024);
  }, 180_000);

  it("bypasses an admissible oversized snapshot without clearing an unrelated hot layout", () => {
    const cache = loadActualIndexCache();
    const a = Object.freeze({ rootDir: "retained-small" });
    const b = Object.freeze({ rootDir: "oversized" });
    const bytes = Buffer.from('{"id":"small"}\n');
    const expected = cache.run(a, bytes);
    const large = Buffer.from(
      Array.from({ length: 2200 }, (_, index) =>
        JSON.stringify({ id: `large-${index}`, value: "x".repeat(12000) }),
      ).join("\n") + "\n",
    );
    expect(large.length).toBeGreaterThan(24 * 1024 * 1024);
    expect(cache.run(b, large).entries).toHaveLength(2200);
    const countsBefore = { ...cache.counts };
    expect(cache.run(a, bytes)).toEqual(expected);
    expect(cache.counts).toEqual(countsBefore);
    expect(cache.state().layouts).toBe(1);
    expect(cache.state().reservedIndexMemory).toBe(0);
  }, 120_000);
});
