import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/feature-flags.js";

describe("Feature Flags V2 Surface", () => {
  beforeEach(() => M._resetStateFeatureFlagsV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.FFLAG_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.FFLAG_EVAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.FFLAG_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.FFLAG_EVAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveFflagProfilesPerOwnerV2(11);
      expect(M.getMaxActiveFflagProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingFflagEvalsPerProfileV2(33);
      expect(M.getMaxPendingFflagEvalsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setFflagProfileIdleMsV2(60000);
      expect(M.getFflagProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setFflagEvalStuckMsV2(45000);
      expect(M.getFflagEvalStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveFflagProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setFflagEvalStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveFflagProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveFflagProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(
        M.registerFflagProfileV2({ id: "p1", owner: "alice" }).status,
      ).toBe("pending"));
    it("default scope", () =>
      expect(M.registerFflagProfileV2({ id: "p1", owner: "a" }).scope).toBe(
        "*",
      ));
    it("activate", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      expect(M.activateFflagProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      expect(M.pauseFflagProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      const a = M.activateFflagProfileV2("p1");
      M.pauseFflagProfileV2("p1");
      expect(M.activateFflagProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      expect(M.archiveFflagProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      M.archiveFflagProfileV2("p1");
      expect(() => M.touchFflagProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseFflagProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerFflagProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerFflagProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getFflagProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.registerFflagProfileV2({ id: "p2", owner: "b" });
      expect(M.listFflagProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getFflagProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getFflagProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveFflagProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerFflagProfileV2({ id, owner: "a" }),
      );
      M.activateFflagProfileV2("p1");
      M.activateFflagProfileV2("p2");
      expect(() => M.activateFflagProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveFflagProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerFflagProfileV2({ id, owner: "a" }),
      );
      M.activateFflagProfileV2("p1");
      M.activateFflagProfileV2("p2");
      M.pauseFflagProfileV2("p1");
      M.activateFflagProfileV2("p3");
      expect(() => M.activateFflagProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveFflagProfilesPerOwnerV2(1);
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.registerFflagProfileV2({ id: "p2", owner: "b" });
      M.activateFflagProfileV2("p1");
      expect(() => M.activateFflagProfileV2("p2")).not.toThrow();
    });
  });

  describe("eval lifecycle", () => {
    beforeEach(() => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
    });
    it("create→evaluating→evaluate", () => {
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      M.evaluatingFflagEvalV2("e1");
      const e = M.evaluateFflagEvalV2("e1");
      expect(e.status).toBe("evaluated");
      expect(e.startedAt).toBeTruthy();
    });
    it("fail", () => {
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      M.evaluatingFflagEvalV2("e1");
      expect(M.failFflagEvalV2("e1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      expect(M.cancelFflagEvalV2("e1").status).toBe("cancelled");
    });
    it("invalid evaluate from queued", () => {
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      expect(() => M.evaluateFflagEvalV2("e1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createFflagEvalV2({ id: "e1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingFflagEvalsPerProfileV2(2);
      ["e1", "e2"].forEach((id) =>
        M.createFflagEvalV2({ id, profileId: "p1" }),
      );
      expect(() => M.createFflagEvalV2({ id: "e3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("evaluating counts as pending", () => {
      M.setMaxPendingFflagEvalsPerProfileV2(1);
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      M.evaluatingFflagEvalV2("e1");
      expect(() =>
        M.createFflagEvalV2({ id: "e2", profileId: "p1" }),
      ).toThrow();
    });
    it("evaluated frees slot", () => {
      M.setMaxPendingFflagEvalsPerProfileV2(1);
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      M.evaluatingFflagEvalV2("e1");
      M.evaluateFflagEvalV2("e1");
      expect(() =>
        M.createFflagEvalV2({ id: "e2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setFflagProfileIdleMsV2(1000);
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      const r = M.autoPauseIdleFflagProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getFflagProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      M.evaluatingFflagEvalV2("e1");
      M.setFflagEvalStuckMsV2(100);
      const r = M.autoFailStuckFflagEvalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getFflagEvalV2("e1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("zero-init keys", () => {
      const s = M.getFeatureFlagsGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.evalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerFflagProfileV2({ id: "p1", owner: "a" });
      M.activateFflagProfileV2("p1");
      M.createFflagEvalV2({ id: "e1", profileId: "p1" });
      const s = M.getFeatureFlagsGovStatsV2();
      expect(s.totalFflagProfilesV2).toBe(1);
      expect(s.totalFflagEvalsV2).toBe(1);
    });
  });
});
