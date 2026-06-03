import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/did-v2-manager.js";

describe("DidV2Manager V2 Surface", () => {
  beforeEach(() => M._resetStateDidV2ManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DV2GOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DV2GOV_CREDENTIAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DV2GOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DV2GOV_CREDENTIAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDv2govProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDv2govProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDv2govCredentialsPerProfileV2(33);
      expect(M.getMaxPendingDv2govCredentialsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDv2govProfileIdleMsV2(60000);
      expect(M.getDv2govProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDv2govCredentialStuckMsV2(45000);
      expect(M.getDv2govCredentialStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDv2govProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDv2govCredentialStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDv2govProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDv2govProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDv2govProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default method", () =>
      expect(M.registerDv2govProfileV2({ id: "p1", owner: "a" }).method).toBe(
        "web",
      ));
    it("activate", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDv2govProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      expect(M.suspendDv2govProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDv2govProfileV2("p1");
      M.suspendDv2govProfileV2("p1");
      expect(M.activateDv2govProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      expect(M.archiveDv2govProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      M.archiveDv2govProfileV2("p1");
      expect(() => M.touchDv2govProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendDv2govProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDv2govProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDv2govProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDv2govProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.registerDv2govProfileV2({ id: "p2", owner: "b" });
      expect(M.listDv2govProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDv2govProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDv2govProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDv2govProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDv2govProfileV2({ id, owner: "a" }),
      );
      M.activateDv2govProfileV2("p1");
      M.activateDv2govProfileV2("p2");
      expect(() => M.activateDv2govProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDv2govProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDv2govProfileV2({ id, owner: "a" }),
      );
      M.activateDv2govProfileV2("p1");
      M.activateDv2govProfileV2("p2");
      M.suspendDv2govProfileV2("p1");
      M.activateDv2govProfileV2("p3");
      expect(() => M.activateDv2govProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDv2govProfilesPerOwnerV2(1);
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.registerDv2govProfileV2({ id: "p2", owner: "b" });
      M.activateDv2govProfileV2("p1");
      expect(() => M.activateDv2govProfileV2("p2")).not.toThrow();
    });
  });

  describe("credential lifecycle", () => {
    beforeEach(() => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
    });
    it("create→issuing→complete", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.issuingDv2govCredentialV2("r1");
      const r = M.completeCredentialDv2govV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.issuingDv2govCredentialV2("r1");
      expect(M.failDv2govCredentialV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDv2govCredentialV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCredentialDv2govV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDv2govCredentialV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDv2govCredentialsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDv2govCredentialV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createDv2govCredentialV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("issuing counts as pending", () => {
      M.setMaxPendingDv2govCredentialsPerProfileV2(1);
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.issuingDv2govCredentialV2("r1");
      expect(() =>
        M.createDv2govCredentialV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDv2govCredentialsPerProfileV2(1);
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.issuingDv2govCredentialV2("r1");
      M.completeCredentialDv2govV2("r1");
      expect(() =>
        M.createDv2govCredentialV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDv2govCredentialV2("nope")).toBeNull());
    it("list", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.createDv2govCredentialV2({ id: "r2", profileId: "p1" });
      expect(M.listDv2govCredentialsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDv2govCredentialV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDv2govCredentialV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDv2govCredentialV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setDv2govProfileIdleMsV2(1000);
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      const r = M.autoSuspendIdleDv2govProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDv2govProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      M.issuingDv2govCredentialV2("r1");
      M.setDv2govCredentialStuckMsV2(100);
      const r = M.autoFailStuckDv2govCredentialsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDv2govProfileIdleMsV2(1000);
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleDv2govProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDidV2ManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.credentialsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDv2govProfileV2({ id: "p1", owner: "a" });
      M.activateDv2govProfileV2("p1");
      M.createDv2govCredentialV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDidV2ManagerGovStatsV2();
      expect(s2.totalDv2govProfilesV2).toBe(1);
      expect(s2.totalDv2govCredentialsV2).toBe(1);
    });
  });
});
