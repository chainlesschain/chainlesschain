import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/threat-intel.js";

describe("ThreatIntelGov V2 Surface", () => {
  beforeEach(() => M._resetStateThreatIntelGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TIGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TIGOV_FEED_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TIGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TIGOV_FEED_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTigovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTigovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTigovFeedsPerProfileV2(33);
      expect(M.getMaxPendingTigovFeedsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTigovProfileIdleMsV2(60000);
      expect(M.getTigovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTigovFeedStuckMsV2(45000);
      expect(M.getTigovFeedStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTigovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTigovFeedStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTigovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTigovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTigovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default source", () =>
      expect(M.registerTigovProfileV2({ id: "p1", owner: "a" }).source).toBe(
        "otx",
      ));
    it("activate", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTigovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      expect(M.staleTigovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTigovProfileV2("p1");
      M.staleTigovProfileV2("p1");
      expect(M.activateTigovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      expect(M.archiveTigovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      M.archiveTigovProfileV2("p1");
      expect(() => M.touchTigovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleTigovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTigovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTigovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTigovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.registerTigovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTigovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTigovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTigovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTigovProfileV2({ id, owner: "a" }),
      );
      M.activateTigovProfileV2("p1");
      M.activateTigovProfileV2("p2");
      expect(() => M.activateTigovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTigovProfileV2({ id, owner: "a" }),
      );
      M.activateTigovProfileV2("p1");
      M.activateTigovProfileV2("p2");
      M.staleTigovProfileV2("p1");
      M.activateTigovProfileV2("p3");
      expect(() => M.activateTigovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTigovProfilesPerOwnerV2(1);
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.registerTigovProfileV2({ id: "p2", owner: "b" });
      M.activateTigovProfileV2("p1");
      expect(() => M.activateTigovProfileV2("p2")).not.toThrow();
    });
  });

  describe("feed lifecycle", () => {
    beforeEach(() => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
    });
    it("create→ingesting→complete", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.ingestingTigovFeedV2("r1");
      const r = M.completeFeedTigovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.ingestingTigovFeedV2("r1");
      expect(M.failTigovFeedV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTigovFeedV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeFeedTigovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTigovFeedV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTigovFeedsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTigovFeedV2({ id, profileId: "p1" }),
      );
      expect(() => M.createTigovFeedV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("ingesting counts as pending", () => {
      M.setMaxPendingTigovFeedsPerProfileV2(1);
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.ingestingTigovFeedV2("r1");
      expect(() =>
        M.createTigovFeedV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTigovFeedsPerProfileV2(1);
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.ingestingTigovFeedV2("r1");
      M.completeFeedTigovV2("r1");
      expect(() =>
        M.createTigovFeedV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTigovFeedV2("nope")).toBeNull());
    it("list", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.createTigovFeedV2({ id: "r2", profileId: "p1" });
      expect(M.listTigovFeedsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTigovFeedV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTigovFeedV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTigovFeedV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setTigovProfileIdleMsV2(1000);
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      const r = M.autoStaleIdleTigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTigovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      M.ingestingTigovFeedV2("r1");
      M.setTigovFeedStuckMsV2(100);
      const r = M.autoFailStuckTigovFeedsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTigovProfileIdleMsV2(1000);
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleTigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getThreatIntelGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.feedsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTigovProfileV2({ id: "p1", owner: "a" });
      M.activateTigovProfileV2("p1");
      M.createTigovFeedV2({ id: "r1", profileId: "p1" });
      const s2 = M.getThreatIntelGovStatsV2();
      expect(s2.totalTigovProfilesV2).toBe(1);
      expect(s2.totalTigovFeedsV2).toBe(1);
    });
  });
});
