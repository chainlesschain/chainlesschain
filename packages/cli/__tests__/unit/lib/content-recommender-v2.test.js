import { describe, test, expect, beforeEach } from "vitest";
import {
  RECOMMENDER_PROFILE_MATURITY_V2, RECOMMENDATION_JOB_LIFECYCLE_V2,
  setMaxActiveRecommenderProfilesPerOwnerV2, getMaxActiveRecommenderProfilesPerOwnerV2,
  setMaxPendingRecommendationJobsPerProfileV2, getMaxPendingRecommendationJobsPerProfileV2,
  setRecommenderProfileIdleMsV2, getRecommenderProfileIdleMsV2,
  setRecommendationJobStuckMsV2, getRecommendationJobStuckMsV2,
  _resetStateContentRecommenderV2,
  registerRecommenderProfileV2, activateRecommenderProfileV2, staleRecommenderProfileV2, archiveRecommenderProfileV2, touchRecommenderProfileV2, getRecommenderProfileV2, listRecommenderProfilesV2,
  createRecommendationJobV2, startRecommendationJobV2, completeRecommendationJobV2, failRecommendationJobV2, cancelRecommendationJobV2, getRecommendationJobV2, listRecommendationJobsV2,
  autoStaleIdleRecommenderProfilesV2, autoFailStuckRecommendationJobsV2,
  getContentRecommenderGovStatsV2,
} from "../../../src/lib/content-recommender.js";

beforeEach(() => { _resetStateContentRecommenderV2(); });

describe("Recommender V2 enums", () => {
  test("profile maturity", () => { expect(RECOMMENDER_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(RECOMMENDER_PROFILE_MATURITY_V2.STALE).toBe("stale"); expect(RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived"); });
  test("job lifecycle", () => { expect(RECOMMENDATION_JOB_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING).toBe("running"); expect(RECOMMENDATION_JOB_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED).toBe("failed"); expect(RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(RECOMMENDER_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(RECOMMENDATION_JOB_LIFECYCLE_V2)).toBe(true); });
});

describe("Recommender V2 config", () => {
  test("defaults", () => { expect(getMaxActiveRecommenderProfilesPerOwnerV2()).toBe(8); expect(getMaxPendingRecommendationJobsPerProfileV2()).toBe(10); expect(getRecommenderProfileIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000); expect(getRecommendationJobStuckMsV2()).toBe(5 * 60 * 1000); });
  test("set max active", () => { setMaxActiveRecommenderProfilesPerOwnerV2(3); expect(getMaxActiveRecommenderProfilesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingRecommendationJobsPerProfileV2(4); expect(getMaxPendingRecommendationJobsPerProfileV2()).toBe(4); });
  test("set idle ms", () => { setRecommenderProfileIdleMsV2(100); expect(getRecommenderProfileIdleMsV2()).toBe(100); });
  test("set stuck ms", () => { setRecommendationJobStuckMsV2(50); expect(getRecommendationJobStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveRecommenderProfilesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveRecommenderProfilesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveRecommenderProfilesPerOwnerV2(5.9); expect(getMaxActiveRecommenderProfilesPerOwnerV2()).toBe(5); });
});

describe("Recommender V2 profile lifecycle", () => {
  test("register", () => { const p = registerRecommenderProfileV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.strategy).toBe("tfidf"); });
  test("register with strategy", () => { const p = registerRecommenderProfileV2({ id: "p1", owner: "u1", strategy: "bm25" }); expect(p.strategy).toBe("bm25"); });
  test("register reject duplicate", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); expect(() => registerRecommenderProfileV2({ id: "p1", owner: "u1" })).toThrow(); });
  test("register reject missing id", () => { expect(() => registerRecommenderProfileV2({ owner: "u1" })).toThrow(); });
  test("register reject missing owner", () => { expect(() => registerRecommenderProfileV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); const p = activateRecommenderProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("stale active → stale", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); activateRecommenderProfileV2("p1"); const p = staleRecommenderProfileV2("p1"); expect(p.status).toBe("stale"); });
  test("activate stale → active (recovery)", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); const before = activateRecommenderProfileV2("p1").activatedAt; staleRecommenderProfileV2("p1"); const p = activateRecommenderProfileV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBe(before); });
  test("archive from active", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); activateRecommenderProfileV2("p1"); const p = archiveRecommenderProfileV2("p1"); expect(p.status).toBe("archived"); expect(p.archivedAt).toBeTruthy(); });
  test("archive from pending", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); const p = archiveRecommenderProfileV2("p1"); expect(p.status).toBe("archived"); });
  test("terminal no transitions", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); archiveRecommenderProfileV2("p1"); expect(() => activateRecommenderProfileV2("p1")).toThrow(); expect(() => staleRecommenderProfileV2("p1")).toThrow(); });
  test("touch terminal throws", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); archiveRecommenderProfileV2("p1"); expect(() => touchRecommenderProfileV2("p1")).toThrow(); });
  test("touch updates", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); activateRecommenderProfileV2("p1"); const p = touchRecommenderProfileV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); expect(getRecommenderProfileV2("p1").id).toBe("p1"); expect(getRecommenderProfileV2("nope")).toBeNull(); expect(listRecommenderProfilesV2().length).toBe(1); });
});

describe("Recommender V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveRecommenderProfilesPerOwnerV2(2);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); registerRecommenderProfileV2({ id: "p2", owner: "u1" }); registerRecommenderProfileV2({ id: "p3", owner: "u1" });
    activateRecommenderProfileV2("p1"); activateRecommenderProfileV2("p2");
    expect(() => activateRecommenderProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveRecommenderProfilesPerOwnerV2(2);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); registerRecommenderProfileV2({ id: "p2", owner: "u1" });
    activateRecommenderProfileV2("p1"); activateRecommenderProfileV2("p2"); staleRecommenderProfileV2("p1");
    const p = activateRecommenderProfileV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveRecommenderProfilesPerOwnerV2(1);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); registerRecommenderProfileV2({ id: "p2", owner: "u2" });
    activateRecommenderProfileV2("p1"); activateRecommenderProfileV2("p2");
  });
});

describe("Recommender V2 job lifecycle", () => {
  test("create", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); const j = createRecommendationJobV2({ id: "j1", profileId: "p1" }); expect(j.status).toBe("queued"); expect(j.query).toBe(""); });
  test("create with query", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); const j = createRecommendationJobV2({ id: "j1", profileId: "p1", query: "rust" }); expect(j.query).toBe("rust"); });
  test("create rejects unknown profile", () => { expect(() => createRecommendationJobV2({ id: "j1", profileId: "nope" })).toThrow(); });
  test("create rejects duplicate", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); expect(() => createRecommendationJobV2({ id: "j1", profileId: "p1" })).toThrow(); });
  test("start queued → running", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); const j = startRecommendationJobV2("j1"); expect(j.status).toBe("running"); expect(j.startedAt).toBeTruthy(); });
  test("complete running → completed", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1"); const j = completeRecommendationJobV2("j1"); expect(j.status).toBe("completed"); expect(j.settledAt).toBeTruthy(); });
  test("fail running → failed", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1"); const j = failRecommendationJobV2("j1", "oops"); expect(j.status).toBe("failed"); expect(j.metadata.failReason).toBe("oops"); });
  test("cancel queued → cancelled", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); const j = cancelRecommendationJobV2("j1", "abort"); expect(j.status).toBe("cancelled"); expect(j.metadata.cancelReason).toBe("abort"); });
  test("cancel running → cancelled", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1"); const j = cancelRecommendationJobV2("j1"); expect(j.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1"); completeRecommendationJobV2("j1"); expect(() => failRecommendationJobV2("j1")).toThrow(); });
  test("get / list", () => { registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); expect(getRecommendationJobV2("j1").id).toBe("j1"); expect(getRecommendationJobV2("nope")).toBeNull(); expect(listRecommendationJobsV2().length).toBe(1); });
});

describe("Recommender V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingRecommendationJobsPerProfileV2(2);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" });
    createRecommendationJobV2({ id: "j1", profileId: "p1" }); createRecommendationJobV2({ id: "j2", profileId: "p1" });
    expect(() => createRecommendationJobV2({ id: "j3", profileId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingRecommendationJobsPerProfileV2(2);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" });
    createRecommendationJobV2({ id: "j1", profileId: "p1" }); createRecommendationJobV2({ id: "j2", profileId: "p1" });
    startRecommendationJobV2("j1"); completeRecommendationJobV2("j1");
    createRecommendationJobV2({ id: "j3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingRecommendationJobsPerProfileV2(1);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); registerRecommenderProfileV2({ id: "p2", owner: "u1" });
    createRecommendationJobV2({ id: "j1", profileId: "p1" }); createRecommendationJobV2({ id: "j2", profileId: "p2" });
  });
});

describe("Recommender V2 auto flips", () => {
  test("autoStaleIdleRecommenderProfilesV2", () => {
    setRecommenderProfileIdleMsV2(100);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); activateRecommenderProfileV2("p1");
    const { count } = autoStaleIdleRecommenderProfilesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getRecommenderProfileV2("p1").status).toBe("stale");
  });
  test("autoFailStuckRecommendationJobsV2", () => {
    setRecommendationJobStuckMsV2(100);
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1");
    const { count } = autoFailStuckRecommendationJobsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getRecommendationJobV2("j1").status).toBe("failed"); expect(getRecommendationJobV2("j1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("Recommender V2 stats", () => {
  test("empty defaults", () => {
    const s = getContentRecommenderGovStatsV2();
    expect(s.totalRecommenderProfilesV2).toBe(0); expect(s.totalRecommendationJobsV2).toBe(0);
    for (const k of ["pending", "active", "stale", "archived"]) expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"]) expect(s.jobsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerRecommenderProfileV2({ id: "p1", owner: "u1" }); activateRecommenderProfileV2("p1");
    createRecommendationJobV2({ id: "j1", profileId: "p1" }); startRecommendationJobV2("j1");
    const s = getContentRecommenderGovStatsV2();
    expect(s.totalRecommenderProfilesV2).toBe(1); expect(s.totalRecommendationJobsV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1); expect(s.jobsByStatus.running).toBe(1);
  });
});
