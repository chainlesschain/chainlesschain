import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/skill-mcp.js";

describe("SkillMcpGov V2 Surface", () => {
  beforeEach(() => M._resetStateSkillMcpGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SMCPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SMCPGOV_CALL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SMCPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SMCPGOV_CALL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSmcpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSmcpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSmcpgovCallsPerProfileV2(33);
      expect(M.getMaxPendingSmcpgovCallsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSmcpgovProfileIdleMsV2(60000);
      expect(M.getSmcpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSmcpgovCallStuckMsV2(45000);
      expect(M.getSmcpgovCallStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSmcpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSmcpgovCallStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSmcpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSmcpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSmcpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default server", () =>
      expect(M.registerSmcpgovProfileV2({ id: "p1", owner: "a" }).server).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSmcpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      expect(M.staleSmcpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSmcpgovProfileV2("p1");
      M.staleSmcpgovProfileV2("p1");
      expect(M.activateSmcpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      expect(M.archiveSmcpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      M.archiveSmcpgovProfileV2("p1");
      expect(() => M.touchSmcpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleSmcpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSmcpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSmcpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSmcpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmcpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSmcpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSmcpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSmcpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSmcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmcpgovProfileV2("p1");
      M.activateSmcpgovProfileV2("p2");
      expect(() => M.activateSmcpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSmcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSmcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateSmcpgovProfileV2("p1");
      M.activateSmcpgovProfileV2("p2");
      M.staleSmcpgovProfileV2("p1");
      M.activateSmcpgovProfileV2("p3");
      expect(() => M.activateSmcpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSmcpgovProfilesPerOwnerV2(1);
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerSmcpgovProfileV2({ id: "p2", owner: "b" });
      M.activateSmcpgovProfileV2("p1");
      expect(() => M.activateSmcpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("call lifecycle", () => {
    beforeEach(() => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
    });
    it("create→invoking→complete", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.invokingSmcpgovCallV2("r1");
      const r = M.completeCallSmcpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.invokingSmcpgovCallV2("r1");
      expect(M.failSmcpgovCallV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmcpgovCallV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCallSmcpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSmcpgovCallV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSmcpgovCallsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSmcpgovCallV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSmcpgovCallV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("invoking counts as pending", () => {
      M.setMaxPendingSmcpgovCallsPerProfileV2(1);
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.invokingSmcpgovCallV2("r1");
      expect(() =>
        M.createSmcpgovCallV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSmcpgovCallsPerProfileV2(1);
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.invokingSmcpgovCallV2("r1");
      M.completeCallSmcpgovV2("r1");
      expect(() =>
        M.createSmcpgovCallV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSmcpgovCallV2("nope")).toBeNull());
    it("list", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.createSmcpgovCallV2({ id: "r2", profileId: "p1" });
      expect(M.listSmcpgovCallsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSmcpgovCallV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSmcpgovCallV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSmcpgovCallV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setSmcpgovProfileIdleMsV2(1000);
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      const r = M.autoStaleIdleSmcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSmcpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      M.invokingSmcpgovCallV2("r1");
      M.setSmcpgovCallStuckMsV2(100);
      const r = M.autoFailStuckSmcpgovCallsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSmcpgovProfileIdleMsV2(1000);
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleSmcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSkillMcpGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.callsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateSmcpgovProfileV2("p1");
      M.createSmcpgovCallV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSkillMcpGovStatsV2();
      expect(s2.totalSmcpgovProfilesV2).toBe(1);
      expect(s2.totalSmcpgovCallsV2).toBe(1);
    });
  });
});
