import { describe, test, expect, beforeEach } from "vitest";
import {
  SVC_CONTAINER_MATURITY_V2, SVC_RESOLUTION_LIFECYCLE_V2,
  setMaxActiveSvcContainersPerOwnerV2, getMaxActiveSvcContainersPerOwnerV2,
  setMaxPendingSvcResolutionsPerContainerV2, getMaxPendingSvcResolutionsPerContainerV2,
  setSvcContainerIdleMsV2, getSvcContainerIdleMsV2,
  setSvcResolutionStuckMsV2, getSvcResolutionStuckMsV2,
  _resetStateServiceContainerV2,
  registerSvcContainerV2, activateSvcContainerV2, degradeSvcContainerV2, decommissionSvcContainerV2, touchSvcContainerV2, getSvcContainerV2, listSvcContainersV2,
  createSvcResolutionV2, resolvingSvcResolutionV2, resolveSvcResolutionV2, failSvcResolutionV2, cancelSvcResolutionV2, getSvcResolutionV2, listSvcResolutionsV2,
  autoDegradeIdleSvcContainersV2, autoFailStuckSvcResolutionsV2,
  getServiceContainerGovStatsV2,
} from "../../../src/lib/service-container.js";

beforeEach(() => { _resetStateServiceContainerV2(); });

describe("ServiceContainer V2 enums", () => {
  test("container maturity", () => { expect(SVC_CONTAINER_MATURITY_V2.PENDING).toBe("pending"); expect(SVC_CONTAINER_MATURITY_V2.ACTIVE).toBe("active"); expect(SVC_CONTAINER_MATURITY_V2.DEGRADED).toBe("degraded"); expect(SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED).toBe("decommissioned"); });
  test("resolution lifecycle", () => { expect(SVC_RESOLUTION_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING).toBe("resolving"); expect(SVC_RESOLUTION_LIFECYCLE_V2.RESOLVED).toBe("resolved"); expect(SVC_RESOLUTION_LIFECYCLE_V2.FAILED).toBe("failed"); expect(SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(SVC_CONTAINER_MATURITY_V2)).toBe(true); expect(Object.isFrozen(SVC_RESOLUTION_LIFECYCLE_V2)).toBe(true); });
});

describe("ServiceContainer V2 config", () => {
  test("defaults", () => { expect(getMaxActiveSvcContainersPerOwnerV2()).toBe(8); expect(getMaxPendingSvcResolutionsPerContainerV2()).toBe(25); expect(getSvcContainerIdleMsV2()).toBe(60 * 60 * 1000); expect(getSvcResolutionStuckMsV2()).toBe(30 * 1000); });
  test("set max active", () => { setMaxActiveSvcContainersPerOwnerV2(3); expect(getMaxActiveSvcContainersPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingSvcResolutionsPerContainerV2(4); expect(getMaxPendingSvcResolutionsPerContainerV2()).toBe(4); });
  test("set idle/stuck ms", () => { setSvcContainerIdleMsV2(100); expect(getSvcContainerIdleMsV2()).toBe(100); setSvcResolutionStuckMsV2(50); expect(getSvcResolutionStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveSvcContainersPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveSvcContainersPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveSvcContainersPerOwnerV2(5.9); expect(getMaxActiveSvcContainersPerOwnerV2()).toBe(5); });
});

describe("ServiceContainer V2 container lifecycle", () => {
  test("register", () => { const c = registerSvcContainerV2({ id: "c1", owner: "u1" }); expect(c.status).toBe("pending"); expect(c.scope).toBe("default"); });
  test("register with scope", () => { const c = registerSvcContainerV2({ id: "c1", owner: "u1", scope: "test" }); expect(c.scope).toBe("test"); });
  test("register reject duplicate/missing", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); expect(() => registerSvcContainerV2({ id: "c1", owner: "u1" })).toThrow(); expect(() => registerSvcContainerV2({ owner: "u1" })).toThrow(); expect(() => registerSvcContainerV2({ id: "c1" })).toThrow(); });
  test("activate pending → active", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); const c = activateSvcContainerV2("c1"); expect(c.status).toBe("active"); expect(c.activatedAt).toBeTruthy(); });
  test("degrade active → degraded", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); activateSvcContainerV2("c1"); const c = degradeSvcContainerV2("c1"); expect(c.status).toBe("degraded"); });
  test("activate degraded → active (recovery)", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); const before = activateSvcContainerV2("c1").activatedAt; degradeSvcContainerV2("c1"); const c = activateSvcContainerV2("c1"); expect(c.activatedAt).toBe(before); });
  test("decommission from any non-terminal", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); const c = decommissionSvcContainerV2("c1"); expect(c.status).toBe("decommissioned"); expect(c.decommissionedAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); decommissionSvcContainerV2("c1"); expect(() => activateSvcContainerV2("c1")).toThrow(); expect(() => touchSvcContainerV2("c1")).toThrow(); });
  test("touch updates", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); activateSvcContainerV2("c1"); const c = touchSvcContainerV2("c1"); expect(c.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); expect(getSvcContainerV2("c1").id).toBe("c1"); expect(getSvcContainerV2("nope")).toBeNull(); expect(listSvcContainersV2().length).toBe(1); });
});

describe("ServiceContainer V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSvcContainersPerOwnerV2(2);
    registerSvcContainerV2({ id: "c1", owner: "u1" }); registerSvcContainerV2({ id: "c2", owner: "u1" }); registerSvcContainerV2({ id: "c3", owner: "u1" });
    activateSvcContainerV2("c1"); activateSvcContainerV2("c2");
    expect(() => activateSvcContainerV2("c3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSvcContainersPerOwnerV2(2);
    registerSvcContainerV2({ id: "c1", owner: "u1" }); registerSvcContainerV2({ id: "c2", owner: "u1" });
    activateSvcContainerV2("c1"); activateSvcContainerV2("c2"); degradeSvcContainerV2("c1");
    const c = activateSvcContainerV2("c1"); expect(c.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveSvcContainersPerOwnerV2(1);
    registerSvcContainerV2({ id: "c1", owner: "u1" }); registerSvcContainerV2({ id: "c2", owner: "u2" });
    activateSvcContainerV2("c1"); activateSvcContainerV2("c2");
  });
});

describe("ServiceContainer V2 resolution lifecycle", () => {
  test("create", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); const r = createSvcResolutionV2({ id: "r1", containerId: "c1" }); expect(r.status).toBe("queued"); expect(r.token).toBe(""); });
  test("create with token", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); const r = createSvcResolutionV2({ id: "r1", containerId: "c1", token: "Logger" }); expect(r.token).toBe("Logger"); });
  test("create rejects unknown container/duplicate", () => { expect(() => createSvcResolutionV2({ id: "r1", containerId: "nope" })).toThrow(); registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); expect(() => createSvcResolutionV2({ id: "r1", containerId: "c1" })).toThrow(); });
  test("resolving queued → resolving", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); const r = resolvingSvcResolutionV2("r1"); expect(r.status).toBe("resolving"); expect(r.startedAt).toBeTruthy(); });
  test("resolve resolving → resolved", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); resolvingSvcResolutionV2("r1"); const r = resolveSvcResolutionV2("r1"); expect(r.status).toBe("resolved"); expect(r.settledAt).toBeTruthy(); });
  test("fail resolving → failed", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); resolvingSvcResolutionV2("r1"); const r = failSvcResolutionV2("r1", "err"); expect(r.status).toBe("failed"); expect(r.metadata.failReason).toBe("err"); });
  test("cancel queued/resolving → cancelled", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); cancelSvcResolutionV2("r1", "abort"); createSvcResolutionV2({ id: "r2", containerId: "c1" }); resolvingSvcResolutionV2("r2"); const r = cancelSvcResolutionV2("r2"); expect(r.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); resolvingSvcResolutionV2("r1"); resolveSvcResolutionV2("r1"); expect(() => failSvcResolutionV2("r1")).toThrow(); });
  test("get / list", () => { registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); expect(getSvcResolutionV2("r1").id).toBe("r1"); expect(getSvcResolutionV2("nope")).toBeNull(); expect(listSvcResolutionsV2().length).toBe(1); });
});

describe("ServiceContainer V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingSvcResolutionsPerContainerV2(2);
    registerSvcContainerV2({ id: "c1", owner: "u1" });
    createSvcResolutionV2({ id: "r1", containerId: "c1" }); createSvcResolutionV2({ id: "r2", containerId: "c1" });
    expect(() => createSvcResolutionV2({ id: "r3", containerId: "c1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingSvcResolutionsPerContainerV2(2);
    registerSvcContainerV2({ id: "c1", owner: "u1" });
    createSvcResolutionV2({ id: "r1", containerId: "c1" }); createSvcResolutionV2({ id: "r2", containerId: "c1" });
    resolvingSvcResolutionV2("r1"); resolveSvcResolutionV2("r1");
    createSvcResolutionV2({ id: "r3", containerId: "c1" });
  });
});

describe("ServiceContainer V2 auto flips", () => {
  test("autoDegradeIdleSvcContainersV2", () => {
    setSvcContainerIdleMsV2(100);
    registerSvcContainerV2({ id: "c1", owner: "u1" }); activateSvcContainerV2("c1");
    const { count } = autoDegradeIdleSvcContainersV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSvcContainerV2("c1").status).toBe("degraded");
  });
  test("autoFailStuckSvcResolutionsV2", () => {
    setSvcResolutionStuckMsV2(100);
    registerSvcContainerV2({ id: "c1", owner: "u1" }); createSvcResolutionV2({ id: "r1", containerId: "c1" }); resolvingSvcResolutionV2("r1");
    const { count } = autoFailStuckSvcResolutionsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSvcResolutionV2("r1").status).toBe("failed"); expect(getSvcResolutionV2("r1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("ServiceContainer V2 stats", () => {
  test("empty defaults", () => {
    const s = getServiceContainerGovStatsV2();
    expect(s.totalSvcContainersV2).toBe(0); expect(s.totalSvcResolutionsV2).toBe(0);
    for (const k of ["pending", "active", "degraded", "decommissioned"]) expect(s.containersByStatus[k]).toBe(0);
    for (const k of ["queued", "resolving", "resolved", "failed", "cancelled"]) expect(s.resolutionsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSvcContainerV2({ id: "c1", owner: "u1" }); activateSvcContainerV2("c1");
    createSvcResolutionV2({ id: "r1", containerId: "c1" }); resolvingSvcResolutionV2("r1");
    const s = getServiceContainerGovStatsV2();
    expect(s.containersByStatus.active).toBe(1); expect(s.resolutionsByStatus.resolving).toBe(1);
  });
});
