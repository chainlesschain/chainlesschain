import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sandbox-v2.js";

describe("Sandbox V2 Surface", () => {
  beforeEach(() => M._resetStateSandboxV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SBOX_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SBOX_EXEC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SBOX_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SBOX_EXEC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSboxProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSboxProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSboxExecsPerProfileV2(33);
      expect(M.getMaxPendingSboxExecsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSboxProfileIdleMsV2(60000);
      expect(M.getSboxProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSboxExecStuckMsV2(45000);
      expect(M.getSboxExecStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSboxProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSboxExecStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSboxProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSboxProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSboxProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default template", () =>
      expect(M.registerSboxProfileV2({ id: "p1", owner: "a" }).template).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSboxProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      expect(M.pauseSboxProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSboxProfileV2("p1");
      M.pauseSboxProfileV2("p1");
      expect(M.activateSboxProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      expect(M.archiveSboxProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      M.archiveSboxProfileV2("p1");
      expect(() => M.touchSboxProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseSboxProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerSboxProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSboxProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSboxProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.registerSboxProfileV2({ id: "p2", owner: "b" });
      expect(M.listSboxProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSboxProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSboxProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSboxProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSboxProfileV2({ id, owner: "a" }),
      );
      M.activateSboxProfileV2("p1");
      M.activateSboxProfileV2("p2");
      expect(() => M.activateSboxProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSboxProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSboxProfileV2({ id, owner: "a" }),
      );
      M.activateSboxProfileV2("p1");
      M.activateSboxProfileV2("p2");
      M.pauseSboxProfileV2("p1");
      M.activateSboxProfileV2("p3");
      expect(() => M.activateSboxProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSboxProfilesPerOwnerV2(1);
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.registerSboxProfileV2({ id: "p2", owner: "b" });
      M.activateSboxProfileV2("p1");
      expect(() => M.activateSboxProfileV2("p2")).not.toThrow();
    });
  });

  describe("exec lifecycle", () => {
    beforeEach(() => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.runningSboxExecV2("r1");
      const r = M.completeExecSboxV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("running");
    });
    it("fail", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.runningSboxExecV2("r1");
      expect(M.failSboxExecV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSboxExecV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeExecSboxV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSboxExecV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSboxExecsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createSboxExecV2({ id, profileId: "p1" }));
      expect(() => M.createSboxExecV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingSboxExecsPerProfileV2(1);
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.runningSboxExecV2("r1");
      expect(() => M.createSboxExecV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSboxExecsPerProfileV2(1);
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.runningSboxExecV2("r1");
      M.completeExecSboxV2("r1");
      expect(() =>
        M.createSboxExecV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSboxExecV2("nope")).toBeNull());
    it("list", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.createSboxExecV2({ id: "r2", profileId: "p1" });
      expect(M.listSboxExecsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSboxExecV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      expect(() => M.createSboxExecV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSboxExecV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setSboxProfileIdleMsV2(1000);
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      const r = M.autoPauseIdleSboxProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSboxProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      M.runningSboxExecV2("r1");
      M.setSboxExecStuckMsV2(100);
      const r = M.autoFailStuckSboxExecsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSboxProfileIdleMsV2(1000);
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleSboxProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSandboxGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.execsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSboxProfileV2({ id: "p1", owner: "a" });
      M.activateSboxProfileV2("p1");
      M.createSboxExecV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSandboxGovStatsV2();
      expect(s2.totalSboxProfilesV2).toBe(1);
      expect(s2.totalSboxExecsV2).toBe(1);
    });
  });
});
