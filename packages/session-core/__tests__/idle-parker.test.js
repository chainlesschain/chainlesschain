import { describe, it, expect, vi } from "vitest";
import { IdleParker, DEFAULT_IDLE_THRESHOLD_MS } from "../lib/idle-parker.js";
import { SessionManager } from "../lib/session-manager.js";

function fixedClock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

describe("IdleParker — construction", () => {
  it("requires manager", () => {
    expect(() => new IdleParker({})).toThrow(/manager required/);
  });

  it("defaults to 10min idle threshold", () => {
    const p = new IdleParker({ manager: new SessionManager() });
    expect(p.idleThresholdMs).toBe(DEFAULT_IDLE_THRESHOLD_MS);
  });
});

describe("IdleParker — start/stop", () => {
  it("start/stop are idempotent", () => {
    const fakeInterval = vi.fn(() => ({ unref: () => {} }));
    const fakeClear = vi.fn();
    const p = new IdleParker({
      manager: new SessionManager(),
      setInterval: fakeInterval,
      clearInterval: fakeClear,
    });
    expect(p.start()).toBe(true);
    expect(p.start()).toBe(false); // second call no-op
    expect(fakeInterval).toHaveBeenCalledTimes(1);
    expect(p.isRunning()).toBe(true);
    expect(p.stop()).toBe(true);
    expect(p.stop()).toBe(false);
    expect(fakeClear).toHaveBeenCalledTimes(1);
  });

  it("emits started/stopped", () => {
    const p = new IdleParker({
      manager: new SessionManager(),
      setInterval: () => ({ unref: () => {} }),
      clearInterval: () => {},
    });
    const started = vi.fn();
    const stopped = vi.fn();
    p.on("started", started);
    p.on("stopped", stopped);
    p.start();
    p.stop();
    expect(started).toHaveBeenCalled();
    expect(stopped).toHaveBeenCalled();
  });
});

describe("IdleParker — scan", () => {
  it("parks session idle beyond threshold", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({
      manager: mgr,
      idleThresholdMs: 1000,
      now,
    });
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(1500);
    const parked = await parker.scan();
    expect(parked).toContain(h.sessionId);
    expect(h.status).toBe("parked");
  });

  it("does not park sessions below threshold", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({
      manager: mgr,
      idleThresholdMs: 5000,
      now,
    });
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(1000);
    const parked = await parker.scan();
    expect(parked).toHaveLength(0);
    expect(h.status).toBe("idle");
  });

  it("ignores running sessions", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({
      manager: mgr,
      idleThresholdMs: 1000,
      now,
    });
    mgr.create({ agentId: "a" });
    now.advance(10_000);
    const parked = await parker.scan();
    expect(parked).toHaveLength(0);
  });

  it("parks multiple sessions in one scan", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({
      manager: mgr,
      idleThresholdMs: 500,
      now,
    });
    const h1 = mgr.create({ agentId: "a" });
    const h2 = mgr.create({ agentId: "a" });
    mgr.markIdle(h1.sessionId);
    mgr.markIdle(h2.sessionId);
    now.advance(1000);
    const parked = await parker.scan();
    expect(parked).toHaveLength(2);
  });

  it("emits scan-complete", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({ manager: mgr, idleThresholdMs: 100, now });
    const spy = vi.fn();
    parker.on("scan-complete", spy);
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(200);
    await parker.scan();
    expect(spy).toHaveBeenCalledWith({ candidates: 1, parked: 1 });
  });

  it("emits parked per session", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({ manager: mgr, idleThresholdMs: 100, now });
    const parked = vi.fn();
    parker.on("parked", parked);
    const h1 = mgr.create({ agentId: "a" });
    const h2 = mgr.create({ agentId: "a" });
    mgr.markIdle(h1.sessionId);
    mgr.markIdle(h2.sessionId);
    now.advance(500);
    await parker.scan();
    expect(parked).toHaveBeenCalledTimes(2);
  });

  it("catches per-session park errors", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    // Force park to throw
    mgr.park = vi.fn().mockRejectedValue(new Error("store offline"));
    const parker = new IdleParker({ manager: mgr, idleThresholdMs: 100, now });
    const errSpy = vi.fn();
    parker.on("park-error", errSpy);
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(500);
    await parker.scan();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(parker.stats().errors).toBe(1);
  });
});

describe("IdleParker — stats", () => {
  it("counts scans and parked", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({ manager: mgr, idleThresholdMs: 100, now });
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(500);
    await parker.scan();
    await parker.scan();
    expect(parker.stats().scans).toBe(2);
    expect(parker.stats().parked).toBe(1);
  });

  it("resetStats zeros counters", async () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const parker = new IdleParker({ manager: mgr, idleThresholdMs: 100, now });
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(500);
    await parker.scan();
    parker.resetStats();
    expect(parker.stats()).toMatchObject({ scans: 0, parked: 0, errors: 0 });
  });
});

describe("IdleParker — timer integration", () => {
  it("timer callback calls scan()", () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    let tick;
    const fakeInterval = (fn) => {
      tick = fn;
      return { unref: () => {} };
    };
    const parker = new IdleParker({
      manager: mgr,
      idleThresholdMs: 100,
      now,
      setInterval: fakeInterval,
      clearInterval: () => {},
    });
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    now.advance(500);
    parker.start();
    tick(); // simulate timer firing
    // scan is async; can't await cleanly here, but stats should increment after microtask
    return Promise.resolve().then(() => {
      expect(parker.stats().scans).toBeGreaterThanOrEqual(1);
    });
  });
});
