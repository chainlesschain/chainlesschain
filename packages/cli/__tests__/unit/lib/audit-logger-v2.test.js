import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/audit-logger.js";

describe("AuditLogger V2 Surface", () => {
  beforeEach(() => M._resetStateAuditLoggerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.AUD_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.AUD_WRITE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.AUD_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AUD_WRITE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAudProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAudProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAudWritesPerProfileV2(33);
      expect(M.getMaxPendingAudWritesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAudProfileIdleMsV2(60000);
      expect(M.getAudProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAudWriteStuckMsV2(45000);
      expect(M.getAudWriteStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAudProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAudWriteStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAudProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAudProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAudProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default level", () =>
      expect(M.registerAudProfileV2({ id: "p1", owner: "a" }).level).toBe(
        "info",
      ));
    it("activate", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAudProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      expect(M.suspendAudProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAudProfileV2("p1");
      M.suspendAudProfileV2("p1");
      expect(M.activateAudProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      expect(M.archiveAudProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      M.archiveAudProfileV2("p1");
      expect(() => M.touchAudProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendAudProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerAudProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAudProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAudProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.registerAudProfileV2({ id: "p2", owner: "b" });
      expect(M.listAudProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAudProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAudProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAudProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAudProfileV2({ id, owner: "a" }),
      );
      M.activateAudProfileV2("p1");
      M.activateAudProfileV2("p2");
      expect(() => M.activateAudProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAudProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAudProfileV2({ id, owner: "a" }),
      );
      M.activateAudProfileV2("p1");
      M.activateAudProfileV2("p2");
      M.suspendAudProfileV2("p1");
      M.activateAudProfileV2("p3");
      expect(() => M.activateAudProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAudProfilesPerOwnerV2(1);
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.registerAudProfileV2({ id: "p2", owner: "b" });
      M.activateAudProfileV2("p1");
      expect(() => M.activateAudProfileV2("p2")).not.toThrow();
    });
  });

  describe("write lifecycle", () => {
    beforeEach(() => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
    });
    it("create→writing→complete", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.writingAudWriteV2("r1");
      const r = M.writeOkAudV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("writing");
    });
    it("fail", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.writingAudWriteV2("r1");
      expect(M.failAudWriteV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAudWriteV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      expect(() => M.writeOkAudV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAudWriteV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAudWritesPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createAudWriteV2({ id, profileId: "p1" }));
      expect(() => M.createAudWriteV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("writing counts as pending", () => {
      M.setMaxPendingAudWritesPerProfileV2(1);
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.writingAudWriteV2("r1");
      expect(() => M.createAudWriteV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAudWritesPerProfileV2(1);
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.writingAudWriteV2("r1");
      M.writeOkAudV2("r1");
      expect(() =>
        M.createAudWriteV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAudWriteV2("nope")).toBeNull());
    it("list", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.createAudWriteV2({ id: "r2", profileId: "p1" });
      expect(M.listAudWritesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAudWriteV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      expect(() => M.createAudWriteV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAudWriteV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setAudProfileIdleMsV2(1000);
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      const r = M.autoSuspendIdleAudProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAudProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      M.writingAudWriteV2("r1");
      M.setAudWriteStuckMsV2(100);
      const r = M.autoFailStuckAudWritesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAudProfileIdleMsV2(1000);
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleAudProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAuditLoggerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.writesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAudProfileV2({ id: "p1", owner: "a" });
      M.activateAudProfileV2("p1");
      M.createAudWriteV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAuditLoggerGovStatsV2();
      expect(s2.totalAudProfilesV2).toBe(1);
      expect(s2.totalAudWritesV2).toBe(1);
    });
  });
});
