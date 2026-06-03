import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/inference-network.js";

describe("Infnetgov V2 Surface", () => {
  beforeEach(() => M._resetStateInfnetgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.INFNETGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.INFNETGOV_REQUEST_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.INFNETGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.INFNETGOV_REQUEST_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveInfnetProfilesPerOwnerV2(11);
      expect(M.getMaxActiveInfnetProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingInfnetRequestsPerProfileV2(33);
      expect(M.getMaxPendingInfnetRequestsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setInfnetProfileIdleMsV2(60000);
      expect(M.getInfnetProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setInfnetRequestStuckMsV2(45000);
      expect(M.getInfnetRequestStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveInfnetProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setInfnetRequestStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveInfnetProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveInfnetProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerInfnetProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default node", () =>
      expect(M.registerInfnetProfileV2({ id: "p1", owner: "a" }).node).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      expect(M.activateInfnetProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      expect(M.staleInfnetProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      const a = M.activateInfnetProfileV2("p1");
      M.staleInfnetProfileV2("p1");
      expect(M.activateInfnetProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      expect(M.archiveInfnetProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      M.archiveInfnetProfileV2("p1");
      expect(() => M.touchInfnetProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleInfnetProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerInfnetProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerInfnetProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getInfnetProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.registerInfnetProfileV2({ id: "p2", owner: "b" });
      expect(M.listInfnetProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getInfnetProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getInfnetProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveInfnetProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerInfnetProfileV2({ id, owner: "a" }),
      );
      M.activateInfnetProfileV2("p1");
      M.activateInfnetProfileV2("p2");
      expect(() => M.activateInfnetProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveInfnetProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerInfnetProfileV2({ id, owner: "a" }),
      );
      M.activateInfnetProfileV2("p1");
      M.activateInfnetProfileV2("p2");
      M.staleInfnetProfileV2("p1");
      M.activateInfnetProfileV2("p3");
      expect(() => M.activateInfnetProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveInfnetProfilesPerOwnerV2(1);
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.registerInfnetProfileV2({ id: "p2", owner: "b" });
      M.activateInfnetProfileV2("p1");
      expect(() => M.activateInfnetProfileV2("p2")).not.toThrow();
    });
  });

  describe("request lifecycle", () => {
    beforeEach(() => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
    });
    it("create→inferring→complete", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.inferringInfnetRequestV2("r1");
      const r = M.completeRequestInfnetV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.inferringInfnetRequestV2("r1");
      expect(M.failInfnetRequestV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelInfnetRequestV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRequestInfnetV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createInfnetRequestV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingInfnetRequestsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createInfnetRequestV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createInfnetRequestV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("inferring counts as pending", () => {
      M.setMaxPendingInfnetRequestsPerProfileV2(1);
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.inferringInfnetRequestV2("r1");
      expect(() =>
        M.createInfnetRequestV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingInfnetRequestsPerProfileV2(1);
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.inferringInfnetRequestV2("r1");
      M.completeRequestInfnetV2("r1");
      expect(() =>
        M.createInfnetRequestV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getInfnetRequestV2("nope")).toBeNull());
    it("list", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.createInfnetRequestV2({ id: "r2", profileId: "p1" });
      expect(M.listInfnetRequestsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createInfnetRequestV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createInfnetRequestV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelInfnetRequestV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setInfnetProfileIdleMsV2(1000);
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      const r = M.autoStaleIdleInfnetProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getInfnetProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      M.inferringInfnetRequestV2("r1");
      M.setInfnetRequestStuckMsV2(100);
      const r = M.autoFailStuckInfnetRequestsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setInfnetProfileIdleMsV2(1000);
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleInfnetProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getInfnetgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.requestsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerInfnetProfileV2({ id: "p1", owner: "a" });
      M.activateInfnetProfileV2("p1");
      M.createInfnetRequestV2({ id: "r1", profileId: "p1" });
      const s2 = M.getInfnetgovStatsV2();
      expect(s2.totalInfnetProfilesV2).toBe(1);
      expect(s2.totalInfnetRequestsV2).toBe(1);
    });
  });
});
