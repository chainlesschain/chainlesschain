import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/dlp-engine.js";

describe("DLP Engine V2 Surface", () => {
  beforeEach(() => M._resetStateDlpEngineV2());

  describe("enums", () => {
    it("policy maturity has 4 states", () =>
      expect(Object.keys(M.DLP_POLICY_MATURITY_V2)).toHaveLength(4));
    it("scan lifecycle has 5 states", () =>
      expect(Object.keys(M.DLP_SCAN_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.DLP_POLICY_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DLP_SCAN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveDlpPoliciesPerOwnerV2", () => {
      M.setMaxActiveDlpPoliciesPerOwnerV2(30);
      expect(M.getMaxActiveDlpPoliciesPerOwnerV2()).toBe(30);
    });
    it("setMaxPendingDlpScansPerPolicyV2", () => {
      M.setMaxPendingDlpScansPerPolicyV2(40);
      expect(M.getMaxPendingDlpScansPerPolicyV2()).toBe(40);
    });
    it("setDlpPolicyIdleMsV2", () => {
      M.setDlpPolicyIdleMsV2(3600000);
      expect(M.getDlpPolicyIdleMsV2()).toBe(3600000);
    });
    it("setDlpScanStuckMsV2", () => {
      M.setDlpScanStuckMsV2(60000);
      expect(M.getDlpScanStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveDlpPoliciesPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setDlpScanStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingDlpScansPerPolicyV2(5.9);
      expect(M.getMaxPendingDlpScansPerPolicyV2()).toBe(5);
    });
  });

  describe("policy lifecycle", () => {
    it("register", () => {
      const p = M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      expect(p.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      const p = M.activateDlpPolicyV2("p1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBeTruthy();
    });
    it("suspend active→suspended", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      M.activateDlpPolicyV2("p1");
      expect(M.suspendDlpPolicyV2("p1").status).toBe("suspended");
    });
    it("recovery suspended→active preserves activatedAt", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      const p = M.activateDlpPolicyV2("p1");
      M.suspendDlpPolicyV2("p1");
      const re = M.activateDlpPolicyV2("p1");
      expect(re.activatedAt).toBe(p.activatedAt);
    });
    it("retire terminal stamps retiredAt", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      M.activateDlpPolicyV2("p1");
      const p = M.retireDlpPolicyV2("p1");
      expect(p.status).toBe("retired");
      expect(p.retiredAt).toBeTruthy();
    });
    it("cannot touch retired", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      M.activateDlpPolicyV2("p1");
      M.retireDlpPolicyV2("p1");
      expect(() => M.touchDlpPolicyV2("p1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      expect(() => M.suspendDlpPolicyV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "alice" });
      expect(() => M.registerDlpPolicyV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerDlpPolicyV2({ id: "p1" })).toThrow());
    it("list all", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "a" });
      M.registerDlpPolicyV2({ id: "p2", owner: "b" });
      expect(M.listDlpPoliciesV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getDlpPolicyV2("none")).toBeNull());
    it("defensive copy", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "a", metadata: { k: 5 } });
      const p = M.getDlpPolicyV2("p1");
      p.metadata.k = 99;
      expect(M.getDlpPolicyV2("p1").metadata.k).toBe(5);
    });
    it("default classification internal", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "a" });
      expect(M.getDlpPolicyV2("p1").classification).toBe("internal");
    });
  });

  describe("active-policy cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveDlpPoliciesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlpPolicyV2({ id, owner: "o" }),
      );
      M.activateDlpPolicyV2("p1");
      M.activateDlpPolicyV2("p2");
      expect(() => M.activateDlpPolicyV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDlpPoliciesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlpPolicyV2({ id, owner: "o" }),
      );
      M.activateDlpPolicyV2("p1");
      M.activateDlpPolicyV2("p2");
      M.suspendDlpPolicyV2("p1");
      M.activateDlpPolicyV2("p3");
      expect(() => M.activateDlpPolicyV2("p1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveDlpPoliciesPerOwnerV2(1);
      M.registerDlpPolicyV2({ id: "p1", owner: "o1" });
      M.registerDlpPolicyV2({ id: "p2", owner: "o2" });
      M.activateDlpPolicyV2("p1");
      expect(() => M.activateDlpPolicyV2("p2")).not.toThrow();
    });
  });

  describe("scan lifecycle", () => {
    beforeEach(() => {
      M.registerDlpPolicyV2({ id: "p1", owner: "o" });
      M.activateDlpPolicyV2("p1");
    });
    it("create→start→complete", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      M.startDlpScanV2("s1");
      const s = M.completeDlpScanV2("s1");
      expect(s.status).toBe("completed");
    });
    it("fail stores reason", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      M.startDlpScanV2("s1");
      const s = M.failDlpScanV2("s1", "err");
      expect(s.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      expect(M.cancelDlpScanV2("s1").status).toBe("cancelled");
    });
    it("cannot complete from queued", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      expect(() => M.completeDlpScanV2("s1")).toThrow();
    });
    it("unknown policy rejected", () =>
      expect(() =>
        M.createDlpScanV2({ id: "s1", policyId: "none" }),
      ).toThrow());
    it("per-policy pending cap", () => {
      M.setMaxPendingDlpScansPerPolicyV2(2);
      ["s1", "s2"].forEach((id) => M.createDlpScanV2({ id, policyId: "p1" }));
      expect(() => M.createDlpScanV2({ id: "s3", policyId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("scanning counts as pending", () => {
      M.setMaxPendingDlpScansPerPolicyV2(1);
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      M.startDlpScanV2("s1");
      expect(() => M.createDlpScanV2({ id: "s2", policyId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDlpScansPerPolicyV2(1);
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      M.startDlpScanV2("s1");
      M.completeDlpScanV2("s1");
      expect(() =>
        M.createDlpScanV2({ id: "s2", policyId: "p1" }),
      ).not.toThrow();
    });
    it("default target empty", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      expect(M.getDlpScanV2("s1").target).toBe("");
    });
    it("target preserved", () => {
      M.createDlpScanV2({ id: "s1", policyId: "p1", target: "/data" });
      expect(M.getDlpScanV2("s1").target).toBe("/data");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setDlpPolicyIdleMsV2(1000);
      M.registerDlpPolicyV2({ id: "p1", owner: "o" });
      M.activateDlpPolicyV2("p1");
      const r = M.autoSuspendIdleDlpPoliciesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDlpPolicyV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "o" });
      M.activateDlpPolicyV2("p1");
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      M.startDlpScanV2("s1");
      M.setDlpScanStuckMsV2(100);
      const r = M.autoFailStuckDlpScansV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDlpScanV2("s1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getDlpEngineStatsV2();
      expect(s.policiesByStatus.pending).toBe(0);
      expect(s.scansByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDlpPolicyV2({ id: "p1", owner: "o" });
      M.activateDlpPolicyV2("p1");
      M.createDlpScanV2({ id: "s1", policyId: "p1" });
      const s = M.getDlpEngineStatsV2();
      expect(s.totalPoliciesV2).toBe(1);
      expect(s.totalScansV2).toBe(1);
    });
  });
});
