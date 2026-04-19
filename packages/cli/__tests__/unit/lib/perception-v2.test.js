import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/perception.js";

describe("Perception V2 Surface", () => {
  beforeEach(() => M._resetStatePerceptionGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PERCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PERCGOV_SIGNAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PERCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PERCGOV_SIGNAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePercgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePercgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPercgovSignalsPerProfileV2(33);
      expect(M.getMaxPendingPercgovSignalsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPercgovProfileIdleMsV2(60000);
      expect(M.getPercgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPercgovSignalStuckMsV2(45000);
      expect(M.getPercgovSignalStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePercgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPercgovSignalStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePercgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePercgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPercgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default modality", () =>
      expect(
        M.registerPercgovProfileV2({ id: "p1", owner: "a" }).modality,
      ).toBe("vision"));
    it("activate", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePercgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      expect(M.stalePercgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePercgovProfileV2("p1");
      M.stalePercgovProfileV2("p1");
      expect(M.activatePercgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      expect(M.archivePercgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      M.archivePercgovProfileV2("p1");
      expect(() => M.touchPercgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePercgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPercgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPercgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPercgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.registerPercgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPercgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPercgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPercgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePercgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPercgovProfileV2({ id, owner: "a" }),
      );
      M.activatePercgovProfileV2("p1");
      M.activatePercgovProfileV2("p2");
      expect(() => M.activatePercgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePercgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPercgovProfileV2({ id, owner: "a" }),
      );
      M.activatePercgovProfileV2("p1");
      M.activatePercgovProfileV2("p2");
      M.stalePercgovProfileV2("p1");
      M.activatePercgovProfileV2("p3");
      expect(() => M.activatePercgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePercgovProfilesPerOwnerV2(1);
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.registerPercgovProfileV2({ id: "p2", owner: "b" });
      M.activatePercgovProfileV2("p1");
      expect(() => M.activatePercgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("signal lifecycle", () => {
    beforeEach(() => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
    });
    it("create→analyzing→complete", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.analyzingPercgovSignalV2("r1");
      const r = M.completeSignalPercgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.analyzingPercgovSignalV2("r1");
      expect(M.failPercgovSignalV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPercgovSignalV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSignalPercgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPercgovSignalV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPercgovSignalsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPercgovSignalV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPercgovSignalV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("analyzing counts as pending", () => {
      M.setMaxPendingPercgovSignalsPerProfileV2(1);
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.analyzingPercgovSignalV2("r1");
      expect(() =>
        M.createPercgovSignalV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPercgovSignalsPerProfileV2(1);
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.analyzingPercgovSignalV2("r1");
      M.completeSignalPercgovV2("r1");
      expect(() =>
        M.createPercgovSignalV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPercgovSignalV2("nope")).toBeNull());
    it("list", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.createPercgovSignalV2({ id: "r2", profileId: "p1" });
      expect(M.listPercgovSignalsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPercgovSignalV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPercgovSignalV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPercgovSignalV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPercgovProfileIdleMsV2(1000);
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      const r = M.autoStaleIdlePercgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPercgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      M.analyzingPercgovSignalV2("r1");
      M.setPercgovSignalStuckMsV2(100);
      const r = M.autoFailStuckPercgovSignalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPercgovProfileIdleMsV2(1000);
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdlePercgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPerceptionGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.signalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPercgovProfileV2({ id: "p1", owner: "a" });
      M.activatePercgovProfileV2("p1");
      M.createPercgovSignalV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPerceptionGovStatsV2();
      expect(s2.totalPercgovProfilesV2).toBe(1);
      expect(s2.totalPercgovSignalsV2).toBe(1);
    });
  });
});
