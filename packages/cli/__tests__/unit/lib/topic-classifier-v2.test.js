import { describe, test, expect, beforeEach } from "vitest";
import {
  TOPIC_CLS_PROFILE_MATURITY_V2,
  TOPIC_CLS_JOB_LIFECYCLE_V2,
  setMaxActiveTopicClsProfilesPerOwnerV2,
  getMaxActiveTopicClsProfilesPerOwnerV2,
  setMaxPendingTopicClsJobsPerProfileV2,
  getMaxPendingTopicClsJobsPerProfileV2,
  setTopicClsProfileIdleMsV2,
  getTopicClsProfileIdleMsV2,
  setTopicClsJobStuckMsV2,
  getTopicClsJobStuckMsV2,
  _resetStateTopicClsV2,
  registerTopicClsProfileV2,
  activateTopicClsProfileV2,
  staleTopicClsProfileV2,
  archiveTopicClsProfileV2,
  touchTopicClsProfileV2,
  getTopicClsProfileV2,
  listTopicClsProfilesV2,
  createTopicClsJobV2,
  startTopicClsJobV2,
  completeTopicClsJobV2,
  failTopicClsJobV2,
  cancelTopicClsJobV2,
  getTopicClsJobV2,
  listTopicClsJobsV2,
  autoStaleIdleTopicClsProfilesV2,
  autoFailStuckTopicClsJobsV2,
  getTopicClassifierGovStatsV2,
} from "../../../src/lib/topic-classifier.js";

beforeEach(() => {
  _resetStateTopicClsV2();
});

describe("TopicCls V2 enums", () => {
  test("profile maturity", () => {
    expect(TOPIC_CLS_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(TOPIC_CLS_PROFILE_MATURITY_V2.STALE).toBe("stale");
    expect(TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("job lifecycle", () => {
    expect(TOPIC_CLS_JOB_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(TOPIC_CLS_JOB_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(TOPIC_CLS_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(TOPIC_CLS_JOB_LIFECYCLE_V2)).toBe(true);
  });
});

describe("TopicCls V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveTopicClsProfilesPerOwnerV2()).toBe(8);
    expect(getMaxPendingTopicClsJobsPerProfileV2()).toBe(20);
    expect(getTopicClsProfileIdleMsV2()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(getTopicClsJobStuckMsV2()).toBe(5 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveTopicClsProfilesPerOwnerV2(3);
    expect(getMaxActiveTopicClsProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingTopicClsJobsPerProfileV2(4);
    expect(getMaxPendingTopicClsJobsPerProfileV2()).toBe(4);
  });
  test("set idle ms", () => {
    setTopicClsProfileIdleMsV2(100);
    expect(getTopicClsProfileIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setTopicClsJobStuckMsV2(50);
    expect(getTopicClsJobStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveTopicClsProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveTopicClsProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveTopicClsProfilesPerOwnerV2(5.9);
    expect(getMaxActiveTopicClsProfilesPerOwnerV2()).toBe(5);
  });
});

describe("TopicCls V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.model).toBe("default");
  });
  test("register with model", () => {
    const p = registerTopicClsProfileV2({
      id: "p1",
      owner: "u1",
      model: "bge-large",
    });
    expect(p.model).toBe("bge-large");
  });
  test("register reject duplicate", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    expect(() =>
      registerTopicClsProfileV2({ id: "p1", owner: "u1" }),
    ).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerTopicClsProfileV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerTopicClsProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    const p = activateTopicClsProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("stale active → stale", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    activateTopicClsProfileV2("p1");
    const p = staleTopicClsProfileV2("p1");
    expect(p.status).toBe("stale");
  });
  test("activate stale → active (recovery)", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    const before = activateTopicClsProfileV2("p1").activatedAt;
    staleTopicClsProfileV2("p1");
    const p = activateTopicClsProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBe(before);
  });
  test("archive from active", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    activateTopicClsProfileV2("p1");
    const p = archiveTopicClsProfileV2("p1");
    expect(p.status).toBe("archived");
    expect(p.archivedAt).toBeTruthy();
  });
  test("archive from pending", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    const p = archiveTopicClsProfileV2("p1");
    expect(p.status).toBe("archived");
  });
  test("terminal no transitions", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    archiveTopicClsProfileV2("p1");
    expect(() => activateTopicClsProfileV2("p1")).toThrow();
    expect(() => staleTopicClsProfileV2("p1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    archiveTopicClsProfileV2("p1");
    expect(() => touchTopicClsProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    activateTopicClsProfileV2("p1");
    const p = touchTopicClsProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    expect(getTopicClsProfileV2("p1").id).toBe("p1");
    expect(getTopicClsProfileV2("nope")).toBeNull();
    expect(listTopicClsProfilesV2().length).toBe(1);
  });
});

describe("TopicCls V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveTopicClsProfilesPerOwnerV2(2);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    registerTopicClsProfileV2({ id: "p2", owner: "u1" });
    registerTopicClsProfileV2({ id: "p3", owner: "u1" });
    activateTopicClsProfileV2("p1");
    activateTopicClsProfileV2("p2");
    expect(() => activateTopicClsProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveTopicClsProfilesPerOwnerV2(2);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    registerTopicClsProfileV2({ id: "p2", owner: "u1" });
    activateTopicClsProfileV2("p1");
    activateTopicClsProfileV2("p2");
    staleTopicClsProfileV2("p1");
    const p = activateTopicClsProfileV2("p1");
    expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveTopicClsProfilesPerOwnerV2(1);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    registerTopicClsProfileV2({ id: "p2", owner: "u2" });
    activateTopicClsProfileV2("p1");
    activateTopicClsProfileV2("p2");
  });
});

describe("TopicCls V2 job lifecycle", () => {
  test("create", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    const j = createTopicClsJobV2({ id: "j1", profileId: "p1" });
    expect(j.status).toBe("queued");
    expect(j.text).toBe("");
  });
  test("create with text", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    const j = createTopicClsJobV2({ id: "j1", profileId: "p1", text: "hello" });
    expect(j.text).toBe("hello");
  });
  test("create rejects unknown profile", () => {
    expect(() =>
      createTopicClsJobV2({ id: "j1", profileId: "nope" }),
    ).toThrow();
  });
  test("create rejects duplicate", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    expect(() => createTopicClsJobV2({ id: "j1", profileId: "p1" })).toThrow();
  });
  test("start queued → running", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    const j = startTopicClsJobV2("j1");
    expect(j.status).toBe("running");
    expect(j.startedAt).toBeTruthy();
  });
  test("complete running → completed", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    const j = completeTopicClsJobV2("j1");
    expect(j.status).toBe("completed");
    expect(j.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    const j = failTopicClsJobV2("j1", "oops");
    expect(j.status).toBe("failed");
    expect(j.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    const j = cancelTopicClsJobV2("j1", "abort");
    expect(j.status).toBe("cancelled");
    expect(j.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    const j = cancelTopicClsJobV2("j1");
    expect(j.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    completeTopicClsJobV2("j1");
    expect(() => failTopicClsJobV2("j1")).toThrow();
  });
  test("get / list", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    expect(getTopicClsJobV2("j1").id).toBe("j1");
    expect(getTopicClsJobV2("nope")).toBeNull();
    expect(listTopicClsJobsV2().length).toBe(1);
  });
});

describe("TopicCls V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingTopicClsJobsPerProfileV2(2);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    createTopicClsJobV2({ id: "j2", profileId: "p1" });
    expect(() => createTopicClsJobV2({ id: "j3", profileId: "p1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingTopicClsJobsPerProfileV2(2);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    createTopicClsJobV2({ id: "j2", profileId: "p1" });
    startTopicClsJobV2("j1");
    completeTopicClsJobV2("j1");
    createTopicClsJobV2({ id: "j3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingTopicClsJobsPerProfileV2(1);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    registerTopicClsProfileV2({ id: "p2", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    createTopicClsJobV2({ id: "j2", profileId: "p2" });
  });
});

describe("TopicCls V2 auto flips", () => {
  test("autoStaleIdleTopicClsProfilesV2", () => {
    setTopicClsProfileIdleMsV2(100);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    activateTopicClsProfileV2("p1");
    const { count } = autoStaleIdleTopicClsProfilesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getTopicClsProfileV2("p1").status).toBe("stale");
  });
  test("autoFailStuckTopicClsJobsV2", () => {
    setTopicClsJobStuckMsV2(100);
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    const { count } = autoFailStuckTopicClsJobsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getTopicClsJobV2("j1").status).toBe("failed");
    expect(getTopicClsJobV2("j1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("TopicCls V2 stats", () => {
  test("empty defaults", () => {
    const s = getTopicClassifierGovStatsV2();
    expect(s.totalTopicClsProfilesV2).toBe(0);
    expect(s.totalTopicClsJobsV2).toBe(0);
    for (const k of ["pending", "active", "stale", "archived"])
      expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"])
      expect(s.jobsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerTopicClsProfileV2({ id: "p1", owner: "u1" });
    activateTopicClsProfileV2("p1");
    createTopicClsJobV2({ id: "j1", profileId: "p1" });
    startTopicClsJobV2("j1");
    const s = getTopicClassifierGovStatsV2();
    expect(s.totalTopicClsProfilesV2).toBe(1);
    expect(s.totalTopicClsJobsV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.jobsByStatus.running).toBe(1);
  });
});
