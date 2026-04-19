import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/knowledge-exporter.js";

describe("KnowledgeExporter V2 Surface", () => {
  beforeEach(() => M._resetStateKnowledgeExporterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.KEXPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.KEXPGOV_EXPORT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.KEXPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.KEXPGOV_EXPORT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveKexpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveKexpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingKexpgovExportsPerProfileV2(33);
      expect(M.getMaxPendingKexpgovExportsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setKexpgovProfileIdleMsV2(60000);
      expect(M.getKexpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setKexpgovExportStuckMsV2(45000);
      expect(M.getKexpgovExportStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveKexpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setKexpgovExportStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveKexpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveKexpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerKexpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default format", () =>
      expect(M.registerKexpgovProfileV2({ id: "p1", owner: "a" }).format).toBe(
        "json",
      ));
    it("activate", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateKexpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      expect(M.staleKexpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateKexpgovProfileV2("p1");
      M.staleKexpgovProfileV2("p1");
      expect(M.activateKexpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      expect(M.archiveKexpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      M.archiveKexpgovProfileV2("p1");
      expect(() => M.touchKexpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleKexpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerKexpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerKexpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getKexpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.registerKexpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listKexpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getKexpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getKexpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveKexpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKexpgovProfileV2({ id, owner: "a" }),
      );
      M.activateKexpgovProfileV2("p1");
      M.activateKexpgovProfileV2("p2");
      expect(() => M.activateKexpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveKexpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKexpgovProfileV2({ id, owner: "a" }),
      );
      M.activateKexpgovProfileV2("p1");
      M.activateKexpgovProfileV2("p2");
      M.staleKexpgovProfileV2("p1");
      M.activateKexpgovProfileV2("p3");
      expect(() => M.activateKexpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveKexpgovProfilesPerOwnerV2(1);
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.registerKexpgovProfileV2({ id: "p2", owner: "b" });
      M.activateKexpgovProfileV2("p1");
      expect(() => M.activateKexpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("export lifecycle", () => {
    beforeEach(() => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
    });
    it("create→exporting→complete", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.exportingKexpgovExportV2("r1");
      const r = M.completeExportKexpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.exportingKexpgovExportV2("r1");
      expect(M.failKexpgovExportV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKexpgovExportV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeExportKexpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createKexpgovExportV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingKexpgovExportsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createKexpgovExportV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createKexpgovExportV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("exporting counts as pending", () => {
      M.setMaxPendingKexpgovExportsPerProfileV2(1);
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.exportingKexpgovExportV2("r1");
      expect(() =>
        M.createKexpgovExportV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingKexpgovExportsPerProfileV2(1);
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.exportingKexpgovExportV2("r1");
      M.completeExportKexpgovV2("r1");
      expect(() =>
        M.createKexpgovExportV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getKexpgovExportV2("nope")).toBeNull());
    it("list", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.createKexpgovExportV2({ id: "r2", profileId: "p1" });
      expect(M.listKexpgovExportsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createKexpgovExportV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createKexpgovExportV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKexpgovExportV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setKexpgovProfileIdleMsV2(1000);
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      const r = M.autoStaleIdleKexpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getKexpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      M.exportingKexpgovExportV2("r1");
      M.setKexpgovExportStuckMsV2(100);
      const r = M.autoFailStuckKexpgovExportsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setKexpgovProfileIdleMsV2(1000);
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleKexpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getKnowledgeExporterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.exportsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerKexpgovProfileV2({ id: "p1", owner: "a" });
      M.activateKexpgovProfileV2("p1");
      M.createKexpgovExportV2({ id: "r1", profileId: "p1" });
      const s2 = M.getKnowledgeExporterGovStatsV2();
      expect(s2.totalKexpgovProfilesV2).toBe(1);
      expect(s2.totalKexpgovExportsV2).toBe(1);
    });
  });
});
