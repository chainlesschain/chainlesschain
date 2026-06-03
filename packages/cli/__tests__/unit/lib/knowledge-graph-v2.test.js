import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/knowledge-graph.js";

describe("KnowledgeGraph V2 Surface", () => {
  beforeEach(() => M._resetStateKnowledgeGraphV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.KGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.KGOV_IMPORT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.KGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.KGOV_IMPORT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveKgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveKgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingKgovImportsPerProfileV2(33);
      expect(M.getMaxPendingKgovImportsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setKgovProfileIdleMsV2(60000);
      expect(M.getKgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setKgovImportStuckMsV2(45000);
      expect(M.getKgovImportStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveKgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setKgovImportStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveKgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveKgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerKgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default namespace", () =>
      expect(M.registerKgovProfileV2({ id: "p1", owner: "a" }).namespace).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateKgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      expect(M.staleKgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateKgovProfileV2("p1");
      M.staleKgovProfileV2("p1");
      expect(M.activateKgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      expect(M.archiveKgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      M.archiveKgovProfileV2("p1");
      expect(() => M.touchKgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleKgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerKgovProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerKgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getKgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.registerKgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listKgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getKgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getKgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveKgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKgovProfileV2({ id, owner: "a" }),
      );
      M.activateKgovProfileV2("p1");
      M.activateKgovProfileV2("p2");
      expect(() => M.activateKgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveKgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKgovProfileV2({ id, owner: "a" }),
      );
      M.activateKgovProfileV2("p1");
      M.activateKgovProfileV2("p2");
      M.staleKgovProfileV2("p1");
      M.activateKgovProfileV2("p3");
      expect(() => M.activateKgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveKgovProfilesPerOwnerV2(1);
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.registerKgovProfileV2({ id: "p2", owner: "b" });
      M.activateKgovProfileV2("p1");
      expect(() => M.activateKgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("import lifecycle", () => {
    beforeEach(() => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
    });
    it("create→importing→complete", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKgovImportV2("r1");
      const r = M.completeImportKgovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("importing");
    });
    it("fail", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKgovImportV2("r1");
      expect(M.failKgovImportV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKgovImportV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeImportKgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createKgovImportV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingKgovImportsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createKgovImportV2({ id, profileId: "p1" }),
      );
      expect(() => M.createKgovImportV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("importing counts as pending", () => {
      M.setMaxPendingKgovImportsPerProfileV2(1);
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKgovImportV2("r1");
      expect(() =>
        M.createKgovImportV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingKgovImportsPerProfileV2(1);
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKgovImportV2("r1");
      M.completeImportKgovV2("r1");
      expect(() =>
        M.createKgovImportV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getKgovImportV2("nope")).toBeNull());
    it("list", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.createKgovImportV2({ id: "r2", profileId: "p1" });
      expect(M.listKgovImportsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createKgovImportV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createKgovImportV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKgovImportV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setKgovProfileIdleMsV2(1000);
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      const r = M.autoStaleIdleKgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getKgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      M.importingKgovImportV2("r1");
      M.setKgovImportStuckMsV2(100);
      const r = M.autoFailStuckKgovImportsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setKgovProfileIdleMsV2(1000);
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleKgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getKnowledgeGraphGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.importsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerKgovProfileV2({ id: "p1", owner: "a" });
      M.activateKgovProfileV2("p1");
      M.createKgovImportV2({ id: "r1", profileId: "p1" });
      const s2 = M.getKnowledgeGraphGovStatsV2();
      expect(s2.totalKgovProfilesV2).toBe(1);
      expect(s2.totalKgovImportsV2).toBe(1);
    });
  });
});
