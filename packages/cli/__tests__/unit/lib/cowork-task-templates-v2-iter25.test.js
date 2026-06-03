import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-task-templates.js";

describe("CoworkTaskTemplatesGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkTaskTemplatesGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CTTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CTTGOV_USE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CTTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CTTGOV_USE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCttgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCttgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCttgovUsesPerProfileV2(33);
      expect(M.getMaxPendingCttgovUsesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCttgovProfileIdleMsV2(60000);
      expect(M.getCttgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCttgovUseStuckMsV2(45000);
      expect(M.getCttgovUseStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCttgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCttgovUseStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCttgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCttgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCttgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default category", () =>
      expect(M.registerCttgovProfileV2({ id: "p1", owner: "a" }).category).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCttgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      expect(M.staleCttgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCttgovProfileV2("p1");
      M.staleCttgovProfileV2("p1");
      expect(M.activateCttgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      expect(M.archiveCttgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      M.archiveCttgovProfileV2("p1");
      expect(() => M.touchCttgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCttgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCttgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCttgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCttgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.registerCttgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCttgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCttgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCttgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCttgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCttgovProfileV2({ id, owner: "a" }),
      );
      M.activateCttgovProfileV2("p1");
      M.activateCttgovProfileV2("p2");
      expect(() => M.activateCttgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCttgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCttgovProfileV2({ id, owner: "a" }),
      );
      M.activateCttgovProfileV2("p1");
      M.activateCttgovProfileV2("p2");
      M.staleCttgovProfileV2("p1");
      M.activateCttgovProfileV2("p3");
      expect(() => M.activateCttgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCttgovProfilesPerOwnerV2(1);
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.registerCttgovProfileV2({ id: "p2", owner: "b" });
      M.activateCttgovProfileV2("p1");
      expect(() => M.activateCttgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("use lifecycle", () => {
    beforeEach(() => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
    });
    it("create→applying→complete", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.applyingCttgovUseV2("r1");
      const r = M.completeUseCttgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.applyingCttgovUseV2("r1");
      expect(M.failCttgovUseV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCttgovUseV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeUseCttgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCttgovUseV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCttgovUsesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCttgovUseV2({ id, profileId: "p1" }),
      );
      expect(() => M.createCttgovUseV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("applying counts as pending", () => {
      M.setMaxPendingCttgovUsesPerProfileV2(1);
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.applyingCttgovUseV2("r1");
      expect(() =>
        M.createCttgovUseV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCttgovUsesPerProfileV2(1);
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.applyingCttgovUseV2("r1");
      M.completeUseCttgovV2("r1");
      expect(() =>
        M.createCttgovUseV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCttgovUseV2("nope")).toBeNull());
    it("list", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.createCttgovUseV2({ id: "r2", profileId: "p1" });
      expect(M.listCttgovUsesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCttgovUseV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCttgovUseV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCttgovUseV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCttgovProfileIdleMsV2(1000);
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      const r = M.autoStaleIdleCttgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCttgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      M.applyingCttgovUseV2("r1");
      M.setCttgovUseStuckMsV2(100);
      const r = M.autoFailStuckCttgovUsesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCttgovProfileIdleMsV2(1000);
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCttgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkTaskTemplatesGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.usesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCttgovProfileV2({ id: "p1", owner: "a" });
      M.activateCttgovProfileV2("p1");
      M.createCttgovUseV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkTaskTemplatesGovStatsV2();
      expect(s2.totalCttgovProfilesV2).toBe(1);
      expect(s2.totalCttgovUsesV2).toBe(1);
    });
  });
});
