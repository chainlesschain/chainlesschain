import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evomap-manager.js";

describe("Emgrgov V2 Surface", () => {
  beforeEach(() => M._resetStateEmgrgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.EMGRGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.EMGRGOV_OP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.EMGRGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.EMGRGOV_OP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEmgrProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEmgrProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEmgrOpsPerProfileV2(33);
      expect(M.getMaxPendingEmgrOpsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEmgrProfileIdleMsV2(60000);
      expect(M.getEmgrProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEmgrOpStuckMsV2(45000);
      expect(M.getEmgrOpStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEmgrProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setEmgrOpStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEmgrProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEmgrProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEmgrProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default map", () =>
      expect(M.registerEmgrProfileV2({ id: "p1", owner: "a" }).map).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEmgrProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      expect(M.staleEmgrProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEmgrProfileV2("p1");
      M.staleEmgrProfileV2("p1");
      expect(M.activateEmgrProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      expect(M.archiveEmgrProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      M.archiveEmgrProfileV2("p1");
      expect(() => M.touchEmgrProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleEmgrProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerEmgrProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEmgrProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEmgrProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.registerEmgrProfileV2({ id: "p2", owner: "b" });
      expect(M.listEmgrProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEmgrProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEmgrProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEmgrProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEmgrProfileV2({ id, owner: "a" }),
      );
      M.activateEmgrProfileV2("p1");
      M.activateEmgrProfileV2("p2");
      expect(() => M.activateEmgrProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEmgrProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEmgrProfileV2({ id, owner: "a" }),
      );
      M.activateEmgrProfileV2("p1");
      M.activateEmgrProfileV2("p2");
      M.staleEmgrProfileV2("p1");
      M.activateEmgrProfileV2("p3");
      expect(() => M.activateEmgrProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEmgrProfilesPerOwnerV2(1);
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.registerEmgrProfileV2({ id: "p2", owner: "b" });
      M.activateEmgrProfileV2("p1");
      expect(() => M.activateEmgrProfileV2("p2")).not.toThrow();
    });
  });

  describe("op lifecycle", () => {
    beforeEach(() => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
    });
    it("create→operating→complete", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.operatingEmgrOpV2("r1");
      const r = M.completeOpEmgrV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.operatingEmgrOpV2("r1");
      expect(M.failEmgrOpV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEmgrOpV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeOpEmgrV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEmgrOpV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEmgrOpsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createEmgrOpV2({ id, profileId: "p1" }));
      expect(() => M.createEmgrOpV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("operating counts as pending", () => {
      M.setMaxPendingEmgrOpsPerProfileV2(1);
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.operatingEmgrOpV2("r1");
      expect(() => M.createEmgrOpV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEmgrOpsPerProfileV2(1);
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.operatingEmgrOpV2("r1");
      M.completeOpEmgrV2("r1");
      expect(() =>
        M.createEmgrOpV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEmgrOpV2("nope")).toBeNull());
    it("list", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.createEmgrOpV2({ id: "r2", profileId: "p1" });
      expect(M.listEmgrOpsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEmgrOpV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      expect(() => M.createEmgrOpV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEmgrOpV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setEmgrProfileIdleMsV2(1000);
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      const r = M.autoStaleIdleEmgrProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEmgrProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      M.operatingEmgrOpV2("r1");
      M.setEmgrOpStuckMsV2(100);
      const r = M.autoFailStuckEmgrOpsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEmgrProfileIdleMsV2(1000);
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleEmgrProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getEmgrgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.opsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEmgrProfileV2({ id: "p1", owner: "a" });
      M.activateEmgrProfileV2("p1");
      M.createEmgrOpV2({ id: "r1", profileId: "p1" });
      const s2 = M.getEmgrgovStatsV2();
      expect(s2.totalEmgrProfilesV2).toBe(1);
      expect(s2.totalEmgrOpsV2).toBe(1);
    });
  });
});
