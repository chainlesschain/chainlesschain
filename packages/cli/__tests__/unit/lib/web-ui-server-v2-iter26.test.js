import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/web-ui-server.js";

describe("WebUiServerGov V2 Surface", () => {
  beforeEach(() => M._resetStateWebUiServerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.WEBUIGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.WEBUIGOV_REQUEST_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.WEBUIGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.WEBUIGOV_REQUEST_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveWebuigovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveWebuigovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingWebuigovRequestsPerProfileV2(33);
      expect(M.getMaxPendingWebuigovRequestsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setWebuigovProfileIdleMsV2(60000);
      expect(M.getWebuigovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setWebuigovRequestStuckMsV2(45000);
      expect(M.getWebuigovRequestStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveWebuigovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setWebuigovRequestStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveWebuigovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveWebuigovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerWebuigovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default endpoint", () =>
      expect(
        M.registerWebuigovProfileV2({ id: "p1", owner: "a" }).endpoint,
      ).toBe("/"));
    it("activate", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateWebuigovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      expect(M.degradeWebuigovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateWebuigovProfileV2("p1");
      M.degradeWebuigovProfileV2("p1");
      expect(M.activateWebuigovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      expect(M.archiveWebuigovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      M.archiveWebuigovProfileV2("p1");
      expect(() => M.touchWebuigovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeWebuigovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerWebuigovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerWebuigovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getWebuigovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.registerWebuigovProfileV2({ id: "p2", owner: "b" });
      expect(M.listWebuigovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getWebuigovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getWebuigovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveWebuigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWebuigovProfileV2({ id, owner: "a" }),
      );
      M.activateWebuigovProfileV2("p1");
      M.activateWebuigovProfileV2("p2");
      expect(() => M.activateWebuigovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveWebuigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWebuigovProfileV2({ id, owner: "a" }),
      );
      M.activateWebuigovProfileV2("p1");
      M.activateWebuigovProfileV2("p2");
      M.degradeWebuigovProfileV2("p1");
      M.activateWebuigovProfileV2("p3");
      expect(() => M.activateWebuigovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveWebuigovProfilesPerOwnerV2(1);
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.registerWebuigovProfileV2({ id: "p2", owner: "b" });
      M.activateWebuigovProfileV2("p1");
      expect(() => M.activateWebuigovProfileV2("p2")).not.toThrow();
    });
  });

  describe("request lifecycle", () => {
    beforeEach(() => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
    });
    it("create→serving→complete", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.servingWebuigovRequestV2("r1");
      const r = M.completeRequestWebuigovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.servingWebuigovRequestV2("r1");
      expect(M.failWebuigovRequestV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWebuigovRequestV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRequestWebuigovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createWebuigovRequestV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingWebuigovRequestsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createWebuigovRequestV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createWebuigovRequestV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("serving counts as pending", () => {
      M.setMaxPendingWebuigovRequestsPerProfileV2(1);
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.servingWebuigovRequestV2("r1");
      expect(() =>
        M.createWebuigovRequestV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingWebuigovRequestsPerProfileV2(1);
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.servingWebuigovRequestV2("r1");
      M.completeRequestWebuigovV2("r1");
      expect(() =>
        M.createWebuigovRequestV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getWebuigovRequestV2("nope")).toBeNull());
    it("list", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.createWebuigovRequestV2({ id: "r2", profileId: "p1" });
      expect(M.listWebuigovRequestsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createWebuigovRequestV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createWebuigovRequestV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWebuigovRequestV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setWebuigovProfileIdleMsV2(1000);
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      const r = M.autoDegradeIdleWebuigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getWebuigovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      M.servingWebuigovRequestV2("r1");
      M.setWebuigovRequestStuckMsV2(100);
      const r = M.autoFailStuckWebuigovRequestsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setWebuigovProfileIdleMsV2(1000);
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleWebuigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getWebUiServerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.requestsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerWebuigovProfileV2({ id: "p1", owner: "a" });
      M.activateWebuigovProfileV2("p1");
      M.createWebuigovRequestV2({ id: "r1", profileId: "p1" });
      const s2 = M.getWebUiServerGovStatsV2();
      expect(s2.totalWebuigovProfilesV2).toBe(1);
      expect(s2.totalWebuigovRequestsV2).toBe(1);
    });
  });
});
