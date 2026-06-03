import { describe, it, expect, vi } from "vitest";
import { SessionManager, MS_PER_HOUR } from "../lib/session-manager.js";
import { SessionHandle, STATUS } from "../lib/session-handle.js";

function fixedClock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  now.set = (v) => {
    t = v;
  };
  return now;
}

describe("SessionManager — create/get/list", () => {
  it("create returns a SessionHandle", () => {
    const mgr = new SessionManager();
    const h = mgr.create({ agentId: "a1" });
    expect(h.sessionId).toMatch(/^sess_/);
    expect(h.agentId).toBe("a1");
  });

  it("get returns registered session", () => {
    const mgr = new SessionManager();
    const h = mgr.create({ agentId: "a1" });
    expect(mgr.get(h.sessionId)).toBe(h);
  });

  it("get returns null for unknown", () => {
    const mgr = new SessionManager();
    expect(mgr.get("ghost")).toBeNull();
  });

  it("list filters by agentId", () => {
    const mgr = new SessionManager();
    mgr.create({ agentId: "a1" });
    mgr.create({ agentId: "a1" });
    mgr.create({ agentId: "a2" });
    expect(mgr.list({ agentId: "a1" })).toHaveLength(2);
    expect(mgr.list({ agentId: "a2" })).toHaveLength(1);
  });

  it("list filters by status", () => {
    const now = fixedClock(1000);
    const mgr = new SessionManager({ now });
    const h1 = mgr.create({ agentId: "a" });
    const h2 = mgr.create({ agentId: "a" });
    now.advance(500);
    mgr.markIdle(h2.sessionId);
    expect(mgr.list({ status: STATUS.RUNNING })).toContain(h1);
    expect(mgr.list({ status: STATUS.IDLE })).toContain(h2);
  });

  it("duplicate sessionId throws", () => {
    const mgr = new SessionManager();
    mgr.create({ agentId: "a", sessionId: "dup" });
    expect(() => mgr.create({ agentId: "a", sessionId: "dup" })).toThrow(/duplicate/);
  });

  it("adopt registers existing handle", () => {
    const mgr = new SessionManager();
    const h = new SessionHandle({ agentId: "a" });
    mgr.adopt(h);
    expect(mgr.has(h.sessionId)).toBe(true);
  });

  it("adopt rejects non-SessionHandle", () => {
    const mgr = new SessionManager();
    expect(() => mgr.adopt({ agentId: "a" })).toThrow();
  });
});

describe("SessionManager — lifecycle", () => {
  it("touch marks activity", () => {
    const now = fixedClock(1000);
    const mgr = new SessionManager({ now });
    const h = mgr.create({ agentId: "a" });
    now.advance(100);
    expect(mgr.touch(h.sessionId)).toBe(true);
    expect(h.lastActiveAt).toBe(1100);
  });

  it("markIdle transitions to idle", () => {
    const mgr = new SessionManager();
    const h = mgr.create({ agentId: "a" });
    expect(mgr.markIdle(h.sessionId)).toBe(true);
    expect(h.status).toBe(STATUS.IDLE);
  });

  it("park + resume round trip", async () => {
    const now = fixedClock(1000);
    const mgr = new SessionManager({ now });
    const h = mgr.create({ agentId: "a" });
    now.advance(500);
    mgr.markIdle(h.sessionId);
    now.advance(1000);
    expect(await mgr.park(h.sessionId)).toBe(true);
    expect(h.status).toBe(STATUS.PARKED);
    now.advance(100);
    expect(await mgr.resume(h.sessionId)).toBe(true);
    expect(h.status).toBe(STATUS.RUNNING);
  });

  it("park on running fails (must idle first)", async () => {
    const mgr = new SessionManager();
    const h = mgr.create({ agentId: "a" });
    expect(await mgr.park(h.sessionId)).toBe(false);
  });

  it("close removes from manager", async () => {
    const mgr = new SessionManager();
    const h = mgr.create({ agentId: "a" });
    expect(await mgr.close(h.sessionId)).toBe(true);
    expect(mgr.has(h.sessionId)).toBe(false);
  });

  it("close unknown returns false", async () => {
    const mgr = new SessionManager();
    expect(await mgr.close("ghost")).toBe(false);
  });
});

describe("SessionManager — store persistence", () => {
  it("park calls store.save", async () => {
    const store = { save: vi.fn().mockResolvedValue() };
    const now = fixedClock(0);
    const mgr = new SessionManager({ store, now });
    const h = mgr.create({ agentId: "a" });
    now.advance(100);
    mgr.markIdle(h.sessionId);
    await mgr.park(h.sessionId);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][0].sessionId).toBe(h.sessionId);
  });

  it("resume loads from store when session not in memory", async () => {
    const handleData = new SessionHandle({ agentId: "a", sessionId: "persisted" }).toJSON();
    handleData.status = STATUS.PARKED;
    const store = {
      save: vi.fn(),
      load: vi.fn().mockResolvedValue(handleData),
      remove: vi.fn(),
    };
    const mgr = new SessionManager({ store });
    const ok = await mgr.resume("persisted");
    expect(ok).toBe(true);
    expect(mgr.has("persisted")).toBe(true);
  });

  it("close calls store.remove", async () => {
    const store = { save: vi.fn(), remove: vi.fn().mockResolvedValue() };
    const mgr = new SessionManager({ store });
    const h = mgr.create({ agentId: "a" });
    await mgr.close(h.sessionId);
    expect(store.remove).toHaveBeenCalledWith(h.sessionId);
  });

  it("store errors emit store-error without throwing", async () => {
    const store = { save: vi.fn().mockRejectedValue(new Error("disk")) };
    const mgr = new SessionManager({ store });
    const spy = vi.fn();
    mgr.on("store-error", spy);
    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    await mgr.park(h.sessionId);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("SessionManager — usage metrics", () => {
  it("usage returns session-hour for single session", () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const h = mgr.create({ agentId: "a" });
    now.advance(MS_PER_HOUR / 2); // 30 min running
    const u = mgr.usage(h.sessionId);
    expect(u.sessionHours).toBeCloseTo(0.5, 5);
    expect(u.agentId).toBe("a");
  });

  it("usage returns null for unknown", () => {
    const mgr = new SessionManager();
    expect(mgr.usage("ghost")).toBeNull();
  });

  it("usageByAgent aggregates per agent", () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    mgr.create({ agentId: "a1" });
    mgr.create({ agentId: "a1" });
    mgr.create({ agentId: "a2" });
    now.advance(MS_PER_HOUR);
    const by = mgr.usageByAgent();
    const a1 = by.find((x) => x.agentId === "a1");
    const a2 = by.find((x) => x.agentId === "a2");
    expect(a1.sessionCount).toBe(2);
    expect(a1.sessionHours).toBeCloseTo(2, 5);
    expect(a2.sessionCount).toBe(1);
    expect(a2.sessionHours).toBeCloseTo(1, 5);
  });

  it("usageTotal sums across all sessions", () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    mgr.create({ agentId: "a1" });
    mgr.create({ agentId: "a2" });
    now.advance(MS_PER_HOUR);
    const total = mgr.usageTotal();
    expect(total.sessionCount).toBe(2);
    expect(total.sessionHours).toBeCloseTo(2, 5);
  });

  it("idle time does not count toward sessionHours", () => {
    const now = fixedClock(0);
    const mgr = new SessionManager({ now });
    const h = mgr.create({ agentId: "a" });
    now.advance(MS_PER_HOUR / 4); // 15 min running
    mgr.markIdle(h.sessionId);
    now.advance(MS_PER_HOUR * 2); // 2 hr idle
    const u = mgr.usage(h.sessionId);
    expect(u.sessionHours).toBeCloseTo(0.25, 5); // only 15 min
    expect(u.idleMs).toBeCloseTo(MS_PER_HOUR * 2, -2);
  });
});

describe("SessionManager — events", () => {
  it("emits lifecycle events", async () => {
    const mgr = new SessionManager();
    const events = [];
    mgr.on("created", () => events.push("created"));
    mgr.on("idle", () => events.push("idle"));
    mgr.on("parked", () => events.push("parked"));
    mgr.on("resumed", () => events.push("resumed"));
    mgr.on("closed", () => events.push("closed"));

    const h = mgr.create({ agentId: "a" });
    mgr.markIdle(h.sessionId);
    await mgr.park(h.sessionId);
    await mgr.resume(h.sessionId);
    await mgr.close(h.sessionId);

    expect(events).toEqual(["created", "idle", "parked", "resumed", "closed"]);
  });
});

describe("SessionManager — listActive", () => {
  it("excludes parked and closed sessions", async () => {
    const mgr = new SessionManager();
    const h1 = mgr.create({ agentId: "a" });
    const h2 = mgr.create({ agentId: "a" });
    mgr.markIdle(h2.sessionId);
    await mgr.park(h2.sessionId);
    const active = mgr.listActive();
    expect(active).toContain(h1);
    expect(active).not.toContain(h2);
  });
});
