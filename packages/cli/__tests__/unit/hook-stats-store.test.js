/**
 * hook-stats-store — pure reliability aggregate for async hooks (P2 doctor
 * "慢/熔断 Hook"). Aggregation is pure (clock injected by the caller); load/save
 * take an injected fs and are best-effort.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const store = require("../../src/lib/hook-stats-store.cjs");

describe("aggregateRun", () => {
  it("accumulates runs, failures, durations and max", () => {
    let s = store.emptyStats();
    s = store.aggregateRun(s, {
      command: "./g.sh",
      event: "PreToolUse",
      ok: true,
      ms: 100,
      now: 1,
    });
    s = store.aggregateRun(s, {
      command: "./g.sh",
      event: "PreToolUse",
      ok: false,
      ms: 300,
      now: 2,
    });
    const e = Object.values(s)[0];
    expect(e.runs).toBe(2);
    expect(e.failures).toBe(1);
    expect(e.totalMs).toBe(400);
    expect(e.maxMs).toBe(300);
    expect(e.lastRunAt).toBe(2);
    expect(e.lastFailureAt).toBe(2);
  });

  it("tracks consecutive failures and resets on success", () => {
    let s = store.emptyStats();
    const rec = (ok, now) =>
      (s = store.aggregateRun(s, { command: "x", event: "E", ok, ms: 1, now }));
    rec(false, 1);
    rec(false, 2);
    expect(Object.values(s)[0].consecutiveFailures).toBe(2);
    rec(true, 3);
    expect(Object.values(s)[0].consecutiveFailures).toBe(0);
  });

  it("bounds distinct hooks to MAX_HOOKS (drops least-recently-run)", () => {
    let s = store.emptyStats();
    for (let i = 0; i < store.MAX_HOOKS + 5; i++) {
      s = store.aggregateRun(s, {
        command: `h${i}`,
        event: "E",
        ok: true,
        ms: 1,
        now: i,
      });
    }
    expect(Object.keys(s).length).toBe(store.MAX_HOOKS);
    // The oldest (h0) was dropped; the newest survive.
    expect(s[store.hookKey("h0", "E")]).toBeUndefined();
    expect(s[store.hookKey(`h${store.MAX_HOOKS + 4}`, "E")]).toBeTruthy();
  });
});

describe("mergeStats", () => {
  it("adds counts and keeps the delta's recent streak", () => {
    const base = store.aggregateRun(store.emptyStats(), {
      command: "x",
      event: "E",
      ok: false,
      ms: 10,
      now: 1,
    });
    const delta = store.aggregateRun(store.emptyStats(), {
      command: "x",
      event: "E",
      ok: false,
      ms: 50,
      now: 9,
    });
    const merged = store.mergeStats(base, delta);
    const e = Object.values(merged)[0];
    expect(e.runs).toBe(2);
    expect(e.failures).toBe(2);
    expect(e.maxMs).toBe(50);
    expect(e.lastRunAt).toBe(9);
    expect(e.consecutiveFailures).toBe(1); // delta's streak wins
  });
});

describe("toCheckHooksInput", () => {
  it("shapes for checkHooks with avgMs + derived circuitOpen", () => {
    let s = store.emptyStats();
    for (let i = 0; i < 3; i++) {
      s = store.aggregateRun(s, {
        command: "flaky",
        event: "E",
        ok: false,
        ms: 200,
        now: i,
      });
    }
    const [input] = store.toCheckHooksInput(s, { circuitThreshold: 3 });
    expect(input.id).toBe("flaky");
    expect(input.failures).toBe(3);
    expect(input.avgMs).toBe(200);
    expect(input.circuitOpen).toBe(true);
  });
});

describe("load / save / persistSessionStats (best-effort)", () => {
  it("round-trips through a real temp file and merges on persist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hookstats-"));
    const file = path.join(tmp, "hook-stats.json");
    try {
      const first = store.aggregateRun(store.emptyStats(), {
        command: "x",
        event: "E",
        ok: false,
        ms: 5,
        now: 1,
      });
      expect(store.persistSessionStats(first, file)).toBe(true);

      const second = store.aggregateRun(store.emptyStats(), {
        command: "x",
        event: "E",
        ok: false,
        ms: 7,
        now: 2,
      });
      store.persistSessionStats(second, file); // merges with what's on disk

      const loaded = store.loadHookStats(file);
      expect(Object.values(loaded)[0].runs).toBe(2);
      expect(Object.values(loaded)[0].failures).toBe(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("load returns {} on missing/corrupt; save/persist never throw", () => {
    expect(store.loadHookStats("/no/such/hook-stats.json")).toEqual({});
    // persist with empty delta is a no-op
    expect(store.persistSessionStats({}, "/no/such/x.json")).toBe(false);
  });
});
