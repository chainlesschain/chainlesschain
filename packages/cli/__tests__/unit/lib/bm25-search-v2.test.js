import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/bm25-search.js";

describe("BM25 Search V2 Surface", () => {
  beforeEach(() => M._resetStateBm25SearchV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.BM25_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.BM25_QUERY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.BM25_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.BM25_QUERY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveBm25ProfilesPerOwnerV2(11);
      expect(M.getMaxActiveBm25ProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingBm25QueriesPerProfileV2(33);
      expect(M.getMaxPendingBm25QueriesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setBm25ProfileIdleMsV2(60000);
      expect(M.getBm25ProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setBm25QueryStuckMsV2(45000);
      expect(M.getBm25QueryStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveBm25ProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setBm25QueryStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveBm25ProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveBm25ProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerBm25ProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default field", () =>
      expect(M.registerBm25ProfileV2({ id: "p1", owner: "a" }).field).toBe(
        "content",
      ));
    it("activate", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      expect(M.activateBm25ProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      expect(M.staleBm25ProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      const a = M.activateBm25ProfileV2("p1");
      M.staleBm25ProfileV2("p1");
      expect(M.activateBm25ProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      expect(M.archiveBm25ProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      M.archiveBm25ProfileV2("p1");
      expect(() => M.touchBm25ProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleBm25ProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerBm25ProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerBm25ProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getBm25ProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.registerBm25ProfileV2({ id: "p2", owner: "b" });
      expect(M.listBm25ProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getBm25ProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getBm25ProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveBm25ProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBm25ProfileV2({ id, owner: "a" }),
      );
      M.activateBm25ProfileV2("p1");
      M.activateBm25ProfileV2("p2");
      expect(() => M.activateBm25ProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveBm25ProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBm25ProfileV2({ id, owner: "a" }),
      );
      M.activateBm25ProfileV2("p1");
      M.activateBm25ProfileV2("p2");
      M.staleBm25ProfileV2("p1");
      M.activateBm25ProfileV2("p3");
      expect(() => M.activateBm25ProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveBm25ProfilesPerOwnerV2(1);
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.registerBm25ProfileV2({ id: "p2", owner: "b" });
      M.activateBm25ProfileV2("p1");
      expect(() => M.activateBm25ProfileV2("p2")).not.toThrow();
    });
  });

  describe("query lifecycle", () => {
    beforeEach(() => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
    });
    it("create→searching→complete", () => {
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      M.searchingBm25QueryV2("q1");
      const q = M.completeBm25QueryV2("q1");
      expect(q.status).toBe("completed");
    });
    it("fail", () => {
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      M.searchingBm25QueryV2("q1");
      expect(M.failBm25QueryV2("q1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      expect(M.cancelBm25QueryV2("q1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      expect(() => M.completeBm25QueryV2("q1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createBm25QueryV2({ id: "q1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingBm25QueriesPerProfileV2(2);
      ["q1", "q2"].forEach((id) =>
        M.createBm25QueryV2({ id, profileId: "p1" }),
      );
      expect(() => M.createBm25QueryV2({ id: "q3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("searching counts as pending", () => {
      M.setMaxPendingBm25QueriesPerProfileV2(1);
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      M.searchingBm25QueryV2("q1");
      expect(() =>
        M.createBm25QueryV2({ id: "q2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingBm25QueriesPerProfileV2(1);
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      M.searchingBm25QueryV2("q1");
      M.completeBm25QueryV2("q1");
      expect(() =>
        M.createBm25QueryV2({ id: "q2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setBm25ProfileIdleMsV2(1000);
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      const r = M.autoStaleIdleBm25ProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getBm25ProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      M.searchingBm25QueryV2("q1");
      M.setBm25QueryStuckMsV2(100);
      const r = M.autoFailStuckBm25QueriesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s = M.getBm25SearchGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.queriesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerBm25ProfileV2({ id: "p1", owner: "a" });
      M.activateBm25ProfileV2("p1");
      M.createBm25QueryV2({ id: "q1", profileId: "p1" });
      const s = M.getBm25SearchGovStatsV2();
      expect(s.totalBm25ProfilesV2).toBe(1);
      expect(s.totalBm25QueriesV2).toBe(1);
    });
  });
});
