import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/pipeline-orchestrator.js";

describe("Pipogov V2 Surface", () => {
  beforeEach(() => M._resetStatePipogovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PIPOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PIPOGOV_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PIPOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PIPOGOV_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePipoProfilesPerOwnerV2(11);
      expect(M.getMaxActivePipoProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPipoRunsPerProfileV2(33);
      expect(M.getMaxPendingPipoRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPipoProfileIdleMsV2(60000);
      expect(M.getPipoProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPipoRunStuckMsV2(45000);
      expect(M.getPipoRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePipoProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setPipoRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePipoProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePipoProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPipoProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default pipeline", () =>
      expect(M.registerPipoProfileV2({ id: "p1", owner: "a" }).pipeline).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePipoProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      expect(M.pausedPipoProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePipoProfileV2("p1");
      M.pausedPipoProfileV2("p1");
      expect(M.activatePipoProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      expect(M.archivePipoProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      M.archivePipoProfileV2("p1");
      expect(() => M.touchPipoProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedPipoProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerPipoProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPipoProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPipoProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.registerPipoProfileV2({ id: "p2", owner: "b" });
      expect(M.listPipoProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPipoProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPipoProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePipoProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPipoProfileV2({ id, owner: "a" }),
      );
      M.activatePipoProfileV2("p1");
      M.activatePipoProfileV2("p2");
      expect(() => M.activatePipoProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePipoProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPipoProfileV2({ id, owner: "a" }),
      );
      M.activatePipoProfileV2("p1");
      M.activatePipoProfileV2("p2");
      M.pausedPipoProfileV2("p1");
      M.activatePipoProfileV2("p3");
      expect(() => M.activatePipoProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePipoProfilesPerOwnerV2(1);
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.registerPipoProfileV2({ id: "p2", owner: "b" });
      M.activatePipoProfileV2("p1");
      expect(() => M.activatePipoProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.runningPipoRunV2("r1");
      const r = M.completeRunPipoV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.runningPipoRunV2("r1");
      expect(M.failPipoRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPipoRunV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRunPipoV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPipoRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPipoRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createPipoRunV2({ id, profileId: "p1" }));
      expect(() => M.createPipoRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingPipoRunsPerProfileV2(1);
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.runningPipoRunV2("r1");
      expect(() => M.createPipoRunV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPipoRunsPerProfileV2(1);
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.runningPipoRunV2("r1");
      M.completeRunPipoV2("r1");
      expect(() =>
        M.createPipoRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPipoRunV2("nope")).toBeNull());
    it("list", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.createPipoRunV2({ id: "r2", profileId: "p1" });
      expect(M.listPipoRunsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPipoRunV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.createPipoRunV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPipoRunV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setPipoProfileIdleMsV2(1000);
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      const r = M.autoPausedIdlePipoProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPipoProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      M.runningPipoRunV2("r1");
      M.setPipoRunStuckMsV2(100);
      const r = M.autoFailStuckPipoRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPipoProfileIdleMsV2(1000);
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdlePipoProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPipogovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPipoProfileV2({ id: "p1", owner: "a" });
      M.activatePipoProfileV2("p1");
      M.createPipoRunV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPipogovStatsV2();
      expect(s2.totalPipoProfilesV2).toBe(1);
      expect(s2.totalPipoRunsV2).toBe(1);
    });
  });
});
