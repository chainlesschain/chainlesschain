import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/agent-router.js";

describe("AgentRouterGov V2 Surface", () => {
  beforeEach(() => M._resetStateAgentRouterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ARGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ARGOV_ROUTING_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ARGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ARGOV_ROUTING_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveArgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveArgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingArgovRoutingsPerProfileV2(33);
      expect(M.getMaxPendingArgovRoutingsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setArgovProfileIdleMsV2(60000);
      expect(M.getArgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setArgovRoutingStuckMsV2(45000);
      expect(M.getArgovRoutingStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveArgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setArgovRoutingStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveArgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveArgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerArgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default strategy", () =>
      expect(M.registerArgovProfileV2({ id: "p1", owner: "a" }).strategy).toBe(
        "round-robin",
      ));
    it("activate", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateArgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      expect(M.staleArgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateArgovProfileV2("p1");
      M.staleArgovProfileV2("p1");
      expect(M.activateArgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      expect(M.archiveArgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      M.archiveArgovProfileV2("p1");
      expect(() => M.touchArgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleArgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerArgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerArgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getArgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.registerArgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listArgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getArgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getArgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveArgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerArgovProfileV2({ id, owner: "a" }),
      );
      M.activateArgovProfileV2("p1");
      M.activateArgovProfileV2("p2");
      expect(() => M.activateArgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveArgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerArgovProfileV2({ id, owner: "a" }),
      );
      M.activateArgovProfileV2("p1");
      M.activateArgovProfileV2("p2");
      M.staleArgovProfileV2("p1");
      M.activateArgovProfileV2("p3");
      expect(() => M.activateArgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveArgovProfilesPerOwnerV2(1);
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.registerArgovProfileV2({ id: "p2", owner: "b" });
      M.activateArgovProfileV2("p1");
      expect(() => M.activateArgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("routing lifecycle", () => {
    beforeEach(() => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.runningArgovRoutingV2("r1");
      const r = M.completeRoutingArgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.runningArgovRoutingV2("r1");
      expect(M.failArgovRoutingV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      expect(M.cancelArgovRoutingV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRoutingArgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createArgovRoutingV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingArgovRoutingsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createArgovRoutingV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createArgovRoutingV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("running counts as pending", () => {
      M.setMaxPendingArgovRoutingsPerProfileV2(1);
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.runningArgovRoutingV2("r1");
      expect(() =>
        M.createArgovRoutingV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingArgovRoutingsPerProfileV2(1);
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.runningArgovRoutingV2("r1");
      M.completeRoutingArgovV2("r1");
      expect(() =>
        M.createArgovRoutingV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getArgovRoutingV2("nope")).toBeNull());
    it("list", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.createArgovRoutingV2({ id: "r2", profileId: "p1" });
      expect(M.listArgovRoutingsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createArgovRoutingV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createArgovRoutingV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      expect(M.cancelArgovRoutingV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setArgovProfileIdleMsV2(1000);
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      const r = M.autoStaleIdleArgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getArgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      M.runningArgovRoutingV2("r1");
      M.setArgovRoutingStuckMsV2(100);
      const r = M.autoFailStuckArgovRoutingsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setArgovProfileIdleMsV2(1000);
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleArgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAgentRouterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.routingsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerArgovProfileV2({ id: "p1", owner: "a" });
      M.activateArgovProfileV2("p1");
      M.createArgovRoutingV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAgentRouterGovStatsV2();
      expect(s2.totalArgovProfilesV2).toBe(1);
      expect(s2.totalArgovRoutingsV2).toBe(1);
    });
  });
});
