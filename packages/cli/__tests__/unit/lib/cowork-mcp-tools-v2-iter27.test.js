import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-mcp-tools.js";

describe("CoworkMcpToolsGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkMcpToolsGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CMCPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CMCPGOV_EXEC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CMCPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CMCPGOV_EXEC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCmcpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCmcpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCmcpgovExecsPerProfileV2(33);
      expect(M.getMaxPendingCmcpgovExecsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCmcpgovProfileIdleMsV2(60000);
      expect(M.getCmcpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCmcpgovExecStuckMsV2(45000);
      expect(M.getCmcpgovExecStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCmcpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCmcpgovExecStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCmcpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCmcpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCmcpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default toolset", () =>
      expect(M.registerCmcpgovProfileV2({ id: "p1", owner: "a" }).toolset).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCmcpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      expect(M.staleCmcpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCmcpgovProfileV2("p1");
      M.staleCmcpgovProfileV2("p1");
      expect(M.activateCmcpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      expect(M.archiveCmcpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      M.archiveCmcpgovProfileV2("p1");
      expect(() => M.touchCmcpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCmcpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCmcpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCmcpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCmcpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerCmcpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCmcpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCmcpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCmcpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCmcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateCmcpgovProfileV2("p1");
      M.activateCmcpgovProfileV2("p2");
      expect(() => M.activateCmcpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCmcpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmcpgovProfileV2({ id, owner: "a" }),
      );
      M.activateCmcpgovProfileV2("p1");
      M.activateCmcpgovProfileV2("p2");
      M.staleCmcpgovProfileV2("p1");
      M.activateCmcpgovProfileV2("p3");
      expect(() => M.activateCmcpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCmcpgovProfilesPerOwnerV2(1);
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.registerCmcpgovProfileV2({ id: "p2", owner: "b" });
      M.activateCmcpgovProfileV2("p1");
      expect(() => M.activateCmcpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("exec lifecycle", () => {
    beforeEach(() => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.runningCmcpgovExecV2("r1");
      const r = M.completeExecCmcpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.runningCmcpgovExecV2("r1");
      expect(M.failCmcpgovExecV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmcpgovExecV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeExecCmcpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCmcpgovExecV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCmcpgovExecsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCmcpgovExecV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCmcpgovExecV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("running counts as pending", () => {
      M.setMaxPendingCmcpgovExecsPerProfileV2(1);
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.runningCmcpgovExecV2("r1");
      expect(() =>
        M.createCmcpgovExecV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCmcpgovExecsPerProfileV2(1);
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.runningCmcpgovExecV2("r1");
      M.completeExecCmcpgovV2("r1");
      expect(() =>
        M.createCmcpgovExecV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCmcpgovExecV2("nope")).toBeNull());
    it("list", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.createCmcpgovExecV2({ id: "r2", profileId: "p1" });
      expect(M.listCmcpgovExecsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCmcpgovExecV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCmcpgovExecV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmcpgovExecV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCmcpgovProfileIdleMsV2(1000);
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      const r = M.autoStaleIdleCmcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCmcpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      M.runningCmcpgovExecV2("r1");
      M.setCmcpgovExecStuckMsV2(100);
      const r = M.autoFailStuckCmcpgovExecsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCmcpgovProfileIdleMsV2(1000);
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCmcpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkMcpToolsGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.execsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCmcpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCmcpgovProfileV2("p1");
      M.createCmcpgovExecV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkMcpToolsGovStatsV2();
      expect(s2.totalCmcpgovProfilesV2).toBe(1);
      expect(s2.totalCmcpgovExecsV2).toBe(1);
    });
  });
});
