import { describe, test, expect, beforeEach } from "vitest";
import {
  ORCH_PROFILE_MATURITY_V2, ORCH_TASK_LIFECYCLE_V2,
  setMaxActiveOrchProfilesPerOwnerV2, getMaxActiveOrchProfilesPerOwnerV2,
  setMaxPendingOrchTasksPerProfileV2, getMaxPendingOrchTasksPerProfileV2,
  setOrchProfileIdleMsV2, getOrchProfileIdleMsV2,
  setOrchTaskStuckMsV2, getOrchTaskStuckMsV2,
  _resetStateOrchestratorV2,
  registerOrchProfileV2, activateOrchProfileV2, pauseOrchProfileV2, retireOrchProfileV2, touchOrchProfileV2, getOrchProfileV2, listOrchProfilesV2,
  createOrchTaskV2, dispatchOrchTaskV2, completeOrchTaskV2, failOrchTaskV2, cancelOrchTaskV2, getOrchTaskV2, listOrchTasksV2,
  autoPauseIdleOrchProfilesV2, autoFailStuckOrchTasksV2,
  getOrchestratorGovStatsV2,
} from "../../../src/lib/orchestrator.js";

beforeEach(() => { _resetStateOrchestratorV2(); });

describe("Orch V2 enums", () => {
  test("profile maturity", () => { expect(ORCH_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(ORCH_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(ORCH_PROFILE_MATURITY_V2.PAUSED).toBe("paused"); expect(ORCH_PROFILE_MATURITY_V2.RETIRED).toBe("retired"); });
  test("task lifecycle", () => { expect(ORCH_TASK_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(ORCH_TASK_LIFECYCLE_V2.DISPATCHING).toBe("dispatching"); expect(ORCH_TASK_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(ORCH_TASK_LIFECYCLE_V2.FAILED).toBe("failed"); expect(ORCH_TASK_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(ORCH_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(ORCH_TASK_LIFECYCLE_V2)).toBe(true); });
});

describe("Orch V2 config", () => {
  test("defaults", () => { expect(getMaxActiveOrchProfilesPerOwnerV2()).toBe(6); expect(getMaxPendingOrchTasksPerProfileV2()).toBe(12); expect(getOrchProfileIdleMsV2()).toBe(14 * 24 * 60 * 60 * 1000); expect(getOrchTaskStuckMsV2()).toBe(15 * 60 * 1000); });
  test("set max active", () => { setMaxActiveOrchProfilesPerOwnerV2(3); expect(getMaxActiveOrchProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingOrchTasksPerProfileV2(4); expect(getMaxPendingOrchTasksPerProfileV2()).toBe(4); });
  test("set idle ms", () => { setOrchProfileIdleMsV2(100); expect(getOrchProfileIdleMsV2()).toBe(100); });
  test("set stuck ms", () => { setOrchTaskStuckMsV2(50); expect(getOrchTaskStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveOrchProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveOrchProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveOrchProfilesPerOwnerV2(5.9); expect(getMaxActiveOrchProfilesPerOwnerV2()).toBe(5); });
});

describe("Orch V2 profile lifecycle", () => {
  test("register", () => { const p = registerOrchProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.source).toBe("cli"); });
  test("register with source", () => { const p = registerOrchProfileV2({ id: "p1", owner: "u1", source: "github" }); expect(p.source).toBe("github"); });
  test("register reject duplicate", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); expect(() => registerOrchProfileV2({ id: "p1", owner: "u1" })).toThrow(); });
  test("register reject missing id", () => { expect(() => registerOrchProfileV2({ owner: "u1" })).toThrow(); });
  test("register reject missing owner", () => { expect(() => registerOrchProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); const p = activateOrchProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("pause active → paused", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); activateOrchProfileV2("p1"); const p = pauseOrchProfileV2("p1"); expect(p.status).toBe("paused"); });
  test("activate paused → active (recovery)", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); const before = activateOrchProfileV2("p1").activatedAt; pauseOrchProfileV2("p1"); const p = activateOrchProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBe(before); });
  test("retire from active", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); activateOrchProfileV2("p1"); const p = retireOrchProfileV2("p1"); expect(p.status).toBe("retired"); expect(p.retiredAt).toBeTruthy(); });
  test("retire from pending", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); const p = retireOrchProfileV2("p1"); expect(p.status).toBe("retired"); });
  test("terminal no transitions", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); retireOrchProfileV2("p1"); expect(() => activateOrchProfileV2("p1")).toThrow(); expect(() => pauseOrchProfileV2("p1")).toThrow(); });
  test("touch terminal throws", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); retireOrchProfileV2("p1"); expect(() => touchOrchProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); activateOrchProfileV2("p1"); const p = touchOrchProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); expect(getOrchProfileV2("p1").id).toBe("p1"); expect(getOrchProfileV2("nope")).toBeNull(); expect(listOrchProfilesV2().length).toBe(1); });
});

describe("Orch V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveOrchProfilesPerOwnerV2(2);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); registerOrchProfileV2({ id: "p2", owner: "u1" }); registerOrchProfileV2({ id: "p3", owner: "u1" });
    activateOrchProfileV2("p1"); activateOrchProfileV2("p2");
    expect(() => activateOrchProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveOrchProfilesPerOwnerV2(2);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); registerOrchProfileV2({ id: "p2", owner: "u1" });
    activateOrchProfileV2("p1"); activateOrchProfileV2("p2"); pauseOrchProfileV2("p1");
    const p = activateOrchProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveOrchProfilesPerOwnerV2(1);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); registerOrchProfileV2({ id: "p2", owner: "u2" });
    activateOrchProfileV2("p1"); activateOrchProfileV2("p2");
  });
});

describe("Orch V2 task lifecycle", () => {
  test("create", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); const t = createOrchTaskV2({ id: "t1", profileId: "p1" }); expect(t.status).toBe("queued"); expect(t.prompt).toBe(""); });
  test("create with prompt", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); const t = createOrchTaskV2({ id: "t1", profileId: "p1", prompt: "fix" }); expect(t.prompt).toBe("fix"); });
  test("create rejects unknown profile", () => { expect(() => createOrchTaskV2({ id: "t1", profileId: "nope" })).toThrow(); });
  test("create rejects duplicate", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); expect(() => createOrchTaskV2({ id: "t1", profileId: "p1" })).toThrow(); });
  test("dispatch queued → dispatching", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); const t = dispatchOrchTaskV2("t1"); expect(t.status).toBe("dispatching"); expect(t.startedAt).toBeTruthy(); });
  test("complete dispatching → completed", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1"); const t = completeOrchTaskV2("t1"); expect(t.status).toBe("completed"); expect(t.settledAt).toBeTruthy(); });
  test("fail dispatching → failed", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1"); const t = failOrchTaskV2("t1", "oops"); expect(t.status).toBe("failed"); expect(t.metadata.failReason).toBe("oops"); });
  test("cancel queued → cancelled", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); const t = cancelOrchTaskV2("t1", "abort"); expect(t.status).toBe("cancelled"); expect(t.metadata.cancelReason).toBe("abort"); });
  test("cancel dispatching → cancelled", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1"); const t = cancelOrchTaskV2("t1"); expect(t.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1"); completeOrchTaskV2("t1"); expect(() => failOrchTaskV2("t1")).toThrow(); });
  test("get / list", () => { registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); expect(getOrchTaskV2("t1").id).toBe("t1"); expect(getOrchTaskV2("nope")).toBeNull(); expect(listOrchTasksV2().length).toBe(1); });
});

describe("Orch V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingOrchTasksPerProfileV2(2);
    registerOrchProfileV2({ id: "p1", owner: "u1" });
    createOrchTaskV2({ id: "t1", profileId: "p1" }); createOrchTaskV2({ id: "t2", profileId: "p1" });
    expect(() => createOrchTaskV2({ id: "t3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingOrchTasksPerProfileV2(2);
    registerOrchProfileV2({ id: "p1", owner: "u1" });
    createOrchTaskV2({ id: "t1", profileId: "p1" }); createOrchTaskV2({ id: "t2", profileId: "p1" });
    dispatchOrchTaskV2("t1"); completeOrchTaskV2("t1");
    createOrchTaskV2({ id: "t3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingOrchTasksPerProfileV2(1);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); registerOrchProfileV2({ id: "p2", owner: "u1" });
    createOrchTaskV2({ id: "t1", profileId: "p1" }); createOrchTaskV2({ id: "t2", profileId: "p2" });
  });
});

describe("Orch V2 auto flips", () => {
  test("autoPauseIdleOrchProfilesV2", () => {
    setOrchProfileIdleMsV2(100);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); activateOrchProfileV2("p1");
    const { count } = autoPauseIdleOrchProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getOrchProfileV2("p1").status).toBe("paused");
  });
  test("autoFailStuckOrchTasksV2", () => {
    setOrchTaskStuckMsV2(100);
    registerOrchProfileV2({ id: "p1", owner: "u1" }); createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1");
    const { count } = autoFailStuckOrchTasksV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getOrchTaskV2("t1").status).toBe("failed"); expect(getOrchTaskV2("t1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("Orch V2 stats", () => {
  test("empty defaults", () => {
    const s = getOrchestratorGovStatsV2();
    expect(s.totalOrchProfilesV2).toBe(0); expect(s.totalOrchTasksV2).toBe(0);
    for (const k of ["pending", "active", "paused", "retired"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "dispatching", "completed", "failed", "cancelled"]) expect(s.tasksByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerOrchProfileV2({ id: "p1", owner: "u1" }); activateOrchProfileV2("p1");
    createOrchTaskV2({ id: "t1", profileId: "p1" }); dispatchOrchTaskV2("t1");
    const s = getOrchestratorGovStatsV2();
    expect(s.totalOrchProfilesV2).toBe(1); expect(s.totalOrchTasksV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1); expect(s.tasksByStatus.dispatching).toBe(1);
  });
});
