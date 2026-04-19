import { describe, test, expect, beforeEach } from "vitest";
import {
  PERF_TUNING_PROFILE_MATURITY_V2,
  PERF_BENCH_LIFECYCLE_V2,
  setMaxActivePerfTuningProfilesPerOwnerV2,
  getMaxActivePerfTuningProfilesPerOwnerV2,
  setMaxPendingPerfBenchesPerProfileV2,
  getMaxPendingPerfBenchesPerProfileV2,
  setPerfTuningProfileIdleMsV2,
  getPerfTuningProfileIdleMsV2,
  setPerfBenchStuckMsV2,
  getPerfBenchStuckMsV2,
  _resetStatePerfTuningV2,
  registerPerfTuningProfileV2,
  activatePerfTuningProfileV2,
  stalePerfTuningProfileV2,
  decommissionPerfTuningProfileV2,
  touchPerfTuningProfileV2,
  getPerfTuningProfileV2,
  listPerfTuningProfilesV2,
  createPerfBenchV2,
  startPerfBenchV2,
  completePerfBenchV2,
  failPerfBenchV2,
  cancelPerfBenchV2,
  getPerfBenchV2,
  listPerfBenchesV2,
  autoStaleIdlePerfTuningProfilesV2,
  autoFailStuckPerfBenchesV2,
  getPerfTuningGovStatsV2,
} from "../../../src/lib/perf-tuning.js";

beforeEach(() => {
  _resetStatePerfTuningV2();
});

describe("PerfTuning V2 enums", () => {
  test("profile maturity", () => {
    expect(PERF_TUNING_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(PERF_TUNING_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(PERF_TUNING_PROFILE_MATURITY_V2.STALE).toBe("stale");
    expect(PERF_TUNING_PROFILE_MATURITY_V2.DECOMMISSIONED).toBe(
      "decommissioned",
    );
  });
  test("bench lifecycle", () => {
    expect(PERF_BENCH_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(PERF_BENCH_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(PERF_BENCH_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(PERF_BENCH_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(PERF_BENCH_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(PERF_TUNING_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(PERF_BENCH_LIFECYCLE_V2)).toBe(true);
  });
});

describe("PerfTuning V2 config", () => {
  test("defaults", () => {
    expect(getMaxActivePerfTuningProfilesPerOwnerV2()).toBe(6);
    expect(getMaxPendingPerfBenchesPerProfileV2()).toBe(10);
    expect(getPerfTuningProfileIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getPerfBenchStuckMsV2()).toBe(30 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActivePerfTuningProfilesPerOwnerV2(3);
    expect(getMaxActivePerfTuningProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingPerfBenchesPerProfileV2(4);
    expect(getMaxPendingPerfBenchesPerProfileV2()).toBe(4);
  });
  test("set idle ms", () => {
    setPerfTuningProfileIdleMsV2(100);
    expect(getPerfTuningProfileIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setPerfBenchStuckMsV2(50);
    expect(getPerfBenchStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActivePerfTuningProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActivePerfTuningProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActivePerfTuningProfilesPerOwnerV2(5.9);
    expect(getMaxActivePerfTuningProfilesPerOwnerV2()).toBe(5);
  });
});

describe("PerfTuning V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.target).toBe("default");
  });
  test("register with target", () => {
    const p = registerPerfTuningProfileV2({
      id: "p1",
      owner: "u1",
      target: "ml-infer",
    });
    expect(p.target).toBe("ml-infer");
  });
  test("register reject duplicate", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    expect(() =>
      registerPerfTuningProfileV2({ id: "p1", owner: "u1" }),
    ).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerPerfTuningProfileV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerPerfTuningProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    const p = activatePerfTuningProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("stale active → stale", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    const p = stalePerfTuningProfileV2("p1");
    expect(p.status).toBe("stale");
  });
  test("activate stale → active (recovery)", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    const before = activatePerfTuningProfileV2("p1").activatedAt;
    stalePerfTuningProfileV2("p1");
    const p = activatePerfTuningProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBe(before);
  });
  test("decommission from active", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    const p = decommissionPerfTuningProfileV2("p1");
    expect(p.status).toBe("decommissioned");
    expect(p.decommissionedAt).toBeTruthy();
  });
  test("decommission from pending", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    const p = decommissionPerfTuningProfileV2("p1");
    expect(p.status).toBe("decommissioned");
  });
  test("terminal no transitions", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    decommissionPerfTuningProfileV2("p1");
    expect(() => activatePerfTuningProfileV2("p1")).toThrow();
    expect(() => stalePerfTuningProfileV2("p1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    decommissionPerfTuningProfileV2("p1");
    expect(() => touchPerfTuningProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    const p = touchPerfTuningProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    expect(getPerfTuningProfileV2("p1").id).toBe("p1");
    expect(getPerfTuningProfileV2("nope")).toBeNull();
    expect(listPerfTuningProfilesV2().length).toBe(1);
  });
});

describe("PerfTuning V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActivePerfTuningProfilesPerOwnerV2(2);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    registerPerfTuningProfileV2({ id: "p2", owner: "u1" });
    registerPerfTuningProfileV2({ id: "p3", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    activatePerfTuningProfileV2("p2");
    expect(() => activatePerfTuningProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActivePerfTuningProfilesPerOwnerV2(2);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    registerPerfTuningProfileV2({ id: "p2", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    activatePerfTuningProfileV2("p2");
    stalePerfTuningProfileV2("p1");
    const p = activatePerfTuningProfileV2("p1");
    expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActivePerfTuningProfilesPerOwnerV2(1);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    registerPerfTuningProfileV2({ id: "p2", owner: "u2" });
    activatePerfTuningProfileV2("p1");
    activatePerfTuningProfileV2("p2");
  });
});

describe("PerfTuning V2 bench lifecycle", () => {
  test("create", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    const b = createPerfBenchV2({ id: "b1", profileId: "p1" });
    expect(b.status).toBe("queued");
    expect(b.scenario).toBe("");
  });
  test("create with scenario", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    const b = createPerfBenchV2({
      id: "b1",
      profileId: "p1",
      scenario: "load",
    });
    expect(b.scenario).toBe("load");
  });
  test("create rejects unknown profile", () => {
    expect(() => createPerfBenchV2({ id: "b1", profileId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    expect(() => createPerfBenchV2({ id: "b1", profileId: "p1" })).toThrow();
  });
  test("start queued → running", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    const b = startPerfBenchV2("b1");
    expect(b.status).toBe("running");
    expect(b.startedAt).toBeTruthy();
  });
  test("complete running → completed", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    const b = completePerfBenchV2("b1");
    expect(b.status).toBe("completed");
    expect(b.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    const b = failPerfBenchV2("b1", "oops");
    expect(b.status).toBe("failed");
    expect(b.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    const b = cancelPerfBenchV2("b1", "abort");
    expect(b.status).toBe("cancelled");
    expect(b.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    const b = cancelPerfBenchV2("b1");
    expect(b.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    completePerfBenchV2("b1");
    expect(() => failPerfBenchV2("b1")).toThrow();
  });
  test("get / list", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    expect(getPerfBenchV2("b1").id).toBe("b1");
    expect(getPerfBenchV2("nope")).toBeNull();
    expect(listPerfBenchesV2().length).toBe(1);
  });
});

describe("PerfTuning V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingPerfBenchesPerProfileV2(2);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    createPerfBenchV2({ id: "b2", profileId: "p1" });
    expect(() => createPerfBenchV2({ id: "b3", profileId: "p1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingPerfBenchesPerProfileV2(2);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    createPerfBenchV2({ id: "b2", profileId: "p1" });
    startPerfBenchV2("b1");
    completePerfBenchV2("b1");
    createPerfBenchV2({ id: "b3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingPerfBenchesPerProfileV2(1);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    registerPerfTuningProfileV2({ id: "p2", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    createPerfBenchV2({ id: "b2", profileId: "p2" });
  });
});

describe("PerfTuning V2 auto flips", () => {
  test("autoStaleIdlePerfTuningProfilesV2", () => {
    setPerfTuningProfileIdleMsV2(100);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    const { count } = autoStaleIdlePerfTuningProfilesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getPerfTuningProfileV2("p1").status).toBe("stale");
  });
  test("autoFailStuckPerfBenchesV2", () => {
    setPerfBenchStuckMsV2(100);
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    const { count } = autoFailStuckPerfBenchesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getPerfBenchV2("b1").status).toBe("failed");
    expect(getPerfBenchV2("b1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("PerfTuning V2 stats", () => {
  test("empty defaults", () => {
    const s = getPerfTuningGovStatsV2();
    expect(s.totalPerfTuningProfilesV2).toBe(0);
    expect(s.totalPerfBenchesV2).toBe(0);
    for (const k of ["pending", "active", "stale", "decommissioned"])
      expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"])
      expect(s.benchesByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerPerfTuningProfileV2({ id: "p1", owner: "u1" });
    activatePerfTuningProfileV2("p1");
    createPerfBenchV2({ id: "b1", profileId: "p1" });
    startPerfBenchV2("b1");
    const s = getPerfTuningGovStatsV2();
    expect(s.totalPerfTuningProfilesV2).toBe(1);
    expect(s.totalPerfBenchesV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.benchesByStatus.running).toBe(1);
  });
});
