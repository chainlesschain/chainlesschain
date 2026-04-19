import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/knowledge-importer.js";

describe("KnowledgeImporter V2 Surface", () => {
  beforeEach(() => M._resetStateKnowledgeImporterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.KIMPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.KIMPGOV_IMPORT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.KIMPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.KIMPGOV_IMPORT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveKimpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveKimpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingKimpgovImportsPerProfileV2(33);
      expect(M.getMaxPendingKimpgovImportsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setKimpgovProfileIdleMsV2(60000);
      expect(M.getKimpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setKimpgovImportStuckMsV2(45000);
      expect(M.getKimpgovImportStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveKimpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setKimpgovImportStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveKimpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveKimpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerKimpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default format", () =>
      expect(M.registerKimpgovProfileV2({ id: "p1", owner: "a" }).format).toBe(
        "json",
      ));
    it("activate", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateKimpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      expect(M.staleKimpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateKimpgovProfileV2("p1");
      M.staleKimpgovProfileV2("p1");
      expect(M.activateKimpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      expect(M.archiveKimpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      M.archiveKimpgovProfileV2("p1");
      expect(() => M.touchKimpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleKimpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerKimpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerKimpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getKimpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.registerKimpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listKimpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getKimpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getKimpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveKimpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKimpgovProfileV2({ id, owner: "a" }),
      );
      M.activateKimpgovProfileV2("p1");
      M.activateKimpgovProfileV2("p2");
      expect(() => M.activateKimpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveKimpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKimpgovProfileV2({ id, owner: "a" }),
      );
      M.activateKimpgovProfileV2("p1");
      M.activateKimpgovProfileV2("p2");
      M.staleKimpgovProfileV2("p1");
      M.activateKimpgovProfileV2("p3");
      expect(() => M.activateKimpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveKimpgovProfilesPerOwnerV2(1);
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.registerKimpgovProfileV2({ id: "p2", owner: "b" });
      M.activateKimpgovProfileV2("p1");
      expect(() => M.activateKimpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("import lifecycle", () => {
    beforeEach(() => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
    });
    it("create→importing→complete", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKimpgovImportV2("r1");
      const r = M.completeImportKimpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKimpgovImportV2("r1");
      expect(M.failKimpgovImportV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKimpgovImportV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeImportKimpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createKimpgovImportV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingKimpgovImportsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createKimpgovImportV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createKimpgovImportV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("importing counts as pending", () => {
      M.setMaxPendingKimpgovImportsPerProfileV2(1);
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKimpgovImportV2("r1");
      expect(() =>
        M.createKimpgovImportV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingKimpgovImportsPerProfileV2(1);
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKimpgovImportV2("r1");
      M.completeImportKimpgovV2("r1");
      expect(() =>
        M.createKimpgovImportV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getKimpgovImportV2("nope")).toBeNull());
    it("list", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.createKimpgovImportV2({ id: "r2", profileId: "p1" });
      expect(M.listKimpgovImportsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createKimpgovImportV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createKimpgovImportV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKimpgovImportV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setKimpgovProfileIdleMsV2(1000);
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      const r = M.autoStaleIdleKimpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getKimpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKimpgovImportV2("r1");
      M.setKimpgovImportStuckMsV2(100);
      const r = M.autoFailStuckKimpgovImportsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setKimpgovProfileIdleMsV2(1000);
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleKimpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getKnowledgeImporterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.importsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerKimpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKimpgovProfileV2("p1");
      M.createKimpgovImportV2({ id: "r1", profileId: "p1" });
      const s2 = M.getKnowledgeImporterGovStatsV2();
      expect(s2.totalKimpgovProfilesV2).toBe(1);
      expect(s2.totalKimpgovImportsV2).toBe(1);
    });
  });
});
