import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/nl-programming.js";

describe("NlProgramming V2 Surface", () => {
  beforeEach(() => M._resetStateNlProgrammingGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.NLPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.NLPGOV_TRANSLATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.NLPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.NLPGOV_TRANSLATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveNlpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveNlpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingNlpgovTranslationsPerProfileV2(33);
      expect(M.getMaxPendingNlpgovTranslationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setNlpgovProfileIdleMsV2(60000);
      expect(M.getNlpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setNlpgovTranslationStuckMsV2(45000);
      expect(M.getNlpgovTranslationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveNlpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setNlpgovTranslationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveNlpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveNlpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerNlpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default style", () =>
      expect(M.registerNlpgovProfileV2({ id: "p1", owner: "a" }).style).toBe(
        "natural",
      ));
    it("activate", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateNlpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      expect(M.staleNlpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateNlpgovProfileV2("p1");
      M.staleNlpgovProfileV2("p1");
      expect(M.activateNlpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      expect(M.archiveNlpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      M.archiveNlpgovProfileV2("p1");
      expect(() => M.touchNlpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleNlpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerNlpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerNlpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getNlpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.registerNlpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listNlpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getNlpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getNlpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveNlpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNlpgovProfileV2({ id, owner: "a" }),
      );
      M.activateNlpgovProfileV2("p1");
      M.activateNlpgovProfileV2("p2");
      expect(() => M.activateNlpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveNlpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNlpgovProfileV2({ id, owner: "a" }),
      );
      M.activateNlpgovProfileV2("p1");
      M.activateNlpgovProfileV2("p2");
      M.staleNlpgovProfileV2("p1");
      M.activateNlpgovProfileV2("p3");
      expect(() => M.activateNlpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveNlpgovProfilesPerOwnerV2(1);
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.registerNlpgovProfileV2({ id: "p2", owner: "b" });
      M.activateNlpgovProfileV2("p1");
      expect(() => M.activateNlpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("translation lifecycle", () => {
    beforeEach(() => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
    });
    it("create→translating→complete", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.translatingNlpgovTranslationV2("r1");
      const r = M.completeTranslationNlpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.translatingNlpgovTranslationV2("r1");
      expect(M.failNlpgovTranslationV2("r1", "x").metadata.failReason).toBe(
        "x",
      );
    });
    it("cancel from queued", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNlpgovTranslationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTranslationNlpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createNlpgovTranslationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingNlpgovTranslationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createNlpgovTranslationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createNlpgovTranslationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("translating counts as pending", () => {
      M.setMaxPendingNlpgovTranslationsPerProfileV2(1);
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.translatingNlpgovTranslationV2("r1");
      expect(() =>
        M.createNlpgovTranslationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingNlpgovTranslationsPerProfileV2(1);
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.translatingNlpgovTranslationV2("r1");
      M.completeTranslationNlpgovV2("r1");
      expect(() =>
        M.createNlpgovTranslationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getNlpgovTranslationV2("nope")).toBeNull());
    it("list", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.createNlpgovTranslationV2({ id: "r2", profileId: "p1" });
      expect(M.listNlpgovTranslationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createNlpgovTranslationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNlpgovTranslationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setNlpgovProfileIdleMsV2(1000);
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      const r = M.autoStaleIdleNlpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getNlpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      M.translatingNlpgovTranslationV2("r1");
      M.setNlpgovTranslationStuckMsV2(100);
      const r = M.autoFailStuckNlpgovTranslationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setNlpgovProfileIdleMsV2(1000);
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleNlpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getNlProgrammingGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.translationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerNlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateNlpgovProfileV2("p1");
      M.createNlpgovTranslationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getNlProgrammingGovStatsV2();
      expect(s2.totalNlpgovProfilesV2).toBe(1);
      expect(s2.totalNlpgovTranslationsV2).toBe(1);
    });
  });
});
