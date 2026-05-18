import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/aiops.js";

describe("Aiops V2 Surface", () => {
  beforeEach(() => M._resetStateAiopsGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.AIOPSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.AIOPSGOV_INCIDENT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.AIOPSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AIOPSGOV_INCIDENT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAiopsgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAiopsgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAiopsgovIncidentsPerProfileV2(33);
      expect(M.getMaxPendingAiopsgovIncidentsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAiopsgovProfileIdleMsV2(60000);
      expect(M.getAiopsgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAiopsgovIncidentStuckMsV2(45000);
      expect(M.getAiopsgovIncidentStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAiopsgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAiopsgovIncidentStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAiopsgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAiopsgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAiopsgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default mode", () =>
      expect(M.registerAiopsgovProfileV2({ id: "p1", owner: "a" }).mode).toBe(
        "monitor",
      ));
    it("activate", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAiopsgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      expect(M.staleAiopsgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAiopsgovProfileV2("p1");
      M.staleAiopsgovProfileV2("p1");
      expect(M.activateAiopsgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      expect(M.archiveAiopsgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      M.archiveAiopsgovProfileV2("p1");
      expect(() => M.touchAiopsgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleAiopsgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerAiopsgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAiopsgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAiopsgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.registerAiopsgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listAiopsgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAiopsgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAiopsgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAiopsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAiopsgovProfileV2({ id, owner: "a" }),
      );
      M.activateAiopsgovProfileV2("p1");
      M.activateAiopsgovProfileV2("p2");
      expect(() => M.activateAiopsgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAiopsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAiopsgovProfileV2({ id, owner: "a" }),
      );
      M.activateAiopsgovProfileV2("p1");
      M.activateAiopsgovProfileV2("p2");
      M.staleAiopsgovProfileV2("p1");
      M.activateAiopsgovProfileV2("p3");
      expect(() => M.activateAiopsgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAiopsgovProfilesPerOwnerV2(1);
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.registerAiopsgovProfileV2({ id: "p2", owner: "b" });
      M.activateAiopsgovProfileV2("p1");
      expect(() => M.activateAiopsgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("incident lifecycle", () => {
    beforeEach(() => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
    });
    it("create→triaging→complete", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.triagingAiopsgovIncidentV2("r1");
      const r = M.completeIncidentAiopsgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.triagingAiopsgovIncidentV2("r1");
      expect(M.failAiopsgovIncidentV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAiopsgovIncidentV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeIncidentAiopsgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAiopsgovIncidentV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAiopsgovIncidentsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createAiopsgovIncidentV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createAiopsgovIncidentV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("triaging counts as pending", () => {
      M.setMaxPendingAiopsgovIncidentsPerProfileV2(1);
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.triagingAiopsgovIncidentV2("r1");
      expect(() =>
        M.createAiopsgovIncidentV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAiopsgovIncidentsPerProfileV2(1);
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.triagingAiopsgovIncidentV2("r1");
      M.completeIncidentAiopsgovV2("r1");
      expect(() =>
        M.createAiopsgovIncidentV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAiopsgovIncidentV2("nope")).toBeNull());
    it("list", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.createAiopsgovIncidentV2({ id: "r2", profileId: "p1" });
      expect(M.listAiopsgovIncidentsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAiopsgovIncidentV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAiopsgovIncidentV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setAiopsgovProfileIdleMsV2(1000);
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      const r = M.autoStaleIdleAiopsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAiopsgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      M.triagingAiopsgovIncidentV2("r1");
      M.setAiopsgovIncidentStuckMsV2(100);
      const r = M.autoFailStuckAiopsgovIncidentsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAiopsgovProfileIdleMsV2(1000);
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleAiopsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAiopsGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.incidentsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAiopsgovProfileV2({ id: "p1", owner: "a" });
      M.activateAiopsgovProfileV2("p1");
      M.createAiopsgovIncidentV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAiopsGovStatsV2();
      expect(s2.totalAiopsgovProfilesV2).toBe(1);
      expect(s2.totalAiopsgovIncidentsV2).toBe(1);
    });
  });
});
