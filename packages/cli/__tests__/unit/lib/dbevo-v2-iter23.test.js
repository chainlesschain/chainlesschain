import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/dbevo.js";

describe("DbevoGov V2 Surface", () => {
  beforeEach(() => M._resetStateDbevoGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DBEVOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DBEVOGOV_MIGRATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DBEVOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DBEVOGOV_MIGRATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDbevogovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDbevogovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDbevogovMigrationsPerProfileV2(33);
      expect(M.getMaxPendingDbevogovMigrationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDbevogovProfileIdleMsV2(60000);
      expect(M.getDbevogovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDbevogovMigrationStuckMsV2(45000);
      expect(M.getDbevogovMigrationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDbevogovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDbevogovMigrationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDbevogovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDbevogovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDbevogovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default schema", () =>
      expect(M.registerDbevogovProfileV2({ id: "p1", owner: "a" }).schema).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDbevogovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      expect(M.pauseDbevogovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDbevogovProfileV2("p1");
      M.pauseDbevogovProfileV2("p1");
      expect(M.activateDbevogovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      expect(M.archiveDbevogovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      M.archiveDbevogovProfileV2("p1");
      expect(() => M.touchDbevogovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseDbevogovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDbevogovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDbevogovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDbevogovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.registerDbevogovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDbevogovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDbevogovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDbevogovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDbevogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDbevogovProfileV2({ id, owner: "a" }),
      );
      M.activateDbevogovProfileV2("p1");
      M.activateDbevogovProfileV2("p2");
      expect(() => M.activateDbevogovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDbevogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDbevogovProfileV2({ id, owner: "a" }),
      );
      M.activateDbevogovProfileV2("p1");
      M.activateDbevogovProfileV2("p2");
      M.pauseDbevogovProfileV2("p1");
      M.activateDbevogovProfileV2("p3");
      expect(() => M.activateDbevogovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDbevogovProfilesPerOwnerV2(1);
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.registerDbevogovProfileV2({ id: "p2", owner: "b" });
      M.activateDbevogovProfileV2("p1");
      expect(() => M.activateDbevogovProfileV2("p2")).not.toThrow();
    });
  });

  describe("migration lifecycle", () => {
    beforeEach(() => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
    });
    it("create→applying→complete", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.applyingDbevogovMigrationV2("r1");
      const r = M.completeMigrationDbevogovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.applyingDbevogovMigrationV2("r1");
      expect(M.failDbevogovMigrationV2("r1", "x").metadata.failReason).toBe(
        "x",
      );
    });
    it("cancel from queued", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDbevogovMigrationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMigrationDbevogovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDbevogovMigrationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDbevogovMigrationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDbevogovMigrationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createDbevogovMigrationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("applying counts as pending", () => {
      M.setMaxPendingDbevogovMigrationsPerProfileV2(1);
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.applyingDbevogovMigrationV2("r1");
      expect(() =>
        M.createDbevogovMigrationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDbevogovMigrationsPerProfileV2(1);
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.applyingDbevogovMigrationV2("r1");
      M.completeMigrationDbevogovV2("r1");
      expect(() =>
        M.createDbevogovMigrationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDbevogovMigrationV2("nope")).toBeNull());
    it("list", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.createDbevogovMigrationV2({ id: "r2", profileId: "p1" });
      expect(M.listDbevogovMigrationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDbevogovMigrationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDbevogovMigrationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setDbevogovProfileIdleMsV2(1000);
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      const r = M.autoPauseIdleDbevogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDbevogovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      M.applyingDbevogovMigrationV2("r1");
      M.setDbevogovMigrationStuckMsV2(100);
      const r = M.autoFailStuckDbevogovMigrationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDbevogovProfileIdleMsV2(1000);
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleDbevogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDbevoGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.migrationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDbevogovProfileV2({ id: "p1", owner: "a" });
      M.activateDbevogovProfileV2("p1");
      M.createDbevogovMigrationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDbevoGovStatsV2();
      expect(s2.totalDbevogovProfilesV2).toBe(1);
      expect(s2.totalDbevogovMigrationsV2).toBe(1);
    });
  });
});
