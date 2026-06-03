import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/chat-core.js";

describe("Ccoregov V2 Surface", () => {
  beforeEach(() => M._resetStateCcoregovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CCOREGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CCOREGOV_MSG_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CCOREGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CCOREGOV_MSG_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCcoreProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCcoreProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCcoreMsgsPerProfileV2(33);
      expect(M.getMaxPendingCcoreMsgsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCcoreProfileIdleMsV2(60000);
      expect(M.getCcoreProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCcoreMsgStuckMsV2(45000);
      expect(M.getCcoreMsgStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCcoreProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCcoreMsgStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCcoreProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCcoreProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCcoreProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerCcoreProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCcoreProfileV2("p1").status).toBe("active");
    });
    it("idle", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      expect(M.idleCcoreProfileV2("p1").status).toBe("idle");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCcoreProfileV2("p1");
      M.idleCcoreProfileV2("p1");
      expect(M.activateCcoreProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      expect(M.archiveCcoreProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      M.archiveCcoreProfileV2("p1");
      expect(() => M.touchCcoreProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      expect(() => M.idleCcoreProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCcoreProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCcoreProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCcoreProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.registerCcoreProfileV2({ id: "p2", owner: "b" });
      expect(M.listCcoreProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCcoreProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCcoreProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCcoreProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCcoreProfileV2({ id, owner: "a" }),
      );
      M.activateCcoreProfileV2("p1");
      M.activateCcoreProfileV2("p2");
      expect(() => M.activateCcoreProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCcoreProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCcoreProfileV2({ id, owner: "a" }),
      );
      M.activateCcoreProfileV2("p1");
      M.activateCcoreProfileV2("p2");
      M.idleCcoreProfileV2("p1");
      M.activateCcoreProfileV2("p3");
      expect(() => M.activateCcoreProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCcoreProfilesPerOwnerV2(1);
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.registerCcoreProfileV2({ id: "p2", owner: "b" });
      M.activateCcoreProfileV2("p1");
      expect(() => M.activateCcoreProfileV2("p2")).not.toThrow();
    });
  });

  describe("msg lifecycle", () => {
    beforeEach(() => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
    });
    it("create→sending→complete", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.sendingCcoreMsgV2("r1");
      const r = M.completeMsgCcoreV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.sendingCcoreMsgV2("r1");
      expect(M.failCcoreMsgV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCcoreMsgV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMsgCcoreV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCcoreMsgV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCcoreMsgsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createCcoreMsgV2({ id, profileId: "p1" }));
      expect(() => M.createCcoreMsgV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("sending counts as pending", () => {
      M.setMaxPendingCcoreMsgsPerProfileV2(1);
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.sendingCcoreMsgV2("r1");
      expect(() => M.createCcoreMsgV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCcoreMsgsPerProfileV2(1);
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.sendingCcoreMsgV2("r1");
      M.completeMsgCcoreV2("r1");
      expect(() =>
        M.createCcoreMsgV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCcoreMsgV2("nope")).toBeNull());
    it("list", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.createCcoreMsgV2({ id: "r2", profileId: "p1" });
      expect(M.listCcoreMsgsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCcoreMsgV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      expect(() => M.createCcoreMsgV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCcoreMsgV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoIdleIdle", () => {
      M.setCcoreProfileIdleMsV2(1000);
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      const r = M.autoIdleIdleCcoreProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCcoreProfileV2("p1").status).toBe("idle");
    });
    it("autoFailStuck", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      M.sendingCcoreMsgV2("r1");
      M.setCcoreMsgStuckMsV2(100);
      const r = M.autoFailStuckCcoreMsgsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCcoreProfileIdleMsV2(1000);
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      const r = M.autoIdleIdleCcoreProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCcoregovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.msgsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCcoreProfileV2({ id: "p1", owner: "a" });
      M.activateCcoreProfileV2("p1");
      M.createCcoreMsgV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCcoregovStatsV2();
      expect(s2.totalCcoreProfilesV2).toBe(1);
      expect(s2.totalCcoreMsgsV2).toBe(1);
    });
  });
});
