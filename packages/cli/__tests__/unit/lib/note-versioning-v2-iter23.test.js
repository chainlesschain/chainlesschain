import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/note-versioning.js";

describe("NoteVersioningGov V2 Surface", () => {
  beforeEach(() => M._resetStateNoteVersioningGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.NTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.NTGOV_REVISION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.NTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.NTGOV_REVISION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveNtgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveNtgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingNtgovRevisionsPerProfileV2(33);
      expect(M.getMaxPendingNtgovRevisionsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setNtgovProfileIdleMsV2(60000);
      expect(M.getNtgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setNtgovRevisionStuckMsV2(45000);
      expect(M.getNtgovRevisionStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveNtgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setNtgovRevisionStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveNtgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveNtgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerNtgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default series", () =>
      expect(M.registerNtgovProfileV2({ id: "p1", owner: "a" }).series).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateNtgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      expect(M.staleNtgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateNtgovProfileV2("p1");
      M.staleNtgovProfileV2("p1");
      expect(M.activateNtgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      expect(M.archiveNtgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      M.archiveNtgovProfileV2("p1");
      expect(() => M.touchNtgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleNtgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerNtgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerNtgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getNtgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.registerNtgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listNtgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getNtgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getNtgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveNtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNtgovProfileV2({ id, owner: "a" }),
      );
      M.activateNtgovProfileV2("p1");
      M.activateNtgovProfileV2("p2");
      expect(() => M.activateNtgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveNtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNtgovProfileV2({ id, owner: "a" }),
      );
      M.activateNtgovProfileV2("p1");
      M.activateNtgovProfileV2("p2");
      M.staleNtgovProfileV2("p1");
      M.activateNtgovProfileV2("p3");
      expect(() => M.activateNtgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveNtgovProfilesPerOwnerV2(1);
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.registerNtgovProfileV2({ id: "p2", owner: "b" });
      M.activateNtgovProfileV2("p1");
      expect(() => M.activateNtgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("revision lifecycle", () => {
    beforeEach(() => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
    });
    it("create→reviewing→complete", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.reviewingNtgovRevisionV2("r1");
      const r = M.completeRevisionNtgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.reviewingNtgovRevisionV2("r1");
      expect(M.failNtgovRevisionV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNtgovRevisionV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRevisionNtgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createNtgovRevisionV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingNtgovRevisionsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createNtgovRevisionV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createNtgovRevisionV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("reviewing counts as pending", () => {
      M.setMaxPendingNtgovRevisionsPerProfileV2(1);
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.reviewingNtgovRevisionV2("r1");
      expect(() =>
        M.createNtgovRevisionV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingNtgovRevisionsPerProfileV2(1);
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.reviewingNtgovRevisionV2("r1");
      M.completeRevisionNtgovV2("r1");
      expect(() =>
        M.createNtgovRevisionV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getNtgovRevisionV2("nope")).toBeNull());
    it("list", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.createNtgovRevisionV2({ id: "r2", profileId: "p1" });
      expect(M.listNtgovRevisionsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createNtgovRevisionV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createNtgovRevisionV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNtgovRevisionV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setNtgovProfileIdleMsV2(1000);
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      const r = M.autoStaleIdleNtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getNtgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      M.reviewingNtgovRevisionV2("r1");
      M.setNtgovRevisionStuckMsV2(100);
      const r = M.autoFailStuckNtgovRevisionsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setNtgovProfileIdleMsV2(1000);
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleNtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getNoteVersioningGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.revisionsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerNtgovProfileV2({ id: "p1", owner: "a" });
      M.activateNtgovProfileV2("p1");
      M.createNtgovRevisionV2({ id: "r1", profileId: "p1" });
      const s2 = M.getNoteVersioningGovStatsV2();
      expect(s2.totalNtgovProfilesV2).toBe(1);
      expect(s2.totalNtgovRevisionsV2).toBe(1);
    });
  });
});
