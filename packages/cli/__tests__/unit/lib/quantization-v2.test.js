import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/quantization.js";

describe("Quantization V2 Surface", () => {
  beforeEach(() => M._resetStateQuantizationGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.QNTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.QNTGOV_JOB_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.QNTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.QNTGOV_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveQntgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveQntgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingQntgovJobsPerProfileV2(33);
      expect(M.getMaxPendingQntgovJobsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setQntgovProfileIdleMsV2(60000);
      expect(M.getQntgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setQntgovJobStuckMsV2(45000);
      expect(M.getQntgovJobStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveQntgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setQntgovJobStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveQntgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveQntgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerQntgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default precision", () =>
      expect(
        M.registerQntgovProfileV2({ id: "p1", owner: "a" }).precision,
      ).toBe("int8"));
    it("activate", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateQntgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      expect(M.staleQntgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateQntgovProfileV2("p1");
      M.staleQntgovProfileV2("p1");
      expect(M.activateQntgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      expect(M.archiveQntgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      M.archiveQntgovProfileV2("p1");
      expect(() => M.touchQntgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleQntgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerQntgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerQntgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getQntgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.registerQntgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listQntgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getQntgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getQntgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveQntgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerQntgovProfileV2({ id, owner: "a" }),
      );
      M.activateQntgovProfileV2("p1");
      M.activateQntgovProfileV2("p2");
      expect(() => M.activateQntgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveQntgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerQntgovProfileV2({ id, owner: "a" }),
      );
      M.activateQntgovProfileV2("p1");
      M.activateQntgovProfileV2("p2");
      M.staleQntgovProfileV2("p1");
      M.activateQntgovProfileV2("p3");
      expect(() => M.activateQntgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveQntgovProfilesPerOwnerV2(1);
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.registerQntgovProfileV2({ id: "p2", owner: "b" });
      M.activateQntgovProfileV2("p1");
      expect(() => M.activateQntgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("job lifecycle", () => {
    beforeEach(() => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
    });
    it("create→quantizing→complete", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.quantizingQntgovJobV2("r1");
      const r = M.completeJobQntgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.quantizingQntgovJobV2("r1");
      expect(M.failQntgovJobV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelQntgovJobV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeJobQntgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createQntgovJobV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingQntgovJobsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createQntgovJobV2({ id, profileId: "p1" }),
      );
      expect(() => M.createQntgovJobV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("quantizing counts as pending", () => {
      M.setMaxPendingQntgovJobsPerProfileV2(1);
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.quantizingQntgovJobV2("r1");
      expect(() =>
        M.createQntgovJobV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingQntgovJobsPerProfileV2(1);
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.quantizingQntgovJobV2("r1");
      M.completeJobQntgovV2("r1");
      expect(() =>
        M.createQntgovJobV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getQntgovJobV2("nope")).toBeNull());
    it("list", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.createQntgovJobV2({ id: "r2", profileId: "p1" });
      expect(M.listQntgovJobsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createQntgovJobV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createQntgovJobV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelQntgovJobV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setQntgovProfileIdleMsV2(1000);
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      const r = M.autoStaleIdleQntgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getQntgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      M.quantizingQntgovJobV2("r1");
      M.setQntgovJobStuckMsV2(100);
      const r = M.autoFailStuckQntgovJobsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setQntgovProfileIdleMsV2(1000);
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleQntgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getQuantizationGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.jobsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerQntgovProfileV2({ id: "p1", owner: "a" });
      M.activateQntgovProfileV2("p1");
      M.createQntgovJobV2({ id: "r1", profileId: "p1" });
      const s2 = M.getQuantizationGovStatsV2();
      expect(s2.totalQntgovProfilesV2).toBe(1);
      expect(s2.totalQntgovJobsV2).toBe(1);
    });
  });
});
