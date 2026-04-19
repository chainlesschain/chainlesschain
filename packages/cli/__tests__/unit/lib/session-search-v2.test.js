import { describe, test, expect, beforeEach } from "vitest";
import {
  SSCH_PROFILE_MATURITY_V2, SSCH_QUERY_LIFECYCLE_V2,
  setMaxActiveSschProfilesPerOwnerV2, getMaxActiveSschProfilesPerOwnerV2,
  setMaxPendingSschQueriesPerProfileV2, getMaxPendingSschQueriesPerProfileV2,
  setSschProfileIdleMsV2, getSschProfileIdleMsV2,
  setSschQueryStuckMsV2, getSschQueryStuckMsV2,
  _resetStateSessionSearchV2,
  registerSschProfileV2, activateSschProfileV2, staleSschProfileV2, archiveSschProfileV2, touchSschProfileV2, getSschProfileV2, listSschProfilesV2,
  createSschQueryV2, searchingSschQueryV2, completeSschQueryV2, failSschQueryV2, cancelSschQueryV2, getSschQueryV2, listSschQueriesV2,
  autoStaleIdleSschProfilesV2, autoFailStuckSschQueriesV2,
  getSessionSearchGovStatsV2,
} from "../../../src/lib/session-search.js";

beforeEach(() => { _resetStateSessionSearchV2(); });

describe("SessionSearch V2 enums", () => {
  test("profile maturity", () => { expect(SSCH_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(SSCH_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(SSCH_PROFILE_MATURITY_V2.STALE).toBe("stale"); expect(SSCH_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived"); });
  test("query lifecycle", () => { expect(SSCH_QUERY_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(SSCH_QUERY_LIFECYCLE_V2.SEARCHING).toBe("searching"); expect(SSCH_QUERY_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(SSCH_QUERY_LIFECYCLE_V2.FAILED).toBe("failed"); expect(SSCH_QUERY_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(SSCH_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(SSCH_QUERY_LIFECYCLE_V2)).toBe(true); });
});

describe("SessionSearch V2 config", () => {
  test("defaults", () => { expect(getMaxActiveSschProfilesPerOwnerV2()).toBe(8); expect(getMaxPendingSschQueriesPerProfileV2()).toBe(20); expect(getSschProfileIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000); expect(getSschQueryStuckMsV2()).toBe(30 * 1000); });
  test("set max active", () => { setMaxActiveSschProfilesPerOwnerV2(3); expect(getMaxActiveSschProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingSschQueriesPerProfileV2(4); expect(getMaxPendingSschQueriesPerProfileV2()).toBe(4); });
  test("set idle/stuck ms", () => { setSschProfileIdleMsV2(100); expect(getSschProfileIdleMsV2()).toBe(100); setSschQueryStuckMsV2(50); expect(getSschQueryStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveSschProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveSschProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveSschProfilesPerOwnerV2(5.9); expect(getMaxActiveSschProfilesPerOwnerV2()).toBe(5); });
});

describe("SessionSearch V2 profile lifecycle", () => {
  test("register", () => { const p = registerSschProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.scope).toBe("all"); });
  test("register with scope", () => { const p = registerSschProfileV2({ id: "p1", owner: "u1", scope: "recent" }); expect(p.scope).toBe("recent"); });
  test("register reject duplicate/missing", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); expect(() => registerSschProfileV2({ id: "p1", owner: "u1" })).toThrow(); expect(() => registerSschProfileV2({ owner: "u1" })).toThrow(); expect(() => registerSschProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); const p = activateSschProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("stale active → stale", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); activateSschProfileV2("p1"); const p = staleSschProfileV2("p1"); expect(p.status).toBe("stale"); });
  test("activate stale → active (recovery)", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); const before = activateSschProfileV2("p1").activatedAt; staleSschProfileV2("p1"); const p = activateSschProfileV2("p1"); expect(p.activatedAt).toBe(before); });
  test("archive from any non-terminal", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); const p = archiveSschProfileV2("p1"); expect(p.status).toBe("archived"); expect(p.archivedAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); archiveSschProfileV2("p1"); expect(() => activateSschProfileV2("p1")).toThrow(); expect(() => touchSschProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); activateSschProfileV2("p1"); const p = touchSschProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); expect(getSschProfileV2("p1").id).toBe("p1"); expect(getSschProfileV2("nope")).toBeNull(); expect(listSschProfilesV2().length).toBe(1); });
});

describe("SessionSearch V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSschProfilesPerOwnerV2(2);
    registerSschProfileV2({ id: "p1", owner: "u1" }); registerSschProfileV2({ id: "p2", owner: "u1" }); registerSschProfileV2({ id: "p3", owner: "u1" });
    activateSschProfileV2("p1"); activateSschProfileV2("p2");
    expect(() => activateSschProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSschProfilesPerOwnerV2(2);
    registerSschProfileV2({ id: "p1", owner: "u1" }); registerSschProfileV2({ id: "p2", owner: "u1" });
    activateSschProfileV2("p1"); activateSschProfileV2("p2"); staleSschProfileV2("p1");
    const p = activateSschProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveSschProfilesPerOwnerV2(1);
    registerSschProfileV2({ id: "p1", owner: "u1" }); registerSschProfileV2({ id: "p2", owner: "u2" });
    activateSschProfileV2("p1"); activateSschProfileV2("p2");
  });
});

describe("SessionSearch V2 query lifecycle", () => {
  test("create", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); const q = createSschQueryV2({ id: "q1", profileId: "p1" }); expect(q.status).toBe("queued"); expect(q.q).toBe(""); });
  test("create with q", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); const q = createSschQueryV2({ id: "q1", profileId: "p1", q: "hello" }); expect(q.q).toBe("hello"); });
  test("create rejects unknown profile/duplicate", () => { expect(() => createSschQueryV2({ id: "q1", profileId: "nope" })).toThrow(); registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); expect(() => createSschQueryV2({ id: "q1", profileId: "p1" })).toThrow(); });
  test("searching queued → searching", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); const q = searchingSschQueryV2("q1"); expect(q.status).toBe("searching"); expect(q.startedAt).toBeTruthy(); });
  test("complete searching → completed", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); searchingSschQueryV2("q1"); const q = completeSschQueryV2("q1"); expect(q.status).toBe("completed"); expect(q.settledAt).toBeTruthy(); });
  test("fail searching → failed", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); searchingSschQueryV2("q1"); const q = failSschQueryV2("q1", "err"); expect(q.status).toBe("failed"); expect(q.metadata.failReason).toBe("err"); });
  test("cancel queued/searching → cancelled", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); cancelSschQueryV2("q1", "abort"); createSschQueryV2({ id: "q2", profileId: "p1" }); searchingSschQueryV2("q2"); const q = cancelSschQueryV2("q2"); expect(q.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); searchingSschQueryV2("q1"); completeSschQueryV2("q1"); expect(() => failSschQueryV2("q1")).toThrow(); });
  test("get / list", () => { registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); expect(getSschQueryV2("q1").id).toBe("q1"); expect(getSschQueryV2("nope")).toBeNull(); expect(listSschQueriesV2().length).toBe(1); });
});

describe("SessionSearch V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingSschQueriesPerProfileV2(2);
    registerSschProfileV2({ id: "p1", owner: "u1" });
    createSschQueryV2({ id: "q1", profileId: "p1" }); createSschQueryV2({ id: "q2", profileId: "p1" });
    expect(() => createSschQueryV2({ id: "q3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingSschQueriesPerProfileV2(2);
    registerSschProfileV2({ id: "p1", owner: "u1" });
    createSschQueryV2({ id: "q1", profileId: "p1" }); createSschQueryV2({ id: "q2", profileId: "p1" });
    searchingSschQueryV2("q1"); completeSschQueryV2("q1");
    createSschQueryV2({ id: "q3", profileId: "p1" });
  });
});

describe("SessionSearch V2 auto flips", () => {
  test("autoStaleIdleSschProfilesV2", () => {
    setSschProfileIdleMsV2(100);
    registerSschProfileV2({ id: "p1", owner: "u1" }); activateSschProfileV2("p1");
    const { count } = autoStaleIdleSschProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSschProfileV2("p1").status).toBe("stale");
  });
  test("autoFailStuckSschQueriesV2", () => {
    setSschQueryStuckMsV2(100);
    registerSschProfileV2({ id: "p1", owner: "u1" }); createSschQueryV2({ id: "q1", profileId: "p1" }); searchingSschQueryV2("q1");
    const { count } = autoFailStuckSschQueriesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSschQueryV2("q1").status).toBe("failed"); expect(getSschQueryV2("q1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("SessionSearch V2 stats", () => {
  test("empty defaults", () => {
    const s = getSessionSearchGovStatsV2();
    expect(s.totalSschProfilesV2).toBe(0); expect(s.totalSschQueriesV2).toBe(0);
    for (const k of ["pending", "active", "stale", "archived"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "searching", "completed", "failed", "cancelled"]) expect(s.queriesByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSschProfileV2({ id: "p1", owner: "u1" }); activateSschProfileV2("p1");
    createSschQueryV2({ id: "q1", profileId: "p1" }); searchingSschQueryV2("q1");
    const s = getSessionSearchGovStatsV2();
    expect(s.profilesByStatus.active).toBe(1); expect(s.queriesByStatus.searching).toBe(1);
  });
});
