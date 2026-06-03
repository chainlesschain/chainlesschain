import { describe, test, expect, beforeEach } from "vitest";
import {
  RUNNER_PROFILE_MATURITY_V2,
  RUNNER_EXEC_LIFECYCLE_V2,
  setMaxActiveRunnerProfilesPerOwnerV2,
  getMaxActiveRunnerProfilesPerOwnerV2,
  setMaxPendingRunnerExecsPerProfileV2,
  getMaxPendingRunnerExecsPerProfileV2,
  setRunnerProfileIdleMsV2,
  getRunnerProfileIdleMsV2,
  setRunnerExecStuckMsV2,
  getRunnerExecStuckMsV2,
  _resetStateRunnerV2,
  registerRunnerProfileV2,
  activateRunnerProfileV2,
  pauseRunnerProfileV2,
  retireRunnerProfileV2,
  touchRunnerProfileV2,
  getRunnerProfileV2,
  listRunnerProfilesV2,
  createRunnerExecV2,
  startRunnerExecV2,
  succeedRunnerExecV2,
  failRunnerExecV2,
  cancelRunnerExecV2,
  getRunnerExecV2,
  listRunnerExecsV2,
  autoPauseIdleRunnerProfilesV2,
  autoFailStuckRunnerExecsV2,
  getRunnerGovStatsV2,
} from "../../../src/lib/cowork-task-runner.js";

beforeEach(() => {
  _resetStateRunnerV2();
});

describe("Runner V2 enums", () => {
  test("profile maturity", () => {
    expect(RUNNER_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(RUNNER_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(RUNNER_PROFILE_MATURITY_V2.PAUSED).toBe("paused");
    expect(RUNNER_PROFILE_MATURITY_V2.RETIRED).toBe("retired");
  });
  test("exec lifecycle", () => {
    expect(RUNNER_EXEC_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(RUNNER_EXEC_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED).toBe("succeeded");
    expect(RUNNER_EXEC_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(RUNNER_EXEC_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(RUNNER_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(RUNNER_EXEC_LIFECYCLE_V2)).toBe(true);
  });
});

describe("Runner V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveRunnerProfilesPerOwnerV2()).toBe(8);
    expect(getMaxPendingRunnerExecsPerProfileV2()).toBe(15);
    expect(getRunnerProfileIdleMsV2()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(getRunnerExecStuckMsV2()).toBe(20 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveRunnerProfilesPerOwnerV2(3);
    expect(getMaxActiveRunnerProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingRunnerExecsPerProfileV2(4);
    expect(getMaxPendingRunnerExecsPerProfileV2()).toBe(4);
  });
  test("set idle ms", () => {
    setRunnerProfileIdleMsV2(100);
    expect(getRunnerProfileIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setRunnerExecStuckMsV2(50);
    expect(getRunnerExecStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveRunnerProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveRunnerProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveRunnerProfilesPerOwnerV2(5.9);
    expect(getMaxActiveRunnerProfilesPerOwnerV2()).toBe(5);
  });
});

describe("Runner V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerRunnerProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.template).toBe("default");
  });
  test("register with template", () => {
    const p = registerRunnerProfileV2({
      id: "p1",
      owner: "u1",
      template: "tpl-a",
    });
    expect(p.template).toBe("tpl-a");
  });
  test("register reject duplicate", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    expect(() => registerRunnerProfileV2({ id: "p1", owner: "u1" })).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerRunnerProfileV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerRunnerProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    const p = activateRunnerProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("pause active → paused", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    activateRunnerProfileV2("p1");
    const p = pauseRunnerProfileV2("p1");
    expect(p.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    const before = activateRunnerProfileV2("p1").activatedAt;
    pauseRunnerProfileV2("p1");
    const p = activateRunnerProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBe(before);
  });
  test("retire from active", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    activateRunnerProfileV2("p1");
    const p = retireRunnerProfileV2("p1");
    expect(p.status).toBe("retired");
    expect(p.retiredAt).toBeTruthy();
  });
  test("retire from pending", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    const p = retireRunnerProfileV2("p1");
    expect(p.status).toBe("retired");
  });
  test("terminal no transitions", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    retireRunnerProfileV2("p1");
    expect(() => activateRunnerProfileV2("p1")).toThrow();
    expect(() => pauseRunnerProfileV2("p1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    retireRunnerProfileV2("p1");
    expect(() => touchRunnerProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    activateRunnerProfileV2("p1");
    const p = touchRunnerProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    expect(getRunnerProfileV2("p1").id).toBe("p1");
    expect(getRunnerProfileV2("nope")).toBeNull();
    expect(listRunnerProfilesV2().length).toBe(1);
  });
});

describe("Runner V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveRunnerProfilesPerOwnerV2(2);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    registerRunnerProfileV2({ id: "p2", owner: "u1" });
    registerRunnerProfileV2({ id: "p3", owner: "u1" });
    activateRunnerProfileV2("p1");
    activateRunnerProfileV2("p2");
    expect(() => activateRunnerProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveRunnerProfilesPerOwnerV2(2);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    registerRunnerProfileV2({ id: "p2", owner: "u1" });
    activateRunnerProfileV2("p1");
    activateRunnerProfileV2("p2");
    pauseRunnerProfileV2("p1");
    const p = activateRunnerProfileV2("p1");
    expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveRunnerProfilesPerOwnerV2(1);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    registerRunnerProfileV2({ id: "p2", owner: "u2" });
    activateRunnerProfileV2("p1");
    activateRunnerProfileV2("p2");
  });
});

describe("Runner V2 exec lifecycle", () => {
  test("create", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    const e = createRunnerExecV2({ id: "e1", profileId: "p1" });
    expect(e.status).toBe("queued");
    expect(e.taskInput).toBe("");
  });
  test("create with input", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    const e = createRunnerExecV2({
      id: "e1",
      profileId: "p1",
      taskInput: "go",
    });
    expect(e.taskInput).toBe("go");
  });
  test("create rejects unknown profile", () => {
    expect(() => createRunnerExecV2({ id: "e1", profileId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    expect(() => createRunnerExecV2({ id: "e1", profileId: "p1" })).toThrow();
  });
  test("start queued → running", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    const e = startRunnerExecV2("e1");
    expect(e.status).toBe("running");
    expect(e.startedAt).toBeTruthy();
  });
  test("succeed running → succeeded", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    const e = succeedRunnerExecV2("e1");
    expect(e.status).toBe("succeeded");
    expect(e.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    const e = failRunnerExecV2("e1", "oops");
    expect(e.status).toBe("failed");
    expect(e.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    const e = cancelRunnerExecV2("e1", "abort");
    expect(e.status).toBe("cancelled");
    expect(e.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    const e = cancelRunnerExecV2("e1");
    expect(e.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    succeedRunnerExecV2("e1");
    expect(() => failRunnerExecV2("e1")).toThrow();
  });
  test("get / list", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    expect(getRunnerExecV2("e1").id).toBe("e1");
    expect(getRunnerExecV2("nope")).toBeNull();
    expect(listRunnerExecsV2().length).toBe(1);
  });
});

describe("Runner V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingRunnerExecsPerProfileV2(2);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    createRunnerExecV2({ id: "e2", profileId: "p1" });
    expect(() => createRunnerExecV2({ id: "e3", profileId: "p1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingRunnerExecsPerProfileV2(2);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    createRunnerExecV2({ id: "e2", profileId: "p1" });
    startRunnerExecV2("e1");
    succeedRunnerExecV2("e1");
    createRunnerExecV2({ id: "e3", profileId: "p1" });
  });
  test("per-profile scope", () => {
    setMaxPendingRunnerExecsPerProfileV2(1);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    registerRunnerProfileV2({ id: "p2", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    createRunnerExecV2({ id: "e2", profileId: "p2" });
  });
});

describe("Runner V2 auto flips", () => {
  test("autoPauseIdleRunnerProfilesV2", () => {
    setRunnerProfileIdleMsV2(100);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    activateRunnerProfileV2("p1");
    const { count } = autoPauseIdleRunnerProfilesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getRunnerProfileV2("p1").status).toBe("paused");
  });
  test("autoFailStuckRunnerExecsV2", () => {
    setRunnerExecStuckMsV2(100);
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    const { count } = autoFailStuckRunnerExecsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getRunnerExecV2("e1").status).toBe("failed");
    expect(getRunnerExecV2("e1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("Runner V2 stats", () => {
  test("empty defaults", () => {
    const s = getRunnerGovStatsV2();
    expect(s.totalRunnerProfilesV2).toBe(0);
    expect(s.totalRunnerExecsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "retired"])
      expect(s.profilesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "succeeded", "failed", "cancelled"])
      expect(s.execsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerRunnerProfileV2({ id: "p1", owner: "u1" });
    activateRunnerProfileV2("p1");
    createRunnerExecV2({ id: "e1", profileId: "p1" });
    startRunnerExecV2("e1");
    const s = getRunnerGovStatsV2();
    expect(s.totalRunnerProfilesV2).toBe(1);
    expect(s.totalRunnerExecsV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.execsByStatus.running).toBe(1);
  });
});
