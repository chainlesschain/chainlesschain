import { describe, test, expect, beforeEach } from "vitest";
import {
  SIEM_TARGET_MATURITY_V2,
  SIEM_EXPORT_LIFECYCLE_V2,
  setMaxActiveSiemTargetsPerOperatorV2,
  getMaxActiveSiemTargetsPerOperatorV2,
  setMaxPendingSiemExportsPerTargetV2,
  getMaxPendingSiemExportsPerTargetV2,
  setSiemTargetIdleMsV2,
  getSiemTargetIdleMsV2,
  setSiemExportStuckMsV2,
  getSiemExportStuckMsV2,
  _resetStateSiemExporterV2,
  registerSiemTargetV2,
  activateSiemTargetV2,
  degradeSiemTargetV2,
  retireSiemTargetV2,
  touchSiemTargetV2,
  getSiemTargetV2,
  listSiemTargetsV2,
  createSiemExportV2,
  startSiemExportV2,
  deliverSiemExportV2,
  failSiemExportV2,
  cancelSiemExportV2,
  getSiemExportV2,
  listSiemExportsV2,
  autoDegradeIdleSiemTargetsV2,
  autoFailStuckSiemExportsV2,
  getSiemExporterGovStatsV2,
} from "../../../src/lib/siem-exporter.js";

beforeEach(() => {
  _resetStateSiemExporterV2();
});

describe("SIEM V2 enums", () => {
  test("target maturity", () => {
    expect(SIEM_TARGET_MATURITY_V2.PENDING).toBe("pending");
    expect(SIEM_TARGET_MATURITY_V2.ACTIVE).toBe("active");
    expect(SIEM_TARGET_MATURITY_V2.DEGRADED).toBe("degraded");
    expect(SIEM_TARGET_MATURITY_V2.RETIRED).toBe("retired");
  });
  test("export lifecycle", () => {
    expect(SIEM_EXPORT_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(SIEM_EXPORT_LIFECYCLE_V2.SENDING).toBe("sending");
    expect(SIEM_EXPORT_LIFECYCLE_V2.DELIVERED).toBe("delivered");
    expect(SIEM_EXPORT_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(SIEM_EXPORT_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(SIEM_TARGET_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(SIEM_EXPORT_LIFECYCLE_V2)).toBe(true);
  });
});

describe("SIEM V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveSiemTargetsPerOperatorV2()).toBe(8);
    expect(getMaxPendingSiemExportsPerTargetV2()).toBe(50);
    expect(getSiemTargetIdleMsV2()).toBe(24 * 60 * 60 * 1000);
    expect(getSiemExportStuckMsV2()).toBe(5 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveSiemTargetsPerOperatorV2(5);
    expect(getMaxActiveSiemTargetsPerOperatorV2()).toBe(5);
  });
  test("set max pending", () => {
    setMaxPendingSiemExportsPerTargetV2(3);
    expect(getMaxPendingSiemExportsPerTargetV2()).toBe(3);
  });
  test("set idle ms", () => {
    setSiemTargetIdleMsV2(100);
    expect(getSiemTargetIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setSiemExportStuckMsV2(50);
    expect(getSiemExportStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveSiemTargetsPerOperatorV2(0)).toThrow();
    expect(() => setMaxActiveSiemTargetsPerOperatorV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveSiemTargetsPerOperatorV2(4.9);
    expect(getMaxActiveSiemTargetsPerOperatorV2()).toBe(4);
  });
});

describe("SIEM V2 target lifecycle", () => {
  test("register", () => {
    const t = registerSiemTargetV2({ id: "t1", operator: "op1" });
    expect(t.status).toBe("pending");
    expect(t.kind).toBe("splunk_hec");
  });
  test("register with kind", () => {
    const t = registerSiemTargetV2({
      id: "t1",
      operator: "op1",
      kind: "elastic",
    });
    expect(t.kind).toBe("elastic");
  });
  test("register reject duplicate", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    expect(() => registerSiemTargetV2({ id: "t1", operator: "op1" })).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerSiemTargetV2({ operator: "op1" })).toThrow();
  });
  test("register reject missing operator", () => {
    expect(() => registerSiemTargetV2({ id: "t1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    const t = activateSiemTargetV2("t1");
    expect(t.status).toBe("active");
    expect(t.activatedAt).toBeTruthy();
  });
  test("degrade active → degraded", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    activateSiemTargetV2("t1");
    const t = degradeSiemTargetV2("t1");
    expect(t.status).toBe("degraded");
  });
  test("activate degraded → active (recovery)", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    const before = activateSiemTargetV2("t1").activatedAt;
    degradeSiemTargetV2("t1");
    const t = activateSiemTargetV2("t1");
    expect(t.status).toBe("active");
    expect(t.activatedAt).toBe(before);
  });
  test("retire from active", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    activateSiemTargetV2("t1");
    const t = retireSiemTargetV2("t1");
    expect(t.status).toBe("retired");
    expect(t.retiredAt).toBeTruthy();
  });
  test("retire from pending", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    const t = retireSiemTargetV2("t1");
    expect(t.status).toBe("retired");
  });
  test("retire terminal no transitions", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    retireSiemTargetV2("t1");
    expect(() => activateSiemTargetV2("t1")).toThrow();
    expect(() => degradeSiemTargetV2("t1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    retireSiemTargetV2("t1");
    expect(() => touchSiemTargetV2("t1")).toThrow();
  });
  test("touch updates lastTouchedAt", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    activateSiemTargetV2("t1");
    const t = touchSiemTargetV2("t1");
    expect(t.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    expect(getSiemTargetV2("t1").id).toBe("t1");
    expect(getSiemTargetV2("nope")).toBeNull();
    expect(listSiemTargetsV2().length).toBe(1);
  });
});

describe("SIEM V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSiemTargetsPerOperatorV2(2);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    registerSiemTargetV2({ id: "t2", operator: "op1" });
    registerSiemTargetV2({ id: "t3", operator: "op1" });
    activateSiemTargetV2("t1");
    activateSiemTargetV2("t2");
    expect(() => activateSiemTargetV2("t3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSiemTargetsPerOperatorV2(2);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    registerSiemTargetV2({ id: "t2", operator: "op1" });
    activateSiemTargetV2("t1");
    activateSiemTargetV2("t2");
    degradeSiemTargetV2("t1");
    const t = activateSiemTargetV2("t1");
    expect(t.status).toBe("active");
  });
  test("per-operator scope", () => {
    setMaxActiveSiemTargetsPerOperatorV2(1);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    registerSiemTargetV2({ id: "t2", operator: "op2" });
    activateSiemTargetV2("t1");
    activateSiemTargetV2("t2");
  });
});

describe("SIEM V2 export lifecycle", () => {
  test("create", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    const e = createSiemExportV2({ id: "e1", targetId: "t1" });
    expect(e.status).toBe("queued");
    expect(e.format).toBe("json");
  });
  test("create with format", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    const e = createSiemExportV2({ id: "e1", targetId: "t1", format: "cef" });
    expect(e.format).toBe("cef");
  });
  test("create rejects unknown target", () => {
    expect(() => createSiemExportV2({ id: "e1", targetId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    expect(() => createSiemExportV2({ id: "e1", targetId: "t1" })).toThrow();
  });
  test("start queued → sending", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    const e = startSiemExportV2("e1");
    expect(e.status).toBe("sending");
    expect(e.startedAt).toBeTruthy();
  });
  test("deliver sending → delivered", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    const e = deliverSiemExportV2("e1");
    expect(e.status).toBe("delivered");
    expect(e.settledAt).toBeTruthy();
  });
  test("fail sending → failed", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    const e = failSiemExportV2("e1", "oops");
    expect(e.status).toBe("failed");
    expect(e.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    const e = cancelSiemExportV2("e1", "abort");
    expect(e.status).toBe("cancelled");
    expect(e.metadata.cancelReason).toBe("abort");
  });
  test("cancel sending → cancelled", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    const e = cancelSiemExportV2("e1");
    expect(e.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    deliverSiemExportV2("e1");
    expect(() => failSiemExportV2("e1")).toThrow();
  });
  test("get / list", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    expect(getSiemExportV2("e1").id).toBe("e1");
    expect(getSiemExportV2("nope")).toBeNull();
    expect(listSiemExportsV2().length).toBe(1);
  });
});

describe("SIEM V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingSiemExportsPerTargetV2(2);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    createSiemExportV2({ id: "e2", targetId: "t1" });
    expect(() => createSiemExportV2({ id: "e3", targetId: "t1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingSiemExportsPerTargetV2(2);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    createSiemExportV2({ id: "e2", targetId: "t1" });
    startSiemExportV2("e1");
    deliverSiemExportV2("e1");
    createSiemExportV2({ id: "e3", targetId: "t1" });
  });
  test("per-target scope", () => {
    setMaxPendingSiemExportsPerTargetV2(1);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    registerSiemTargetV2({ id: "t2", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    createSiemExportV2({ id: "e2", targetId: "t2" });
  });
});

describe("SIEM V2 auto flips", () => {
  test("autoDegradeIdleSiemTargetsV2", () => {
    setSiemTargetIdleMsV2(100);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    activateSiemTargetV2("t1");
    const { count } = autoDegradeIdleSiemTargetsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSiemTargetV2("t1").status).toBe("degraded");
  });
  test("autoFailStuckSiemExportsV2", () => {
    setSiemExportStuckMsV2(100);
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    const { count } = autoFailStuckSiemExportsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSiemExportV2("e1").status).toBe("failed");
    expect(getSiemExportV2("e1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("SIEM V2 stats", () => {
  test("empty defaults", () => {
    const s = getSiemExporterGovStatsV2();
    expect(s.totalSiemTargetsV2).toBe(0);
    expect(s.totalSiemExportsV2).toBe(0);
    for (const k of ["pending", "active", "degraded", "retired"])
      expect(s.targetsByStatus[k]).toBe(0);
    for (const k of ["queued", "sending", "delivered", "failed", "cancelled"])
      expect(s.exportsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSiemTargetV2({ id: "t1", operator: "op1" });
    activateSiemTargetV2("t1");
    createSiemExportV2({ id: "e1", targetId: "t1" });
    startSiemExportV2("e1");
    const s = getSiemExporterGovStatsV2();
    expect(s.totalSiemTargetsV2).toBe(1);
    expect(s.totalSiemExportsV2).toBe(1);
    expect(s.targetsByStatus.active).toBe(1);
    expect(s.exportsByStatus.sending).toBe(1);
  });
});
