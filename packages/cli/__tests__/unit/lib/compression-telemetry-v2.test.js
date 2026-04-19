import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/compression-telemetry.js";

describe("Compression Telemetry V2 Surface", () => {
  beforeEach(() => M._resetStateCompressionTelemetryV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.COMPT_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.COMPT_SAMPLE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.COMPT_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.COMPT_SAMPLE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveComptProfilesPerOwnerV2(11);
      expect(M.getMaxActiveComptProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingComptSamplesPerProfileV2(33);
      expect(M.getMaxPendingComptSamplesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setComptProfileIdleMsV2(60000);
      expect(M.getComptProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setComptSampleStuckMsV2(45000);
      expect(M.getComptSampleStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveComptProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setComptSampleStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveComptProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveComptProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerComptProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerComptProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      expect(M.activateComptProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      expect(M.staleComptProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      const a = M.activateComptProfileV2("p1");
      M.staleComptProfileV2("p1");
      expect(M.activateComptProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      expect(M.archiveComptProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      M.archiveComptProfileV2("p1");
      expect(() => M.touchComptProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleComptProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerComptProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerComptProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getComptProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.registerComptProfileV2({ id: "p2", owner: "b" });
      expect(M.listComptProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getComptProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getComptProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveComptProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerComptProfileV2({ id, owner: "a" }),
      );
      M.activateComptProfileV2("p1");
      M.activateComptProfileV2("p2");
      expect(() => M.activateComptProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveComptProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerComptProfileV2({ id, owner: "a" }),
      );
      M.activateComptProfileV2("p1");
      M.activateComptProfileV2("p2");
      M.staleComptProfileV2("p1");
      M.activateComptProfileV2("p3");
      expect(() => M.activateComptProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveComptProfilesPerOwnerV2(1);
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.registerComptProfileV2({ id: "p2", owner: "b" });
      M.activateComptProfileV2("p1");
      expect(() => M.activateComptProfileV2("p2")).not.toThrow();
    });
  });

  describe("sample lifecycle", () => {
    beforeEach(() => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
    });
    it("create→recording→record", () => {
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      M.recordingComptSampleV2("s1");
      const s = M.recordComptSampleV2("s1");
      expect(s.status).toBe("recorded");
    });
    it("fail", () => {
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      M.recordingComptSampleV2("s1");
      expect(M.failComptSampleV2("s1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      expect(M.cancelComptSampleV2("s1").status).toBe("cancelled");
    });
    it("invalid record from queued", () => {
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      expect(() => M.recordComptSampleV2("s1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createComptSampleV2({ id: "s1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingComptSamplesPerProfileV2(2);
      ["s1", "s2"].forEach((id) =>
        M.createComptSampleV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createComptSampleV2({ id: "s3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("recording counts as pending", () => {
      M.setMaxPendingComptSamplesPerProfileV2(1);
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      M.recordingComptSampleV2("s1");
      expect(() =>
        M.createComptSampleV2({ id: "s2", profileId: "p1" }),
      ).toThrow();
    });
    it("recorded frees slot", () => {
      M.setMaxPendingComptSamplesPerProfileV2(1);
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      M.recordingComptSampleV2("s1");
      M.recordComptSampleV2("s1");
      expect(() =>
        M.createComptSampleV2({ id: "s2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setComptProfileIdleMsV2(1000);
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      const r = M.autoStaleIdleComptProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getComptProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      M.recordingComptSampleV2("s1");
      M.setComptSampleStuckMsV2(100);
      const r = M.autoFailStuckComptSamplesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s = M.getCompressionTelemetryGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.samplesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerComptProfileV2({ id: "p1", owner: "a" });
      M.activateComptProfileV2("p1");
      M.createComptSampleV2({ id: "s1", profileId: "p1" });
      const s = M.getCompressionTelemetryGovStatsV2();
      expect(s.totalComptProfilesV2).toBe(1);
      expect(s.totalComptSamplesV2).toBe(1);
    });
  });
});
