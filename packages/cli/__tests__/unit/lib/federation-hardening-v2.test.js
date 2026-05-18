import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/federation-hardening.js";

describe("FederationHardening V2 Surface", () => {
  beforeEach(() => M._resetStateFederationHardeningGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.FEDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.FEDGOV_PROBE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.FEDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.FEDGOV_PROBE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveFedgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveFedgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingFedgovProbesPerProfileV2(33);
      expect(M.getMaxPendingFedgovProbesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setFedgovProfileIdleMsV2(60000);
      expect(M.getFedgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setFedgovProbeStuckMsV2(45000);
      expect(M.getFedgovProbeStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveFedgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setFedgovProbeStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveFedgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveFedgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerFedgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default region", () =>
      expect(M.registerFedgovProfileV2({ id: "p1", owner: "a" }).region).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateFedgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      expect(M.degradeFedgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateFedgovProfileV2("p1");
      M.degradeFedgovProfileV2("p1");
      expect(M.activateFedgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      expect(M.archiveFedgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      M.archiveFedgovProfileV2("p1");
      expect(() => M.touchFedgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeFedgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerFedgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerFedgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getFedgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.registerFedgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listFedgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getFedgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getFedgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveFedgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerFedgovProfileV2({ id, owner: "a" }),
      );
      M.activateFedgovProfileV2("p1");
      M.activateFedgovProfileV2("p2");
      expect(() => M.activateFedgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveFedgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerFedgovProfileV2({ id, owner: "a" }),
      );
      M.activateFedgovProfileV2("p1");
      M.activateFedgovProfileV2("p2");
      M.degradeFedgovProfileV2("p1");
      M.activateFedgovProfileV2("p3");
      expect(() => M.activateFedgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveFedgovProfilesPerOwnerV2(1);
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.registerFedgovProfileV2({ id: "p2", owner: "b" });
      M.activateFedgovProfileV2("p1");
      expect(() => M.activateFedgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("probe lifecycle", () => {
    beforeEach(() => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
    });
    it("create→probing→complete", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.probingFedgovProbeV2("r1");
      const r = M.completeProbeFedgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.probingFedgovProbeV2("r1");
      expect(M.failFedgovProbeV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelFedgovProbeV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeProbeFedgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createFedgovProbeV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingFedgovProbesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createFedgovProbeV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createFedgovProbeV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("probing counts as pending", () => {
      M.setMaxPendingFedgovProbesPerProfileV2(1);
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.probingFedgovProbeV2("r1");
      expect(() =>
        M.createFedgovProbeV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingFedgovProbesPerProfileV2(1);
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.probingFedgovProbeV2("r1");
      M.completeProbeFedgovV2("r1");
      expect(() =>
        M.createFedgovProbeV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getFedgovProbeV2("nope")).toBeNull());
    it("list", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.createFedgovProbeV2({ id: "r2", profileId: "p1" });
      expect(M.listFedgovProbesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createFedgovProbeV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createFedgovProbeV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelFedgovProbeV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setFedgovProfileIdleMsV2(1000);
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      const r = M.autoDegradeIdleFedgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getFedgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      M.probingFedgovProbeV2("r1");
      M.setFedgovProbeStuckMsV2(100);
      const r = M.autoFailStuckFedgovProbesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setFedgovProfileIdleMsV2(1000);
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleFedgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getFederationHardeningGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.probesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerFedgovProfileV2({ id: "p1", owner: "a" });
      M.activateFedgovProfileV2("p1");
      M.createFedgovProbeV2({ id: "r1", profileId: "p1" });
      const s2 = M.getFederationHardeningGovStatsV2();
      expect(s2.totalFedgovProfilesV2).toBe(1);
      expect(s2.totalFedgovProbesV2).toBe(1);
    });
  });
});
