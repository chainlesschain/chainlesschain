import { describe, test, expect, beforeEach } from "vitest";
import {
  STAIL_SUB_MATURITY_V2,
  STAIL_EVENT_LIFECYCLE_V2,
  setMaxActiveStailSubsPerOwnerV2,
  getMaxActiveStailSubsPerOwnerV2,
  setMaxPendingStailEventsPerSubV2,
  getMaxPendingStailEventsPerSubV2,
  setStailSubIdleMsV2,
  getStailSubIdleMsV2,
  setStailEventStuckMsV2,
  getStailEventStuckMsV2,
  _resetStateSessionTailV2,
  registerStailSubV2,
  activateStailSubV2,
  pauseStailSubV2,
  closeStailSubV2,
  touchStailSubV2,
  getStailSubV2,
  listStailSubsV2,
  createStailEventV2,
  tailingStailEventV2,
  completeStailEventV2,
  failStailEventV2,
  cancelStailEventV2,
  getStailEventV2,
  listStailEventsV2,
  autoPauseIdleStailSubsV2,
  autoFailStuckStailEventsV2,
  getSessionTailGovStatsV2,
} from "../../../src/lib/session-tail.js";

beforeEach(() => {
  _resetStateSessionTailV2();
});

describe("SessionTail V2 enums", () => {
  test("sub maturity", () => {
    expect(STAIL_SUB_MATURITY_V2.PENDING).toBe("pending");
    expect(STAIL_SUB_MATURITY_V2.ACTIVE).toBe("active");
    expect(STAIL_SUB_MATURITY_V2.PAUSED).toBe("paused");
    expect(STAIL_SUB_MATURITY_V2.CLOSED).toBe("closed");
  });
  test("event lifecycle", () => {
    expect(STAIL_EVENT_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(STAIL_EVENT_LIFECYCLE_V2.TAILING).toBe("tailing");
    expect(STAIL_EVENT_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(STAIL_EVENT_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(STAIL_EVENT_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(STAIL_SUB_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(STAIL_EVENT_LIFECYCLE_V2)).toBe(true);
  });
});

describe("SessionTail V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveStailSubsPerOwnerV2()).toBe(10);
    expect(getMaxPendingStailEventsPerSubV2()).toBe(30);
    expect(getStailSubIdleMsV2()).toBe(24 * 60 * 60 * 1000);
    expect(getStailEventStuckMsV2()).toBe(60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveStailSubsPerOwnerV2(3);
    expect(getMaxActiveStailSubsPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingStailEventsPerSubV2(4);
    expect(getMaxPendingStailEventsPerSubV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setStailSubIdleMsV2(100);
    expect(getStailSubIdleMsV2()).toBe(100);
    setStailEventStuckMsV2(50);
    expect(getStailEventStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveStailSubsPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveStailSubsPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveStailSubsPerOwnerV2(5.9);
    expect(getMaxActiveStailSubsPerOwnerV2()).toBe(5);
  });
});

describe("SessionTail V2 sub lifecycle", () => {
  test("register", () => {
    const s = registerStailSubV2({ id: "s1", owner: "u1" });
    expect(s.status).toBe("pending");
    expect(s.sessionId).toBe("*");
  });
  test("register with sessionId", () => {
    const s = registerStailSubV2({ id: "s1", owner: "u1", sessionId: "x" });
    expect(s.sessionId).toBe("x");
  });
  test("register reject duplicate/missing", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    expect(() => registerStailSubV2({ id: "s1", owner: "u1" })).toThrow();
    expect(() => registerStailSubV2({ owner: "u1" })).toThrow();
    expect(() => registerStailSubV2({ id: "s1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    const s = activateStailSubV2("s1");
    expect(s.status).toBe("active");
    expect(s.activatedAt).toBeTruthy();
  });
  test("pause active → paused", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    activateStailSubV2("s1");
    const s = pauseStailSubV2("s1");
    expect(s.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    const before = activateStailSubV2("s1").activatedAt;
    pauseStailSubV2("s1");
    const s = activateStailSubV2("s1");
    expect(s.activatedAt).toBe(before);
  });
  test("close from any non-terminal", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    const s = closeStailSubV2("s1");
    expect(s.status).toBe("closed");
    expect(s.closedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    closeStailSubV2("s1");
    expect(() => activateStailSubV2("s1")).toThrow();
    expect(() => touchStailSubV2("s1")).toThrow();
  });
  test("touch updates", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    activateStailSubV2("s1");
    const s = touchStailSubV2("s1");
    expect(s.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    expect(getStailSubV2("s1").id).toBe("s1");
    expect(getStailSubV2("nope")).toBeNull();
    expect(listStailSubsV2().length).toBe(1);
  });
});

describe("SessionTail V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveStailSubsPerOwnerV2(2);
    registerStailSubV2({ id: "s1", owner: "u1" });
    registerStailSubV2({ id: "s2", owner: "u1" });
    registerStailSubV2({ id: "s3", owner: "u1" });
    activateStailSubV2("s1");
    activateStailSubV2("s2");
    expect(() => activateStailSubV2("s3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveStailSubsPerOwnerV2(2);
    registerStailSubV2({ id: "s1", owner: "u1" });
    registerStailSubV2({ id: "s2", owner: "u1" });
    activateStailSubV2("s1");
    activateStailSubV2("s2");
    pauseStailSubV2("s1");
    const s = activateStailSubV2("s1");
    expect(s.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveStailSubsPerOwnerV2(1);
    registerStailSubV2({ id: "s1", owner: "u1" });
    registerStailSubV2({ id: "s2", owner: "u2" });
    activateStailSubV2("s1");
    activateStailSubV2("s2");
  });
});

describe("SessionTail V2 event lifecycle", () => {
  test("create", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    const e = createStailEventV2({ id: "e1", subId: "s1" });
    expect(e.status).toBe("queued");
    expect(e.cursor).toBe("0");
  });
  test("create with cursor", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    const e = createStailEventV2({ id: "e1", subId: "s1", cursor: "42" });
    expect(e.cursor).toBe("42");
  });
  test("create rejects unknown sub/duplicate", () => {
    expect(() => createStailEventV2({ id: "e1", subId: "nope" })).toThrow();
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    expect(() => createStailEventV2({ id: "e1", subId: "s1" })).toThrow();
  });
  test("tailing queued → tailing", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    const e = tailingStailEventV2("e1");
    expect(e.status).toBe("tailing");
    expect(e.startedAt).toBeTruthy();
  });
  test("complete tailing → completed", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    tailingStailEventV2("e1");
    const e = completeStailEventV2("e1");
    expect(e.status).toBe("completed");
    expect(e.settledAt).toBeTruthy();
  });
  test("fail tailing → failed", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    tailingStailEventV2("e1");
    const e = failStailEventV2("e1", "err");
    expect(e.status).toBe("failed");
    expect(e.metadata.failReason).toBe("err");
  });
  test("cancel queued/tailing → cancelled", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    cancelStailEventV2("e1", "abort");
    createStailEventV2({ id: "e2", subId: "s1" });
    tailingStailEventV2("e2");
    const e = cancelStailEventV2("e2");
    expect(e.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    tailingStailEventV2("e1");
    completeStailEventV2("e1");
    expect(() => failStailEventV2("e1")).toThrow();
  });
  test("get / list", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    expect(getStailEventV2("e1").id).toBe("e1");
    expect(getStailEventV2("nope")).toBeNull();
    expect(listStailEventsV2().length).toBe(1);
  });
});

describe("SessionTail V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingStailEventsPerSubV2(2);
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    createStailEventV2({ id: "e2", subId: "s1" });
    expect(() => createStailEventV2({ id: "e3", subId: "s1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingStailEventsPerSubV2(2);
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    createStailEventV2({ id: "e2", subId: "s1" });
    tailingStailEventV2("e1");
    completeStailEventV2("e1");
    createStailEventV2({ id: "e3", subId: "s1" });
  });
});

describe("SessionTail V2 auto flips", () => {
  test("autoPauseIdleStailSubsV2", () => {
    setStailSubIdleMsV2(100);
    registerStailSubV2({ id: "s1", owner: "u1" });
    activateStailSubV2("s1");
    const { count } = autoPauseIdleStailSubsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getStailSubV2("s1").status).toBe("paused");
  });
  test("autoFailStuckStailEventsV2", () => {
    setStailEventStuckMsV2(100);
    registerStailSubV2({ id: "s1", owner: "u1" });
    createStailEventV2({ id: "e1", subId: "s1" });
    tailingStailEventV2("e1");
    const { count } = autoFailStuckStailEventsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getStailEventV2("e1").status).toBe("failed");
    expect(getStailEventV2("e1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("SessionTail V2 stats", () => {
  test("empty defaults", () => {
    const s = getSessionTailGovStatsV2();
    expect(s.totalStailSubsV2).toBe(0);
    expect(s.totalStailEventsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "closed"])
      expect(s.subsByStatus[k]).toBe(0);
    for (const k of ["queued", "tailing", "completed", "failed", "cancelled"])
      expect(s.eventsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerStailSubV2({ id: "s1", owner: "u1" });
    activateStailSubV2("s1");
    createStailEventV2({ id: "e1", subId: "s1" });
    tailingStailEventV2("e1");
    const s = getSessionTailGovStatsV2();
    expect(s.subsByStatus.active).toBe(1);
    expect(s.eventsByStatus.tailing).toBe(1);
  });
});
