import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/interactive-planner.js";

describe("InteractivePlannerGov V2 Surface", () => {
  beforeEach(() => M._resetStateInteractivePlannerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PLANNERGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PLANNERGOV_PROMPT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PLANNERGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PLANNERGOV_PROMPT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePlannergovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePlannergovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPlannergovPromptsPerProfileV2(33);
      expect(M.getMaxPendingPlannergovPromptsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPlannergovProfileIdleMsV2(60000);
      expect(M.getPlannergovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPlannergovPromptStuckMsV2(45000);
      expect(M.getPlannergovPromptStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePlannergovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPlannergovPromptStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePlannergovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePlannergovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(
        M.registerPlannergovProfileV2({ id: "p1", owner: "a" }).status,
      ).toBe("pending"));
    it("default persona", () =>
      expect(
        M.registerPlannergovProfileV2({ id: "p1", owner: "a" }).persona,
      ).toBe("default"));
    it("activate", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePlannergovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      expect(M.pausePlannergovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePlannergovProfileV2("p1");
      M.pausePlannergovProfileV2("p1");
      expect(M.activatePlannergovProfileV2("p1").activatedAt).toBe(
        a.activatedAt,
      );
    });
    it("archive terminal", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      expect(M.archivePlannergovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      M.archivePlannergovProfileV2("p1");
      expect(() => M.touchPlannergovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausePlannergovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPlannergovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPlannergovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPlannergovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.registerPlannergovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPlannergovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPlannergovProfileV2({
        id: "p1",
        owner: "a",
        metadata: { x: 1 },
      });
      const p = M.getPlannergovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPlannergovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePlannergovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPlannergovProfileV2({ id, owner: "a" }),
      );
      M.activatePlannergovProfileV2("p1");
      M.activatePlannergovProfileV2("p2");
      expect(() => M.activatePlannergovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePlannergovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPlannergovProfileV2({ id, owner: "a" }),
      );
      M.activatePlannergovProfileV2("p1");
      M.activatePlannergovProfileV2("p2");
      M.pausePlannergovProfileV2("p1");
      M.activatePlannergovProfileV2("p3");
      expect(() => M.activatePlannergovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePlannergovProfilesPerOwnerV2(1);
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.registerPlannergovProfileV2({ id: "p2", owner: "b" });
      M.activatePlannergovProfileV2("p1");
      expect(() => M.activatePlannergovProfileV2("p2")).not.toThrow();
    });
  });

  describe("prompt lifecycle", () => {
    beforeEach(() => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
    });
    it("create→asking→complete", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.askingPlannergovPromptV2("r1");
      const r = M.completePromptPlannergovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.askingPlannergovPromptV2("r1");
      expect(M.failPlannergovPromptV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPlannergovPromptV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePromptPlannergovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPlannergovPromptV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPlannergovPromptsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPlannergovPromptV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPlannergovPromptV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("asking counts as pending", () => {
      M.setMaxPendingPlannergovPromptsPerProfileV2(1);
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.askingPlannergovPromptV2("r1");
      expect(() =>
        M.createPlannergovPromptV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPlannergovPromptsPerProfileV2(1);
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.askingPlannergovPromptV2("r1");
      M.completePromptPlannergovV2("r1");
      expect(() =>
        M.createPlannergovPromptV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPlannergovPromptV2("nope")).toBeNull());
    it("list", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.createPlannergovPromptV2({ id: "r2", profileId: "p1" });
      expect(M.listPlannergovPromptsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPlannergovPromptV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPlannergovPromptV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPlannergovPromptV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setPlannergovProfileIdleMsV2(1000);
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      const r = M.autoPauseIdlePlannergovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPlannergovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      M.askingPlannergovPromptV2("r1");
      M.setPlannergovPromptStuckMsV2(100);
      const r = M.autoFailStuckPlannergovPromptsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPlannergovProfileIdleMsV2(1000);
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdlePlannergovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getInteractivePlannerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.promptsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPlannergovProfileV2({ id: "p1", owner: "a" });
      M.activatePlannergovProfileV2("p1");
      M.createPlannergovPromptV2({ id: "r1", profileId: "p1" });
      const s2 = M.getInteractivePlannerGovStatsV2();
      expect(s2.totalPlannergovProfilesV2).toBe(1);
      expect(s2.totalPlannergovPromptsV2).toBe(1);
    });
  });
});
