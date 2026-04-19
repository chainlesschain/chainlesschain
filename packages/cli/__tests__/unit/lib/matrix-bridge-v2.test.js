import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/matrix-bridge.js";

describe("MatrixBridge V2 Surface", () => {
  beforeEach(() => M._resetStateMatrixBridgeGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.MATGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.MATGOV_SEND_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.MATGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.MATGOV_SEND_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveMatgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveMatgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingMatgovSendsPerProfileV2(33);
      expect(M.getMaxPendingMatgovSendsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setMatgovProfileIdleMsV2(60000);
      expect(M.getMatgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setMatgovSendStuckMsV2(45000);
      expect(M.getMatgovSendStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveMatgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setMatgovSendStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveMatgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveMatgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerMatgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default homeserver", () =>
      expect(
        M.registerMatgovProfileV2({ id: "p1", owner: "a" }).homeserver,
      ).toBe("matrix.org"));
    it("activate", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateMatgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      expect(M.suspendMatgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateMatgovProfileV2("p1");
      M.suspendMatgovProfileV2("p1");
      expect(M.activateMatgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      expect(M.archiveMatgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      M.archiveMatgovProfileV2("p1");
      expect(() => M.touchMatgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendMatgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerMatgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerMatgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getMatgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.registerMatgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listMatgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getMatgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getMatgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveMatgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMatgovProfileV2({ id, owner: "a" }),
      );
      M.activateMatgovProfileV2("p1");
      M.activateMatgovProfileV2("p2");
      expect(() => M.activateMatgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveMatgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMatgovProfileV2({ id, owner: "a" }),
      );
      M.activateMatgovProfileV2("p1");
      M.activateMatgovProfileV2("p2");
      M.suspendMatgovProfileV2("p1");
      M.activateMatgovProfileV2("p3");
      expect(() => M.activateMatgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveMatgovProfilesPerOwnerV2(1);
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.registerMatgovProfileV2({ id: "p2", owner: "b" });
      M.activateMatgovProfileV2("p1");
      expect(() => M.activateMatgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("send lifecycle", () => {
    beforeEach(() => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
    });
    it("create→sending→complete", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.sendingMatgovSendV2("r1");
      const r = M.completeSendMatgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.sendingMatgovSendV2("r1");
      expect(M.failMatgovSendV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMatgovSendV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSendMatgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createMatgovSendV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingMatgovSendsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createMatgovSendV2({ id, profileId: "p1" }),
      );
      expect(() => M.createMatgovSendV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("sending counts as pending", () => {
      M.setMaxPendingMatgovSendsPerProfileV2(1);
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.sendingMatgovSendV2("r1");
      expect(() =>
        M.createMatgovSendV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingMatgovSendsPerProfileV2(1);
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.sendingMatgovSendV2("r1");
      M.completeSendMatgovV2("r1");
      expect(() =>
        M.createMatgovSendV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getMatgovSendV2("nope")).toBeNull());
    it("list", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.createMatgovSendV2({ id: "r2", profileId: "p1" });
      expect(M.listMatgovSendsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createMatgovSendV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createMatgovSendV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMatgovSendV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setMatgovProfileIdleMsV2(1000);
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      const r = M.autoSuspendIdleMatgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getMatgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      M.sendingMatgovSendV2("r1");
      M.setMatgovSendStuckMsV2(100);
      const r = M.autoFailStuckMatgovSendsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setMatgovProfileIdleMsV2(1000);
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleMatgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getMatrixBridgeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.sendsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerMatgovProfileV2({ id: "p1", owner: "a" });
      M.activateMatgovProfileV2("p1");
      M.createMatgovSendV2({ id: "r1", profileId: "p1" });
      const s2 = M.getMatrixBridgeGovStatsV2();
      expect(s2.totalMatgovProfilesV2).toBe(1);
      expect(s2.totalMatgovSendsV2).toBe(1);
    });
  });
});
