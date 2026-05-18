import { describe, test, expect, beforeEach } from "vitest";
import {
  MSCAF_PROFILE_MATURITY_V2,
  MSCAF_GENERATION_LIFECYCLE_V2,
  setMaxActiveMscafProfilesPerOwnerV2,
  getMaxActiveMscafProfilesPerOwnerV2,
  setMaxPendingMscafGenerationsPerProfileV2,
  getMaxPendingMscafGenerationsPerProfileV2,
  setMscafProfileIdleMsV2,
  getMscafProfileIdleMsV2,
  setMscafGenerationStuckMsV2,
  getMscafGenerationStuckMsV2,
  _resetStateMcpScaffoldV2,
  registerMscafProfileV2,
  activateMscafProfileV2,
  staleMscafProfileV2,
  archiveMscafProfileV2,
  touchMscafProfileV2,
  getMscafProfileV2,
  listMscafProfilesV2,
  createMscafGenerationV2,
  generatingMscafGenerationV2,
  generateMscafGenerationV2,
  failMscafGenerationV2,
  cancelMscafGenerationV2,
  getMscafGenerationV2,
  listMscafGenerationsV2,
  autoStaleIdleMscafProfilesV2,
  autoFailStuckMscafGenerationsV2,
  getMcpScaffoldGovStatsV2,
} from "../../../src/lib/mcp-scaffold.js";

beforeEach(() => {
  _resetStateMcpScaffoldV2();
});

describe("McpScaffold V2 enums", () => {
  test("profile maturity", () => {
    expect(MSCAF_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(MSCAF_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(MSCAF_PROFILE_MATURITY_V2.STALE).toBe("stale");
    expect(MSCAF_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("generation lifecycle", () => {
    expect(MSCAF_GENERATION_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(MSCAF_GENERATION_LIFECYCLE_V2.GENERATING).toBe("generating");
    expect(MSCAF_GENERATION_LIFECYCLE_V2.GENERATED).toBe("generated");
    expect(MSCAF_GENERATION_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(MSCAF_GENERATION_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(MSCAF_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(MSCAF_GENERATION_LIFECYCLE_V2)).toBe(true);
  });
});

describe("McpScaffold V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveMscafProfilesPerOwnerV2()).toBe(6);
    expect(getMaxPendingMscafGenerationsPerProfileV2()).toBe(15);
    expect(getMscafProfileIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getMscafGenerationStuckMsV2()).toBe(60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveMscafProfilesPerOwnerV2(3);
    expect(getMaxActiveMscafProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingMscafGenerationsPerProfileV2(4);
    expect(getMaxPendingMscafGenerationsPerProfileV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setMscafProfileIdleMsV2(100);
    expect(getMscafProfileIdleMsV2()).toBe(100);
    setMscafGenerationStuckMsV2(50);
    expect(getMscafGenerationStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveMscafProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveMscafProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveMscafProfilesPerOwnerV2(5.9);
    expect(getMaxActiveMscafProfilesPerOwnerV2()).toBe(5);
  });
});

describe("McpScaffold V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerMscafProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.transport).toBe("stdio");
  });
  test("register with transport", () => {
    const p = registerMscafProfileV2({
      id: "p1",
      owner: "u1",
      transport: "http",
    });
    expect(p.transport).toBe("http");
  });
  test("register reject duplicate/missing", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    expect(() => registerMscafProfileV2({ id: "p1", owner: "u1" })).toThrow();
    expect(() => registerMscafProfileV2({ owner: "u1" })).toThrow();
    expect(() => registerMscafProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    const p = activateMscafProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("stale active → stale", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    const p = staleMscafProfileV2("p1");
    expect(p.status).toBe("stale");
  });
  test("activate stale → active (recovery)", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    const before = activateMscafProfileV2("p1").activatedAt;
    staleMscafProfileV2("p1");
    const p = activateMscafProfileV2("p1");
    expect(p.activatedAt).toBe(before);
  });
  test("archive from any non-terminal", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    const p = archiveMscafProfileV2("p1");
    expect(p.status).toBe("archived");
    expect(p.archivedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    archiveMscafProfileV2("p1");
    expect(() => activateMscafProfileV2("p1")).toThrow();
    expect(() => touchMscafProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    const p = touchMscafProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    expect(getMscafProfileV2("p1").id).toBe("p1");
    expect(getMscafProfileV2("nope")).toBeNull();
    expect(listMscafProfilesV2().length).toBe(1);
  });
});

describe("McpScaffold V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveMscafProfilesPerOwnerV2(2);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    registerMscafProfileV2({ id: "p2", owner: "u1" });
    registerMscafProfileV2({ id: "p3", owner: "u1" });
    activateMscafProfileV2("p1");
    activateMscafProfileV2("p2");
    expect(() => activateMscafProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveMscafProfilesPerOwnerV2(1);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    registerMscafProfileV2({ id: "p2", owner: "u1" });
    activateMscafProfileV2("p1");
    staleMscafProfileV2("p1");
    activateMscafProfileV2("p2");
    expect(() => activateMscafProfileV2("p1")).not.toThrow();
  });
  test("per-owner isolation", () => {
    setMaxActiveMscafProfilesPerOwnerV2(1);
    registerMscafProfileV2({ id: "a", owner: "u1" });
    registerMscafProfileV2({ id: "b", owner: "u2" });
    activateMscafProfileV2("a");
    expect(() => activateMscafProfileV2("b")).not.toThrow();
  });
});

describe("McpScaffold V2 generation lifecycle", () => {
  beforeEach(() => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
  });
  test("create queued", () => {
    const g = createMscafGenerationV2({
      id: "g1",
      profileId: "p1",
      target: "./out",
    });
    expect(g.status).toBe("queued");
    expect(g.target).toBe("./out");
  });
  test("create reject duplicate/unknown", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    expect(() =>
      createMscafGenerationV2({ id: "g1", profileId: "p1" }),
    ).toThrow();
    expect(() =>
      createMscafGenerationV2({ id: "g2", profileId: "nope" }),
    ).toThrow();
  });
  test("queued → generating", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    const g = generatingMscafGenerationV2("g1");
    expect(g.status).toBe("generating");
    expect(g.startedAt).toBeTruthy();
  });
  test("generating → generated", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    const g = generateMscafGenerationV2("g1");
    expect(g.status).toBe("generated");
    expect(g.settledAt).toBeTruthy();
  });
  test("generating → failed", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    const g = failMscafGenerationV2("g1", "x");
    expect(g.status).toBe("failed");
    expect(g.metadata.failReason).toBe("x");
  });
  test("queued → cancelled", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    const g = cancelMscafGenerationV2("g1", "y");
    expect(g.status).toBe("cancelled");
    expect(g.metadata.cancelReason).toBe("y");
  });
  test("terminal blocks", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    generateMscafGenerationV2("g1");
    expect(() => failMscafGenerationV2("g1")).toThrow();
  });
  test("invalid transition", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    expect(() => generateMscafGenerationV2("g1")).toThrow();
  });
  test("get / list", () => {
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    expect(getMscafGenerationV2("g1").id).toBe("g1");
    expect(getMscafGenerationV2("nope")).toBeNull();
    expect(listMscafGenerationsV2().length).toBe(1);
  });
});

describe("McpScaffold V2 pending cap", () => {
  test("enforce", () => {
    setMaxPendingMscafGenerationsPerProfileV2(2);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    createMscafGenerationV2({ id: "g2", profileId: "p1" });
    expect(() =>
      createMscafGenerationV2({ id: "g3", profileId: "p1" }),
    ).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingMscafGenerationsPerProfileV2(1);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    generateMscafGenerationV2("g1");
    expect(() =>
      createMscafGenerationV2({ id: "g2", profileId: "p1" }),
    ).not.toThrow();
  });
});

describe("McpScaffold V2 auto flips", () => {
  test("auto-stale-idle profiles", () => {
    setMscafProfileIdleMsV2(100);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    const p = getMscafProfileV2("p1");
    const r = autoStaleIdleMscafProfilesV2({ now: p.lastTouchedAt + 200 });
    expect(r.flipped).toContain("p1");
    expect(getMscafProfileV2("p1").status).toBe("stale");
  });
  test("auto-fail-stuck generations", () => {
    setMscafGenerationStuckMsV2(50);
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    const g = getMscafGenerationV2("g1");
    const r = autoFailStuckMscafGenerationsV2({ now: g.startedAt + 100 });
    expect(r.flipped).toContain("g1");
    expect(getMscafGenerationV2("g1").status).toBe("failed");
    expect(getMscafGenerationV2("g1").metadata.failReason).toBe(
      "auto-fail-stuck",
    );
  });
});

describe("McpScaffold V2 stats", () => {
  test("zero-init keys", () => {
    const s = getMcpScaffoldGovStatsV2();
    expect(s.totalMscafProfilesV2).toBe(0);
    expect(s.totalMscafGenerationsV2).toBe(0);
    expect(s.maxActiveMscafProfilesPerOwner).toBe(6);
    expect(s.maxPendingMscafGenerationsPerProfile).toBe(15);
    for (const v of Object.values(MSCAF_PROFILE_MATURITY_V2))
      expect(s.profilesByStatus[v]).toBe(0);
    for (const v of Object.values(MSCAF_GENERATION_LIFECYCLE_V2))
      expect(s.generationsByStatus[v]).toBe(0);
  });
  test("counts after activity", () => {
    registerMscafProfileV2({ id: "p1", owner: "u1" });
    activateMscafProfileV2("p1");
    createMscafGenerationV2({ id: "g1", profileId: "p1" });
    generatingMscafGenerationV2("g1");
    const s = getMcpScaffoldGovStatsV2();
    expect(s.totalMscafProfilesV2).toBe(1);
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.totalMscafGenerationsV2).toBe(1);
    expect(s.generationsByStatus.generating).toBe(1);
  });
});
