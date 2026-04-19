import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-observe-html.js";

describe("CoworkObserveHtmlGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkObserveHtmlGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.COHTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.COHTGOV_RENDER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.COHTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.COHTGOV_RENDER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCohtgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCohtgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCohtgovRendersPerProfileV2(33);
      expect(M.getMaxPendingCohtgovRendersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCohtgovProfileIdleMsV2(60000);
      expect(M.getCohtgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCohtgovRenderStuckMsV2(45000);
      expect(M.getCohtgovRenderStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCohtgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCohtgovRenderStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCohtgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCohtgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCohtgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default template", () =>
      expect(
        M.registerCohtgovProfileV2({ id: "p1", owner: "a" }).template,
      ).toBe("default"));
    it("activate", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCohtgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      expect(M.staleCohtgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCohtgovProfileV2("p1");
      M.staleCohtgovProfileV2("p1");
      expect(M.activateCohtgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      expect(M.archiveCohtgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      M.archiveCohtgovProfileV2("p1");
      expect(() => M.touchCohtgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCohtgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCohtgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCohtgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCohtgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.registerCohtgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCohtgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCohtgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCohtgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCohtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCohtgovProfileV2({ id, owner: "a" }),
      );
      M.activateCohtgovProfileV2("p1");
      M.activateCohtgovProfileV2("p2");
      expect(() => M.activateCohtgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCohtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCohtgovProfileV2({ id, owner: "a" }),
      );
      M.activateCohtgovProfileV2("p1");
      M.activateCohtgovProfileV2("p2");
      M.staleCohtgovProfileV2("p1");
      M.activateCohtgovProfileV2("p3");
      expect(() => M.activateCohtgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCohtgovProfilesPerOwnerV2(1);
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.registerCohtgovProfileV2({ id: "p2", owner: "b" });
      M.activateCohtgovProfileV2("p1");
      expect(() => M.activateCohtgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("render lifecycle", () => {
    beforeEach(() => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
    });
    it("create→rendering→complete", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.renderingCohtgovRenderV2("r1");
      const r = M.completeRenderCohtgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.renderingCohtgovRenderV2("r1");
      expect(M.failCohtgovRenderV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCohtgovRenderV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRenderCohtgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCohtgovRenderV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCohtgovRendersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCohtgovRenderV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCohtgovRenderV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("rendering counts as pending", () => {
      M.setMaxPendingCohtgovRendersPerProfileV2(1);
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.renderingCohtgovRenderV2("r1");
      expect(() =>
        M.createCohtgovRenderV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCohtgovRendersPerProfileV2(1);
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.renderingCohtgovRenderV2("r1");
      M.completeRenderCohtgovV2("r1");
      expect(() =>
        M.createCohtgovRenderV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCohtgovRenderV2("nope")).toBeNull());
    it("list", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.createCohtgovRenderV2({ id: "r2", profileId: "p1" });
      expect(M.listCohtgovRendersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCohtgovRenderV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCohtgovRenderV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCohtgovRenderV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCohtgovProfileIdleMsV2(1000);
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      const r = M.autoStaleIdleCohtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCohtgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      M.renderingCohtgovRenderV2("r1");
      M.setCohtgovRenderStuckMsV2(100);
      const r = M.autoFailStuckCohtgovRendersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCohtgovProfileIdleMsV2(1000);
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCohtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkObserveHtmlGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.rendersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCohtgovProfileV2({ id: "p1", owner: "a" });
      M.activateCohtgovProfileV2("p1");
      M.createCohtgovRenderV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkObserveHtmlGovStatsV2();
      expect(s2.totalCohtgovProfilesV2).toBe(1);
      expect(s2.totalCohtgovRendersV2).toBe(1);
    });
  });
});
