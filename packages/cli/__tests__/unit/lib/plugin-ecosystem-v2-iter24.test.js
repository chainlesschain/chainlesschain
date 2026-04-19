import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/plugin-ecosystem.js";

describe("PluginEcosystemGov V2 Surface", () => {
  beforeEach(() => M._resetStatePluginEcosystemGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ECOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ECOGOV_INSTALL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ECOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ECOGOV_INSTALL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEcogovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEcogovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEcogovInstallsPerProfileV2(33);
      expect(M.getMaxPendingEcogovInstallsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEcogovProfileIdleMsV2(60000);
      expect(M.getEcogovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEcogovInstallStuckMsV2(45000);
      expect(M.getEcogovInstallStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEcogovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEcogovInstallStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEcogovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEcogovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEcogovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default category", () =>
      expect(M.registerEcogovProfileV2({ id: "p1", owner: "a" }).category).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEcogovProfileV2("p1").status).toBe("active");
    });
    it("disable", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      expect(M.disableEcogovProfileV2("p1").status).toBe("disabled");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEcogovProfileV2("p1");
      M.disableEcogovProfileV2("p1");
      expect(M.activateEcogovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      expect(M.archiveEcogovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      M.archiveEcogovProfileV2("p1");
      expect(() => M.touchEcogovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.disableEcogovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerEcogovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEcogovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEcogovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.registerEcogovProfileV2({ id: "p2", owner: "b" });
      expect(M.listEcogovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEcogovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEcogovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEcogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEcogovProfileV2({ id, owner: "a" }),
      );
      M.activateEcogovProfileV2("p1");
      M.activateEcogovProfileV2("p2");
      expect(() => M.activateEcogovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEcogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEcogovProfileV2({ id, owner: "a" }),
      );
      M.activateEcogovProfileV2("p1");
      M.activateEcogovProfileV2("p2");
      M.disableEcogovProfileV2("p1");
      M.activateEcogovProfileV2("p3");
      expect(() => M.activateEcogovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEcogovProfilesPerOwnerV2(1);
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.registerEcogovProfileV2({ id: "p2", owner: "b" });
      M.activateEcogovProfileV2("p1");
      expect(() => M.activateEcogovProfileV2("p2")).not.toThrow();
    });
  });

  describe("install lifecycle", () => {
    beforeEach(() => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
    });
    it("create→installing→complete", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.installingEcogovInstallV2("r1");
      const r = M.completeInstallEcogovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.installingEcogovInstallV2("r1");
      expect(M.failEcogovInstallV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEcogovInstallV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeInstallEcogovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEcogovInstallV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEcogovInstallsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createEcogovInstallV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createEcogovInstallV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("installing counts as pending", () => {
      M.setMaxPendingEcogovInstallsPerProfileV2(1);
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.installingEcogovInstallV2("r1");
      expect(() =>
        M.createEcogovInstallV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEcogovInstallsPerProfileV2(1);
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.installingEcogovInstallV2("r1");
      M.completeInstallEcogovV2("r1");
      expect(() =>
        M.createEcogovInstallV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEcogovInstallV2("nope")).toBeNull());
    it("list", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.createEcogovInstallV2({ id: "r2", profileId: "p1" });
      expect(M.listEcogovInstallsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEcogovInstallV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createEcogovInstallV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEcogovInstallV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDisableIdle", () => {
      M.setEcogovProfileIdleMsV2(1000);
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      const r = M.autoDisableIdleEcogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEcogovProfileV2("p1").status).toBe("disabled");
    });
    it("autoFailStuck", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      M.installingEcogovInstallV2("r1");
      M.setEcogovInstallStuckMsV2(100);
      const r = M.autoFailStuckEcogovInstallsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEcogovProfileIdleMsV2(1000);
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDisableIdleEcogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPluginEcosystemGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.installsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEcogovProfileV2({ id: "p1", owner: "a" });
      M.activateEcogovProfileV2("p1");
      M.createEcogovInstallV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPluginEcosystemGovStatsV2();
      expect(s2.totalEcogovProfilesV2).toBe(1);
      expect(s2.totalEcogovInstallsV2).toBe(1);
    });
  });
});
