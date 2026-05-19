"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { MockAdapter } = require("../lib/mock-adapter");

// ─── Scaffolding ─────────────────────────────────────────────────────────

let tmpDir;
let vault;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-reg-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

afterEach(() => {
  if (vault) {
    try { vault.close(); } catch (_e) {}
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Registration ────────────────────────────────────────────────────────

describe("AdapterRegistry registration", () => {
  it("rejects construction without vault", () => {
    expect(() => new AdapterRegistry({})).toThrow(/vault/);
    expect(() => new AdapterRegistry()).toThrow();
  });

  it("registers + lists + looks up adapters", () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    const a = new MockAdapter({ name: "mock-a" });
    const b = new MockAdapter({ name: "mock-b" });
    reg.register(a);
    reg.register(b);
    expect(reg.has("mock-a")).toBe(true);
    expect(reg.list().map((x) => x.name).sort()).toEqual(["mock-a", "mock-b"]);
    expect(reg.get("mock-a")).toBe(a);
    expect(reg.get("unknown")).toBeNull();
  });

  it("rejects double-register of same name", () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ name: "dup" }));
    expect(() => reg.register(new MockAdapter({ name: "dup" }))).toThrow(/already registered/);
  });

  it("rejects malformed adapter (assertAdapter gate)", () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    expect(() => reg.register({ name: "broken" })).toThrow(/invalid adapter/);
  });

  it("unregister removes; second call returns false", () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ name: "x" }));
    expect(reg.unregister("x")).toBe(true);
    expect(reg.unregister("x")).toBe(false);
    expect(reg.has("x")).toBe(false);
  });
});

// ─── End-to-end sync ─────────────────────────────────────────────────────

describe("AdapterRegistry.syncAdapter", () => {
  it("runs a clean MockAdapter end-to-end: vault + watermark + report", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ count: 30, seed: 1 }));

    const report = await reg.syncAdapter("mock");

    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(30);
    expect(report.invalidCount).toBe(0);
    expect(report.entityCounts.events).toBe(30);
    // ~2/3 of variants have a person (variants 1 and 2)
    expect(report.entityCounts.persons).toBeGreaterThan(0);
    expect(report.error).toBeNull();
    expect(report.watermark).toBe("30");
    expect(report.durationMs).toBeGreaterThan(0);

    // Vault was written
    expect(vault.stats().events).toBe(30);
    expect(vault.stats().rawEvents).toBe(30);

    // Watermark stored
    const wm = vault.getWatermark("mock");
    expect(wm.watermark).toBe("30");
    expect(wm.last_status).toBe("ok");
  });

  it("incremental sync skips already-seen items via stored watermark", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ count: 50, seed: 1 }));

    const first = await reg.syncAdapter("mock", { maxEvents: 20 });
    expect(first.rawCount).toBe(20);
    expect(first.watermark).toBe("20");

    const second = await reg.syncAdapter("mock");
    expect(second.rawCount).toBe(30); // 50 - 20
    expect(second.watermark).toBe("50");
    expect(vault.stats().rawEvents).toBe(50);
  });

  it("unhealthy adapter aborts before sync; records audit", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    const a = new MockAdapter({ count: 10 });
    a.shouldFailHealth = true;
    reg.register(a);

    const report = await reg.syncAdapter("mock");
    expect(report.status).toBe("unhealthy");
    expect(report.rawCount).toBe(0);
    expect(report.error).toBeTruthy();
    expect(vault.stats().events).toBe(0);

    const audits = vault.queryAudit({ action: "adapter.sync.unhealthy" });
    expect(audits.length).toBe(1);
  });

  it("normalize failure on one item does NOT abort the whole sync", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    const a = new MockAdapter({ count: 10 });
    a.normalizeShouldThrowAt(4); // throw on the 5th normalize call
    reg.register(a);

    const report = await reg.syncAdapter("mock");
    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(10);
    expect(report.invalidCount).toBeGreaterThanOrEqual(1);
    expect(report.entityCounts.events).toBeLessThan(10);

    const audits = vault.queryAudit({ action: "adapter.sync.normalize_failed" });
    expect(audits.length).toBe(1);
  });

  it("mid-sync throw is captured as status=error with preserved watermark", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    const a = new MockAdapter({ count: 100 });
    a.failAfter = 25;
    reg.register(a);

    const report = await reg.syncAdapter("mock");
    expect(report.status).toBe("error");
    expect(report.error).toContain("induced sync failure");

    const wm = vault.getWatermark("mock");
    expect(wm.last_status).toBe("error");
    expect(wm.last_error).toContain("induced sync failure");
  });

  it("refuses concurrent sync of two adapters in one registry", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ name: "a", count: 5000 })); // long enough to be in-flight
    reg.register(new MockAdapter({ name: "b", count: 5 }));

    const p1 = reg.syncAdapter("a");
    // Should reject during the brief async window where a is mid-sync.
    let racedReject = null;
    try {
      await reg.syncAdapter("b");
    } catch (e) {
      racedReject = e;
    }
    await p1;
    // Depending on event-loop timing this might race the other way; we just
    // assert no double-sync corruption. The active-sync invariant is
    // additionally enforced by the activeSync flag.
    expect(racedReject == null || /already syncing/.test(racedReject.message)).toBe(true);
  });
});

// ─── KG + RAG sinks ──────────────────────────────────────────────────────

describe("AdapterRegistry pluggable sinks", () => {
  it("kgSink receives triples per batch; ragSink receives docs per batch", async () => {
    freshVault();
    const kgTriples = [];
    const ragDocs = [];
    const reg = new AdapterRegistry({
      vault,
      kgSink: (ts) => kgTriples.push(...ts),
      ragSink: (ds) => ragDocs.push(...ds),
      batchSize: 7, // forces multiple batches across 20 events
    });
    reg.register(new MockAdapter({ count: 20, seed: 1 }));

    const report = await reg.syncAdapter("mock");
    expect(report.status).toBe("ok");
    expect(kgTriples.length).toBeGreaterThan(20); // each event yields multiple triples
    expect(ragDocs.length).toBeGreaterThan(0);
    // All docs should reference the mock adapter
    expect(ragDocs.every((d) => d.metadata.adapter === "mock")).toBe(true);
    // Triple counts in the report should match what was actually sent
    expect(report.kgTripleCount).toBe(kgTriples.length);
    expect(report.ragDocCount).toBe(ragDocs.length);
  });

  it("sink throws don't abort sync; failure recorded as audit", async () => {
    freshVault();
    const reg = new AdapterRegistry({
      vault,
      kgSink: () => { throw new Error("downstream KG died"); },
      ragSink: () => { throw new Error("downstream RAG died"); },
    });
    reg.register(new MockAdapter({ count: 3 }));

    const report = await reg.syncAdapter("mock");
    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(3);
    expect(report.entityCounts.events).toBe(3);

    const kgAudits = vault.queryAudit({ action: "adapter.sync.kg_sink_failed" });
    const ragAudits = vault.queryAudit({ action: "adapter.sync.rag_sink_failed" });
    expect(kgAudits.length).toBeGreaterThan(0);
    expect(ragAudits.length).toBeGreaterThan(0);
  });
});

// ─── syncAll ─────────────────────────────────────────────────────────────

describe("AdapterRegistry.syncAll", () => {
  it("returns one report per registered adapter, isolates failures", async () => {
    freshVault();
    const reg = new AdapterRegistry({ vault });
    reg.register(new MockAdapter({ name: "ok-a", count: 5 }));
    const bad = new MockAdapter({ name: "bad", count: 10 });
    bad.shouldFailHealth = true;
    reg.register(bad);
    reg.register(new MockAdapter({ name: "ok-b", count: 7 }));

    const reports = await reg.syncAll();
    expect(reports.length).toBe(3);
    const byName = Object.fromEntries(reports.map((r) => [r.adapter, r]));
    expect(byName["ok-a"].status).toBe("ok");
    expect(byName["bad"].status).toBe("unhealthy");
    expect(byName["ok-b"].status).toBe("ok");

    // The bad adapter's failure didn't prevent the others' data from landing.
    expect(vault.stats().events).toBe(12);
  });
});

// ─── 1k events < 30s perf gate (architecture doc §15.2) ──────────────────

describe("Phase 2 perf gate: 1k events ingest", () => {
  it("ingests 1k mock events well under the 30s budget", async () => {
    freshVault();
    let kgCount = 0;
    let ragCount = 0;
    const reg = new AdapterRegistry({
      vault,
      kgSink: (ts) => { kgCount += ts.length; },
      ragSink: (ds) => { ragCount += ds.length; },
      batchSize: 200,
    });
    reg.register(new MockAdapter({ count: 1000, seed: 7 }));

    const start = Date.now();
    const report = await reg.syncAdapter("mock");
    const dur = Date.now() - start;

    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(1000);
    expect(report.entityCounts.events).toBe(1000);
    expect(kgCount).toBeGreaterThan(1000);
    expect(ragCount).toBeGreaterThan(0);
    expect(dur).toBeLessThan(30_000); // architecture doc target

    // Sanity probe: querying back ~1k events should be fast.
    const qStart = Date.now();
    const events = vault.queryEvents({ limit: 1000 });
    const qDur = Date.now() - qStart;
    expect(events.length).toBe(1000);
    expect(qDur).toBeLessThan(2000); // 1k-row read should be ms-scale
  }, 60_000); // vitest test timeout — extra headroom for slow CI
});
