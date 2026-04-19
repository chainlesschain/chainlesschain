import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/downloader.js";

describe("DownloaderGov V2 Surface", () => {
  beforeEach(() => M._resetStateDownloaderGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DLGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DLGOV_DOWNLOAD_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DLGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DLGOV_DOWNLOAD_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDlgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDlgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDlgovDownloadsPerProfileV2(33);
      expect(M.getMaxPendingDlgovDownloadsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDlgovProfileIdleMsV2(60000);
      expect(M.getDlgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDlgovDownloadStuckMsV2(45000);
      expect(M.getDlgovDownloadStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDlgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDlgovDownloadStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDlgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDlgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDlgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default mirror", () =>
      expect(M.registerDlgovProfileV2({ id: "p1", owner: "a" }).mirror).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDlgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      expect(M.staleDlgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDlgovProfileV2("p1");
      M.staleDlgovProfileV2("p1");
      expect(M.activateDlgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      expect(M.archiveDlgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      M.archiveDlgovProfileV2("p1");
      expect(() => M.touchDlgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleDlgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDlgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDlgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDlgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.registerDlgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDlgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDlgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDlgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDlgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlgovProfileV2({ id, owner: "a" }),
      );
      M.activateDlgovProfileV2("p1");
      M.activateDlgovProfileV2("p2");
      expect(() => M.activateDlgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDlgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlgovProfileV2({ id, owner: "a" }),
      );
      M.activateDlgovProfileV2("p1");
      M.activateDlgovProfileV2("p2");
      M.staleDlgovProfileV2("p1");
      M.activateDlgovProfileV2("p3");
      expect(() => M.activateDlgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDlgovProfilesPerOwnerV2(1);
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.registerDlgovProfileV2({ id: "p2", owner: "b" });
      M.activateDlgovProfileV2("p1");
      expect(() => M.activateDlgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("download lifecycle", () => {
    beforeEach(() => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
    });
    it("create→fetching→complete", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.fetchingDlgovDownloadV2("r1");
      const r = M.completeDownloadDlgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.fetchingDlgovDownloadV2("r1");
      expect(M.failDlgovDownloadV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDlgovDownloadV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDownloadDlgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDlgovDownloadV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDlgovDownloadsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDlgovDownloadV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createDlgovDownloadV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("fetching counts as pending", () => {
      M.setMaxPendingDlgovDownloadsPerProfileV2(1);
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.fetchingDlgovDownloadV2("r1");
      expect(() =>
        M.createDlgovDownloadV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDlgovDownloadsPerProfileV2(1);
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.fetchingDlgovDownloadV2("r1");
      M.completeDownloadDlgovV2("r1");
      expect(() =>
        M.createDlgovDownloadV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDlgovDownloadV2("nope")).toBeNull());
    it("list", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.createDlgovDownloadV2({ id: "r2", profileId: "p1" });
      expect(M.listDlgovDownloadsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDlgovDownloadV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDlgovDownloadV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDlgovDownloadV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setDlgovProfileIdleMsV2(1000);
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      const r = M.autoStaleIdleDlgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDlgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      M.fetchingDlgovDownloadV2("r1");
      M.setDlgovDownloadStuckMsV2(100);
      const r = M.autoFailStuckDlgovDownloadsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDlgovProfileIdleMsV2(1000);
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleDlgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDownloaderGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.downloadsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDlgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlgovProfileV2("p1");
      M.createDlgovDownloadV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDownloaderGovStatsV2();
      expect(s2.totalDlgovProfilesV2).toBe(1);
      expect(s2.totalDlgovDownloadsV2).toBe(1);
    });
  });
});
