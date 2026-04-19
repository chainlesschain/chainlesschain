import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/llm-providers.js";

describe("LlmProviders V2 Surface", () => {
  beforeEach(() => M._resetStateLlmProvidersGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.LLMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.LLMGOV_COMPLETION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.LLMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.LLMGOV_COMPLETION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveLlmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveLlmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingLlmgovCompletionsPerProfileV2(33);
      expect(M.getMaxPendingLlmgovCompletionsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setLlmgovProfileIdleMsV2(60000);
      expect(M.getLlmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setLlmgovCompletionStuckMsV2(45000);
      expect(M.getLlmgovCompletionStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveLlmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setLlmgovCompletionStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveLlmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveLlmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerLlmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default provider", () =>
      expect(M.registerLlmgovProfileV2({ id: "p1", owner: "a" }).provider).toBe(
        "ollama",
      ));
    it("activate", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateLlmgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      expect(M.degradeLlmgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateLlmgovProfileV2("p1");
      M.degradeLlmgovProfileV2("p1");
      expect(M.activateLlmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      expect(M.archiveLlmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      M.archiveLlmgovProfileV2("p1");
      expect(() => M.touchLlmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeLlmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerLlmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerLlmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getLlmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.registerLlmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listLlmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getLlmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getLlmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveLlmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerLlmgovProfileV2({ id, owner: "a" }),
      );
      M.activateLlmgovProfileV2("p1");
      M.activateLlmgovProfileV2("p2");
      expect(() => M.activateLlmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveLlmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerLlmgovProfileV2({ id, owner: "a" }),
      );
      M.activateLlmgovProfileV2("p1");
      M.activateLlmgovProfileV2("p2");
      M.degradeLlmgovProfileV2("p1");
      M.activateLlmgovProfileV2("p3");
      expect(() => M.activateLlmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveLlmgovProfilesPerOwnerV2(1);
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.registerLlmgovProfileV2({ id: "p2", owner: "b" });
      M.activateLlmgovProfileV2("p1");
      expect(() => M.activateLlmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("completion lifecycle", () => {
    beforeEach(() => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
    });
    it("create→inferring→complete", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.inferringLlmgovCompletionV2("r1");
      const r = M.completeCompletionLlmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.inferringLlmgovCompletionV2("r1");
      expect(M.failLlmgovCompletionV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelLlmgovCompletionV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCompletionLlmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createLlmgovCompletionV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingLlmgovCompletionsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createLlmgovCompletionV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createLlmgovCompletionV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("inferring counts as pending", () => {
      M.setMaxPendingLlmgovCompletionsPerProfileV2(1);
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.inferringLlmgovCompletionV2("r1");
      expect(() =>
        M.createLlmgovCompletionV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingLlmgovCompletionsPerProfileV2(1);
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.inferringLlmgovCompletionV2("r1");
      M.completeCompletionLlmgovV2("r1");
      expect(() =>
        M.createLlmgovCompletionV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getLlmgovCompletionV2("nope")).toBeNull());
    it("list", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.createLlmgovCompletionV2({ id: "r2", profileId: "p1" });
      expect(M.listLlmgovCompletionsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createLlmgovCompletionV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelLlmgovCompletionV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setLlmgovProfileIdleMsV2(1000);
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      const r = M.autoDegradeIdleLlmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getLlmgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      M.inferringLlmgovCompletionV2("r1");
      M.setLlmgovCompletionStuckMsV2(100);
      const r = M.autoFailStuckLlmgovCompletionsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setLlmgovProfileIdleMsV2(1000);
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleLlmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getLlmProvidersGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.completionsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerLlmgovProfileV2({ id: "p1", owner: "a" });
      M.activateLlmgovProfileV2("p1");
      M.createLlmgovCompletionV2({ id: "r1", profileId: "p1" });
      const s2 = M.getLlmProvidersGovStatsV2();
      expect(s2.totalLlmgovProfilesV2).toBe(1);
      expect(s2.totalLlmgovCompletionsV2).toBe(1);
    });
  });
});
