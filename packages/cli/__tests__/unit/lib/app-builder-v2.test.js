import { describe, test, expect, beforeEach } from "vitest";
import {
  APP_MATURITY_V2,
  APP_BUILD_LIFECYCLE_V2,
  setMaxActiveAppsPerOwnerV2,
  getMaxActiveAppsPerOwnerV2,
  setMaxPendingAppBuildsPerAppV2,
  getMaxPendingAppBuildsPerAppV2,
  setAppIdleMsV2,
  getAppIdleMsV2,
  setAppBuildStuckMsV2,
  getAppBuildStuckMsV2,
  _resetStateAppBuilderV2,
  registerAppV2,
  activateAppV2,
  pauseAppV2,
  archiveAppV2,
  touchAppV2,
  getAppV2,
  listAppsV2,
  createAppBuildV2,
  startAppBuildV2,
  succeedAppBuildV2,
  failAppBuildV2,
  cancelAppBuildV2,
  getAppBuildV2,
  listAppBuildsV2,
  autoPauseIdleAppsV2,
  autoFailStuckAppBuildsV2,
  getAppBuilderGovStatsV2,
} from "../../../src/lib/app-builder.js";

beforeEach(() => {
  _resetStateAppBuilderV2();
});

describe("App Builder V2 enums", () => {
  test("maturity enum", () => {
    expect(APP_MATURITY_V2.PENDING).toBe("pending");
    expect(APP_MATURITY_V2.ACTIVE).toBe("active");
    expect(APP_MATURITY_V2.PAUSED).toBe("paused");
    expect(APP_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("build lifecycle enum", () => {
    expect(APP_BUILD_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(APP_BUILD_LIFECYCLE_V2.BUILDING).toBe("building");
    expect(APP_BUILD_LIFECYCLE_V2.SUCCEEDED).toBe("succeeded");
    expect(APP_BUILD_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(APP_BUILD_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("enums are frozen", () => {
    expect(Object.isFrozen(APP_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(APP_BUILD_LIFECYCLE_V2)).toBe(true);
  });
});

describe("App Builder V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveAppsPerOwnerV2()).toBe(10);
    expect(getMaxPendingAppBuildsPerAppV2()).toBe(20);
    expect(getAppIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getAppBuildStuckMsV2()).toBe(10 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveAppsPerOwnerV2(7);
    expect(getMaxActiveAppsPerOwnerV2()).toBe(7);
  });
  test("set max pending builds", () => {
    setMaxPendingAppBuildsPerAppV2(5);
    expect(getMaxPendingAppBuildsPerAppV2()).toBe(5);
  });
  test("set idle ms", () => {
    setAppIdleMsV2(1000);
    expect(getAppIdleMsV2()).toBe(1000);
  });
  test("set build stuck ms", () => {
    setAppBuildStuckMsV2(500);
    expect(getAppBuildStuckMsV2()).toBe(500);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveAppsPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveAppsPerOwnerV2(-1)).toThrow();
    expect(() => setMaxActiveAppsPerOwnerV2("abc")).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveAppsPerOwnerV2(4.7);
    expect(getMaxActiveAppsPerOwnerV2()).toBe(4);
  });
});

describe("App Builder V2 app lifecycle", () => {
  test("register", () => {
    const a = registerAppV2({ id: "a1", owner: "u1" });
    expect(a.id).toBe("a1");
    expect(a.status).toBe("pending");
    expect(a.name).toBe("a1");
  });
  test("register with name", () => {
    const a = registerAppV2({ id: "a1", owner: "u1", name: "MyApp" });
    expect(a.name).toBe("MyApp");
  });
  test("register reject duplicate", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    expect(() => registerAppV2({ id: "a1", owner: "u1" })).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerAppV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerAppV2({ id: "a1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    const a = activateAppV2("a1");
    expect(a.status).toBe("active");
    expect(a.activatedAt).toBeTruthy();
  });
  test("activate unknown", () => {
    expect(() => activateAppV2("nope")).toThrow();
  });
  test("pause active → paused", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    activateAppV2("a1");
    const a = pauseAppV2("a1");
    expect(a.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    const before = activateAppV2("a1").activatedAt;
    pauseAppV2("a1");
    const a = activateAppV2("a1");
    expect(a.status).toBe("active");
    expect(a.activatedAt).toBe(before);
  });
  test("archive from active", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    activateAppV2("a1");
    const a = archiveAppV2("a1");
    expect(a.status).toBe("archived");
    expect(a.archivedAt).toBeTruthy();
  });
  test("archive from pending", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    const a = archiveAppV2("a1");
    expect(a.status).toBe("archived");
  });
  test("archive terminal - no transitions", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    archiveAppV2("a1");
    expect(() => activateAppV2("a1")).toThrow();
    expect(() => pauseAppV2("a1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    archiveAppV2("a1");
    expect(() => touchAppV2("a1")).toThrow();
  });
  test("getAppV2 / listAppsV2", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    registerAppV2({ id: "a2", owner: "u1" });
    expect(getAppV2("a1").id).toBe("a1");
    expect(getAppV2("nope")).toBeNull();
    expect(listAppsV2().length).toBe(2);
  });
});

describe("App Builder V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveAppsPerOwnerV2(2);
    registerAppV2({ id: "a1", owner: "u1" });
    registerAppV2({ id: "a2", owner: "u1" });
    registerAppV2({ id: "a3", owner: "u1" });
    activateAppV2("a1");
    activateAppV2("a2");
    expect(() => activateAppV2("a3")).toThrow(/max active/);
  });
  test("recovery exempt from cap", () => {
    setMaxActiveAppsPerOwnerV2(2);
    registerAppV2({ id: "a1", owner: "u1" });
    registerAppV2({ id: "a2", owner: "u1" });
    activateAppV2("a1");
    activateAppV2("a2");
    pauseAppV2("a1");
    const a = activateAppV2("a1");
    expect(a.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveAppsPerOwnerV2(1);
    registerAppV2({ id: "a1", owner: "u1" });
    registerAppV2({ id: "a2", owner: "u2" });
    activateAppV2("a1");
    activateAppV2("a2");
  });
});

describe("App Builder V2 build lifecycle", () => {
  test("create", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    const b = createAppBuildV2({ id: "b1", appId: "a1" });
    expect(b.status).toBe("queued");
    expect(b.target).toBe("web");
  });
  test("create with target", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    const b = createAppBuildV2({ id: "b1", appId: "a1", target: "android" });
    expect(b.target).toBe("android");
  });
  test("create rejects unknown app", () => {
    expect(() => createAppBuildV2({ id: "b1", appId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    expect(() => createAppBuildV2({ id: "b1", appId: "a1" })).toThrow();
  });
  test("start queued → building", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    const b = startAppBuildV2("b1");
    expect(b.status).toBe("building");
    expect(b.startedAt).toBeTruthy();
  });
  test("succeed building → succeeded", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    const b = succeedAppBuildV2("b1");
    expect(b.status).toBe("succeeded");
    expect(b.settledAt).toBeTruthy();
  });
  test("fail building → failed", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    const b = failAppBuildV2("b1", "oops");
    expect(b.status).toBe("failed");
    expect(b.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    const b = cancelAppBuildV2("b1", "abort");
    expect(b.status).toBe("cancelled");
    expect(b.metadata.cancelReason).toBe("abort");
  });
  test("cancel building → cancelled", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    const b = cancelAppBuildV2("b1");
    expect(b.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    succeedAppBuildV2("b1");
    expect(() => failAppBuildV2("b1")).toThrow();
    expect(() => cancelAppBuildV2("b1")).toThrow();
  });
  test("getAppBuildV2 / listAppBuildsV2", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    createAppBuildV2({ id: "b2", appId: "a1" });
    expect(getAppBuildV2("b1").id).toBe("b1");
    expect(getAppBuildV2("nope")).toBeNull();
    expect(listAppBuildsV2().length).toBe(2);
  });
});

describe("App Builder V2 pending build cap", () => {
  test("enforce at create", () => {
    setMaxPendingAppBuildsPerAppV2(2);
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    createAppBuildV2({ id: "b2", appId: "a1" });
    expect(() => createAppBuildV2({ id: "b3", appId: "a1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingAppBuildsPerAppV2(2);
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    createAppBuildV2({ id: "b2", appId: "a1" });
    startAppBuildV2("b1");
    succeedAppBuildV2("b1");
    createAppBuildV2({ id: "b3", appId: "a1" });
  });
  test("per-app scope", () => {
    setMaxPendingAppBuildsPerAppV2(1);
    registerAppV2({ id: "a1", owner: "u1" });
    registerAppV2({ id: "a2", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    createAppBuildV2({ id: "b2", appId: "a2" });
  });
});

describe("App Builder V2 auto flips", () => {
  test("autoPauseIdleAppsV2", () => {
    setAppIdleMsV2(100);
    registerAppV2({ id: "a1", owner: "u1" });
    activateAppV2("a1");
    const { flipped, count } = autoPauseIdleAppsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(flipped).toContain("a1");
    expect(getAppV2("a1").status).toBe("paused");
  });
  test("autoFailStuckAppBuildsV2", () => {
    setAppBuildStuckMsV2(100);
    registerAppV2({ id: "a1", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    const { flipped, count } = autoFailStuckAppBuildsV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(flipped).toContain("b1");
    expect(getAppBuildV2("b1").status).toBe("failed");
    expect(getAppBuildV2("b1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("App Builder V2 stats", () => {
  test("empty defaults", () => {
    const s = getAppBuilderGovStatsV2();
    expect(s.totalAppsV2).toBe(0);
    expect(s.totalAppBuildsV2).toBe(0);
    expect(s.appsByStatus.pending).toBe(0);
    expect(s.appsByStatus.active).toBe(0);
    expect(s.appsByStatus.paused).toBe(0);
    expect(s.appsByStatus.archived).toBe(0);
    expect(s.buildsByStatus.queued).toBe(0);
    expect(s.buildsByStatus.building).toBe(0);
    expect(s.buildsByStatus.succeeded).toBe(0);
    expect(s.buildsByStatus.failed).toBe(0);
    expect(s.buildsByStatus.cancelled).toBe(0);
  });
  test("populated counts", () => {
    registerAppV2({ id: "a1", owner: "u1" });
    activateAppV2("a1");
    registerAppV2({ id: "a2", owner: "u1" });
    createAppBuildV2({ id: "b1", appId: "a1" });
    startAppBuildV2("b1");
    const s = getAppBuilderGovStatsV2();
    expect(s.totalAppsV2).toBe(2);
    expect(s.totalAppBuildsV2).toBe(1);
    expect(s.appsByStatus.active).toBe(1);
    expect(s.appsByStatus.pending).toBe(1);
    expect(s.buildsByStatus.building).toBe(1);
  });
});
