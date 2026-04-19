import { describe, test, expect, beforeEach } from "vitest";
import {
  ITER_BUDGET_PROFILE_MATURITY_V2,
  ITER_RUN_LIFECYCLE_V2,
  setMaxActiveIterBudgetProfilesPerOwnerV2,
  getMaxActiveIterBudgetProfilesPerOwnerV2,
  setMaxPendingIterRunsPerProfileV2,
  getMaxPendingIterRunsPerProfileV2,
  setIterBudgetProfileIdleMsV2,
  getIterBudgetProfileIdleMsV2,
  setIterRunStuckMsV2,
  getIterRunStuckMsV2,
  _resetStateIterationBudgetV2,
  registerIterBudgetProfileV2,
  activateIterBudgetProfileV2,
  pauseIterBudgetProfileV2,
  exhaustIterBudgetProfileV2,
  touchIterBudgetProfileV2,
  getIterBudgetProfileV2,
  listIterBudgetProfilesV2,
  createIterRunV2,
  startIterRunV2,
  completeIterRunV2,
  failIterRunV2,
  cancelIterRunV2,
  getIterRunV2,
  listIterRunsV2,
  autoPauseIdleIterBudgetProfilesV2,
  autoFailStuckIterRunsV2,
  getIterationBudgetGovStatsV2,
} from "../../../src/lib/iteration-budget.js";

beforeEach(() => {
  _resetStateIterationBudgetV2();
});

describe("IterBudget V2 enums", () => {
  test("profile maturity", () => {
    expect(ITER_BUDGET_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED).toBe("paused");
    expect(ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED).toBe("exhausted");
  });
  test("run lifecycle", () => {
    expect(ITER_RUN_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(ITER_RUN_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(ITER_RUN_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(ITER_RUN_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(ITER_RUN_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(ITER_BUDGET_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(ITER_RUN_LIFECYCLE_V2)).toBe(true);
  });
});

describe("IterBudget V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveIterBudgetProfilesPerOwnerV2()).toBe(4);
    expect(getMaxPendingIterRunsPerProfileV2()).toBe(8);
    expect(getIterBudgetProfileIdleMsV2()).toBe(24 * 60 * 60 * 1000);
    expect(getIterRunStuckMsV2()).toBe(60 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(3);
    expect(getMaxActiveIterBudgetProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingIterRunsPerProfileV2(4);
    expect(getMaxPendingIterRunsPerProfileV2()).toBe(4);
  });
  test("set idle ms", () => {
    setIterBudgetProfileIdleMsV2(100);
    expect(getIterBudgetProfileIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setIterRunStuckMsV2(50);
    expect(getIterRunStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveIterBudgetProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveIterBudgetProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(5.9);
    expect(getMaxActiveIterBudgetProfilesPerOwnerV2()).toBe(5);
  });
});

describe("IterBudget V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.budget).toBe(50);
  });
  test("register with budget", () => {
    const p = registerIterBudgetProfileV2({
      id: "p1",
      owner: "u1",
      budget: 200,
    });
    expect(p.budget).toBe(200);
  });
  test("register reject duplicate", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    expect(() =>
      registerIterBudgetProfileV2({ id: "p1", owner: "u1" }),
    ).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerIterBudgetProfileV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerIterBudgetProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    const p = activateIterBudgetProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("pause active → paused", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    const p = pauseIterBudgetProfileV2("p1");
    expect(p.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    const before = activateIterBudgetProfileV2("p1").activatedAt;
    pauseIterBudgetProfileV2("p1");
    const p = activateIterBudgetProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBe(before);
  });
  test("exhaust from active", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    const p = exhaustIterBudgetProfileV2("p1");
    expect(p.status).toBe("exhausted");
    expect(p.exhaustedAt).toBeTruthy();
  });
  test("exhaust from pending", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    const p = exhaustIterBudgetProfileV2("p1");
    expect(p.status).toBe("exhausted");
  });
  test("terminal no transitions", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    exhaustIterBudgetProfileV2("p1");
    expect(() => activateIterBudgetProfileV2("p1")).toThrow();
    expect(() => pauseIterBudgetProfileV2("p1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    exhaustIterBudgetProfileV2("p1");
    expect(() => touchIterBudgetProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    const p = touchIterBudgetProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    expect(getIterBudgetProfileV2("p1").id).toBe("p1");
    expect(getIterBudgetProfileV2("nope")).toBeNull();
    expect(listIterBudgetProfilesV2().length).toBe(1);
  });
});

describe("IterBudget V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(2);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    registerIterBudgetProfileV2({ id: "p2", owner: "u1" });
    registerIterBudgetProfileV2({ id: "p3", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    activateIterBudgetProfileV2("p2");
    expect(() => activateIterBudgetProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(2);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    registerIterBudgetProfileV2({ id: "p2", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    activateIterBudgetProfileV2("p2");
    pauseIterBudgetProfileV2("p1");
    const p = activateIterBudgetProfileV2("p1");
    expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(1);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    registerIterBudgetProfileV2({ id: "p2", owner: "u2" });
    activateIterBudgetProfileV2("p1");
    activateIterBudgetProfileV2("p2");
  });
});

describe("IterBudget V2 run lifecycle", () => {
  test("create", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    const r = createIterRunV2({ id: "r1", profileId: "p1" });
    expect(r.status).toBe("queued");
    expect(r.goal).toBe("");
  });
  test("create with goal", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    const r = createIterRunV2({ id: "r1", profileId: "p1", goal: "ship" });
    expect(r.goal).toBe("ship");
  });
  test("create rejects unknown profile", () => {
    expect(() => createIterRunV2({ id: "r1", profileId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    expect(() => createIterRunV2({ id: "r1", profileId: "p1" })).toThrow();
  });
  test("start queued → running", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    const r = startIterRunV2("r1");
    expect(r.status).toBe("running");
    expect(r.startedAt).toBeTruthy();
  });
  test("complete running → completed", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    const r = completeIterRunV2("r1");
    expect(r.status).toBe("completed");
    expect(r.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    const r = failIterRunV2("r1", "oops");
    expect(r.status).toBe("failed");
    expect(r.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    const r = cancelIterRunV2("r1", "abort");
    expect(r.status).toBe("cancelled");
    expect(r.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    const r = cancelIterRunV2("r1");
    expect(r.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    completeIterRunV2("r1");
    expect(() => failIterRunV2("r1")).toThrow();
  });
  test("get / list", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    expect(getIterRunV2("r1").id).toBe("r1");
    expect(getIterRunV2("nope")).toBeNull();
    expect(listIterRunsV2().length).toBe(1);
  });
});

describe("IterBudget V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingIterRunsPerProfileV2(2);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    createIterRunV2({ id: "r2", profileId: "p1" });
    expect(() => createIterRunV2({ id: "r3", profileId: "p1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingIterRunsPerProfileV2(2);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    createIterRunV2({ id: "r2", profileId: "p1" });
    startIterRunV2("r1");
    completeIterRunV2("r1");
    createIterRunV2({ id: "r3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingIterRunsPerProfileV2(1);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    registerIterBudgetProfileV2({ id: "p2", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    createIterRunV2({ id: "r2", profileId: "p2" });
  });
});

describe("IterBudget V2 auto flips", () => {
  test("autoPauseIdleIterBudgetProfilesV2", () => {
    setIterBudgetProfileIdleMsV2(100);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    const { count } = autoPauseIdleIterBudgetProfilesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getIterBudgetProfileV2("p1").status).toBe("paused");
  });
  test("autoFailStuckIterRunsV2", () => {
    setIterRunStuckMsV2(100);
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    const { count } = autoFailStuckIterRunsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getIterRunV2("r1").status).toBe("failed");
    expect(getIterRunV2("r1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("IterBudget V2 stats", () => {
  test("empty defaults", () => {
    const s = getIterationBudgetGovStatsV2();
    expect(s.totalIterBudgetProfilesV2).toBe(0);
    expect(s.totalIterRunsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "exhausted"])
      expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"])
      expect(s.runsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerIterBudgetProfileV2({ id: "p1", owner: "u1" });
    activateIterBudgetProfileV2("p1");
    createIterRunV2({ id: "r1", profileId: "p1" });
    startIterRunV2("r1");
    const s = getIterationBudgetGovStatsV2();
    expect(s.totalIterBudgetProfilesV2).toBe(1);
    expect(s.totalIterRunsV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.runsByStatus.running).toBe(1);
  });
});
