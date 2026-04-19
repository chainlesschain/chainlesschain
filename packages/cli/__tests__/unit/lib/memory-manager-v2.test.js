import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/memory-manager.js";

describe("MemoryManager V2 Surface", () => {
  beforeEach(() => M._resetStateMemoryManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.MEMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.MEMGOV_RECALL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.MEMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.MEMGOV_RECALL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveMemgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveMemgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingMemgovRecallsPerProfileV2(33);
      expect(M.getMaxPendingMemgovRecallsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setMemgovProfileIdleMsV2(60000);
      expect(M.getMemgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setMemgovRecallStuckMsV2(45000);
      expect(M.getMemgovRecallStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveMemgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setMemgovRecallStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveMemgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveMemgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerMemgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default scope", () =>
      expect(M.registerMemgovProfileV2({ id: "p1", owner: "a" }).scope).toBe(
        "user",
      ));
    it("activate", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateMemgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      expect(M.staleMemgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateMemgovProfileV2("p1");
      M.staleMemgovProfileV2("p1");
      expect(M.activateMemgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      expect(M.archiveMemgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      M.archiveMemgovProfileV2("p1");
      expect(() => M.touchMemgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleMemgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerMemgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerMemgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getMemgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.registerMemgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listMemgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getMemgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getMemgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveMemgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMemgovProfileV2({ id, owner: "a" }),
      );
      M.activateMemgovProfileV2("p1");
      M.activateMemgovProfileV2("p2");
      expect(() => M.activateMemgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveMemgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMemgovProfileV2({ id, owner: "a" }),
      );
      M.activateMemgovProfileV2("p1");
      M.activateMemgovProfileV2("p2");
      M.staleMemgovProfileV2("p1");
      M.activateMemgovProfileV2("p3");
      expect(() => M.activateMemgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveMemgovProfilesPerOwnerV2(1);
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.registerMemgovProfileV2({ id: "p2", owner: "b" });
      M.activateMemgovProfileV2("p1");
      expect(() => M.activateMemgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("recall lifecycle", () => {
    beforeEach(() => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
    });
    it("create→recalling→complete", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.recallingMemgovRecallV2("r1");
      const r = M.completeRecallMemgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.recallingMemgovRecallV2("r1");
      expect(M.failMemgovRecallV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMemgovRecallV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRecallMemgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createMemgovRecallV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingMemgovRecallsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createMemgovRecallV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createMemgovRecallV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("recalling counts as pending", () => {
      M.setMaxPendingMemgovRecallsPerProfileV2(1);
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.recallingMemgovRecallV2("r1");
      expect(() =>
        M.createMemgovRecallV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingMemgovRecallsPerProfileV2(1);
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.recallingMemgovRecallV2("r1");
      M.completeRecallMemgovV2("r1");
      expect(() =>
        M.createMemgovRecallV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getMemgovRecallV2("nope")).toBeNull());
    it("list", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.createMemgovRecallV2({ id: "r2", profileId: "p1" });
      expect(M.listMemgovRecallsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createMemgovRecallV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createMemgovRecallV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMemgovRecallV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setMemgovProfileIdleMsV2(1000);
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      const r = M.autoStaleIdleMemgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getMemgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      M.recallingMemgovRecallV2("r1");
      M.setMemgovRecallStuckMsV2(100);
      const r = M.autoFailStuckMemgovRecallsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setMemgovProfileIdleMsV2(1000);
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleMemgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getMemoryManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.recallsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerMemgovProfileV2({ id: "p1", owner: "a" });
      M.activateMemgovProfileV2("p1");
      M.createMemgovRecallV2({ id: "r1", profileId: "p1" });
      const s2 = M.getMemoryManagerGovStatsV2();
      expect(s2.totalMemgovProfilesV2).toBe(1);
      expect(s2.totalMemgovRecallsV2).toBe(1);
    });
  });
});
