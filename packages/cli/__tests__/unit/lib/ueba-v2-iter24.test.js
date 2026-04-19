import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/ueba.js";

describe("UebaGov V2 Surface", () => {
  beforeEach(() => M._resetStateUebaGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.UEBGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.UEBGOV_ALERT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.UEBGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.UEBGOV_ALERT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveUebgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveUebgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingUebgovAlertsPerProfileV2(33);
      expect(M.getMaxPendingUebgovAlertsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setUebgovProfileIdleMsV2(60000);
      expect(M.getUebgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setUebgovAlertStuckMsV2(45000);
      expect(M.getUebgovAlertStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveUebgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setUebgovAlertStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveUebgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveUebgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerUebgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default entity", () =>
      expect(M.registerUebgovProfileV2({ id: "p1", owner: "a" }).entity).toBe(
        "user",
      ));
    it("activate", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateUebgovProfileV2("p1").status).toBe("active");
    });
    it("suppress", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      expect(M.suppressUebgovProfileV2("p1").status).toBe("suppressed");
    });
    it("recovery preserves activatedAt", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateUebgovProfileV2("p1");
      M.suppressUebgovProfileV2("p1");
      expect(M.activateUebgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      expect(M.archiveUebgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      M.archiveUebgovProfileV2("p1");
      expect(() => M.touchUebgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suppressUebgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerUebgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerUebgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getUebgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.registerUebgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listUebgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getUebgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getUebgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveUebgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerUebgovProfileV2({ id, owner: "a" }),
      );
      M.activateUebgovProfileV2("p1");
      M.activateUebgovProfileV2("p2");
      expect(() => M.activateUebgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveUebgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerUebgovProfileV2({ id, owner: "a" }),
      );
      M.activateUebgovProfileV2("p1");
      M.activateUebgovProfileV2("p2");
      M.suppressUebgovProfileV2("p1");
      M.activateUebgovProfileV2("p3");
      expect(() => M.activateUebgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveUebgovProfilesPerOwnerV2(1);
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.registerUebgovProfileV2({ id: "p2", owner: "b" });
      M.activateUebgovProfileV2("p1");
      expect(() => M.activateUebgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("alert lifecycle", () => {
    beforeEach(() => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
    });
    it("create→analyzing→complete", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.analyzingUebgovAlertV2("r1");
      const r = M.completeAlertUebgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.analyzingUebgovAlertV2("r1");
      expect(M.failUebgovAlertV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      expect(M.cancelUebgovAlertV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeAlertUebgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createUebgovAlertV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingUebgovAlertsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createUebgovAlertV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createUebgovAlertV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("analyzing counts as pending", () => {
      M.setMaxPendingUebgovAlertsPerProfileV2(1);
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.analyzingUebgovAlertV2("r1");
      expect(() =>
        M.createUebgovAlertV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingUebgovAlertsPerProfileV2(1);
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.analyzingUebgovAlertV2("r1");
      M.completeAlertUebgovV2("r1");
      expect(() =>
        M.createUebgovAlertV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getUebgovAlertV2("nope")).toBeNull());
    it("list", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.createUebgovAlertV2({ id: "r2", profileId: "p1" });
      expect(M.listUebgovAlertsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createUebgovAlertV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createUebgovAlertV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      expect(M.cancelUebgovAlertV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuppressIdle", () => {
      M.setUebgovProfileIdleMsV2(1000);
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      const r = M.autoSuppressIdleUebgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getUebgovProfileV2("p1").status).toBe("suppressed");
    });
    it("autoFailStuck", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      M.analyzingUebgovAlertV2("r1");
      M.setUebgovAlertStuckMsV2(100);
      const r = M.autoFailStuckUebgovAlertsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setUebgovProfileIdleMsV2(1000);
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuppressIdleUebgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getUebaGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.alertsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerUebgovProfileV2({ id: "p1", owner: "a" });
      M.activateUebgovProfileV2("p1");
      M.createUebgovAlertV2({ id: "r1", profileId: "p1" });
      const s2 = M.getUebaGovStatsV2();
      expect(s2.totalUebgovProfilesV2).toBe(1);
      expect(s2.totalUebgovAlertsV2).toBe(1);
    });
  });
});
