import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/session-consolidator.js";

describe("Session Consolidator V2 Surface", () => {
  beforeEach(() => M._resetStateSessionConsolidatorV2());

  describe("enums", () => {
    it("profile maturity has 4 states", () =>
      expect(Object.keys(M.CONSOL_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("job lifecycle has 5 states", () =>
      expect(Object.keys(M.CONSOL_JOB_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.CONSOL_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CONSOL_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config setters", () => {
    it("setMaxActiveConsolProfilesPerOwnerV2", () => {
      M.setMaxActiveConsolProfilesPerOwnerV2(15);
      expect(M.getMaxActiveConsolProfilesPerOwnerV2()).toBe(15);
    });
    it("setMaxPendingConsolJobsPerProfileV2", () => {
      M.setMaxPendingConsolJobsPerProfileV2(20);
      expect(M.getMaxPendingConsolJobsPerProfileV2()).toBe(20);
    });
    it("setConsolProfileIdleMsV2", () => {
      M.setConsolProfileIdleMsV2(3600000);
      expect(M.getConsolProfileIdleMsV2()).toBe(3600000);
    });
    it("setConsolJobStuckMsV2", () => {
      M.setConsolJobStuckMsV2(60000);
      expect(M.getConsolJobStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveConsolProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setConsolJobStuckMsV2("abc")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveConsolProfilesPerOwnerV2(5.7);
      expect(M.getMaxActiveConsolProfilesPerOwnerV2()).toBe(5);
    });
  });

  describe("profile lifecycle", () => {
    it("register", () => {
      const p = M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      expect(p.status).toBe("pending");
    });
    it("activate pending→active", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      const p = M.activateConsolProfileV2("p1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBeTruthy();
    });
    it("pause active→paused", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      M.activateConsolProfileV2("p1");
      expect(M.pauseConsolProfileV2("p1").status).toBe("paused");
    });
    it("recovery paused→active preserves activatedAt", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      const a = M.activateConsolProfileV2("p1");
      M.pauseConsolProfileV2("p1");
      const r = M.activateConsolProfileV2("p1");
      expect(r.activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      M.activateConsolProfileV2("p1");
      const p = M.archiveConsolProfileV2("p1");
      expect(p.status).toBe("archived");
      expect(p.archivedAt).toBeTruthy();
    });
    it("cannot touch archived", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      M.activateConsolProfileV2("p1");
      M.archiveConsolProfileV2("p1");
      expect(() => M.touchConsolProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      expect(() => M.pauseConsolProfileV2("p1")).toThrow();
    });
    it("duplicate id rejected", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      expect(() =>
        M.registerConsolProfileV2({ id: "p1", owner: "bob" }),
      ).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerConsolProfileV2({ id: "p1" })).toThrow());
    it("touch updates lastTouchedAt", async () => {
      M.registerConsolProfileV2({ id: "p1", owner: "alice" });
      M.activateConsolProfileV2("p1");
      const b = M.getConsolProfileV2("p1").lastTouchedAt;
      await new Promise((r) => setTimeout(r, 5));
      const p = M.touchConsolProfileV2("p1");
      expect(p.lastTouchedAt).toBeGreaterThan(b);
    });
    it("get returns null for unknown", () =>
      expect(M.getConsolProfileV2("nope")).toBeNull());
    it("list returns all", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.registerConsolProfileV2({ id: "p2", owner: "b" });
      expect(M.listConsolProfilesV2()).toHaveLength(2);
    });
    it("defensive copy on read", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getConsolProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getConsolProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active-profile cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveConsolProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerConsolProfileV2({ id, owner: "a" }),
      );
      M.activateConsolProfileV2("p1");
      M.activateConsolProfileV2("p2");
      expect(() => M.activateConsolProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveConsolProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerConsolProfileV2({ id, owner: "a" }),
      );
      M.activateConsolProfileV2("p1");
      M.activateConsolProfileV2("p2");
      M.pauseConsolProfileV2("p1");
      M.activateConsolProfileV2("p3");
      expect(() => M.activateConsolProfileV2("p1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveConsolProfilesPerOwnerV2(1);
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.registerConsolProfileV2({ id: "p2", owner: "b" });
      M.activateConsolProfileV2("p1");
      expect(() => M.activateConsolProfileV2("p2")).not.toThrow();
    });
  });

  describe("job lifecycle", () => {
    beforeEach(() => {
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.activateConsolProfileV2("p1");
    });
    it("create→start→complete", () => {
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      M.startConsolJobV2("j1");
      const j = M.completeConsolJobV2("j1");
      expect(j.status).toBe("completed");
      expect(j.startedAt).toBeTruthy();
      expect(j.settledAt).toBeTruthy();
    });
    it("fail from running", () => {
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      M.startConsolJobV2("j1");
      const j = M.failConsolJobV2("j1", "oops");
      expect(j.status).toBe("failed");
      expect(j.metadata.failReason).toBe("oops");
    });
    it("cancel from queued", () => {
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      expect(M.cancelConsolJobV2("j1").status).toBe("cancelled");
    });
    it("cannot complete from queued", () => {
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      expect(() => M.completeConsolJobV2("j1")).toThrow();
    });
    it("unknown profile rejected", () =>
      expect(() =>
        M.createConsolJobV2({ id: "j1", profileId: "none" }),
      ).toThrow());
    it("per-profile pending cap", () => {
      M.setMaxPendingConsolJobsPerProfileV2(2);
      ["j1", "j2"].forEach((id) =>
        M.createConsolJobV2({ id, profileId: "p1" }),
      );
      expect(() => M.createConsolJobV2({ id: "j3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts toward pending", () => {
      M.setMaxPendingConsolJobsPerProfileV2(1);
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      M.startConsolJobV2("j1");
      expect(() =>
        M.createConsolJobV2({ id: "j2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingConsolJobsPerProfileV2(1);
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      M.startConsolJobV2("j1");
      M.completeConsolJobV2("j1");
      expect(() =>
        M.createConsolJobV2({ id: "j2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setConsolProfileIdleMsV2(1000);
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.activateConsolProfileV2("p1");
      const r = M.autoPauseIdleConsolProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getConsolProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.activateConsolProfileV2("p1");
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      M.startConsolJobV2("j1");
      M.setConsolJobStuckMsV2(100);
      const r = M.autoFailStuckConsolJobsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getConsolJobV2("j1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("includes all status keys", () => {
      const s = M.getSessionConsolidatorStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.jobsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerConsolProfileV2({ id: "p1", owner: "a" });
      M.activateConsolProfileV2("p1");
      M.createConsolJobV2({ id: "j1", profileId: "p1" });
      const s = M.getSessionConsolidatorStatsV2();
      expect(s.totalProfilesV2).toBe(1);
      expect(s.totalJobsV2).toBe(1);
    });
  });
});
