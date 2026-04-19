import { describe, test, expect, beforeEach } from "vitest";
import {
  PERM_RULE_MATURITY_V2, PERM_CHECK_LIFECYCLE_V2,
  setMaxActivePermRulesPerOwnerV2, getMaxActivePermRulesPerOwnerV2,
  setMaxPendingPermChecksPerRuleV2, getMaxPendingPermChecksPerRuleV2,
  setPermRuleIdleMsV2, getPermRuleIdleMsV2,
  setPermCheckStuckMsV2, getPermCheckStuckMsV2,
  _resetStatePermissionEngineV2,
  registerPermRuleV2, activatePermRuleV2, disablePermRuleV2, retirePermRuleV2, touchPermRuleV2, getPermRuleV2, listPermRulesV2,
  createPermCheckV2, evaluatePermCheckV2, allowPermCheckV2, denyPermCheckV2, cancelPermCheckV2, getPermCheckV2, listPermChecksV2,
  autoDisableIdlePermRulesV2, autoDenyStuckPermChecksV2,
  getPermissionEngineGovStatsV2,
} from "../../../src/lib/permission-engine.js";

beforeEach(() => { _resetStatePermissionEngineV2(); });

describe("PermissionEngine V2 enums", () => {
  test("rule maturity", () => { expect(PERM_RULE_MATURITY_V2.PENDING).toBe("pending"); expect(PERM_RULE_MATURITY_V2.ACTIVE).toBe("active"); expect(PERM_RULE_MATURITY_V2.DISABLED).toBe("disabled"); expect(PERM_RULE_MATURITY_V2.RETIRED).toBe("retired"); });
  test("check lifecycle", () => { expect(PERM_CHECK_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(PERM_CHECK_LIFECYCLE_V2.EVALUATING).toBe("evaluating"); expect(PERM_CHECK_LIFECYCLE_V2.ALLOWED).toBe("allowed"); expect(PERM_CHECK_LIFECYCLE_V2.DENIED).toBe("denied"); expect(PERM_CHECK_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(PERM_RULE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(PERM_CHECK_LIFECYCLE_V2)).toBe(true); });
});

describe("PermissionEngine V2 config", () => {
  test("defaults", () => { expect(getMaxActivePermRulesPerOwnerV2()).toBe(10); expect(getMaxPendingPermChecksPerRuleV2()).toBe(30); expect(getPermRuleIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000); expect(getPermCheckStuckMsV2()).toBe(60 * 1000); });
  test("set max active", () => { setMaxActivePermRulesPerOwnerV2(3); expect(getMaxActivePermRulesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingPermChecksPerRuleV2(4); expect(getMaxPendingPermChecksPerRuleV2()).toBe(4); });
  test("set idle ms", () => { setPermRuleIdleMsV2(100); expect(getPermRuleIdleMsV2()).toBe(100); });
  test("set stuck ms", () => { setPermCheckStuckMsV2(50); expect(getPermCheckStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActivePermRulesPerOwnerV2(0)).toThrow(); expect(() => setMaxActivePermRulesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActivePermRulesPerOwnerV2(5.9); expect(getMaxActivePermRulesPerOwnerV2()).toBe(5); });
});

describe("PermissionEngine V2 rule lifecycle", () => {
  test("register", () => { const r = registerPermRuleV2({ id: "r1", owner: "u1" }); expect(r.status).toBe("pending"); expect(r.scope).toBe("*"); });
  test("register with scope", () => { const r = registerPermRuleV2({ id: "r1", owner: "u1", scope: "fs.read" }); expect(r.scope).toBe("fs.read"); });
  test("register reject duplicate/missing", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); expect(() => registerPermRuleV2({ id: "r1", owner: "u1" })).toThrow(); expect(() => registerPermRuleV2({ owner: "u1" })).toThrow(); expect(() => registerPermRuleV2({ id: "r1" })).toThrow(); });
  test("activate pending → active", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); const r = activatePermRuleV2("r1"); expect(r.status).toBe("active"); expect(r.activatedAt).toBeTruthy(); });
  test("disable active → disabled", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); activatePermRuleV2("r1"); const r = disablePermRuleV2("r1"); expect(r.status).toBe("disabled"); });
  test("activate disabled → active (recovery)", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); const before = activatePermRuleV2("r1").activatedAt; disablePermRuleV2("r1"); const r = activatePermRuleV2("r1"); expect(r.activatedAt).toBe(before); });
  test("retire from pending/active/disabled", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); const r = retirePermRuleV2("r1"); expect(r.status).toBe("retired"); expect(r.retiredAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); retirePermRuleV2("r1"); expect(() => activatePermRuleV2("r1")).toThrow(); expect(() => touchPermRuleV2("r1")).toThrow(); });
  test("touch updates", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); activatePermRuleV2("r1"); const r = touchPermRuleV2("r1"); expect(r.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); expect(getPermRuleV2("r1").id).toBe("r1"); expect(getPermRuleV2("nope")).toBeNull(); expect(listPermRulesV2().length).toBe(1); });
});

describe("PermissionEngine V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActivePermRulesPerOwnerV2(2);
    registerPermRuleV2({ id: "r1", owner: "u1" }); registerPermRuleV2({ id: "r2", owner: "u1" }); registerPermRuleV2({ id: "r3", owner: "u1" });
    activatePermRuleV2("r1"); activatePermRuleV2("r2");
    expect(() => activatePermRuleV2("r3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActivePermRulesPerOwnerV2(2);
    registerPermRuleV2({ id: "r1", owner: "u1" }); registerPermRuleV2({ id: "r2", owner: "u1" });
    activatePermRuleV2("r1"); activatePermRuleV2("r2"); disablePermRuleV2("r1");
    const r = activatePermRuleV2("r1"); expect(r.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActivePermRulesPerOwnerV2(1);
    registerPermRuleV2({ id: "r1", owner: "u1" }); registerPermRuleV2({ id: "r2", owner: "u2" });
    activatePermRuleV2("r1"); activatePermRuleV2("r2");
  });
});

describe("PermissionEngine V2 check lifecycle", () => {
  test("create", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); const c = createPermCheckV2({ id: "c1", ruleId: "r1" }); expect(c.status).toBe("queued"); expect(c.subject).toBe(""); });
  test("create with subject", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); const c = createPermCheckV2({ id: "c1", ruleId: "r1", subject: "alice" }); expect(c.subject).toBe("alice"); });
  test("create rejects unknown rule/duplicate", () => { expect(() => createPermCheckV2({ id: "c1", ruleId: "nope" })).toThrow(); registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); expect(() => createPermCheckV2({ id: "c1", ruleId: "r1" })).toThrow(); });
  test("evaluate queued → evaluating", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); const c = evaluatePermCheckV2("c1"); expect(c.status).toBe("evaluating"); expect(c.startedAt).toBeTruthy(); });
  test("allow evaluating → allowed", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); evaluatePermCheckV2("c1"); const c = allowPermCheckV2("c1"); expect(c.status).toBe("allowed"); expect(c.settledAt).toBeTruthy(); });
  test("deny evaluating → denied", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); evaluatePermCheckV2("c1"); const c = denyPermCheckV2("c1", "no"); expect(c.status).toBe("denied"); expect(c.metadata.denyReason).toBe("no"); });
  test("cancel queued/evaluating → cancelled", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); cancelPermCheckV2("c1", "abort"); createPermCheckV2({ id: "c2", ruleId: "r1" }); evaluatePermCheckV2("c2"); const c = cancelPermCheckV2("c2"); expect(c.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); evaluatePermCheckV2("c1"); allowPermCheckV2("c1"); expect(() => denyPermCheckV2("c1")).toThrow(); });
  test("get / list", () => { registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); expect(getPermCheckV2("c1").id).toBe("c1"); expect(getPermCheckV2("nope")).toBeNull(); expect(listPermChecksV2().length).toBe(1); });
});

describe("PermissionEngine V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingPermChecksPerRuleV2(2);
    registerPermRuleV2({ id: "r1", owner: "u1" });
    createPermCheckV2({ id: "c1", ruleId: "r1" }); createPermCheckV2({ id: "c2", ruleId: "r1" });
    expect(() => createPermCheckV2({ id: "c3", ruleId: "r1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingPermChecksPerRuleV2(2);
    registerPermRuleV2({ id: "r1", owner: "u1" });
    createPermCheckV2({ id: "c1", ruleId: "r1" }); createPermCheckV2({ id: "c2", ruleId: "r1" });
    evaluatePermCheckV2("c1"); allowPermCheckV2("c1");
    createPermCheckV2({ id: "c3", ruleId: "r1" });
  });
});

describe("PermissionEngine V2 auto flips", () => {
  test("autoDisableIdlePermRulesV2", () => {
    setPermRuleIdleMsV2(100);
    registerPermRuleV2({ id: "r1", owner: "u1" }); activatePermRuleV2("r1");
    const { count } = autoDisableIdlePermRulesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getPermRuleV2("r1").status).toBe("disabled");
  });
  test("autoDenyStuckPermChecksV2", () => {
    setPermCheckStuckMsV2(100);
    registerPermRuleV2({ id: "r1", owner: "u1" }); createPermCheckV2({ id: "c1", ruleId: "r1" }); evaluatePermCheckV2("c1");
    const { count } = autoDenyStuckPermChecksV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getPermCheckV2("c1").status).toBe("denied"); expect(getPermCheckV2("c1").metadata.denyReason).toBe("auto-deny-stuck");
  });
});

describe("PermissionEngine V2 stats", () => {
  test("empty defaults", () => {
    const s = getPermissionEngineGovStatsV2();
    expect(s.totalPermRulesV2).toBe(0); expect(s.totalPermChecksV2).toBe(0);
    for (const k of ["pending", "active", "disabled", "retired"]) expect(s.rulesByStatus[k]).toBe(0);
    for (const k of ["queued", "evaluating", "allowed", "denied", "cancelled"]) expect(s.checksByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerPermRuleV2({ id: "r1", owner: "u1" }); activatePermRuleV2("r1");
    createPermCheckV2({ id: "c1", ruleId: "r1" }); evaluatePermCheckV2("c1");
    const s = getPermissionEngineGovStatsV2();
    expect(s.rulesByStatus.active).toBe(1); expect(s.checksByStatus.evaluating).toBe(1);
  });
});
