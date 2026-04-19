import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sla-manager.js";

describe("SlaManager V2 Surface", () => {
  beforeEach(() => M._resetStateSlaManagerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SLAGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SLAGOV_MEASUREMENT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SLAGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SLAGOV_MEASUREMENT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSlagovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSlagovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSlagovMeasurementsPerProfileV2(33);
      expect(M.getMaxPendingSlagovMeasurementsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSlagovProfileIdleMsV2(60000);
      expect(M.getSlagovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSlagovMeasurementStuckMsV2(45000);
      expect(M.getSlagovMeasurementStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSlagovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSlagovMeasurementStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSlagovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSlagovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSlagovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default tier", () =>
      expect(M.registerSlagovProfileV2({ id: "p1", owner: "a" }).tier).toBe(
        "standard",
      ));
    it("activate", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSlagovProfileV2("p1").status).toBe("active");
    });
    it("breach", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      expect(M.breachSlagovProfileV2("p1").status).toBe("breached");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSlagovProfileV2("p1");
      M.breachSlagovProfileV2("p1");
      expect(M.activateSlagovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      expect(M.archiveSlagovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      M.archiveSlagovProfileV2("p1");
      expect(() => M.touchSlagovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.breachSlagovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSlagovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSlagovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSlagovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.registerSlagovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSlagovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSlagovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSlagovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSlagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSlagovProfileV2({ id, owner: "a" }),
      );
      M.activateSlagovProfileV2("p1");
      M.activateSlagovProfileV2("p2");
      expect(() => M.activateSlagovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSlagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSlagovProfileV2({ id, owner: "a" }),
      );
      M.activateSlagovProfileV2("p1");
      M.activateSlagovProfileV2("p2");
      M.breachSlagovProfileV2("p1");
      M.activateSlagovProfileV2("p3");
      expect(() => M.activateSlagovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSlagovProfilesPerOwnerV2(1);
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.registerSlagovProfileV2({ id: "p2", owner: "b" });
      M.activateSlagovProfileV2("p1");
      expect(() => M.activateSlagovProfileV2("p2")).not.toThrow();
    });
  });

  describe("measurement lifecycle", () => {
    beforeEach(() => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
    });
    it("create→measuring→complete", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.measuringSlagovMeasurementV2("r1");
      const r = M.completeMeasurementSlagovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("measuring");
    });
    it("fail", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.measuringSlagovMeasurementV2("r1");
      expect(M.failSlagovMeasurementV2("r1", "x").metadata.failReason).toBe(
        "x",
      );
    });
    it("cancel from queued", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSlagovMeasurementV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMeasurementSlagovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSlagovMeasurementV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSlagovMeasurementsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSlagovMeasurementV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSlagovMeasurementV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("measuring counts as pending", () => {
      M.setMaxPendingSlagovMeasurementsPerProfileV2(1);
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.measuringSlagovMeasurementV2("r1");
      expect(() =>
        M.createSlagovMeasurementV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSlagovMeasurementsPerProfileV2(1);
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.measuringSlagovMeasurementV2("r1");
      M.completeMeasurementSlagovV2("r1");
      expect(() =>
        M.createSlagovMeasurementV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSlagovMeasurementV2("nope")).toBeNull());
    it("list", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.createSlagovMeasurementV2({ id: "r2", profileId: "p1" });
      expect(M.listSlagovMeasurementsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSlagovMeasurementV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSlagovMeasurementV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoBreachIdle", () => {
      M.setSlagovProfileIdleMsV2(1000);
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      const r = M.autoBreachIdleSlagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSlagovProfileV2("p1").status).toBe("breached");
    });
    it("autoFailStuck", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      M.measuringSlagovMeasurementV2("r1");
      M.setSlagovMeasurementStuckMsV2(100);
      const r = M.autoFailStuckSlagovMeasurementsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSlagovProfileIdleMsV2(1000);
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoBreachIdleSlagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSlaManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.measurementsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSlagovProfileV2({ id: "p1", owner: "a" });
      M.activateSlagovProfileV2("p1");
      M.createSlagovMeasurementV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSlaManagerGovStatsV2();
      expect(s2.totalSlagovProfilesV2).toBe(1);
      expect(s2.totalSlagovMeasurementsV2).toBe(1);
    });
  });
});
