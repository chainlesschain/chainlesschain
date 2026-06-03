import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/provider-stream.js";

describe("ProviderStreamGov V2 Surface", () => {
  beforeEach(() => M._resetStateProviderStreamGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PSTRMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PSTRMGOV_CHUNK_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PSTRMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PSTRMGOV_CHUNK_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePstrmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePstrmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPstrmgovChunksPerProfileV2(33);
      expect(M.getMaxPendingPstrmgovChunksPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPstrmgovProfileIdleMsV2(60000);
      expect(M.getPstrmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPstrmgovChunkStuckMsV2(45000);
      expect(M.getPstrmgovChunkStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePstrmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPstrmgovChunkStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePstrmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePstrmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPstrmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default provider", () =>
      expect(
        M.registerPstrmgovProfileV2({ id: "p1", owner: "a" }).provider,
      ).toBe("default"));
    it("activate", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePstrmgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      expect(M.stalePstrmgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePstrmgovProfileV2("p1");
      M.stalePstrmgovProfileV2("p1");
      expect(M.activatePstrmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      expect(M.archivePstrmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      M.archivePstrmgovProfileV2("p1");
      expect(() => M.touchPstrmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePstrmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPstrmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPstrmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPstrmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.registerPstrmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPstrmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPstrmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPstrmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePstrmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPstrmgovProfileV2({ id, owner: "a" }),
      );
      M.activatePstrmgovProfileV2("p1");
      M.activatePstrmgovProfileV2("p2");
      expect(() => M.activatePstrmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePstrmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPstrmgovProfileV2({ id, owner: "a" }),
      );
      M.activatePstrmgovProfileV2("p1");
      M.activatePstrmgovProfileV2("p2");
      M.stalePstrmgovProfileV2("p1");
      M.activatePstrmgovProfileV2("p3");
      expect(() => M.activatePstrmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePstrmgovProfilesPerOwnerV2(1);
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.registerPstrmgovProfileV2({ id: "p2", owner: "b" });
      M.activatePstrmgovProfileV2("p1");
      expect(() => M.activatePstrmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("chunk lifecycle", () => {
    beforeEach(() => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
    });
    it("create→streaming→complete", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.streamingPstrmgovChunkV2("r1");
      const r = M.completeChunkPstrmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.streamingPstrmgovChunkV2("r1");
      expect(M.failPstrmgovChunkV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPstrmgovChunkV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeChunkPstrmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPstrmgovChunkV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPstrmgovChunksPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPstrmgovChunkV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPstrmgovChunkV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("streaming counts as pending", () => {
      M.setMaxPendingPstrmgovChunksPerProfileV2(1);
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.streamingPstrmgovChunkV2("r1");
      expect(() =>
        M.createPstrmgovChunkV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPstrmgovChunksPerProfileV2(1);
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.streamingPstrmgovChunkV2("r1");
      M.completeChunkPstrmgovV2("r1");
      expect(() =>
        M.createPstrmgovChunkV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPstrmgovChunkV2("nope")).toBeNull());
    it("list", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.createPstrmgovChunkV2({ id: "r2", profileId: "p1" });
      expect(M.listPstrmgovChunksV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPstrmgovChunkV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPstrmgovChunkV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPstrmgovProfileIdleMsV2(1000);
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      const r = M.autoStaleIdlePstrmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPstrmgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      M.streamingPstrmgovChunkV2("r1");
      M.setPstrmgovChunkStuckMsV2(100);
      const r = M.autoFailStuckPstrmgovChunksV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPstrmgovProfileIdleMsV2(1000);
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdlePstrmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getProviderStreamGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.chunksByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPstrmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePstrmgovProfileV2("p1");
      M.createPstrmgovChunkV2({ id: "r1", profileId: "p1" });
      const s2 = M.getProviderStreamGovStatsV2();
      expect(s2.totalPstrmgovProfilesV2).toBe(1);
      expect(s2.totalPstrmgovChunksV2).toBe(1);
    });
  });
});
