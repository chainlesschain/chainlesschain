import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/tech-learning-engine.js";

describe("TechLearningEngineGov V2 Surface", () => {
  beforeEach(() => M._resetStateTechLearningEngineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TECHGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TECHGOV_LESSON_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TECHGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TECHGOV_LESSON_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTechgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTechgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTechgovLessonsPerProfileV2(33);
      expect(M.getMaxPendingTechgovLessonsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTechgovProfileIdleMsV2(60000);
      expect(M.getTechgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTechgovLessonStuckMsV2(45000);
      expect(M.getTechgovLessonStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTechgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTechgovLessonStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTechgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTechgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTechgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default topic", () =>
      expect(M.registerTechgovProfileV2({ id: "p1", owner: "a" }).topic).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTechgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      expect(M.staleTechgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTechgovProfileV2("p1");
      M.staleTechgovProfileV2("p1");
      expect(M.activateTechgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      expect(M.archiveTechgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      M.archiveTechgovProfileV2("p1");
      expect(() => M.touchTechgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleTechgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTechgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTechgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTechgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.registerTechgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTechgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTechgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTechgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTechgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTechgovProfileV2({ id, owner: "a" }),
      );
      M.activateTechgovProfileV2("p1");
      M.activateTechgovProfileV2("p2");
      expect(() => M.activateTechgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTechgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTechgovProfileV2({ id, owner: "a" }),
      );
      M.activateTechgovProfileV2("p1");
      M.activateTechgovProfileV2("p2");
      M.staleTechgovProfileV2("p1");
      M.activateTechgovProfileV2("p3");
      expect(() => M.activateTechgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTechgovProfilesPerOwnerV2(1);
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.registerTechgovProfileV2({ id: "p2", owner: "b" });
      M.activateTechgovProfileV2("p1");
      expect(() => M.activateTechgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("lesson lifecycle", () => {
    beforeEach(() => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
    });
    it("create→studying→complete", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.studyingTechgovLessonV2("r1");
      const r = M.completeLessonTechgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.studyingTechgovLessonV2("r1");
      expect(M.failTechgovLessonV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTechgovLessonV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeLessonTechgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTechgovLessonV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTechgovLessonsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTechgovLessonV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createTechgovLessonV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("studying counts as pending", () => {
      M.setMaxPendingTechgovLessonsPerProfileV2(1);
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.studyingTechgovLessonV2("r1");
      expect(() =>
        M.createTechgovLessonV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTechgovLessonsPerProfileV2(1);
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.studyingTechgovLessonV2("r1");
      M.completeLessonTechgovV2("r1");
      expect(() =>
        M.createTechgovLessonV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTechgovLessonV2("nope")).toBeNull());
    it("list", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.createTechgovLessonV2({ id: "r2", profileId: "p1" });
      expect(M.listTechgovLessonsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTechgovLessonV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTechgovLessonV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTechgovLessonV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setTechgovProfileIdleMsV2(1000);
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      const r = M.autoStaleIdleTechgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTechgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      M.studyingTechgovLessonV2("r1");
      M.setTechgovLessonStuckMsV2(100);
      const r = M.autoFailStuckTechgovLessonsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTechgovProfileIdleMsV2(1000);
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleTechgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTechLearningEngineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.lessonsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTechgovProfileV2({ id: "p1", owner: "a" });
      M.activateTechgovProfileV2("p1");
      M.createTechgovLessonV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTechLearningEngineGovStatsV2();
      expect(s2.totalTechgovProfilesV2).toBe(1);
      expect(s2.totalTechgovLessonsV2).toBe(1);
    });
  });
});
