import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/service-manager.js";

describe("ServiceManagerGov V2 Surface", () => {
  beforeEach(() => M._resetStateServiceManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SMGRGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SMGRGOV_OP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SMGRGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SMGRGOV_OP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSmgrgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSmgrgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSmgrgovOpsPerProfileV2(33);
      expect(M.getMaxPendingSmgrgovOpsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSmgrgovProfileIdleMsV2(60000);
      expect(M.getSmgrgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSmgrgovOpStuckMsV2(45000);
      expect(M.getSmgrgovOpStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSmgrgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSmgrgovOpStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSmgrgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSmgrgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSmgrgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default service", () =>
      expect(M.registerSmgrgovProfileV2({ id: "p1", owner: "a" }).service).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSmgrgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      expect(M.degradeSmgrgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSmgrgovProfileV2("p1");
      M.degradeSmgrgovProfileV2("p1");
      expect(M.activateSmgrgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      expect(M.archiveSmgrgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      M.archiveSmgrgovProfileV2("p1");
      expect(() => M.touchSmgrgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeSmgrgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSmgrgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSmgrgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSmgrgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmgrgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSmgrgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSmgrgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSmgrgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSmgrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmgrgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmgrgovProfileV2("p1");
      M.activateSmgrgovProfileV2("p2");
      expect(() => M.activateSmgrgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSmgrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmgrgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmgrgovProfileV2("p1");
      M.activateSmgrgovProfileV2("p2");
      M.degradeSmgrgovProfileV2("p1");
      M.activateSmgrgovProfileV2("p3");
      expect(() => M.activateSmgrgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSmgrgovProfilesPerOwnerV2(1);
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmgrgovProfileV2({ id: "p2", owner: "b" });
      M.activateSmgrgovProfileV2("p1");
      expect(() => M.activateSmgrgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("op lifecycle", () => {
    beforeEach(() => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
    });
    it("create→operating→complete", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.operatingSmgrgovOpV2("r1");
      const r = M.completeOpSmgrgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.operatingSmgrgovOpV2("r1");
      expect(M.failSmgrgovOpV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmgrgovOpV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeOpSmgrgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSmgrgovOpV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSmgrgovOpsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSmgrgovOpV2({ id, profileId: "p1" }),
      );
      expect(() => M.createSmgrgovOpV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("operating counts as pending", () => {
      M.setMaxPendingSmgrgovOpsPerProfileV2(1);
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.operatingSmgrgovOpV2("r1");
      expect(() =>
        M.createSmgrgovOpV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSmgrgovOpsPerProfileV2(1);
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.operatingSmgrgovOpV2("r1");
      M.completeOpSmgrgovV2("r1");
      expect(() =>
        M.createSmgrgovOpV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSmgrgovOpV2("nope")).toBeNull());
    it("list", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.createSmgrgovOpV2({ id: "r2", profileId: "p1" });
      expect(M.listSmgrgovOpsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSmgrgovOpV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSmgrgovOpV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmgrgovOpV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setSmgrgovProfileIdleMsV2(1000);
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      const r = M.autoDegradeIdleSmgrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSmgrgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      M.operatingSmgrgovOpV2("r1");
      M.setSmgrgovOpStuckMsV2(100);
      const r = M.autoFailStuckSmgrgovOpsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSmgrgovProfileIdleMsV2(1000);
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleSmgrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getServiceManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.opsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgrgovProfileV2("p1");
      M.createSmgrgovOpV2({ id: "r1", profileId: "p1" });
      const s2 = M.getServiceManagerGovStatsV2();
      expect(s2.totalSmgrgovProfilesV2).toBe(1);
      expect(s2.totalSmgrgovOpsV2).toBe(1);
    });
  });
});
