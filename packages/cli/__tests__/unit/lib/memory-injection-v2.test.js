import { describe, test, expect, beforeEach } from "vitest";
import {
  MINJ_RULE_MATURITY_V2,
  MINJ_INJECTION_LIFECYCLE_V2,
  setMaxActiveMinjRulesPerOwnerV2,
  getMaxActiveMinjRulesPerOwnerV2,
  setMaxPendingMinjInjectionsPerRuleV2,
  getMaxPendingMinjInjectionsPerRuleV2,
  setMinjRuleIdleMsV2,
  getMinjRuleIdleMsV2,
  setMinjInjectionStuckMsV2,
  getMinjInjectionStuckMsV2,
  _resetStateMemoryInjectionV2,
  registerMinjRuleV2,
  activateMinjRuleV2,
  pauseMinjRuleV2,
  archiveMinjRuleV2,
  touchMinjRuleV2,
  getMinjRuleV2,
  listMinjRulesV2,
  createMinjInjectionV2,
  injectingMinjInjectionV2,
  applyMinjInjectionV2,
  failMinjInjectionV2,
  cancelMinjInjectionV2,
  getMinjInjectionV2,
  listMinjInjectionsV2,
  autoPauseIdleMinjRulesV2,
  autoFailStuckMinjInjectionsV2,
  getMemoryInjectionGovStatsV2,
} from "../../../src/lib/memory-injection.js";

beforeEach(() => {
  _resetStateMemoryInjectionV2();
});

describe("MemoryInjection V2 enums", () => {
  test("rule maturity", () => {
    expect(MINJ_RULE_MATURITY_V2.PENDING).toBe("pending");
    expect(MINJ_RULE_MATURITY_V2.ACTIVE).toBe("active");
    expect(MINJ_RULE_MATURITY_V2.PAUSED).toBe("paused");
    expect(MINJ_RULE_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("injection lifecycle", () => {
    expect(MINJ_INJECTION_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(MINJ_INJECTION_LIFECYCLE_V2.INJECTING).toBe("injecting");
    expect(MINJ_INJECTION_LIFECYCLE_V2.APPLIED).toBe("applied");
    expect(MINJ_INJECTION_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(MINJ_INJECTION_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(MINJ_RULE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(MINJ_INJECTION_LIFECYCLE_V2)).toBe(true);
  });
});

describe("MemoryInjection V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveMinjRulesPerOwnerV2()).toBe(10);
    expect(getMaxPendingMinjInjectionsPerRuleV2()).toBe(25);
    expect(getMinjRuleIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getMinjInjectionStuckMsV2()).toBe(30 * 1000);
  });
  test("set max active", () => {
    setMaxActiveMinjRulesPerOwnerV2(3);
    expect(getMaxActiveMinjRulesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingMinjInjectionsPerRuleV2(4);
    expect(getMaxPendingMinjInjectionsPerRuleV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setMinjRuleIdleMsV2(100);
    expect(getMinjRuleIdleMsV2()).toBe(100);
    setMinjInjectionStuckMsV2(50);
    expect(getMinjInjectionStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveMinjRulesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveMinjRulesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveMinjRulesPerOwnerV2(5.9);
    expect(getMaxActiveMinjRulesPerOwnerV2()).toBe(5);
  });
});

describe("MemoryInjection V2 rule lifecycle", () => {
  test("register", () => {
    const r = registerMinjRuleV2({ id: "r1", owner: "u1" });
    expect(r.status).toBe("pending");
    expect(r.scope).toBe("*");
  });
  test("register with scope", () => {
    const r = registerMinjRuleV2({ id: "r1", owner: "u1", scope: "system" });
    expect(r.scope).toBe("system");
  });
  test("register reject duplicate/missing", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    expect(() => registerMinjRuleV2({ id: "r1", owner: "u1" })).toThrow();
    expect(() => registerMinjRuleV2({ owner: "u1" })).toThrow();
    expect(() => registerMinjRuleV2({ id: "r1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    const r = activateMinjRuleV2("r1");
    expect(r.status).toBe("active");
    expect(r.activatedAt).toBeTruthy();
  });
  test("pause active → paused", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    activateMinjRuleV2("r1");
    const r = pauseMinjRuleV2("r1");
    expect(r.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    const before = activateMinjRuleV2("r1").activatedAt;
    pauseMinjRuleV2("r1");
    const r = activateMinjRuleV2("r1");
    expect(r.activatedAt).toBe(before);
  });
  test("archive from any non-terminal", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    const r = archiveMinjRuleV2("r1");
    expect(r.status).toBe("archived");
    expect(r.archivedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    archiveMinjRuleV2("r1");
    expect(() => activateMinjRuleV2("r1")).toThrow();
    expect(() => touchMinjRuleV2("r1")).toThrow();
  });
  test("touch updates", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    activateMinjRuleV2("r1");
    const r = touchMinjRuleV2("r1");
    expect(r.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    expect(getMinjRuleV2("r1").id).toBe("r1");
    expect(getMinjRuleV2("nope")).toBeNull();
    expect(listMinjRulesV2().length).toBe(1);
  });
});

describe("MemoryInjection V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveMinjRulesPerOwnerV2(2);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    registerMinjRuleV2({ id: "r2", owner: "u1" });
    registerMinjRuleV2({ id: "r3", owner: "u1" });
    activateMinjRuleV2("r1");
    activateMinjRuleV2("r2");
    expect(() => activateMinjRuleV2("r3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveMinjRulesPerOwnerV2(2);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    registerMinjRuleV2({ id: "r2", owner: "u1" });
    activateMinjRuleV2("r1");
    activateMinjRuleV2("r2");
    pauseMinjRuleV2("r1");
    const r = activateMinjRuleV2("r1");
    expect(r.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveMinjRulesPerOwnerV2(1);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    registerMinjRuleV2({ id: "r2", owner: "u2" });
    activateMinjRuleV2("r1");
    activateMinjRuleV2("r2");
  });
});

describe("MemoryInjection V2 injection lifecycle", () => {
  test("create", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    const i = createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    expect(i.status).toBe("queued");
    expect(i.payload).toBe("");
  });
  test("create with payload", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    const i = createMinjInjectionV2({ id: "i1", ruleId: "r1", payload: "x" });
    expect(i.payload).toBe("x");
  });
  test("create rejects unknown rule/duplicate", () => {
    expect(() => createMinjInjectionV2({ id: "i1", ruleId: "nope" })).toThrow();
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    expect(() => createMinjInjectionV2({ id: "i1", ruleId: "r1" })).toThrow();
  });
  test("injecting queued → injecting", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    const i = injectingMinjInjectionV2("i1");
    expect(i.status).toBe("injecting");
    expect(i.startedAt).toBeTruthy();
  });
  test("apply injecting → applied", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    const i = applyMinjInjectionV2("i1");
    expect(i.status).toBe("applied");
    expect(i.settledAt).toBeTruthy();
  });
  test("fail injecting → failed", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    const i = failMinjInjectionV2("i1", "err");
    expect(i.status).toBe("failed");
    expect(i.metadata.failReason).toBe("err");
  });
  test("cancel queued/injecting → cancelled", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    cancelMinjInjectionV2("i1", "abort");
    createMinjInjectionV2({ id: "i2", ruleId: "r1" });
    injectingMinjInjectionV2("i2");
    const i = cancelMinjInjectionV2("i2");
    expect(i.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    applyMinjInjectionV2("i1");
    expect(() => failMinjInjectionV2("i1")).toThrow();
  });
  test("get / list", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    expect(getMinjInjectionV2("i1").id).toBe("i1");
    expect(getMinjInjectionV2("nope")).toBeNull();
    expect(listMinjInjectionsV2().length).toBe(1);
  });
});

describe("MemoryInjection V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingMinjInjectionsPerRuleV2(2);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    createMinjInjectionV2({ id: "i2", ruleId: "r1" });
    expect(() => createMinjInjectionV2({ id: "i3", ruleId: "r1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingMinjInjectionsPerRuleV2(2);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    createMinjInjectionV2({ id: "i2", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    applyMinjInjectionV2("i1");
    createMinjInjectionV2({ id: "i3", ruleId: "r1" });
  });
});

describe("MemoryInjection V2 auto flips", () => {
  test("autoPauseIdleMinjRulesV2", () => {
    setMinjRuleIdleMsV2(100);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    activateMinjRuleV2("r1");
    const { count } = autoPauseIdleMinjRulesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getMinjRuleV2("r1").status).toBe("paused");
  });
  test("autoFailStuckMinjInjectionsV2", () => {
    setMinjInjectionStuckMsV2(100);
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    const { count } = autoFailStuckMinjInjectionsV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getMinjInjectionV2("i1").status).toBe("failed");
    expect(getMinjInjectionV2("i1").metadata.failReason).toBe(
      "auto-fail-stuck",
    );
  });
});

describe("MemoryInjection V2 stats", () => {
  test("empty defaults", () => {
    const s = getMemoryInjectionGovStatsV2();
    expect(s.totalMinjRulesV2).toBe(0);
    expect(s.totalMinjInjectionsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "archived"])
      expect(s.rulesByStatus[k]).toBe(0);
    for (const k of ["queued", "injecting", "applied", "failed", "cancelled"])
      expect(s.injectionsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerMinjRuleV2({ id: "r1", owner: "u1" });
    activateMinjRuleV2("r1");
    createMinjInjectionV2({ id: "i1", ruleId: "r1" });
    injectingMinjInjectionV2("i1");
    const s = getMemoryInjectionGovStatsV2();
    expect(s.rulesByStatus.active).toBe(1);
    expect(s.injectionsByStatus.injecting).toBe(1);
  });
});
