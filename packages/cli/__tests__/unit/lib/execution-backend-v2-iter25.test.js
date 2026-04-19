import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/execution-backend.js";

describe("ExecutionBackendGov V2 Surface", () => {
  beforeEach(() => M._resetStateExecutionBackendGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.EBGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.EBGOV_JOB_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.EBGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.EBGOV_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEbgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEbgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEbgovJobsPerProfileV2(33);
      expect(M.getMaxPendingEbgovJobsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEbgovProfileIdleMsV2(60000);
      expect(M.getEbgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEbgovJobStuckMsV2(45000);
      expect(M.getEbgovJobStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEbgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEbgovJobStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEbgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEbgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEbgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default backend", () =>
      expect(M.registerEbgovProfileV2({ id: "p1", owner: "a" }).backend).toBe(
        "local",
      ));
    it("activate", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEbgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      expect(M.degradeEbgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEbgovProfileV2("p1");
      M.degradeEbgovProfileV2("p1");
      expect(M.activateEbgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      expect(M.archiveEbgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      M.archiveEbgovProfileV2("p1");
      expect(() => M.touchEbgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeEbgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerEbgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEbgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEbgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.registerEbgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listEbgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEbgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEbgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEbgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEbgovProfileV2({ id, owner: "a" }),
      );
      M.activateEbgovProfileV2("p1");
      M.activateEbgovProfileV2("p2");
      expect(() => M.activateEbgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEbgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEbgovProfileV2({ id, owner: "a" }),
      );
      M.activateEbgovProfileV2("p1");
      M.activateEbgovProfileV2("p2");
      M.degradeEbgovProfileV2("p1");
      M.activateEbgovProfileV2("p3");
      expect(() => M.activateEbgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEbgovProfilesPerOwnerV2(1);
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.registerEbgovProfileV2({ id: "p2", owner: "b" });
      M.activateEbgovProfileV2("p1");
      expect(() => M.activateEbgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("job lifecycle", () => {
    beforeEach(() => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
    });
    it("create→executing→complete", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.executingEbgovJobV2("r1");
      const r = M.completeJobEbgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.executingEbgovJobV2("r1");
      expect(M.failEbgovJobV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEbgovJobV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeJobEbgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEbgovJobV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEbgovJobsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createEbgovJobV2({ id, profileId: "p1" }));
      expect(() => M.createEbgovJobV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("executing counts as pending", () => {
      M.setMaxPendingEbgovJobsPerProfileV2(1);
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.executingEbgovJobV2("r1");
      expect(() => M.createEbgovJobV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEbgovJobsPerProfileV2(1);
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.executingEbgovJobV2("r1");
      M.completeJobEbgovV2("r1");
      expect(() =>
        M.createEbgovJobV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEbgovJobV2("nope")).toBeNull());
    it("list", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.createEbgovJobV2({ id: "r2", profileId: "p1" });
      expect(M.listEbgovJobsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEbgovJobV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.createEbgovJobV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEbgovJobV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setEbgovProfileIdleMsV2(1000);
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      const r = M.autoDegradeIdleEbgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEbgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      M.executingEbgovJobV2("r1");
      M.setEbgovJobStuckMsV2(100);
      const r = M.autoFailStuckEbgovJobsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEbgovProfileIdleMsV2(1000);
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleEbgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getExecutionBackendGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.jobsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEbgovProfileV2({ id: "p1", owner: "a" });
      M.activateEbgovProfileV2("p1");
      M.createEbgovJobV2({ id: "r1", profileId: "p1" });
      const s2 = M.getExecutionBackendGovStatsV2();
      expect(s2.totalEbgovProfilesV2).toBe(1);
      expect(s2.totalEbgovJobsV2).toBe(1);
    });
  });
});
