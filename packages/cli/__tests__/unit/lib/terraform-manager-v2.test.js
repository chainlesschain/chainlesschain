import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/terraform-manager.js";

describe("TerraformManager V2 Surface", () => {
  beforeEach(() => M._resetStateTerraformManagerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TFGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TFGOV_APPLY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TFGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TFGOV_APPLY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTfgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTfgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTfgovApplysPerProfileV2(33);
      expect(M.getMaxPendingTfgovApplysPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTfgovProfileIdleMsV2(60000);
      expect(M.getTfgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTfgovApplyStuckMsV2(45000);
      expect(M.getTfgovApplyStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTfgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTfgovApplyStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTfgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTfgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTfgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default provider", () =>
      expect(M.registerTfgovProfileV2({ id: "p1", owner: "a" }).provider).toBe(
        "aws",
      ));
    it("activate", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTfgovProfileV2("p1").status).toBe("active");
    });
    it("drift", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      expect(M.driftTfgovProfileV2("p1").status).toBe("drifted");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTfgovProfileV2("p1");
      M.driftTfgovProfileV2("p1");
      expect(M.activateTfgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      expect(M.archiveTfgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      M.archiveTfgovProfileV2("p1");
      expect(() => M.touchTfgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.driftTfgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTfgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTfgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTfgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.registerTfgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTfgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTfgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTfgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTfgovProfileV2({ id, owner: "a" }),
      );
      M.activateTfgovProfileV2("p1");
      M.activateTfgovProfileV2("p2");
      expect(() => M.activateTfgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTfgovProfileV2({ id, owner: "a" }),
      );
      M.activateTfgovProfileV2("p1");
      M.activateTfgovProfileV2("p2");
      M.driftTfgovProfileV2("p1");
      M.activateTfgovProfileV2("p3");
      expect(() => M.activateTfgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTfgovProfilesPerOwnerV2(1);
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.registerTfgovProfileV2({ id: "p2", owner: "b" });
      M.activateTfgovProfileV2("p1");
      expect(() => M.activateTfgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("apply lifecycle", () => {
    beforeEach(() => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
    });
    it("create→applying→complete", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingTfgovApplyV2("r1");
      const r = M.completeApplyTfgovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("applying");
    });
    it("fail", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingTfgovApplyV2("r1");
      expect(M.failTfgovApplyV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTfgovApplyV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeApplyTfgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTfgovApplyV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTfgovApplysPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTfgovApplyV2({ id, profileId: "p1" }),
      );
      expect(() => M.createTfgovApplyV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("applying counts as pending", () => {
      M.setMaxPendingTfgovApplysPerProfileV2(1);
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingTfgovApplyV2("r1");
      expect(() =>
        M.createTfgovApplyV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTfgovApplysPerProfileV2(1);
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingTfgovApplyV2("r1");
      M.completeApplyTfgovV2("r1");
      expect(() =>
        M.createTfgovApplyV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTfgovApplyV2("nope")).toBeNull());
    it("list", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.createTfgovApplyV2({ id: "r2", profileId: "p1" });
      expect(M.listTfgovApplysV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTfgovApplyV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTfgovApplyV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTfgovApplyV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDriftIdle", () => {
      M.setTfgovProfileIdleMsV2(1000);
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      const r = M.autoDriftIdleTfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTfgovProfileV2("p1").status).toBe("drifted");
    });
    it("autoFailStuck", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingTfgovApplyV2("r1");
      M.setTfgovApplyStuckMsV2(100);
      const r = M.autoFailStuckTfgovApplysV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTfgovProfileIdleMsV2(1000);
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDriftIdleTfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTerraformManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.applysByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTfgovProfileV2({ id: "p1", owner: "a" });
      M.activateTfgovProfileV2("p1");
      M.createTfgovApplyV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTerraformManagerGovStatsV2();
      expect(s2.totalTfgovProfilesV2).toBe(1);
      expect(s2.totalTfgovApplysV2).toBe(1);
    });
  });
});
