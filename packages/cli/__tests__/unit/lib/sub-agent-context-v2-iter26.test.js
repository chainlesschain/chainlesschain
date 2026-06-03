import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sub-agent-context.js";

describe("SubAgentContextGov V2 Surface", () => {
  beforeEach(() => M._resetStateSubAgentContextGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SACTXGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SACTXGOV_HANDOFF_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SACTXGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SACTXGOV_HANDOFF_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSactxgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSactxgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSactxgovHandoffsPerProfileV2(33);
      expect(M.getMaxPendingSactxgovHandoffsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSactxgovProfileIdleMsV2(60000);
      expect(M.getSactxgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSactxgovHandoffStuckMsV2(45000);
      expect(M.getSactxgovHandoffStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSactxgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSactxgovHandoffStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSactxgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSactxgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSactxgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default scope", () =>
      expect(M.registerSactxgovProfileV2({ id: "p1", owner: "a" }).scope).toBe(
        "task",
      ));
    it("activate", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSactxgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      expect(M.staleSactxgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSactxgovProfileV2("p1");
      M.staleSactxgovProfileV2("p1");
      expect(M.activateSactxgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      expect(M.archiveSactxgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      M.archiveSactxgovProfileV2("p1");
      expect(() => M.touchSactxgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleSactxgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSactxgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSactxgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSactxgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.registerSactxgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSactxgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSactxgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSactxgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSactxgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSactxgovProfileV2({ id, owner: "a" }),
      );
      M.activateSactxgovProfileV2("p1");
      M.activateSactxgovProfileV2("p2");
      expect(() => M.activateSactxgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSactxgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSactxgovProfileV2({ id, owner: "a" }),
      );
      M.activateSactxgovProfileV2("p1");
      M.activateSactxgovProfileV2("p2");
      M.staleSactxgovProfileV2("p1");
      M.activateSactxgovProfileV2("p3");
      expect(() => M.activateSactxgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSactxgovProfilesPerOwnerV2(1);
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.registerSactxgovProfileV2({ id: "p2", owner: "b" });
      M.activateSactxgovProfileV2("p1");
      expect(() => M.activateSactxgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("handoff lifecycle", () => {
    beforeEach(() => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
    });
    it("create→transferring→complete", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.transferringSactxgovHandoffV2("r1");
      const r = M.completeHandoffSactxgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.transferringSactxgovHandoffV2("r1");
      expect(M.failSactxgovHandoffV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSactxgovHandoffV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeHandoffSactxgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSactxgovHandoffV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSactxgovHandoffsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSactxgovHandoffV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSactxgovHandoffV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("transferring counts as pending", () => {
      M.setMaxPendingSactxgovHandoffsPerProfileV2(1);
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.transferringSactxgovHandoffV2("r1");
      expect(() =>
        M.createSactxgovHandoffV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSactxgovHandoffsPerProfileV2(1);
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.transferringSactxgovHandoffV2("r1");
      M.completeHandoffSactxgovV2("r1");
      expect(() =>
        M.createSactxgovHandoffV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSactxgovHandoffV2("nope")).toBeNull());
    it("list", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.createSactxgovHandoffV2({ id: "r2", profileId: "p1" });
      expect(M.listSactxgovHandoffsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSactxgovHandoffV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSactxgovHandoffV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setSactxgovProfileIdleMsV2(1000);
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      const r = M.autoStaleIdleSactxgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSactxgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      M.transferringSactxgovHandoffV2("r1");
      M.setSactxgovHandoffStuckMsV2(100);
      const r = M.autoFailStuckSactxgovHandoffsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSactxgovProfileIdleMsV2(1000);
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleSactxgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSubAgentContextGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.handoffsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSactxgovProfileV2({ id: "p1", owner: "a" });
      M.activateSactxgovProfileV2("p1");
      M.createSactxgovHandoffV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSubAgentContextGovStatsV2();
      expect(s2.totalSactxgovProfilesV2).toBe(1);
      expect(s2.totalSactxgovHandoffsV2).toBe(1);
    });
  });
});
