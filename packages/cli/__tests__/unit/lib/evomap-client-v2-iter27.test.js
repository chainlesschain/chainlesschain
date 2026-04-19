import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evomap-client.js";

describe("EvomapClientGov V2 Surface", () => {
  beforeEach(() => M._resetStateEvomapClientGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.EVCLIGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.EVCLIGOV_RPC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.EVCLIGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.EVCLIGOV_RPC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEvcligovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEvcligovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEvcligovRpcsPerProfileV2(33);
      expect(M.getMaxPendingEvcligovRpcsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEvcligovProfileIdleMsV2(60000);
      expect(M.getEvcligovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEvcligovRpcStuckMsV2(45000);
      expect(M.getEvcligovRpcStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEvcligovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEvcligovRpcStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEvcligovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEvcligovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEvcligovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default endpoint", () =>
      expect(
        M.registerEvcligovProfileV2({ id: "p1", owner: "a" }).endpoint,
      ).toBe("primary"));
    it("activate", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEvcligovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      expect(M.staleEvcligovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEvcligovProfileV2("p1");
      M.staleEvcligovProfileV2("p1");
      expect(M.activateEvcligovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      expect(M.archiveEvcligovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      M.archiveEvcligovProfileV2("p1");
      expect(() => M.touchEvcligovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleEvcligovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerEvcligovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEvcligovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEvcligovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.registerEvcligovProfileV2({ id: "p2", owner: "b" });
      expect(M.listEvcligovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEvcligovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEvcligovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEvcligovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvcligovProfileV2({ id, owner: "a" }),
      );
      M.activateEvcligovProfileV2("p1");
      M.activateEvcligovProfileV2("p2");
      expect(() => M.activateEvcligovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEvcligovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvcligovProfileV2({ id, owner: "a" }),
      );
      M.activateEvcligovProfileV2("p1");
      M.activateEvcligovProfileV2("p2");
      M.staleEvcligovProfileV2("p1");
      M.activateEvcligovProfileV2("p3");
      expect(() => M.activateEvcligovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEvcligovProfilesPerOwnerV2(1);
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.registerEvcligovProfileV2({ id: "p2", owner: "b" });
      M.activateEvcligovProfileV2("p1");
      expect(() => M.activateEvcligovProfileV2("p2")).not.toThrow();
    });
  });

  describe("rpc lifecycle", () => {
    beforeEach(() => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
    });
    it("create→calling→complete", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.callingEvcligovRpcV2("r1");
      const r = M.completeRpcEvcligovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.callingEvcligovRpcV2("r1");
      expect(M.failEvcligovRpcV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvcligovRpcV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRpcEvcligovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEvcligovRpcV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEvcligovRpcsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createEvcligovRpcV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createEvcligovRpcV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("calling counts as pending", () => {
      M.setMaxPendingEvcligovRpcsPerProfileV2(1);
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.callingEvcligovRpcV2("r1");
      expect(() =>
        M.createEvcligovRpcV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEvcligovRpcsPerProfileV2(1);
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.callingEvcligovRpcV2("r1");
      M.completeRpcEvcligovV2("r1");
      expect(() =>
        M.createEvcligovRpcV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEvcligovRpcV2("nope")).toBeNull());
    it("list", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.createEvcligovRpcV2({ id: "r2", profileId: "p1" });
      expect(M.listEvcligovRpcsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEvcligovRpcV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createEvcligovRpcV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvcligovRpcV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setEvcligovProfileIdleMsV2(1000);
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      const r = M.autoStaleIdleEvcligovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEvcligovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      M.callingEvcligovRpcV2("r1");
      M.setEvcligovRpcStuckMsV2(100);
      const r = M.autoFailStuckEvcligovRpcsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEvcligovProfileIdleMsV2(1000);
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleEvcligovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getEvomapClientGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.rpcsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEvcligovProfileV2({ id: "p1", owner: "a" });
      M.activateEvcligovProfileV2("p1");
      M.createEvcligovRpcV2({ id: "r1", profileId: "p1" });
      const s2 = M.getEvomapClientGovStatsV2();
      expect(s2.totalEvcligovProfilesV2).toBe(1);
      expect(s2.totalEvcligovRpcsV2).toBe(1);
    });
  });
});
