import { describe, test, expect, beforeEach } from "vitest";
import {
  SUSE_BUDGET_MATURITY_V2,
  SUSE_RECORD_LIFECYCLE_V2,
  setMaxActiveSuseBudgetsPerOwnerV2,
  getMaxActiveSuseBudgetsPerOwnerV2,
  setMaxPendingSuseRecordsPerBudgetV2,
  getMaxPendingSuseRecordsPerBudgetV2,
  setSuseBudgetIdleMsV2,
  getSuseBudgetIdleMsV2,
  setSuseRecordStuckMsV2,
  getSuseRecordStuckMsV2,
  _resetStateSessionUsageV2,
  registerSuseBudgetV2,
  activateSuseBudgetV2,
  exhaustSuseBudgetV2,
  archiveSuseBudgetV2,
  touchSuseBudgetV2,
  getSuseBudgetV2,
  listSuseBudgetsV2,
  createSuseRecordV2,
  recordingSuseRecordV2,
  recordSuseRecordV2,
  rejectSuseRecordV2,
  cancelSuseRecordV2,
  getSuseRecordV2,
  listSuseRecordsV2,
  autoExhaustIdleSuseBudgetsV2,
  autoRejectStuckSuseRecordsV2,
  getSessionUsageGovStatsV2,
} from "../../../src/lib/session-usage.js";

beforeEach(() => {
  _resetStateSessionUsageV2();
});

describe("SessionUsage V2 enums", () => {
  test("budget maturity", () => {
    expect(SUSE_BUDGET_MATURITY_V2.PENDING).toBe("pending");
    expect(SUSE_BUDGET_MATURITY_V2.ACTIVE).toBe("active");
    expect(SUSE_BUDGET_MATURITY_V2.EXHAUSTED).toBe("exhausted");
    expect(SUSE_BUDGET_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("record lifecycle", () => {
    expect(SUSE_RECORD_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(SUSE_RECORD_LIFECYCLE_V2.RECORDING).toBe("recording");
    expect(SUSE_RECORD_LIFECYCLE_V2.RECORDED).toBe("recorded");
    expect(SUSE_RECORD_LIFECYCLE_V2.REJECTED).toBe("rejected");
    expect(SUSE_RECORD_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(SUSE_BUDGET_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(SUSE_RECORD_LIFECYCLE_V2)).toBe(true);
  });
});

describe("SessionUsage V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveSuseBudgetsPerOwnerV2()).toBe(5);
    expect(getMaxPendingSuseRecordsPerBudgetV2()).toBe(50);
    expect(getSuseBudgetIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getSuseRecordStuckMsV2()).toBe(30 * 1000);
  });
  test("set max active", () => {
    setMaxActiveSuseBudgetsPerOwnerV2(3);
    expect(getMaxActiveSuseBudgetsPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingSuseRecordsPerBudgetV2(4);
    expect(getMaxPendingSuseRecordsPerBudgetV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setSuseBudgetIdleMsV2(100);
    expect(getSuseBudgetIdleMsV2()).toBe(100);
    setSuseRecordStuckMsV2(50);
    expect(getSuseRecordStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveSuseBudgetsPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveSuseBudgetsPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveSuseBudgetsPerOwnerV2(5.9);
    expect(getMaxActiveSuseBudgetsPerOwnerV2()).toBe(5);
  });
});

describe("SessionUsage V2 budget lifecycle", () => {
  test("register", () => {
    const b = registerSuseBudgetV2({ id: "b1", owner: "u1" });
    expect(b.status).toBe("pending");
    expect(b.limit).toBe(1000);
  });
  test("register with limit", () => {
    const b = registerSuseBudgetV2({ id: "b1", owner: "u1", limit: 500 });
    expect(b.limit).toBe(500);
  });
  test("register reject duplicate/missing", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    expect(() => registerSuseBudgetV2({ id: "b1", owner: "u1" })).toThrow();
    expect(() => registerSuseBudgetV2({ owner: "u1" })).toThrow();
    expect(() => registerSuseBudgetV2({ id: "b1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    const b = activateSuseBudgetV2("b1");
    expect(b.status).toBe("active");
    expect(b.activatedAt).toBeTruthy();
  });
  test("exhaust active → exhausted", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    activateSuseBudgetV2("b1");
    const b = exhaustSuseBudgetV2("b1");
    expect(b.status).toBe("exhausted");
  });
  test("activate exhausted → active (recovery)", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    const before = activateSuseBudgetV2("b1").activatedAt;
    exhaustSuseBudgetV2("b1");
    const b = activateSuseBudgetV2("b1");
    expect(b.activatedAt).toBe(before);
  });
  test("archive from any non-terminal", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    const b = archiveSuseBudgetV2("b1");
    expect(b.status).toBe("archived");
    expect(b.archivedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    archiveSuseBudgetV2("b1");
    expect(() => activateSuseBudgetV2("b1")).toThrow();
    expect(() => touchSuseBudgetV2("b1")).toThrow();
  });
  test("touch updates", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    activateSuseBudgetV2("b1");
    const b = touchSuseBudgetV2("b1");
    expect(b.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    expect(getSuseBudgetV2("b1").id).toBe("b1");
    expect(getSuseBudgetV2("nope")).toBeNull();
    expect(listSuseBudgetsV2().length).toBe(1);
  });
});

describe("SessionUsage V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSuseBudgetsPerOwnerV2(2);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    registerSuseBudgetV2({ id: "b2", owner: "u1" });
    registerSuseBudgetV2({ id: "b3", owner: "u1" });
    activateSuseBudgetV2("b1");
    activateSuseBudgetV2("b2");
    expect(() => activateSuseBudgetV2("b3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSuseBudgetsPerOwnerV2(2);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    registerSuseBudgetV2({ id: "b2", owner: "u1" });
    activateSuseBudgetV2("b1");
    activateSuseBudgetV2("b2");
    exhaustSuseBudgetV2("b1");
    const b = activateSuseBudgetV2("b1");
    expect(b.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveSuseBudgetsPerOwnerV2(1);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    registerSuseBudgetV2({ id: "b2", owner: "u2" });
    activateSuseBudgetV2("b1");
    activateSuseBudgetV2("b2");
  });
});

describe("SessionUsage V2 record lifecycle", () => {
  test("create", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    const r = createSuseRecordV2({ id: "r1", budgetId: "b1" });
    expect(r.status).toBe("queued");
    expect(r.amount).toBe(0);
  });
  test("create with amount", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    const r = createSuseRecordV2({ id: "r1", budgetId: "b1", amount: 42 });
    expect(r.amount).toBe(42);
  });
  test("create rejects unknown budget/duplicate", () => {
    expect(() => createSuseRecordV2({ id: "r1", budgetId: "nope" })).toThrow();
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    expect(() => createSuseRecordV2({ id: "r1", budgetId: "b1" })).toThrow();
  });
  test("recording queued → recording", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    const r = recordingSuseRecordV2("r1");
    expect(r.status).toBe("recording");
    expect(r.startedAt).toBeTruthy();
  });
  test("record recording → recorded", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    const r = recordSuseRecordV2("r1");
    expect(r.status).toBe("recorded");
    expect(r.settledAt).toBeTruthy();
  });
  test("reject recording → rejected", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    const r = rejectSuseRecordV2("r1", "err");
    expect(r.status).toBe("rejected");
    expect(r.metadata.rejectReason).toBe("err");
  });
  test("cancel queued/recording → cancelled", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    cancelSuseRecordV2("r1", "abort");
    createSuseRecordV2({ id: "r2", budgetId: "b1" });
    recordingSuseRecordV2("r2");
    const r = cancelSuseRecordV2("r2");
    expect(r.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    recordSuseRecordV2("r1");
    expect(() => rejectSuseRecordV2("r1")).toThrow();
  });
  test("get / list", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    expect(getSuseRecordV2("r1").id).toBe("r1");
    expect(getSuseRecordV2("nope")).toBeNull();
    expect(listSuseRecordsV2().length).toBe(1);
  });
});

describe("SessionUsage V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingSuseRecordsPerBudgetV2(2);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    createSuseRecordV2({ id: "r2", budgetId: "b1" });
    expect(() => createSuseRecordV2({ id: "r3", budgetId: "b1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingSuseRecordsPerBudgetV2(2);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    createSuseRecordV2({ id: "r2", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    recordSuseRecordV2("r1");
    createSuseRecordV2({ id: "r3", budgetId: "b1" });
  });
});

describe("SessionUsage V2 auto flips", () => {
  test("autoExhaustIdleSuseBudgetsV2", () => {
    setSuseBudgetIdleMsV2(100);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    activateSuseBudgetV2("b1");
    const { count } = autoExhaustIdleSuseBudgetsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSuseBudgetV2("b1").status).toBe("exhausted");
  });
  test("autoRejectStuckSuseRecordsV2", () => {
    setSuseRecordStuckMsV2(100);
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    const { count } = autoRejectStuckSuseRecordsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSuseRecordV2("r1").status).toBe("rejected");
    expect(getSuseRecordV2("r1").metadata.rejectReason).toBe(
      "auto-reject-stuck",
    );
  });
});

describe("SessionUsage V2 stats", () => {
  test("empty defaults", () => {
    const s = getSessionUsageGovStatsV2();
    expect(s.totalSuseBudgetsV2).toBe(0);
    expect(s.totalSuseRecordsV2).toBe(0);
    for (const k of ["pending", "active", "exhausted", "archived"])
      expect(s.budgetsByStatus[k]).toBe(0);
    for (const k of [
      "queued",
      "recording",
      "recorded",
      "rejected",
      "cancelled",
    ])
      expect(s.recordsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSuseBudgetV2({ id: "b1", owner: "u1" });
    activateSuseBudgetV2("b1");
    createSuseRecordV2({ id: "r1", budgetId: "b1" });
    recordingSuseRecordV2("r1");
    const s = getSessionUsageGovStatsV2();
    expect(s.budgetsByStatus.active).toBe(1);
    expect(s.recordsByStatus.recording).toBe(1);
  });
});
