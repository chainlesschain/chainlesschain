import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/hierarchical-memory.js";

describe("Hmemgov V2 Surface", () => {
  beforeEach(() => M._resetStateHmemgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.HMEMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.HMEMGOV_RECALL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.HMEMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.HMEMGOV_RECALL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveHmemProfilesPerOwnerV2(11);
      expect(M.getMaxActiveHmemProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingHmemRecallsPerProfileV2(33);
      expect(M.getMaxPendingHmemRecallsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setHmemProfileIdleMsV2(60000);
      expect(M.getHmemProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setHmemRecallStuckMsV2(45000);
      expect(M.getHmemRecallStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveHmemProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setHmemRecallStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveHmemProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveHmemProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerHmemProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default tier", () =>
      expect(M.registerHmemProfileV2({ id: "p1", owner: "a" }).tier).toBe(
        "short-term",
      ));
    it("activate", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      expect(M.activateHmemProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      expect(M.staleHmemProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      const a = M.activateHmemProfileV2("p1");
      M.staleHmemProfileV2("p1");
      expect(M.activateHmemProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      expect(M.archiveHmemProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      M.archiveHmemProfileV2("p1");
      expect(() => M.touchHmemProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleHmemProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerHmemProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerHmemProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getHmemProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.registerHmemProfileV2({ id: "p2", owner: "b" });
      expect(M.listHmemProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getHmemProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getHmemProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveHmemProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHmemProfileV2({ id, owner: "a" }),
      );
      M.activateHmemProfileV2("p1");
      M.activateHmemProfileV2("p2");
      expect(() => M.activateHmemProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveHmemProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHmemProfileV2({ id, owner: "a" }),
      );
      M.activateHmemProfileV2("p1");
      M.activateHmemProfileV2("p2");
      M.staleHmemProfileV2("p1");
      M.activateHmemProfileV2("p3");
      expect(() => M.activateHmemProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveHmemProfilesPerOwnerV2(1);
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.registerHmemProfileV2({ id: "p2", owner: "b" });
      M.activateHmemProfileV2("p1");
      expect(() => M.activateHmemProfileV2("p2")).not.toThrow();
    });
  });

  describe("recall lifecycle", () => {
    beforeEach(() => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
    });
    it("create→recalling→complete", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.recallingHmemRecallV2("r1");
      const r = M.completeRecallHmemV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.recallingHmemRecallV2("r1");
      expect(M.failHmemRecallV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHmemRecallV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRecallHmemV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createHmemRecallV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingHmemRecallsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createHmemRecallV2({ id, profileId: "p1" }),
      );
      expect(() => M.createHmemRecallV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("recalling counts as pending", () => {
      M.setMaxPendingHmemRecallsPerProfileV2(1);
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.recallingHmemRecallV2("r1");
      expect(() =>
        M.createHmemRecallV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingHmemRecallsPerProfileV2(1);
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.recallingHmemRecallV2("r1");
      M.completeRecallHmemV2("r1");
      expect(() =>
        M.createHmemRecallV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getHmemRecallV2("nope")).toBeNull());
    it("list", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.createHmemRecallV2({ id: "r2", profileId: "p1" });
      expect(M.listHmemRecallsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createHmemRecallV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createHmemRecallV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHmemRecallV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setHmemProfileIdleMsV2(1000);
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      const r = M.autoStaleIdleHmemProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getHmemProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      M.recallingHmemRecallV2("r1");
      M.setHmemRecallStuckMsV2(100);
      const r = M.autoFailStuckHmemRecallsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setHmemProfileIdleMsV2(1000);
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleHmemProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getHmemgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.recallsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerHmemProfileV2({ id: "p1", owner: "a" });
      M.activateHmemProfileV2("p1");
      M.createHmemRecallV2({ id: "r1", profileId: "p1" });
      const s2 = M.getHmemgovStatsV2();
      expect(s2.totalHmemProfilesV2).toBe(1);
      expect(s2.totalHmemRecallsV2).toBe(1);
    });
  });
});
