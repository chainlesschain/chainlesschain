import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/hashline.js";

describe("HashlineGov V2 Surface", () => {
  beforeEach(() => M._resetStateHashlineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.HLGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.HLGOV_DIGEST_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.HLGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.HLGOV_DIGEST_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveHlgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveHlgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingHlgovDigestsPerProfileV2(33);
      expect(M.getMaxPendingHlgovDigestsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setHlgovProfileIdleMsV2(60000);
      expect(M.getHlgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setHlgovDigestStuckMsV2(45000);
      expect(M.getHlgovDigestStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveHlgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setHlgovDigestStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveHlgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveHlgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerHlgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default algorithm", () =>
      expect(M.registerHlgovProfileV2({ id: "p1", owner: "a" }).algorithm).toBe(
        "sha256",
      ));
    it("activate", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateHlgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      expect(M.staleHlgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateHlgovProfileV2("p1");
      M.staleHlgovProfileV2("p1");
      expect(M.activateHlgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      expect(M.archiveHlgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      M.archiveHlgovProfileV2("p1");
      expect(() => M.touchHlgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleHlgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerHlgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerHlgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getHlgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.registerHlgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listHlgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getHlgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getHlgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveHlgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHlgovProfileV2({ id, owner: "a" }),
      );
      M.activateHlgovProfileV2("p1");
      M.activateHlgovProfileV2("p2");
      expect(() => M.activateHlgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveHlgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHlgovProfileV2({ id, owner: "a" }),
      );
      M.activateHlgovProfileV2("p1");
      M.activateHlgovProfileV2("p2");
      M.staleHlgovProfileV2("p1");
      M.activateHlgovProfileV2("p3");
      expect(() => M.activateHlgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveHlgovProfilesPerOwnerV2(1);
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.registerHlgovProfileV2({ id: "p2", owner: "b" });
      M.activateHlgovProfileV2("p1");
      expect(() => M.activateHlgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("digest lifecycle", () => {
    beforeEach(() => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
    });
    it("create→hashing→complete", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.hashingHlgovDigestV2("r1");
      const r = M.completeDigestHlgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.hashingHlgovDigestV2("r1");
      expect(M.failHlgovDigestV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHlgovDigestV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDigestHlgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createHlgovDigestV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingHlgovDigestsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createHlgovDigestV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createHlgovDigestV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("hashing counts as pending", () => {
      M.setMaxPendingHlgovDigestsPerProfileV2(1);
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.hashingHlgovDigestV2("r1");
      expect(() =>
        M.createHlgovDigestV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingHlgovDigestsPerProfileV2(1);
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.hashingHlgovDigestV2("r1");
      M.completeDigestHlgovV2("r1");
      expect(() =>
        M.createHlgovDigestV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getHlgovDigestV2("nope")).toBeNull());
    it("list", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.createHlgovDigestV2({ id: "r2", profileId: "p1" });
      expect(M.listHlgovDigestsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createHlgovDigestV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createHlgovDigestV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHlgovDigestV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setHlgovProfileIdleMsV2(1000);
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      const r = M.autoStaleIdleHlgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getHlgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      M.hashingHlgovDigestV2("r1");
      M.setHlgovDigestStuckMsV2(100);
      const r = M.autoFailStuckHlgovDigestsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setHlgovProfileIdleMsV2(1000);
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleHlgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getHashlineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.digestsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerHlgovProfileV2({ id: "p1", owner: "a" });
      M.activateHlgovProfileV2("p1");
      M.createHlgovDigestV2({ id: "r1", profileId: "p1" });
      const s2 = M.getHashlineGovStatsV2();
      expect(s2.totalHlgovProfilesV2).toBe(1);
      expect(s2.totalHlgovDigestsV2).toBe(1);
    });
  });
});
