import { describe, test, expect, beforeEach } from "vitest";
import {
  COMPLIANCE_FW_MATURITY_V2, COMPLIANCE_FW_REPORT_LIFECYCLE_V2,
  setMaxActiveComplianceFwsPerOwnerV2, getMaxActiveComplianceFwsPerOwnerV2,
  setMaxPendingComplianceFwReportsPerFwV2, getMaxPendingComplianceFwReportsPerFwV2,
  setComplianceFwIdleMsV2, getComplianceFwIdleMsV2, setComplianceFwReportStuckMsV2, getComplianceFwReportStuckMsV2,
  _resetStateComplianceFwReporterV2, registerComplianceFwV2, activateComplianceFwV2, deprecateComplianceFwV2,
  archiveComplianceFwV2, touchComplianceFwV2, getComplianceFwV2, listComplianceFwsV2,
  createComplianceFwReportV2, startComplianceFwReportV2, completeComplianceFwReportV2,
  failComplianceFwReportV2, cancelComplianceFwReportV2, getComplianceFwReportV2, listComplianceFwReportsV2,
  autoDeprecateIdleComplianceFwsV2, autoFailStuckComplianceFwReportsV2, getComplianceFwReporterGovStatsV2,
} from "../../../src/lib/compliance-framework-reporter.js";

beforeEach(() => { _resetStateComplianceFwReporterV2(); });

describe("ComplianceFw V2 enums", () => {
  test("fw maturity", () => { expect(COMPLIANCE_FW_MATURITY_V2.PENDING).toBe("pending"); expect(COMPLIANCE_FW_MATURITY_V2.ACTIVE).toBe("active"); expect(COMPLIANCE_FW_MATURITY_V2.DEPRECATED).toBe("deprecated"); expect(COMPLIANCE_FW_MATURITY_V2.ARCHIVED).toBe("archived"); });
  test("report lifecycle", () => { expect(COMPLIANCE_FW_REPORT_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING).toBe("generating"); expect(COMPLIANCE_FW_REPORT_LIFECYCLE_V2.COMPLETED).toBe("completed"); expect(COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED).toBe("failed"); expect(COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(COMPLIANCE_FW_MATURITY_V2)).toBe(true); expect(Object.isFrozen(COMPLIANCE_FW_REPORT_LIFECYCLE_V2)).toBe(true); });
});

describe("ComplianceFw V2 config", () => {
  test("defaults", () => { expect(getMaxActiveComplianceFwsPerOwnerV2()).toBe(8); expect(getMaxPendingComplianceFwReportsPerFwV2()).toBe(15); expect(getComplianceFwIdleMsV2()).toBe(90 * 24 * 60 * 60 * 1000); expect(getComplianceFwReportStuckMsV2()).toBe(10 * 60 * 1000); });
  test("set max active", () => { setMaxActiveComplianceFwsPerOwnerV2(5); expect(getMaxActiveComplianceFwsPerOwnerV2()).toBe(5); });
  test("set max pending", () => { setMaxPendingComplianceFwReportsPerFwV2(3); expect(getMaxPendingComplianceFwReportsPerFwV2()).toBe(3); });
  test("set idle ms", () => { setComplianceFwIdleMsV2(100); expect(getComplianceFwIdleMsV2()).toBe(100); });
  test("set stuck ms", () => { setComplianceFwReportStuckMsV2(50); expect(getComplianceFwReportStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveComplianceFwsPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveComplianceFwsPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveComplianceFwsPerOwnerV2(3.9); expect(getMaxActiveComplianceFwsPerOwnerV2()).toBe(3); });
});

describe("ComplianceFw V2 framework lifecycle", () => {
  test("register", () => { const f = registerComplianceFwV2({ id: "f1", owner: "u1" }); expect(f.status).toBe("pending"); expect(f.name).toBe("f1"); });
  test("register with name", () => { const f = registerComplianceFwV2({ id: "f1", owner: "u1", name: "GDPR" }); expect(f.name).toBe("GDPR"); });
  test("register reject duplicate", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); expect(() => registerComplianceFwV2({ id: "f1", owner: "u1" })).toThrow(); });
  test("register reject missing id", () => { expect(() => registerComplianceFwV2({ owner: "u1" })).toThrow(); });
  test("register reject missing owner", () => { expect(() => registerComplianceFwV2({ id: "f1" })).toThrow(); });
  test("activate pending → active", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); const f = activateComplianceFwV2("f1"); expect(f.status).toBe("active"); expect(f.activatedAt).toBeTruthy(); });
  test("deprecate active → deprecated", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); activateComplianceFwV2("f1"); const f = deprecateComplianceFwV2("f1"); expect(f.status).toBe("deprecated"); });
  test("activate deprecated → active (recovery)", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); const before = activateComplianceFwV2("f1").activatedAt; deprecateComplianceFwV2("f1"); const f = activateComplianceFwV2("f1"); expect(f.status).toBe("active"); expect(f.activatedAt).toBe(before); });
  test("archive from active", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); activateComplianceFwV2("f1"); const f = archiveComplianceFwV2("f1"); expect(f.status).toBe("archived"); expect(f.archivedAt).toBeTruthy(); });
  test("archive from pending", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); const f = archiveComplianceFwV2("f1"); expect(f.status).toBe("archived"); });
  test("terminal no transitions", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); archiveComplianceFwV2("f1"); expect(() => activateComplianceFwV2("f1")).toThrow(); expect(() => deprecateComplianceFwV2("f1")).toThrow(); });
  test("touch terminal throws", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); archiveComplianceFwV2("f1"); expect(() => touchComplianceFwV2("f1")).toThrow(); });
  test("touch updates", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); activateComplianceFwV2("f1"); const f = touchComplianceFwV2("f1"); expect(f.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); expect(getComplianceFwV2("f1").id).toBe("f1"); expect(getComplianceFwV2("nope")).toBeNull(); expect(listComplianceFwsV2().length).toBe(1); });
});

describe("ComplianceFw V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveComplianceFwsPerOwnerV2(2);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); registerComplianceFwV2({ id: "f2", owner: "u1" }); registerComplianceFwV2({ id: "f3", owner: "u1" });
    activateComplianceFwV2("f1"); activateComplianceFwV2("f2");
    expect(() => activateComplianceFwV2("f3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveComplianceFwsPerOwnerV2(2);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); registerComplianceFwV2({ id: "f2", owner: "u1" });
    activateComplianceFwV2("f1"); activateComplianceFwV2("f2"); deprecateComplianceFwV2("f1");
    const f = activateComplianceFwV2("f1"); expect(f.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveComplianceFwsPerOwnerV2(1);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); registerComplianceFwV2({ id: "f2", owner: "u2" });
    activateComplianceFwV2("f1"); activateComplianceFwV2("f2");
  });
});

describe("ComplianceFw V2 report lifecycle", () => {
  test("create", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); const r = createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); expect(r.status).toBe("queued"); expect(r.format).toBe("markdown"); });
  test("create with format", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); const r = createComplianceFwReportV2({ id: "r1", frameworkId: "f1", format: "pdf" }); expect(r.format).toBe("pdf"); });
  test("create rejects unknown fw", () => { expect(() => createComplianceFwReportV2({ id: "r1", frameworkId: "nope" })).toThrow(); });
  test("create rejects duplicate", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); expect(() => createComplianceFwReportV2({ id: "r1", frameworkId: "f1" })).toThrow(); });
  test("start queued → generating", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); const r = startComplianceFwReportV2("r1"); expect(r.status).toBe("generating"); expect(r.startedAt).toBeTruthy(); });
  test("complete generating → completed", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1"); const r = completeComplianceFwReportV2("r1"); expect(r.status).toBe("completed"); expect(r.settledAt).toBeTruthy(); });
  test("fail generating → failed", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1"); const r = failComplianceFwReportV2("r1", "oops"); expect(r.status).toBe("failed"); expect(r.metadata.failReason).toBe("oops"); });
  test("cancel queued → cancelled", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); const r = cancelComplianceFwReportV2("r1", "abort"); expect(r.status).toBe("cancelled"); expect(r.metadata.cancelReason).toBe("abort"); });
  test("cancel generating → cancelled", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1"); const r = cancelComplianceFwReportV2("r1"); expect(r.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1"); completeComplianceFwReportV2("r1"); expect(() => failComplianceFwReportV2("r1")).toThrow(); });
  test("get / list", () => { registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); expect(getComplianceFwReportV2("r1").id).toBe("r1"); expect(getComplianceFwReportV2("nope")).toBeNull(); expect(listComplianceFwReportsV2().length).toBe(1); });
});

describe("ComplianceFw V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingComplianceFwReportsPerFwV2(2);
    registerComplianceFwV2({ id: "f1", owner: "u1" });
    createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); createComplianceFwReportV2({ id: "r2", frameworkId: "f1" });
    expect(() => createComplianceFwReportV2({ id: "r3", frameworkId: "f1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingComplianceFwReportsPerFwV2(2);
    registerComplianceFwV2({ id: "f1", owner: "u1" });
    createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); createComplianceFwReportV2({ id: "r2", frameworkId: "f1" });
    startComplianceFwReportV2("r1"); completeComplianceFwReportV2("r1");
    createComplianceFwReportV2({ id: "r3", frameworkId: "f1" });
  });
  test("per-fw scope", () => {
    setMaxPendingComplianceFwReportsPerFwV2(1);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); registerComplianceFwV2({ id: "f2", owner: "u1" });
    createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); createComplianceFwReportV2({ id: "r2", frameworkId: "f2" });
  });
});

describe("ComplianceFw V2 auto flips", () => {
  test("autoDeprecateIdleComplianceFwsV2", () => {
    setComplianceFwIdleMsV2(100);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); activateComplianceFwV2("f1");
    const { count } = autoDeprecateIdleComplianceFwsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getComplianceFwV2("f1").status).toBe("deprecated");
  });
  test("autoFailStuckComplianceFwReportsV2", () => {
    setComplianceFwReportStuckMsV2(100);
    registerComplianceFwV2({ id: "f1", owner: "u1" }); createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1");
    const { count } = autoFailStuckComplianceFwReportsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getComplianceFwReportV2("r1").status).toBe("failed"); expect(getComplianceFwReportV2("r1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("ComplianceFw V2 stats", () => {
  test("empty defaults", () => {
    const s = getComplianceFwReporterGovStatsV2();
    expect(s.totalComplianceFwsV2).toBe(0); expect(s.totalComplianceFwReportsV2).toBe(0);
    for (const k of ["pending", "active", "deprecated", "archived"]) expect(s.fwsByStatus[k]).toBe(0);
    for (const k of ["queued", "generating", "completed", "failed", "cancelled"]) expect(s.reportsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerComplianceFwV2({ id: "f1", owner: "u1" }); activateComplianceFwV2("f1");
    createComplianceFwReportV2({ id: "r1", frameworkId: "f1" }); startComplianceFwReportV2("r1");
    const s = getComplianceFwReporterGovStatsV2();
    expect(s.totalComplianceFwsV2).toBe(1); expect(s.totalComplianceFwReportsV2).toBe(1);
    expect(s.fwsByStatus.active).toBe(1); expect(s.reportsByStatus.generating).toBe(1);
  });
});
