import { describe, test, expect, beforeEach } from "vitest";
import {
  SHOK_PROFILE_MATURITY_V2, SHOK_INVOCATION_LIFECYCLE_V2,
  setMaxActiveShokProfilesPerOwnerV2, getMaxActiveShokProfilesPerOwnerV2,
  setMaxPendingShokInvocationsPerProfileV2, getMaxPendingShokInvocationsPerProfileV2,
  setShokProfileIdleMsV2, getShokProfileIdleMsV2,
  setShokInvocationStuckMsV2, getShokInvocationStuckMsV2,
  _resetStateSessionHooksV2,
  registerShokProfileV2, activateShokProfileV2, disableShokProfileV2, retireShokProfileV2, touchShokProfileV2, getShokProfileV2, listShokProfilesV2,
  createShokInvocationV2, runningShokInvocationV2, completeShokInvocationV2, failShokInvocationV2, cancelShokInvocationV2, getShokInvocationV2, listShokInvocationsV2,
  autoDisableIdleShokProfilesV2, autoFailStuckShokInvocationsV2,
  getSessionHooksGovStatsV2,
} from "../../../src/lib/session-hooks.js";

beforeEach(() => { _resetStateSessionHooksV2(); });

describe("SessionHooks V2 enums", () => {
  test("profile maturity", () => { expect(SHOK_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(SHOK_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(SHOK_PROFILE_MATURITY_V2.DISABLED).toBe("disabled"); expect(SHOK_PROFILE_MATURITY_V2.RETIRED).toBe("retired"); });
  test("invocation lifecycle", () => { expect(SHOK_INVOCATION_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(SHOK_INVOCATION_LIFECYCLE_V2.RUNNING).toBe("running"); expect(SHOK_INVOCATION_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(SHOK_INVOCATION_LIFECYCLE_V2.FAILED).toBe("failed"); expect(SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(SHOK_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(SHOK_INVOCATION_LIFECYCLE_V2)).toBe(true); });
});

describe("SessionHooks V2 config", () => {
  test("defaults", () => { expect(getMaxActiveShokProfilesPerOwnerV2()).toBe(12); expect(getMaxPendingShokInvocationsPerProfileV2()).toBe(25); expect(getShokProfileIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000); expect(getShokInvocationStuckMsV2()).toBe(30 * 1000); });
  test("set max active", () => { setMaxActiveShokProfilesPerOwnerV2(3); expect(getMaxActiveShokProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingShokInvocationsPerProfileV2(4); expect(getMaxPendingShokInvocationsPerProfileV2()).toBe(4); });
  test("set idle/stuck ms", () => { setShokProfileIdleMsV2(100); expect(getShokProfileIdleMsV2()).toBe(100); setShokInvocationStuckMsV2(50); expect(getShokInvocationStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveShokProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveShokProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveShokProfilesPerOwnerV2(5.9); expect(getMaxActiveShokProfilesPerOwnerV2()).toBe(5); });
});

describe("SessionHooks V2 profile lifecycle", () => {
  test("register", () => { const p = registerShokProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.event).toBe("preTurn"); });
  test("register with event", () => { const p = registerShokProfileV2({ id: "p1", owner: "u1", event: "postTurn" }); expect(p.event).toBe("postTurn"); });
  test("register reject duplicate/missing", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); expect(() => registerShokProfileV2({ id: "p1", owner: "u1" })).toThrow(); expect(() => registerShokProfileV2({ owner: "u1" })).toThrow(); expect(() => registerShokProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); const p = activateShokProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("disable active → disabled", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); activateShokProfileV2("p1"); const p = disableShokProfileV2("p1"); expect(p.status).toBe("disabled"); });
  test("activate disabled → active (recovery)", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); const before = activateShokProfileV2("p1").activatedAt; disableShokProfileV2("p1"); const p = activateShokProfileV2("p1"); expect(p.activatedAt).toBe(before); });
  test("retire from any non-terminal", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); const p = retireShokProfileV2("p1"); expect(p.status).toBe("retired"); expect(p.retiredAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); retireShokProfileV2("p1"); expect(() => activateShokProfileV2("p1")).toThrow(); expect(() => touchShokProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); activateShokProfileV2("p1"); const p = touchShokProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); expect(getShokProfileV2("p1").id).toBe("p1"); expect(getShokProfileV2("nope")).toBeNull(); expect(listShokProfilesV2().length).toBe(1); });
});

describe("SessionHooks V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveShokProfilesPerOwnerV2(2);
    registerShokProfileV2({ id: "p1", owner: "u1" }); registerShokProfileV2({ id: "p2", owner: "u1" }); registerShokProfileV2({ id: "p3", owner: "u1" });
    activateShokProfileV2("p1"); activateShokProfileV2("p2");
    expect(() => activateShokProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveShokProfilesPerOwnerV2(2);
    registerShokProfileV2({ id: "p1", owner: "u1" }); registerShokProfileV2({ id: "p2", owner: "u1" });
    activateShokProfileV2("p1"); activateShokProfileV2("p2"); disableShokProfileV2("p1");
    const p = activateShokProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveShokProfilesPerOwnerV2(1);
    registerShokProfileV2({ id: "p1", owner: "u1" }); registerShokProfileV2({ id: "p2", owner: "u2" });
    activateShokProfileV2("p1"); activateShokProfileV2("p2");
  });
});

describe("SessionHooks V2 invocation lifecycle", () => {
  test("create", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); const i = createShokInvocationV2({ id: "i1", profileId: "p1" }); expect(i.status).toBe("queued"); expect(i.payload).toBe(""); });
  test("create with payload", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); const i = createShokInvocationV2({ id: "i1", profileId: "p1", payload: "x" }); expect(i.payload).toBe("x"); });
  test("create rejects unknown profile/duplicate", () => { expect(() => createShokInvocationV2({ id: "i1", profileId: "nope" })).toThrow(); registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); expect(() => createShokInvocationV2({ id: "i1", profileId: "p1" })).toThrow(); });
  test("running queued → running", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); const i = runningShokInvocationV2("i1"); expect(i.status).toBe("running"); expect(i.startedAt).toBeTruthy(); });
  test("complete running → completed", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); runningShokInvocationV2("i1"); const i = completeShokInvocationV2("i1"); expect(i.status).toBe("completed"); expect(i.settledAt).toBeTruthy(); });
  test("fail running → failed", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); runningShokInvocationV2("i1"); const i = failShokInvocationV2("i1", "err"); expect(i.status).toBe("failed"); expect(i.metadata.failReason).toBe("err"); });
  test("cancel queued/running → cancelled", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); cancelShokInvocationV2("i1", "abort"); createShokInvocationV2({ id: "i2", profileId: "p1" }); runningShokInvocationV2("i2"); const i = cancelShokInvocationV2("i2"); expect(i.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); runningShokInvocationV2("i1"); completeShokInvocationV2("i1"); expect(() => failShokInvocationV2("i1")).toThrow(); });
  test("get / list", () => { registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); expect(getShokInvocationV2("i1").id).toBe("i1"); expect(getShokInvocationV2("nope")).toBeNull(); expect(listShokInvocationsV2().length).toBe(1); });
});

describe("SessionHooks V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingShokInvocationsPerProfileV2(2);
    registerShokProfileV2({ id: "p1", owner: "u1" });
    createShokInvocationV2({ id: "i1", profileId: "p1" }); createShokInvocationV2({ id: "i2", profileId: "p1" });
    expect(() => createShokInvocationV2({ id: "i3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingShokInvocationsPerProfileV2(2);
    registerShokProfileV2({ id: "p1", owner: "u1" });
    createShokInvocationV2({ id: "i1", profileId: "p1" }); createShokInvocationV2({ id: "i2", profileId: "p1" });
    runningShokInvocationV2("i1"); completeShokInvocationV2("i1");
    createShokInvocationV2({ id: "i3", profileId: "p1" });
  });
});

describe("SessionHooks V2 auto flips", () => {
  test("autoDisableIdleShokProfilesV2", () => {
    setShokProfileIdleMsV2(100);
    registerShokProfileV2({ id: "p1", owner: "u1" }); activateShokProfileV2("p1");
    const { count } = autoDisableIdleShokProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getShokProfileV2("p1").status).toBe("disabled");
  });
  test("autoFailStuckShokInvocationsV2", () => {
    setShokInvocationStuckMsV2(100);
    registerShokProfileV2({ id: "p1", owner: "u1" }); createShokInvocationV2({ id: "i1", profileId: "p1" }); runningShokInvocationV2("i1");
    const { count } = autoFailStuckShokInvocationsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getShokInvocationV2("i1").status).toBe("failed"); expect(getShokInvocationV2("i1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("SessionHooks V2 stats", () => {
  test("empty defaults", () => {
    const s = getSessionHooksGovStatsV2();
    expect(s.totalShokProfilesV2).toBe(0); expect(s.totalShokInvocationsV2).toBe(0);
    for (const k of ["pending", "active", "disabled", "retired"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"]) expect(s.invocationsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerShokProfileV2({ id: "p1", owner: "u1" }); activateShokProfileV2("p1");
    createShokInvocationV2({ id: "i1", profileId: "p1" }); runningShokInvocationV2("i1");
    const s = getSessionHooksGovStatsV2();
    expect(s.profilesByStatus.active).toBe(1); expect(s.invocationsByStatus.running).toBe(1);
  });
});
