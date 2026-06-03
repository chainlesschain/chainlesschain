import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/code-agent.js";

describe("CodeAgent V2 Surface", () => {
  beforeEach(() => M._resetStateCodeAgentGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CDAGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CDAGOV_EDIT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CDAGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CDAGOV_EDIT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCdagovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCdagovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCdagovEditsPerProfileV2(33);
      expect(M.getMaxPendingCdagovEditsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCdagovProfileIdleMsV2(60000);
      expect(M.getCdagovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCdagovEditStuckMsV2(45000);
      expect(M.getCdagovEditStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCdagovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCdagovEditStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCdagovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCdagovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCdagovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default language", () =>
      expect(M.registerCdagovProfileV2({ id: "p1", owner: "a" }).language).toBe(
        "javascript",
      ));
    it("activate", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCdagovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      expect(M.staleCdagovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCdagovProfileV2("p1");
      M.staleCdagovProfileV2("p1");
      expect(M.activateCdagovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      expect(M.archiveCdagovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      M.archiveCdagovProfileV2("p1");
      expect(() => M.touchCdagovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCdagovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCdagovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCdagovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCdagovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.registerCdagovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCdagovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCdagovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCdagovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCdagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCdagovProfileV2({ id, owner: "a" }),
      );
      M.activateCdagovProfileV2("p1");
      M.activateCdagovProfileV2("p2");
      expect(() => M.activateCdagovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCdagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCdagovProfileV2({ id, owner: "a" }),
      );
      M.activateCdagovProfileV2("p1");
      M.activateCdagovProfileV2("p2");
      M.staleCdagovProfileV2("p1");
      M.activateCdagovProfileV2("p3");
      expect(() => M.activateCdagovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCdagovProfilesPerOwnerV2(1);
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.registerCdagovProfileV2({ id: "p2", owner: "b" });
      M.activateCdagovProfileV2("p1");
      expect(() => M.activateCdagovProfileV2("p2")).not.toThrow();
    });
  });

  describe("edit lifecycle", () => {
    beforeEach(() => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
    });
    it("create→editing→complete", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.editingCdagovEditV2("r1");
      const r = M.completeEditCdagovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.editingCdagovEditV2("r1");
      expect(M.failCdagovEditV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCdagovEditV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeEditCdagovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCdagovEditV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCdagovEditsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCdagovEditV2({ id, profileId: "p1" }),
      );
      expect(() => M.createCdagovEditV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("editing counts as pending", () => {
      M.setMaxPendingCdagovEditsPerProfileV2(1);
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.editingCdagovEditV2("r1");
      expect(() =>
        M.createCdagovEditV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCdagovEditsPerProfileV2(1);
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.editingCdagovEditV2("r1");
      M.completeEditCdagovV2("r1");
      expect(() =>
        M.createCdagovEditV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCdagovEditV2("nope")).toBeNull());
    it("list", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.createCdagovEditV2({ id: "r2", profileId: "p1" });
      expect(M.listCdagovEditsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCdagovEditV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCdagovEditV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCdagovEditV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCdagovProfileIdleMsV2(1000);
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      const r = M.autoStaleIdleCdagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCdagovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      M.editingCdagovEditV2("r1");
      M.setCdagovEditStuckMsV2(100);
      const r = M.autoFailStuckCdagovEditsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCdagovProfileIdleMsV2(1000);
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCdagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCodeAgentGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.editsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCdagovProfileV2({ id: "p1", owner: "a" });
      M.activateCdagovProfileV2("p1");
      M.createCdagovEditV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCodeAgentGovStatsV2();
      expect(s2.totalCdagovProfilesV2).toBe(1);
      expect(s2.totalCdagovEditsV2).toBe(1);
    });
  });
});
