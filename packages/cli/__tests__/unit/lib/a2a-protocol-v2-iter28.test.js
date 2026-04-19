import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/a2a-protocol.js";

describe("A2apgov V2 Surface", () => {
  beforeEach(() => M._resetStateA2apgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.A2APGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.A2APGOV_MSG_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.A2APGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.A2APGOV_MSG_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveA2apProfilesPerOwnerV2(11);
      expect(M.getMaxActiveA2apProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingA2apMsgsPerProfileV2(33);
      expect(M.getMaxPendingA2apMsgsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setA2apProfileIdleMsV2(60000);
      expect(M.getA2apProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setA2apMsgStuckMsV2(45000);
      expect(M.getA2apMsgStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveA2apProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setA2apMsgStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveA2apProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveA2apProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerA2apProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default endpoint", () =>
      expect(M.registerA2apProfileV2({ id: "p1", owner: "a" }).endpoint).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      expect(M.activateA2apProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      expect(M.staleA2apProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      const a = M.activateA2apProfileV2("p1");
      M.staleA2apProfileV2("p1");
      expect(M.activateA2apProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      expect(M.archiveA2apProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      M.archiveA2apProfileV2("p1");
      expect(() => M.touchA2apProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleA2apProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerA2apProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerA2apProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getA2apProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.registerA2apProfileV2({ id: "p2", owner: "b" });
      expect(M.listA2apProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getA2apProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getA2apProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveA2apProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerA2apProfileV2({ id, owner: "a" }),
      );
      M.activateA2apProfileV2("p1");
      M.activateA2apProfileV2("p2");
      expect(() => M.activateA2apProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveA2apProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerA2apProfileV2({ id, owner: "a" }),
      );
      M.activateA2apProfileV2("p1");
      M.activateA2apProfileV2("p2");
      M.staleA2apProfileV2("p1");
      M.activateA2apProfileV2("p3");
      expect(() => M.activateA2apProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveA2apProfilesPerOwnerV2(1);
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.registerA2apProfileV2({ id: "p2", owner: "b" });
      M.activateA2apProfileV2("p1");
      expect(() => M.activateA2apProfileV2("p2")).not.toThrow();
    });
  });

  describe("msg lifecycle", () => {
    beforeEach(() => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
    });
    it("create→dispatching→complete", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.dispatchingA2apMsgV2("r1");
      const r = M.completeMsgA2apV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.dispatchingA2apMsgV2("r1");
      expect(M.failA2apMsgV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelA2apMsgV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMsgA2apV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createA2apMsgV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingA2apMsgsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createA2apMsgV2({ id, profileId: "p1" }));
      expect(() => M.createA2apMsgV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("dispatching counts as pending", () => {
      M.setMaxPendingA2apMsgsPerProfileV2(1);
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.dispatchingA2apMsgV2("r1");
      expect(() => M.createA2apMsgV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingA2apMsgsPerProfileV2(1);
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.dispatchingA2apMsgV2("r1");
      M.completeMsgA2apV2("r1");
      expect(() =>
        M.createA2apMsgV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getA2apMsgV2("nope")).toBeNull());
    it("list", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.createA2apMsgV2({ id: "r2", profileId: "p1" });
      expect(M.listA2apMsgsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createA2apMsgV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      expect(() => M.createA2apMsgV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelA2apMsgV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setA2apProfileIdleMsV2(1000);
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      const r = M.autoStaleIdleA2apProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getA2apProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      M.dispatchingA2apMsgV2("r1");
      M.setA2apMsgStuckMsV2(100);
      const r = M.autoFailStuckA2apMsgsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setA2apProfileIdleMsV2(1000);
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleA2apProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getA2apgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.msgsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerA2apProfileV2({ id: "p1", owner: "a" });
      M.activateA2apProfileV2("p1");
      M.createA2apMsgV2({ id: "r1", profileId: "p1" });
      const s2 = M.getA2apgovStatsV2();
      expect(s2.totalA2apProfilesV2).toBe(1);
      expect(s2.totalA2apMsgsV2).toBe(1);
    });
  });
});
