import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-observe.js";

describe("CoworkObserveGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkObserveGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.COBSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.COBSGOV_EVENT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.COBSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.COBSGOV_EVENT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCobsgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCobsgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCobsgovEventsPerProfileV2(33);
      expect(M.getMaxPendingCobsgovEventsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCobsgovProfileIdleMsV2(60000);
      expect(M.getCobsgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCobsgovEventStuckMsV2(45000);
      expect(M.getCobsgovEventStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCobsgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCobsgovEventStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCobsgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCobsgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCobsgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerCobsgovProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCobsgovProfileV2("p1").status).toBe("active");
    });
    it("mute", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      expect(M.muteCobsgovProfileV2("p1").status).toBe("muted");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCobsgovProfileV2("p1");
      M.muteCobsgovProfileV2("p1");
      expect(M.activateCobsgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      expect(M.archiveCobsgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      M.archiveCobsgovProfileV2("p1");
      expect(() => M.touchCobsgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.muteCobsgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCobsgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCobsgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCobsgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.registerCobsgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCobsgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCobsgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCobsgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCobsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCobsgovProfileV2({ id, owner: "a" }),
      );
      M.activateCobsgovProfileV2("p1");
      M.activateCobsgovProfileV2("p2");
      expect(() => M.activateCobsgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCobsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCobsgovProfileV2({ id, owner: "a" }),
      );
      M.activateCobsgovProfileV2("p1");
      M.activateCobsgovProfileV2("p2");
      M.muteCobsgovProfileV2("p1");
      M.activateCobsgovProfileV2("p3");
      expect(() => M.activateCobsgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCobsgovProfilesPerOwnerV2(1);
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.registerCobsgovProfileV2({ id: "p2", owner: "b" });
      M.activateCobsgovProfileV2("p1");
      expect(() => M.activateCobsgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("event lifecycle", () => {
    beforeEach(() => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
    });
    it("create→recording→complete", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.recordingCobsgovEventV2("r1");
      const r = M.completeEventCobsgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.recordingCobsgovEventV2("r1");
      expect(M.failCobsgovEventV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCobsgovEventV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeEventCobsgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCobsgovEventV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCobsgovEventsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCobsgovEventV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCobsgovEventV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("recording counts as pending", () => {
      M.setMaxPendingCobsgovEventsPerProfileV2(1);
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.recordingCobsgovEventV2("r1");
      expect(() =>
        M.createCobsgovEventV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCobsgovEventsPerProfileV2(1);
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.recordingCobsgovEventV2("r1");
      M.completeEventCobsgovV2("r1");
      expect(() =>
        M.createCobsgovEventV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCobsgovEventV2("nope")).toBeNull());
    it("list", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.createCobsgovEventV2({ id: "r2", profileId: "p1" });
      expect(M.listCobsgovEventsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCobsgovEventV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCobsgovEventV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCobsgovEventV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoMuteIdle", () => {
      M.setCobsgovProfileIdleMsV2(1000);
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      const r = M.autoMuteIdleCobsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCobsgovProfileV2("p1").status).toBe("muted");
    });
    it("autoFailStuck", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      M.recordingCobsgovEventV2("r1");
      M.setCobsgovEventStuckMsV2(100);
      const r = M.autoFailStuckCobsgovEventsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCobsgovProfileIdleMsV2(1000);
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoMuteIdleCobsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkObserveGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.eventsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCobsgovProfileV2({ id: "p1", owner: "a" });
      M.activateCobsgovProfileV2("p1");
      M.createCobsgovEventV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkObserveGovStatsV2();
      expect(s2.totalCobsgovProfilesV2).toBe(1);
      expect(s2.totalCobsgovEventsV2).toBe(1);
    });
  });
});
