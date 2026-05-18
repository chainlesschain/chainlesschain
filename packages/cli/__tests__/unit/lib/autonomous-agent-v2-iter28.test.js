import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/autonomous-agent.js";

describe("Autagov V2 Surface", () => {
  beforeEach(() => M._resetStateAutagovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.AUTAGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.AUTAGOV_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.AUTAGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AUTAGOV_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAutagProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAutagProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAutagRunsPerProfileV2(33);
      expect(M.getMaxPendingAutagRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAutagProfileIdleMsV2(60000);
      expect(M.getAutagProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAutagRunStuckMsV2(45000);
      expect(M.getAutagRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAutagProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAutagRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAutagProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAutagProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAutagProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default tier", () =>
      expect(M.registerAutagProfileV2({ id: "p1", owner: "a" }).tier).toBe(
        "assist",
      ));
    it("activate", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAutagProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      expect(M.pausedAutagProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAutagProfileV2("p1");
      M.pausedAutagProfileV2("p1");
      expect(M.activateAutagProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      expect(M.archiveAutagProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      M.archiveAutagProfileV2("p1");
      expect(() => M.touchAutagProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedAutagProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerAutagProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAutagProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAutagProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.registerAutagProfileV2({ id: "p2", owner: "b" });
      expect(M.listAutagProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAutagProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAutagProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAutagProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAutagProfileV2({ id, owner: "a" }),
      );
      M.activateAutagProfileV2("p1");
      M.activateAutagProfileV2("p2");
      expect(() => M.activateAutagProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAutagProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAutagProfileV2({ id, owner: "a" }),
      );
      M.activateAutagProfileV2("p1");
      M.activateAutagProfileV2("p2");
      M.pausedAutagProfileV2("p1");
      M.activateAutagProfileV2("p3");
      expect(() => M.activateAutagProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAutagProfilesPerOwnerV2(1);
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.registerAutagProfileV2({ id: "p2", owner: "b" });
      M.activateAutagProfileV2("p1");
      expect(() => M.activateAutagProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.runningAutagRunV2("r1");
      const r = M.completeRunAutagV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.runningAutagRunV2("r1");
      expect(M.failAutagRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAutagRunV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRunAutagV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAutagRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAutagRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createAutagRunV2({ id, profileId: "p1" }));
      expect(() => M.createAutagRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingAutagRunsPerProfileV2(1);
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.runningAutagRunV2("r1");
      expect(() => M.createAutagRunV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAutagRunsPerProfileV2(1);
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.runningAutagRunV2("r1");
      M.completeRunAutagV2("r1");
      expect(() =>
        M.createAutagRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAutagRunV2("nope")).toBeNull());
    it("list", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.createAutagRunV2({ id: "r2", profileId: "p1" });
      expect(M.listAutagRunsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAutagRunV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.createAutagRunV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAutagRunV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setAutagProfileIdleMsV2(1000);
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      const r = M.autoPausedIdleAutagProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAutagProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      M.runningAutagRunV2("r1");
      M.setAutagRunStuckMsV2(100);
      const r = M.autoFailStuckAutagRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAutagProfileIdleMsV2(1000);
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdleAutagProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAutagovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAutagProfileV2({ id: "p1", owner: "a" });
      M.activateAutagProfileV2("p1");
      M.createAutagRunV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAutagovStatsV2();
      expect(s2.totalAutagProfilesV2).toBe(1);
      expect(s2.totalAutagRunsV2).toBe(1);
    });
  });
});
