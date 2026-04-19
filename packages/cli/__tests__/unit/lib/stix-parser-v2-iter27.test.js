import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/stix-parser.js";

describe("StixParserGov V2 Surface", () => {
  beforeEach(() => M._resetStateStixParserGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.STIXGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.STIXGOV_PARSE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.STIXGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.STIXGOV_PARSE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveStixgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveStixgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingStixgovParsesPerProfileV2(33);
      expect(M.getMaxPendingStixgovParsesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setStixgovProfileIdleMsV2(60000);
      expect(M.getStixgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setStixgovParseStuckMsV2(45000);
      expect(M.getStixgovParseStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveStixgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setStixgovParseStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveStixgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveStixgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerStixgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default stixVersion", () =>
      expect(
        M.registerStixgovProfileV2({ id: "p1", owner: "a" }).stixVersion,
      ).toBe("2.1"));
    it("activate", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateStixgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      expect(M.staleStixgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateStixgovProfileV2("p1");
      M.staleStixgovProfileV2("p1");
      expect(M.activateStixgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      expect(M.archiveStixgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      M.archiveStixgovProfileV2("p1");
      expect(() => M.touchStixgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleStixgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerStixgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerStixgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getStixgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.registerStixgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listStixgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getStixgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getStixgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveStixgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerStixgovProfileV2({ id, owner: "a" }),
      );
      M.activateStixgovProfileV2("p1");
      M.activateStixgovProfileV2("p2");
      expect(() => M.activateStixgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveStixgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerStixgovProfileV2({ id, owner: "a" }),
      );
      M.activateStixgovProfileV2("p1");
      M.activateStixgovProfileV2("p2");
      M.staleStixgovProfileV2("p1");
      M.activateStixgovProfileV2("p3");
      expect(() => M.activateStixgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveStixgovProfilesPerOwnerV2(1);
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.registerStixgovProfileV2({ id: "p2", owner: "b" });
      M.activateStixgovProfileV2("p1");
      expect(() => M.activateStixgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("parse lifecycle", () => {
    beforeEach(() => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
    });
    it("create→parsing→complete", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.parsingStixgovParseV2("r1");
      const r = M.completeParseStixgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.parsingStixgovParseV2("r1");
      expect(M.failStixgovParseV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      expect(M.cancelStixgovParseV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeParseStixgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createStixgovParseV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingStixgovParsesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createStixgovParseV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createStixgovParseV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("parsing counts as pending", () => {
      M.setMaxPendingStixgovParsesPerProfileV2(1);
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.parsingStixgovParseV2("r1");
      expect(() =>
        M.createStixgovParseV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingStixgovParsesPerProfileV2(1);
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.parsingStixgovParseV2("r1");
      M.completeParseStixgovV2("r1");
      expect(() =>
        M.createStixgovParseV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getStixgovParseV2("nope")).toBeNull());
    it("list", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.createStixgovParseV2({ id: "r2", profileId: "p1" });
      expect(M.listStixgovParsesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createStixgovParseV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createStixgovParseV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      expect(M.cancelStixgovParseV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setStixgovProfileIdleMsV2(1000);
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      const r = M.autoStaleIdleStixgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getStixgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      M.parsingStixgovParseV2("r1");
      M.setStixgovParseStuckMsV2(100);
      const r = M.autoFailStuckStixgovParsesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setStixgovProfileIdleMsV2(1000);
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleStixgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getStixParserGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.parsesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerStixgovProfileV2({ id: "p1", owner: "a" });
      M.activateStixgovProfileV2("p1");
      M.createStixgovParseV2({ id: "r1", profileId: "p1" });
      const s2 = M.getStixParserGovStatsV2();
      expect(s2.totalStixgovProfilesV2).toBe(1);
      expect(s2.totalStixgovParsesV2).toBe(1);
    });
  });
});
