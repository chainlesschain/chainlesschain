import { describe, test, expect, beforeEach } from "vitest";
import {
  PLAN_PROFILE_MATURITY_V2, PLAN_STEP_LIFECYCLE_V2,
  setMaxActivePlanProfilesPerOwnerV2, getMaxActivePlanProfilesPerOwnerV2,
  setMaxPendingPlanStepsPerProfileV2, getMaxPendingPlanStepsPerProfileV2,
  setPlanProfileIdleMsV2, getPlanProfileIdleMsV2,
  setPlanStepStuckMsV2, getPlanStepStuckMsV2,
  _resetStatePlanModeV2,
  registerPlanProfileV2, activatePlanProfileV2, pausePlanProfileV2, archivePlanProfileV2, touchPlanProfileV2, getPlanProfileV2, listPlanProfilesV2,
  createPlanStepV2, startPlanStepV2, completePlanStepV2, failPlanStepV2, cancelPlanStepV2, getPlanStepV2, listPlanStepsV2,
  autoPauseIdlePlanProfilesV2, autoFailStuckPlanStepsV2,
  getPlanModeGovStatsV2,
} from "../../../src/lib/plan-mode.js";

beforeEach(() => { _resetStatePlanModeV2(); });

describe("PlanMode V2 enums", () => {
  test("profile maturity", () => { expect(PLAN_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(PLAN_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(PLAN_PROFILE_MATURITY_V2.PAUSED).toBe("paused"); expect(PLAN_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived"); });
  test("step lifecycle", () => { expect(PLAN_STEP_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(PLAN_STEP_LIFECYCLE_V2.RUNNING).toBe("running"); expect(PLAN_STEP_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(PLAN_STEP_LIFECYCLE_V2.FAILED).toBe("failed"); expect(PLAN_STEP_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(PLAN_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(PLAN_STEP_LIFECYCLE_V2)).toBe(true); });
});

describe("PlanMode V2 config", () => {
  test("defaults", () => { expect(getMaxActivePlanProfilesPerOwnerV2()).toBe(6); expect(getMaxPendingPlanStepsPerProfileV2()).toBe(15); expect(getPlanProfileIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000); expect(getPlanStepStuckMsV2()).toBe(30 * 60 * 1000); });
  test("set max active", () => { setMaxActivePlanProfilesPerOwnerV2(3); expect(getMaxActivePlanProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingPlanStepsPerProfileV2(4); expect(getMaxPendingPlanStepsPerProfileV2()).toBe(4); });
  test("set idle ms", () => { setPlanProfileIdleMsV2(100); expect(getPlanProfileIdleMsV2()).toBe(100); });
  test("set stuck ms", () => { setPlanStepStuckMsV2(50); expect(getPlanStepStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActivePlanProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActivePlanProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActivePlanProfilesPerOwnerV2(5.9); expect(getMaxActivePlanProfilesPerOwnerV2()).toBe(5); });
});

describe("PlanMode V2 profile lifecycle", () => {
  test("register", () => { const p = registerPlanProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.goal).toBe(""); });
  test("register with goal", () => { const p = registerPlanProfileV2({ id: "p1", owner: "u1", goal: "ship" }); expect(p.goal).toBe("ship"); });
  test("register reject duplicate", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); expect(() => registerPlanProfileV2({ id: "p1", owner: "u1" })).toThrow(); });
  test("register reject missing id/owner", () => { expect(() => registerPlanProfileV2({ owner: "u1" })).toThrow(); expect(() => registerPlanProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); const p = activatePlanProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("pause active → paused", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); activatePlanProfileV2("p1"); const p = pausePlanProfileV2("p1"); expect(p.status).toBe("paused"); });
  test("activate paused → active (recovery preserves activatedAt)", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); const before = activatePlanProfileV2("p1").activatedAt; pausePlanProfileV2("p1"); const p = activatePlanProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBe(before); });
  test("archive from pending", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); const p = archivePlanProfileV2("p1"); expect(p.status).toBe("archived"); expect(p.archivedAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); archivePlanProfileV2("p1"); expect(() => activatePlanProfileV2("p1")).toThrow(); expect(() => touchPlanProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); activatePlanProfileV2("p1"); const p = touchPlanProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); expect(getPlanProfileV2("p1").id).toBe("p1"); expect(getPlanProfileV2("nope")).toBeNull(); expect(listPlanProfilesV2().length).toBe(1); });
});

describe("PlanMode V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActivePlanProfilesPerOwnerV2(2);
    registerPlanProfileV2({ id: "p1", owner: "u1" }); registerPlanProfileV2({ id: "p2", owner: "u1" }); registerPlanProfileV2({ id: "p3", owner: "u1" });
    activatePlanProfileV2("p1"); activatePlanProfileV2("p2");
    expect(() => activatePlanProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActivePlanProfilesPerOwnerV2(2);
    registerPlanProfileV2({ id: "p1", owner: "u1" }); registerPlanProfileV2({ id: "p2", owner: "u1" });
    activatePlanProfileV2("p1"); activatePlanProfileV2("p2"); pausePlanProfileV2("p1");
    const p = activatePlanProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActivePlanProfilesPerOwnerV2(1);
    registerPlanProfileV2({ id: "p1", owner: "u1" }); registerPlanProfileV2({ id: "p2", owner: "u2" });
    activatePlanProfileV2("p1"); activatePlanProfileV2("p2");
  });
});

describe("PlanMode V2 step lifecycle", () => {
  test("create", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); const s = createPlanStepV2({ id: "s1", profileId: "p1" }); expect(s.status).toBe("queued"); expect(s.action).toBe(""); });
  test("create with action", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); const s = createPlanStepV2({ id: "s1", profileId: "p1", action: "do" }); expect(s.action).toBe("do"); });
  test("create rejects unknown profile/duplicate", () => { expect(() => createPlanStepV2({ id: "s1", profileId: "nope" })).toThrow(); registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); expect(() => createPlanStepV2({ id: "s1", profileId: "p1" })).toThrow(); });
  test("start queued → running", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); const s = startPlanStepV2("s1"); expect(s.status).toBe("running"); expect(s.startedAt).toBeTruthy(); });
  test("complete running → completed", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); startPlanStepV2("s1"); const s = completePlanStepV2("s1"); expect(s.status).toBe("completed"); expect(s.settledAt).toBeTruthy(); });
  test("fail running → failed", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); startPlanStepV2("s1"); const s = failPlanStepV2("s1", "oops"); expect(s.status).toBe("failed"); expect(s.metadata.failReason).toBe("oops"); });
  test("cancel queued/running → cancelled", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); const s = cancelPlanStepV2("s1", "abort"); expect(s.status).toBe("cancelled"); expect(s.metadata.cancelReason).toBe("abort"); createPlanStepV2({ id: "s2", profileId: "p1" }); startPlanStepV2("s2"); const s2 = cancelPlanStepV2("s2"); expect(s2.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); startPlanStepV2("s1"); completePlanStepV2("s1"); expect(() => failPlanStepV2("s1")).toThrow(); });
  test("get / list", () => { registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); expect(getPlanStepV2("s1").id).toBe("s1"); expect(getPlanStepV2("nope")).toBeNull(); expect(listPlanStepsV2().length).toBe(1); });
});

describe("PlanMode V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingPlanStepsPerProfileV2(2);
    registerPlanProfileV2({ id: "p1", owner: "u1" });
    createPlanStepV2({ id: "s1", profileId: "p1" }); createPlanStepV2({ id: "s2", profileId: "p1" });
    expect(() => createPlanStepV2({ id: "s3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingPlanStepsPerProfileV2(2);
    registerPlanProfileV2({ id: "p1", owner: "u1" });
    createPlanStepV2({ id: "s1", profileId: "p1" }); createPlanStepV2({ id: "s2", profileId: "p1" });
    startPlanStepV2("s1"); completePlanStepV2("s1");
    createPlanStepV2({ id: "s3", profileId: "p1" });
  });
});

describe("PlanMode V2 auto flips", () => {
  test("autoPauseIdlePlanProfilesV2", () => {
    setPlanProfileIdleMsV2(100);
    registerPlanProfileV2({ id: "p1", owner: "u1" }); activatePlanProfileV2("p1");
    const { count } = autoPauseIdlePlanProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getPlanProfileV2("p1").status).toBe("paused");
  });
  test("autoFailStuckPlanStepsV2", () => {
    setPlanStepStuckMsV2(100);
    registerPlanProfileV2({ id: "p1", owner: "u1" }); createPlanStepV2({ id: "s1", profileId: "p1" }); startPlanStepV2("s1");
    const { count } = autoFailStuckPlanStepsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getPlanStepV2("s1").status).toBe("failed"); expect(getPlanStepV2("s1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("PlanMode V2 stats", () => {
  test("empty defaults", () => {
    const s = getPlanModeGovStatsV2();
    expect(s.totalPlanProfilesV2).toBe(0); expect(s.totalPlanStepsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "archived"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"]) expect(s.stepsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerPlanProfileV2({ id: "p1", owner: "u1" }); activatePlanProfileV2("p1");
    createPlanStepV2({ id: "s1", profileId: "p1" }); startPlanStepV2("s1");
    const s = getPlanModeGovStatsV2();
    expect(s.totalPlanProfilesV2).toBe(1); expect(s.totalPlanStepsV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1); expect(s.stepsByStatus.running).toBe(1);
  });
});
