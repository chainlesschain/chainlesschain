import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/mcp-registry.js";

describe("McpRegistryGov V2 Surface", () => {
  beforeEach(() => M._resetStateMcpRegistryGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.MCPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.MCPGOV_INVOCATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.MCPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.MCPGOV_INVOCATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveMcpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveMcpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingMcpgovInvocationsPerProfileV2(33);
      expect(M.getMaxPendingMcpgovInvocationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setMcpgovProfileIdleMsV2(60000);
      expect(M.getMcpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setMcpgovInvocationStuckMsV2(45000);
      expect(M.getMcpgovInvocationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveMcpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setMcpgovInvocationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveMcpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveMcpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerMcpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default transport", () =>
      expect(
        M.registerMcpgovProfileV2({ id: "p1", owner: "a" }).transport,
      ).toBe("stdio"));
    it("activate", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateMcpgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      expect(M.suspendMcpgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateMcpgovProfileV2("p1");
      M.suspendMcpgovProfileV2("p1");
      expect(M.activateMcpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      expect(M.archiveMcpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      M.archiveMcpgovProfileV2("p1");
      expect(() => M.touchMcpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendMcpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerMcpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerMcpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getMcpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerMcpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listMcpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getMcpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getMcpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveMcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateMcpgovProfileV2("p1");
      M.activateMcpgovProfileV2("p2");
      expect(() => M.activateMcpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveMcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateMcpgovProfileV2("p1");
      M.activateMcpgovProfileV2("p2");
      M.suspendMcpgovProfileV2("p1");
      M.activateMcpgovProfileV2("p3");
      expect(() => M.activateMcpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveMcpgovProfilesPerOwnerV2(1);
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerMcpgovProfileV2({ id: "p2", owner: "b" });
      M.activateMcpgovProfileV2("p1");
      expect(() => M.activateMcpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("invocation lifecycle", () => {
    beforeEach(() => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
    });
    it("create→invoking→complete", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.invokingMcpgovInvocationV2("r1");
      const r = M.completeInvocationMcpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.invokingMcpgovInvocationV2("r1");
      expect(M.failMcpgovInvocationV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMcpgovInvocationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeInvocationMcpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createMcpgovInvocationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingMcpgovInvocationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createMcpgovInvocationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createMcpgovInvocationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("invoking counts as pending", () => {
      M.setMaxPendingMcpgovInvocationsPerProfileV2(1);
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.invokingMcpgovInvocationV2("r1");
      expect(() =>
        M.createMcpgovInvocationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingMcpgovInvocationsPerProfileV2(1);
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.invokingMcpgovInvocationV2("r1");
      M.completeInvocationMcpgovV2("r1");
      expect(() =>
        M.createMcpgovInvocationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getMcpgovInvocationV2("nope")).toBeNull());
    it("list", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.createMcpgovInvocationV2({ id: "r2", profileId: "p1" });
      expect(M.listMcpgovInvocationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createMcpgovInvocationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMcpgovInvocationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setMcpgovProfileIdleMsV2(1000);
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      const r = M.autoSuspendIdleMcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getMcpgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      M.invokingMcpgovInvocationV2("r1");
      M.setMcpgovInvocationStuckMsV2(100);
      const r = M.autoFailStuckMcpgovInvocationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setMcpgovProfileIdleMsV2(1000);
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleMcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getMcpRegistryGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.invocationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerMcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateMcpgovProfileV2("p1");
      M.createMcpgovInvocationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getMcpRegistryGovStatsV2();
      expect(s2.totalMcpgovProfilesV2).toBe(1);
      expect(s2.totalMcpgovInvocationsV2).toBe(1);
    });
  });
});
