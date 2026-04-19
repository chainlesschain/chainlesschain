import { describe, test, expect, beforeEach } from "vitest";
import {
  WFET_TARGET_MATURITY_V2, WFET_JOB_LIFECYCLE_V2,
  setMaxActiveWfetTargetsPerOwnerV2, getMaxActiveWfetTargetsPerOwnerV2,
  setMaxPendingWfetJobsPerTargetV2, getMaxPendingWfetJobsPerTargetV2,
  setWfetTargetIdleMsV2, getWfetTargetIdleMsV2,
  setWfetJobStuckMsV2, getWfetJobStuckMsV2,
  _resetStateWebFetchV2,
  registerWfetTargetV2, activateWfetTargetV2, degradeWfetTargetV2, retireWfetTargetV2, touchWfetTargetV2, getWfetTargetV2, listWfetTargetsV2,
  createWfetJobV2, fetchingWfetJobV2, succeedWfetJobV2, failWfetJobV2, cancelWfetJobV2, getWfetJobV2, listWfetJobsV2,
  autoDegradeIdleWfetTargetsV2, autoFailStuckWfetJobsV2,
  getWebFetchGovStatsV2,
} from "../../../src/lib/web-fetch.js";

beforeEach(() => { _resetStateWebFetchV2(); });

describe("WebFetch V2 enums", () => {
  test("target maturity", () => { expect(WFET_TARGET_MATURITY_V2.PENDING).toBe("pending"); expect(WFET_TARGET_MATURITY_V2.ACTIVE).toBe("active"); expect(WFET_TARGET_MATURITY_V2.DEGRADED).toBe("degraded"); expect(WFET_TARGET_MATURITY_V2.RETIRED).toBe("retired"); });
  test("job lifecycle", () => { expect(WFET_JOB_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(WFET_JOB_LIFECYCLE_V2.FETCHING).toBe("fetching"); expect(WFET_JOB_LIFECYCLE_V2.SUCCEEDED).toBe("succeeded"); expect(WFET_JOB_LIFECYCLE_V2.FAILED).toBe("failed"); expect(WFET_JOB_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(WFET_TARGET_MATURITY_V2)).toBe(true); expect(Object.isFrozen(WFET_JOB_LIFECYCLE_V2)).toBe(true); });
});

describe("WebFetch V2 config", () => {
  test("defaults", () => { expect(getMaxActiveWfetTargetsPerOwnerV2()).toBe(12); expect(getMaxPendingWfetJobsPerTargetV2()).toBe(30); expect(getWfetTargetIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000); expect(getWfetJobStuckMsV2()).toBe(60 * 1000); });
  test("set max active", () => { setMaxActiveWfetTargetsPerOwnerV2(3); expect(getMaxActiveWfetTargetsPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingWfetJobsPerTargetV2(4); expect(getMaxPendingWfetJobsPerTargetV2()).toBe(4); });
  test("set idle/stuck ms", () => { setWfetTargetIdleMsV2(100); expect(getWfetTargetIdleMsV2()).toBe(100); setWfetJobStuckMsV2(50); expect(getWfetJobStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveWfetTargetsPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveWfetTargetsPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveWfetTargetsPerOwnerV2(5.9); expect(getMaxActiveWfetTargetsPerOwnerV2()).toBe(5); });
});

describe("WebFetch V2 target lifecycle", () => {
  test("register", () => { const t = registerWfetTargetV2({ id: "t1", owner: "u1" }); expect(t.status).toBe("pending"); expect(t.baseUrl).toBe(""); });
  test("register with baseUrl", () => { const t = registerWfetTargetV2({ id: "t1", owner: "u1", baseUrl: "https://x.com" }); expect(t.baseUrl).toBe("https://x.com"); });
  test("register reject duplicate/missing", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); expect(() => registerWfetTargetV2({ id: "t1", owner: "u1" })).toThrow(); expect(() => registerWfetTargetV2({ owner: "u1" })).toThrow(); expect(() => registerWfetTargetV2({ id: "t1" })).toThrow(); });
  test("activate pending → active", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); const t = activateWfetTargetV2("t1"); expect(t.status).toBe("active"); expect(t.activatedAt).toBeTruthy(); });
  test("degrade active → degraded", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); activateWfetTargetV2("t1"); const t = degradeWfetTargetV2("t1"); expect(t.status).toBe("degraded"); });
  test("activate degraded → active (recovery)", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); const before = activateWfetTargetV2("t1").activatedAt; degradeWfetTargetV2("t1"); const t = activateWfetTargetV2("t1"); expect(t.activatedAt).toBe(before); });
  test("retire from any non-terminal", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); const t = retireWfetTargetV2("t1"); expect(t.status).toBe("retired"); expect(t.retiredAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); retireWfetTargetV2("t1"); expect(() => activateWfetTargetV2("t1")).toThrow(); expect(() => touchWfetTargetV2("t1")).toThrow(); });
  test("touch updates", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); activateWfetTargetV2("t1"); const t = touchWfetTargetV2("t1"); expect(t.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); expect(getWfetTargetV2("t1").id).toBe("t1"); expect(getWfetTargetV2("nope")).toBeNull(); expect(listWfetTargetsV2().length).toBe(1); });
});

describe("WebFetch V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveWfetTargetsPerOwnerV2(2);
    registerWfetTargetV2({ id: "t1", owner: "u1" }); registerWfetTargetV2({ id: "t2", owner: "u1" }); registerWfetTargetV2({ id: "t3", owner: "u1" });
    activateWfetTargetV2("t1"); activateWfetTargetV2("t2");
    expect(() => activateWfetTargetV2("t3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveWfetTargetsPerOwnerV2(2);
    registerWfetTargetV2({ id: "t1", owner: "u1" }); registerWfetTargetV2({ id: "t2", owner: "u1" });
    activateWfetTargetV2("t1"); activateWfetTargetV2("t2"); degradeWfetTargetV2("t1");
    const t = activateWfetTargetV2("t1"); expect(t.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveWfetTargetsPerOwnerV2(1);
    registerWfetTargetV2({ id: "t1", owner: "u1" }); registerWfetTargetV2({ id: "t2", owner: "u2" });
    activateWfetTargetV2("t1"); activateWfetTargetV2("t2");
  });
});

describe("WebFetch V2 job lifecycle", () => {
  test("create", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); const j = createWfetJobV2({ id: "j1", targetId: "t1" }); expect(j.status).toBe("queued"); expect(j.kind).toBe("GET"); });
  test("create with kind", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); const j = createWfetJobV2({ id: "j1", targetId: "t1", kind: "POST" }); expect(j.kind).toBe("POST"); });
  test("create rejects unknown target/duplicate", () => { expect(() => createWfetJobV2({ id: "j1", targetId: "nope" })).toThrow(); registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); expect(() => createWfetJobV2({ id: "j1", targetId: "t1" })).toThrow(); });
  test("fetching queued → fetching", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); const j = fetchingWfetJobV2("j1"); expect(j.status).toBe("fetching"); expect(j.startedAt).toBeTruthy(); });
  test("succeed fetching → succeeded", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); fetchingWfetJobV2("j1"); const j = succeedWfetJobV2("j1"); expect(j.status).toBe("succeeded"); expect(j.settledAt).toBeTruthy(); });
  test("fail fetching → failed", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); fetchingWfetJobV2("j1"); const j = failWfetJobV2("j1", "err"); expect(j.status).toBe("failed"); expect(j.metadata.failReason).toBe("err"); });
  test("cancel queued/fetching → cancelled", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); cancelWfetJobV2("j1", "abort"); createWfetJobV2({ id: "j2", targetId: "t1" }); fetchingWfetJobV2("j2"); const j = cancelWfetJobV2("j2"); expect(j.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); fetchingWfetJobV2("j1"); succeedWfetJobV2("j1"); expect(() => failWfetJobV2("j1")).toThrow(); });
  test("get / list", () => { registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); expect(getWfetJobV2("j1").id).toBe("j1"); expect(getWfetJobV2("nope")).toBeNull(); expect(listWfetJobsV2().length).toBe(1); });
});

describe("WebFetch V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingWfetJobsPerTargetV2(2);
    registerWfetTargetV2({ id: "t1", owner: "u1" });
    createWfetJobV2({ id: "j1", targetId: "t1" }); createWfetJobV2({ id: "j2", targetId: "t1" });
    expect(() => createWfetJobV2({ id: "j3", targetId: "t1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingWfetJobsPerTargetV2(2);
    registerWfetTargetV2({ id: "t1", owner: "u1" });
    createWfetJobV2({ id: "j1", targetId: "t1" }); createWfetJobV2({ id: "j2", targetId: "t1" });
    fetchingWfetJobV2("j1"); succeedWfetJobV2("j1");
    createWfetJobV2({ id: "j3", targetId: "t1" });
  });
});

describe("WebFetch V2 auto flips", () => {
  test("autoDegradeIdleWfetTargetsV2", () => {
    setWfetTargetIdleMsV2(100);
    registerWfetTargetV2({ id: "t1", owner: "u1" }); activateWfetTargetV2("t1");
    const { count } = autoDegradeIdleWfetTargetsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getWfetTargetV2("t1").status).toBe("degraded");
  });
  test("autoFailStuckWfetJobsV2", () => {
    setWfetJobStuckMsV2(100);
    registerWfetTargetV2({ id: "t1", owner: "u1" }); createWfetJobV2({ id: "j1", targetId: "t1" }); fetchingWfetJobV2("j1");
    const { count } = autoFailStuckWfetJobsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getWfetJobV2("j1").status).toBe("failed"); expect(getWfetJobV2("j1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("WebFetch V2 stats", () => {
  test("empty defaults", () => {
    const s = getWebFetchGovStatsV2();
    expect(s.totalWfetTargetsV2).toBe(0); expect(s.totalWfetJobsV2).toBe(0);
    for (const k of ["pending", "active", "degraded", "retired"]) expect(s.targetsByStatus[k]).toBe(0);
    for (const k of ["queued", "fetching", "succeeded", "failed", "cancelled"]) expect(s.jobsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerWfetTargetV2({ id: "t1", owner: "u1" }); activateWfetTargetV2("t1");
    createWfetJobV2({ id: "j1", targetId: "t1" }); fetchingWfetJobV2("j1");
    const s = getWebFetchGovStatsV2();
    expect(s.targetsByStatus.active).toBe(1); expect(s.jobsByStatus.fetching).toBe(1);
  });
});
