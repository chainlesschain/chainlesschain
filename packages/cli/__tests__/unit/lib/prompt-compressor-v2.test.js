import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/prompt-compressor.js";

describe("Prompt Compressor V2 Surface", () => {
  beforeEach(() => M._resetStatePromptCompressorV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PCOMP_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PCOMP_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PCOMP_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PCOMP_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePcompProfilesPerOwnerV2(11);
      expect(M.getMaxActivePcompProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPcompRunsPerProfileV2(33);
      expect(M.getMaxPendingPcompRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPcompProfileIdleMsV2(60000);
      expect(M.getPcompProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPcompRunStuckMsV2(45000);
      expect(M.getPcompRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePcompProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPcompRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePcompProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePcompProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPcompProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default variant", () =>
      expect(M.registerPcompProfileV2({ id: "p1", owner: "a" }).variant).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePcompProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      expect(M.stalePcompProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePcompProfileV2("p1");
      M.stalePcompProfileV2("p1");
      expect(M.activatePcompProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      expect(M.archivePcompProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      M.archivePcompProfileV2("p1");
      expect(() => M.touchPcompProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePcompProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPcompProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPcompProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPcompProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.registerPcompProfileV2({ id: "p2", owner: "b" });
      expect(M.listPcompProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPcompProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPcompProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePcompProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPcompProfileV2({ id, owner: "a" }),
      );
      M.activatePcompProfileV2("p1");
      M.activatePcompProfileV2("p2");
      expect(() => M.activatePcompProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePcompProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPcompProfileV2({ id, owner: "a" }),
      );
      M.activatePcompProfileV2("p1");
      M.activatePcompProfileV2("p2");
      M.stalePcompProfileV2("p1");
      M.activatePcompProfileV2("p3");
      expect(() => M.activatePcompProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePcompProfilesPerOwnerV2(1);
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.registerPcompProfileV2({ id: "p2", owner: "b" });
      M.activatePcompProfileV2("p1");
      expect(() => M.activatePcompProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
    });
    it("create→compressing→compress", () => {
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      M.compressingPcompRunV2("r1");
      const r = M.compressPcompRunV2("r1");
      expect(r.status).toBe("compressed");
    });
    it("fail", () => {
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      M.compressingPcompRunV2("r1");
      expect(M.failPcompRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPcompRunV2("r1").status).toBe("cancelled");
    });
    it("invalid compress from queued", () => {
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.compressPcompRunV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPcompRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPcompRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createPcompRunV2({ id, profileId: "p1" }));
      expect(() => M.createPcompRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("compressing counts as pending", () => {
      M.setMaxPendingPcompRunsPerProfileV2(1);
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      M.compressingPcompRunV2("r1");
      expect(() => M.createPcompRunV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("compressed frees slot", () => {
      M.setMaxPendingPcompRunsPerProfileV2(1);
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      M.compressingPcompRunV2("r1");
      M.compressPcompRunV2("r1");
      expect(() =>
        M.createPcompRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPcompProfileIdleMsV2(1000);
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      const r = M.autoStaleIdlePcompProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPcompProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      M.compressingPcompRunV2("r1");
      M.setPcompRunStuckMsV2(100);
      const r = M.autoFailStuckPcompRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s = M.getPromptCompressorGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPcompProfileV2({ id: "p1", owner: "a" });
      M.activatePcompProfileV2("p1");
      M.createPcompRunV2({ id: "r1", profileId: "p1" });
      const s = M.getPromptCompressorGovStatsV2();
      expect(s.totalPcompProfilesV2).toBe(1);
      expect(s.totalPcompRunsV2).toBe(1);
    });
  });
});
