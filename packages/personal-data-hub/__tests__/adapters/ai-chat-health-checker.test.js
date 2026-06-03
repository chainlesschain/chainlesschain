"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  createAIChatHealthChecker,
  DEFAULT_INTERVAL_MS,
  DEFAULT_FIRST_RUN_DELAY_MS,
} = require("../../lib/adapters/ai-chat-history/health-checker");

// ─── fakes ────────────────────────────────────────────────────────────────

function makeFakeAccountsStore({ initial = {} } = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (v) => store.get(v) || null),
    put: vi.fn(async (v, e) => store.set(v, e)),
    delete: vi.fn(async (v) => store.delete(v)),
    list: vi.fn(async () => Array.from(store.values())),
    _store: store,
  };
}

function makeFakeAdapter({ behaviors = {} } = {}) {
  // behaviors = { vendor: ({ok, reason?, throw?: msg}) }
  return {
    registerVendor: vi.fn(async (vendor, _cookies) => {
      const b = behaviors[vendor];
      if (!b) return { ok: true, userId: "u_" + vendor };
      if (b.throw) throw new Error(b.throw);
      return b;
    }),
  };
}

function makeFakeTimers() {
  // Deterministic timer dispatcher we can step through. We track scheduled
  // callbacks + their delays in a queue and let tests `flush` them in order.
  const scheduled = [];
  let _now = 0;
  let _id = 0;
  const setTimeout = (fn, ms) => {
    const id = ++_id;
    scheduled.push({ id, type: "timeout", fireAt: _now + ms, fn });
    return id;
  };
  const setInterval = (fn, ms) => {
    const id = ++_id;
    scheduled.push({ id, type: "interval", fireAt: _now + ms, ms, fn });
    return id;
  };
  const clearTimeout = (id) => {
    const i = scheduled.findIndex((s) => s.id === id);
    if (i >= 0) scheduled.splice(i, 1);
  };
  const clearInterval = clearTimeout;
  async function advance(ms) {
    _now += ms;
    while (true) {
      const due = scheduled
        .filter((s) => s.fireAt <= _now)
        .sort((a, b) => a.fireAt - b.fireAt);
      if (due.length === 0) break;
      const next = due[0];
      const idx = scheduled.indexOf(next);
      scheduled.splice(idx, 1);
      if (next.type === "interval") {
        scheduled.push({ ...next, fireAt: next.fireAt + next.ms });
      }
      await next.fn();
      // Flush any fire-and-forget microtasks the callback kicked off
      // (runOnce returns a promise; the callback doesn't await it).
      await new Promise((r) => setImmediate(r));
    }
  }
  return {
    setTimeout, setInterval, clearTimeout, clearInterval,
    clock: () => _now,
    advance,
    _scheduled: scheduled,
  };
}

// ─── construction guards ─────────────────────────────────────────────────

describe("createAIChatHealthChecker — guards", () => {
  it("throws when accountsStore.list missing", () => {
    expect(() => createAIChatHealthChecker({ accountsStore: {}, vendorAdapter: { registerVendor: () => {} } })).toThrow(/accountsStore.list/);
  });
  it("throws when accountsStore.put missing", () => {
    expect(() => createAIChatHealthChecker({ accountsStore: { list: () => [] }, vendorAdapter: { registerVendor: () => {} } })).toThrow(/accountsStore.put/);
  });
  it("throws when vendorAdapter.registerVendor missing", () => {
    expect(() => createAIChatHealthChecker({ accountsStore: makeFakeAccountsStore() })).toThrow(/vendorAdapter.registerVendor/);
  });
});

// ─── runOnce behavior ────────────────────────────────────────────────────

describe("runOnce — health classification", () => {
  let timers;
  beforeEach(() => {
    timers = makeFakeTimers();
  });

  it("marks vendors ok when adapter returns ok=true", async () => {
    const store = makeFakeAccountsStore({
      initial: {
        deepseek: { vendor: "deepseek", cookies: { userToken: "x" }, cookieSpecVersion: 1 },
        kimi: { vendor: "kimi", cookies: { access_token: "y" }, cookieSpecVersion: 1 },
      },
    });
    const adapter = makeFakeAdapter();
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 2, ok: 2, failed: 0, mismatch: 0 });
    expect(store._store.get("deepseek").lastHealth.ok).toBe(true);
    expect(store._store.get("kimi").lastHealth.ok).toBe(true);
  });

  it("marks vendors failed when adapter returns ok=false (with reason)", async () => {
    const store = makeFakeAccountsStore({
      initial: { deepseek: { vendor: "deepseek", cookies: {}, cookieSpecVersion: 1 } },
    });
    const adapter = makeFakeAdapter({
      behaviors: { deepseek: { ok: false, reason: "COOKIE_EXPIRED" } },
    });
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, failed: 1, ok: 0 });
    expect(store._store.get("deepseek").lastHealth).toMatchObject({
      ok: false, reason: "COOKIE_EXPIRED",
    });
  });

  it("marks SPEC_VERSION_MISMATCH when entry.cookieSpecVersion < specVersion", async () => {
    const store = makeFakeAccountsStore({
      initial: { deepseek: { vendor: "deepseek", cookies: { x: "y" }, cookieSpecVersion: 0 } },
    });
    const adapter = makeFakeAdapter();
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, specVersion: 2, _deps: timers,
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, mismatch: 1, ok: 0, failed: 0 });
    expect(store._store.get("deepseek").lastHealth).toMatchObject({
      ok: false, reason: "SPEC_VERSION_MISMATCH",
    });
    // Adapter was NOT called because the version gate fired first
    expect(adapter.registerVendor).not.toHaveBeenCalled();
  });

  it("captures ADAPTER_THREW when registerVendor rejects", async () => {
    const store = makeFakeAccountsStore({
      initial: { deepseek: { vendor: "deepseek", cookies: { x: "y" }, cookieSpecVersion: 1 } },
    });
    const adapter = makeFakeAdapter({ behaviors: { deepseek: { throw: "net down" } } });
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, failed: 1 });
    expect(store._store.get("deepseek").lastHealth).toMatchObject({
      ok: false, reason: "ADAPTER_THREW",
    });
  });

  it("skips a run if previous one is still in flight", async () => {
    const store = makeFakeAccountsStore({
      initial: { deepseek: { vendor: "deepseek", cookies: {}, cookieSpecVersion: 1 } },
    });
    let release;
    const adapter = {
      registerVendor: vi.fn(() => new Promise((resolve) => {
        release = () => resolve({ ok: true, userId: "u" });
      })),
    };
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    const p1 = hc.runOnce();
    const r2 = await hc.runOnce();
    expect(r2.skipped).toBe(true);
    release();
    await p1;
  });

  it("returns 0 counts on empty accounts list", async () => {
    const hc = createAIChatHealthChecker({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: timers,
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 0, ok: 0, failed: 0, mismatch: 0 });
  });
});

// ─── start / stop / interval scheduling ──────────────────────────────────

describe("start / stop / interval", () => {
  let timers, store, adapter;
  beforeEach(() => {
    timers = makeFakeTimers();
    store = makeFakeAccountsStore({
      initial: { deepseek: { vendor: "deepseek", cookies: { userToken: "x" }, cookieSpecVersion: 1 } },
    });
    adapter = makeFakeAdapter();
  });

  it("first run happens after firstRunDelayMs (30s default), then interval (6h)", async () => {
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter,
      intervalMs: 6 * 3600_000, firstRunDelayMs: 30_000,
      _deps: timers,
    });
    hc.start();
    expect(hc.status().started).toBe(true);
    // 10s in — nothing has fired yet
    await timers.advance(10_000);
    expect(adapter.registerVendor).not.toHaveBeenCalled();
    // 30s mark — first run fires
    await timers.advance(20_000);
    expect(adapter.registerVendor).toHaveBeenCalledTimes(1);
    // Another 6h — interval run #1
    await timers.advance(6 * 3600_000);
    expect(adapter.registerVendor).toHaveBeenCalledTimes(2);
  });

  it("start is idempotent — second call returns false", () => {
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    expect(hc.start()).toBe(true);
    expect(hc.start()).toBe(false);
  });

  it("stop clears pending first-run + interval", async () => {
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, firstRunDelayMs: 30_000, _deps: timers,
    });
    hc.start();
    hc.stop();
    expect(hc.status().started).toBe(false);
    // 60s in — nothing fires since we stopped
    await timers.advance(60_000);
    expect(adapter.registerVendor).not.toHaveBeenCalled();
  });

  it("uses default 6h interval + 30s delay when not specified", () => {
    const hc = createAIChatHealthChecker({
      accountsStore: store, vendorAdapter: adapter, _deps: timers,
    });
    const s = hc.status();
    expect(s.intervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(s.firstRunDelayMs).toBe(DEFAULT_FIRST_RUN_DELAY_MS);
  });
});
