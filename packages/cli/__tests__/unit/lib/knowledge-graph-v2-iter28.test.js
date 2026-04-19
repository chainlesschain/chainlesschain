import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/knowledge-graph.js";

describe("Kggov V2 Surface", () => {
  beforeEach(() => M._resetStateKggovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.KGGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.KGGOV_QUERY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.KGGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.KGGOV_QUERY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveKgProfilesPerOwnerV2(11);
      expect(M.getMaxActiveKgProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingKgQuerysPerProfileV2(33);
      expect(M.getMaxPendingKgQuerysPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setKgProfileIdleMsV2(60000);
      expect(M.getKgProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setKgQueryStuckMsV2(45000);
      expect(M.getKgQueryStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveKgProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setKgQueryStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveKgProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveKgProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerKgProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerKgProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      expect(M.activateKgProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      expect(M.staleKgProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      const a = M.activateKgProfileV2("p1");
      M.staleKgProfileV2("p1");
      expect(M.activateKgProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      expect(M.archiveKgProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      M.archiveKgProfileV2("p1");
      expect(() => M.touchKgProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleKgProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerKgProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerKgProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getKgProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.registerKgProfileV2({ id: "p2", owner: "b" });
      expect(M.listKgProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getKgProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getKgProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveKgProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKgProfileV2({ id, owner: "a" }),
      );
      M.activateKgProfileV2("p1");
      M.activateKgProfileV2("p2");
      expect(() => M.activateKgProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveKgProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerKgProfileV2({ id, owner: "a" }),
      );
      M.activateKgProfileV2("p1");
      M.activateKgProfileV2("p2");
      M.staleKgProfileV2("p1");
      M.activateKgProfileV2("p3");
      expect(() => M.activateKgProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveKgProfilesPerOwnerV2(1);
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.registerKgProfileV2({ id: "p2", owner: "b" });
      M.activateKgProfileV2("p1");
      expect(() => M.activateKgProfileV2("p2")).not.toThrow();
    });
  });

  describe("query lifecycle", () => {
    beforeEach(() => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
    });
    it("create→querying→complete", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.queryingKgQueryV2("r1");
      const r = M.completeQueryKgV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.queryingKgQueryV2("r1");
      expect(M.failKgQueryV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKgQueryV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeQueryKgV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createKgQueryV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingKgQuerysPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createKgQueryV2({ id, profileId: "p1" }));
      expect(() => M.createKgQueryV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("querying counts as pending", () => {
      M.setMaxPendingKgQuerysPerProfileV2(1);
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.queryingKgQueryV2("r1");
      expect(() => M.createKgQueryV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingKgQuerysPerProfileV2(1);
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.queryingKgQueryV2("r1");
      M.completeQueryKgV2("r1");
      expect(() =>
        M.createKgQueryV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getKgQueryV2("nope")).toBeNull());
    it("list", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.createKgQueryV2({ id: "r2", profileId: "p1" });
      expect(M.listKgQuerysV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createKgQueryV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      expect(() => M.createKgQueryV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelKgQueryV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setKgProfileIdleMsV2(1000);
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      const r = M.autoStaleIdleKgProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getKgProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      M.queryingKgQueryV2("r1");
      M.setKgQueryStuckMsV2(100);
      const r = M.autoFailStuckKgQuerysV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setKgProfileIdleMsV2(1000);
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleKgProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getKggovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.querysByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerKgProfileV2({ id: "p1", owner: "a" });
      M.activateKgProfileV2("p1");
      M.createKgQueryV2({ id: "r1", profileId: "p1" });
      const s2 = M.getKggovStatsV2();
      expect(s2.totalKgProfilesV2).toBe(1);
      expect(s2.totalKgQuerysV2).toBe(1);
    });
  });
});
