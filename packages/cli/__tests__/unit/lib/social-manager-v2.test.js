import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/social-manager.js";

describe("SocialManager V2 Surface", () => {
  beforeEach(() => M._resetStateSocialManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SMGOV_POST_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SMGOV_POST_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSmgovPostsPerProfileV2(33);
      expect(M.getMaxPendingSmgovPostsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSmgovProfileIdleMsV2(60000);
      expect(M.getSmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSmgovPostStuckMsV2(45000);
      expect(M.getSmgovPostStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSmgovPostStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerSmgovProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "timeline",
      ));
    it("activate", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSmgovProfileV2("p1").status).toBe("active");
    });
    it("mute", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      expect(M.muteSmgovProfileV2("p1").status).toBe("muted");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSmgovProfileV2("p1");
      M.muteSmgovProfileV2("p1");
      expect(M.activateSmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      expect(M.archiveSmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      M.archiveSmgovProfileV2("p1");
      expect(() => M.touchSmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.muteSmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmgovProfileV2("p1");
      M.activateSmgovProfileV2("p2");
      expect(() => M.activateSmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmgovProfileV2("p1");
      M.activateSmgovProfileV2("p2");
      M.muteSmgovProfileV2("p1");
      M.activateSmgovProfileV2("p3");
      expect(() => M.activateSmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSmgovProfilesPerOwnerV2(1);
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmgovProfileV2({ id: "p2", owner: "b" });
      M.activateSmgovProfileV2("p1");
      expect(() => M.activateSmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("post lifecycle", () => {
    beforeEach(() => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
    });
    it("create→posting→complete", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.postingSmgovPostV2("r1");
      const r = M.completePostSmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.postingSmgovPostV2("r1");
      expect(M.failSmgovPostV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmgovPostV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePostSmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSmgovPostV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSmgovPostsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSmgovPostV2({ id, profileId: "p1" }),
      );
      expect(() => M.createSmgovPostV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("posting counts as pending", () => {
      M.setMaxPendingSmgovPostsPerProfileV2(1);
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.postingSmgovPostV2("r1");
      expect(() =>
        M.createSmgovPostV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSmgovPostsPerProfileV2(1);
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.postingSmgovPostV2("r1");
      M.completePostSmgovV2("r1");
      expect(() =>
        M.createSmgovPostV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSmgovPostV2("nope")).toBeNull());
    it("list", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.createSmgovPostV2({ id: "r2", profileId: "p1" });
      expect(M.listSmgovPostsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSmgovPostV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSmgovPostV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmgovPostV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoMuteIdle", () => {
      M.setSmgovProfileIdleMsV2(1000);
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      const r = M.autoMuteIdleSmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSmgovProfileV2("p1").status).toBe("muted");
    });
    it("autoFailStuck", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      M.postingSmgovPostV2("r1");
      M.setSmgovPostStuckMsV2(100);
      const r = M.autoFailStuckSmgovPostsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSmgovProfileIdleMsV2(1000);
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoMuteIdleSmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSocialManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.postsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSmgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmgovProfileV2("p1");
      M.createSmgovPostV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSocialManagerGovStatsV2();
      expect(s2.totalSmgovProfilesV2).toBe(1);
      expect(s2.totalSmgovPostsV2).toBe(1);
    });
  });
});
