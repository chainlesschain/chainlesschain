import { describe, test, expect, beforeEach } from "vitest";
import {
  TMS_PROFILE_MATURITY_V2, TMS_SELECTION_LIFECYCLE_V2,
  setMaxActiveTmsProfilesPerOwnerV2, getMaxActiveTmsProfilesPerOwnerV2,
  setMaxPendingTmsSelectionsPerProfileV2, getMaxPendingTmsSelectionsPerProfileV2,
  setTmsProfileIdleMsV2, getTmsProfileIdleMsV2,
  setTmsSelectionStuckMsV2, getTmsSelectionStuckMsV2,
  _resetStateTaskModelSelectorV2,
  registerTmsProfileV2, activateTmsProfileV2, staleTmsProfileV2, decommissionTmsProfileV2, touchTmsProfileV2, getTmsProfileV2, listTmsProfilesV2,
  createTmsSelectionV2, scoreTmsSelectionV2, completeTmsSelectionV2, failTmsSelectionV2, cancelTmsSelectionV2, getTmsSelectionV2, listTmsSelectionsV2,
  autoStaleIdleTmsProfilesV2, autoFailStuckTmsSelectionsV2,
  getTaskModelSelectorGovStatsV2,
} from "../../../src/lib/task-model-selector.js";

beforeEach(() => { _resetStateTaskModelSelectorV2(); });

describe("TaskModelSelector V2 enums", () => {
  test("profile maturity", () => { expect(TMS_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(TMS_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(TMS_PROFILE_MATURITY_V2.STALE).toBe("stale"); expect(TMS_PROFILE_MATURITY_V2.DECOMMISSIONED).toBe("decommissioned"); });
  test("selection lifecycle", () => { expect(TMS_SELECTION_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(TMS_SELECTION_LIFECYCLE_V2.SCORING).toBe("scoring"); expect(TMS_SELECTION_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(TMS_SELECTION_LIFECYCLE_V2.FAILED).toBe("failed"); expect(TMS_SELECTION_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(TMS_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(TMS_SELECTION_LIFECYCLE_V2)).toBe(true); });
});

describe("TaskModelSelector V2 config", () => {
  test("defaults", () => { expect(getMaxActiveTmsProfilesPerOwnerV2()).toBe(8); expect(getMaxPendingTmsSelectionsPerProfileV2()).toBe(16); expect(getTmsProfileIdleMsV2()).toBe(14 * 24 * 60 * 60 * 1000); expect(getTmsSelectionStuckMsV2()).toBe(2 * 60 * 1000); });
  test("set max active", () => { setMaxActiveTmsProfilesPerOwnerV2(3); expect(getMaxActiveTmsProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingTmsSelectionsPerProfileV2(4); expect(getMaxPendingTmsSelectionsPerProfileV2()).toBe(4); });
  test("set idle/stuck ms", () => { setTmsProfileIdleMsV2(100); expect(getTmsProfileIdleMsV2()).toBe(100); setTmsSelectionStuckMsV2(50); expect(getTmsSelectionStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveTmsProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveTmsProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveTmsProfilesPerOwnerV2(5.9); expect(getMaxActiveTmsProfilesPerOwnerV2()).toBe(5); });
});

describe("TaskModelSelector V2 profile lifecycle", () => {
  test("register", () => { const p = registerTmsProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.strategy).toBe("default"); });
  test("register with strategy", () => { const p = registerTmsProfileV2({ id: "p1", owner: "u1", strategy: "fast" }); expect(p.strategy).toBe("fast"); });
  test("register reject duplicate/missing", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); expect(() => registerTmsProfileV2({ id: "p1", owner: "u1" })).toThrow(); expect(() => registerTmsProfileV2({ owner: "u1" })).toThrow(); expect(() => registerTmsProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); const p = activateTmsProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("stale active → stale", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); activateTmsProfileV2("p1"); const p = staleTmsProfileV2("p1"); expect(p.status).toBe("stale"); });
  test("activate stale → active (recovery)", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); const before = activateTmsProfileV2("p1").activatedAt; staleTmsProfileV2("p1"); const p = activateTmsProfileV2("p1"); expect(p.activatedAt).toBe(before); });
  test("decommission from any non-terminal", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); const p = decommissionTmsProfileV2("p1"); expect(p.status).toBe("decommissioned"); expect(p.decommissionedAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); decommissionTmsProfileV2("p1"); expect(() => activateTmsProfileV2("p1")).toThrow(); expect(() => touchTmsProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); activateTmsProfileV2("p1"); const p = touchTmsProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); expect(getTmsProfileV2("p1").id).toBe("p1"); expect(getTmsProfileV2("nope")).toBeNull(); expect(listTmsProfilesV2().length).toBe(1); });
});

describe("TaskModelSelector V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveTmsProfilesPerOwnerV2(2);
    registerTmsProfileV2({ id: "p1", owner: "u1" }); registerTmsProfileV2({ id: "p2", owner: "u1" }); registerTmsProfileV2({ id: "p3", owner: "u1" });
    activateTmsProfileV2("p1"); activateTmsProfileV2("p2");
    expect(() => activateTmsProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveTmsProfilesPerOwnerV2(2);
    registerTmsProfileV2({ id: "p1", owner: "u1" }); registerTmsProfileV2({ id: "p2", owner: "u1" });
    activateTmsProfileV2("p1"); activateTmsProfileV2("p2"); staleTmsProfileV2("p1");
    const p = activateTmsProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveTmsProfilesPerOwnerV2(1);
    registerTmsProfileV2({ id: "p1", owner: "u1" }); registerTmsProfileV2({ id: "p2", owner: "u2" });
    activateTmsProfileV2("p1"); activateTmsProfileV2("p2");
  });
});

describe("TaskModelSelector V2 selection lifecycle", () => {
  test("create", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); const s = createTmsSelectionV2({ id: "s1", profileId: "p1" }); expect(s.status).toBe("queued"); expect(s.task).toBe(""); });
  test("create with task", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); const s = createTmsSelectionV2({ id: "s1", profileId: "p1", task: "summarize" }); expect(s.task).toBe("summarize"); });
  test("create rejects unknown profile/duplicate", () => { expect(() => createTmsSelectionV2({ id: "s1", profileId: "nope" })).toThrow(); registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); expect(() => createTmsSelectionV2({ id: "s1", profileId: "p1" })).toThrow(); });
  test("score queued → scoring", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); const s = scoreTmsSelectionV2("s1"); expect(s.status).toBe("scoring"); expect(s.startedAt).toBeTruthy(); });
  test("complete scoring → completed", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); scoreTmsSelectionV2("s1"); const s = completeTmsSelectionV2("s1"); expect(s.status).toBe("completed"); expect(s.settledAt).toBeTruthy(); });
  test("fail scoring → failed", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); scoreTmsSelectionV2("s1"); const s = failTmsSelectionV2("s1", "err"); expect(s.status).toBe("failed"); expect(s.metadata.failReason).toBe("err"); });
  test("cancel queued/scoring → cancelled", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); cancelTmsSelectionV2("s1", "abort"); createTmsSelectionV2({ id: "s2", profileId: "p1" }); scoreTmsSelectionV2("s2"); const s = cancelTmsSelectionV2("s2"); expect(s.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); scoreTmsSelectionV2("s1"); completeTmsSelectionV2("s1"); expect(() => failTmsSelectionV2("s1")).toThrow(); });
  test("get / list", () => { registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); expect(getTmsSelectionV2("s1").id).toBe("s1"); expect(getTmsSelectionV2("nope")).toBeNull(); expect(listTmsSelectionsV2().length).toBe(1); });
});

describe("TaskModelSelector V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingTmsSelectionsPerProfileV2(2);
    registerTmsProfileV2({ id: "p1", owner: "u1" });
    createTmsSelectionV2({ id: "s1", profileId: "p1" }); createTmsSelectionV2({ id: "s2", profileId: "p1" });
    expect(() => createTmsSelectionV2({ id: "s3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingTmsSelectionsPerProfileV2(2);
    registerTmsProfileV2({ id: "p1", owner: "u1" });
    createTmsSelectionV2({ id: "s1", profileId: "p1" }); createTmsSelectionV2({ id: "s2", profileId: "p1" });
    scoreTmsSelectionV2("s1"); completeTmsSelectionV2("s1");
    createTmsSelectionV2({ id: "s3", profileId: "p1" });
  });
});

describe("TaskModelSelector V2 auto flips", () => {
  test("autoStaleIdleTmsProfilesV2", () => {
    setTmsProfileIdleMsV2(100);
    registerTmsProfileV2({ id: "p1", owner: "u1" }); activateTmsProfileV2("p1");
    const { count } = autoStaleIdleTmsProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getTmsProfileV2("p1").status).toBe("stale");
  });
  test("autoFailStuckTmsSelectionsV2", () => {
    setTmsSelectionStuckMsV2(100);
    registerTmsProfileV2({ id: "p1", owner: "u1" }); createTmsSelectionV2({ id: "s1", profileId: "p1" }); scoreTmsSelectionV2("s1");
    const { count } = autoFailStuckTmsSelectionsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getTmsSelectionV2("s1").status).toBe("failed"); expect(getTmsSelectionV2("s1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("TaskModelSelector V2 stats", () => {
  test("empty defaults", () => {
    const s = getTaskModelSelectorGovStatsV2();
    expect(s.totalTmsProfilesV2).toBe(0); expect(s.totalTmsSelectionsV2).toBe(0);
    for (const k of ["pending", "active", "stale", "decommissioned"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "scoring", "completed", "failed", "cancelled"]) expect(s.selectionsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerTmsProfileV2({ id: "p1", owner: "u1" }); activateTmsProfileV2("p1");
    createTmsSelectionV2({ id: "s1", profileId: "p1" }); scoreTmsSelectionV2("s1");
    const s = getTaskModelSelectorGovStatsV2();
    expect(s.profilesByStatus.active).toBe(1); expect(s.selectionsByStatus.scoring).toBe(1);
  });
});
