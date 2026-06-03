import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/pdf-parser.js";

describe("PDF Parser V2 Surface", () => {
  beforeEach(() => M._resetStatePdfParserV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PDFP_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PDFP_PARSE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PDFP_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PDFP_PARSE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePdfpProfilesPerOwnerV2(11);
      expect(M.getMaxActivePdfpProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPdfpParsesPerProfileV2(33);
      expect(M.getMaxPendingPdfpParsesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPdfpProfileIdleMsV2(60000);
      expect(M.getPdfpProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPdfpParseStuckMsV2(45000);
      expect(M.getPdfpParseStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePdfpProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPdfpParseStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePdfpProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePdfpProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPdfpProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default encoding", () =>
      expect(M.registerPdfpProfileV2({ id: "p1", owner: "a" }).encoding).toBe(
        "utf-8",
      ));
    it("activate", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePdfpProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      expect(M.stalePdfpProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePdfpProfileV2("p1");
      M.stalePdfpProfileV2("p1");
      expect(M.activatePdfpProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      expect(M.archivePdfpProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      M.archivePdfpProfileV2("p1");
      expect(() => M.touchPdfpProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePdfpProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerPdfpProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPdfpProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPdfpProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.registerPdfpProfileV2({ id: "p2", owner: "b" });
      expect(M.listPdfpProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPdfpProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPdfpProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePdfpProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPdfpProfileV2({ id, owner: "a" }),
      );
      M.activatePdfpProfileV2("p1");
      M.activatePdfpProfileV2("p2");
      expect(() => M.activatePdfpProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePdfpProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPdfpProfileV2({ id, owner: "a" }),
      );
      M.activatePdfpProfileV2("p1");
      M.activatePdfpProfileV2("p2");
      M.stalePdfpProfileV2("p1");
      M.activatePdfpProfileV2("p3");
      expect(() => M.activatePdfpProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePdfpProfilesPerOwnerV2(1);
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.registerPdfpProfileV2({ id: "p2", owner: "b" });
      M.activatePdfpProfileV2("p1");
      expect(() => M.activatePdfpProfileV2("p2")).not.toThrow();
    });
  });

  describe("parse lifecycle", () => {
    beforeEach(() => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
    });
    it("create→parsing→parse", () => {
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      M.parsingPdfpParseV2("j1");
      const j = M.parsePdfpParseV2("j1");
      expect(j.status).toBe("parsed");
    });
    it("fail", () => {
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      M.parsingPdfpParseV2("j1");
      expect(M.failPdfpParseV2("j1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      expect(M.cancelPdfpParseV2("j1").status).toBe("cancelled");
    });
    it("invalid parse from queued", () => {
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      expect(() => M.parsePdfpParseV2("j1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPdfpParseV2({ id: "j1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPdfpParsesPerProfileV2(2);
      ["j1", "j2"].forEach((id) =>
        M.createPdfpParseV2({ id, profileId: "p1" }),
      );
      expect(() => M.createPdfpParseV2({ id: "j3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("parsing counts as pending", () => {
      M.setMaxPendingPdfpParsesPerProfileV2(1);
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      M.parsingPdfpParseV2("j1");
      expect(() =>
        M.createPdfpParseV2({ id: "j2", profileId: "p1" }),
      ).toThrow();
    });
    it("parsed frees slot", () => {
      M.setMaxPendingPdfpParsesPerProfileV2(1);
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      M.parsingPdfpParseV2("j1");
      M.parsePdfpParseV2("j1");
      expect(() =>
        M.createPdfpParseV2({ id: "j2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPdfpProfileIdleMsV2(1000);
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      const r = M.autoStaleIdlePdfpProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPdfpProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      M.parsingPdfpParseV2("j1");
      M.setPdfpParseStuckMsV2(100);
      const r = M.autoFailStuckPdfpParsesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s = M.getPdfParserGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.parsesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPdfpProfileV2({ id: "p1", owner: "a" });
      M.activatePdfpProfileV2("p1");
      M.createPdfpParseV2({ id: "j1", profileId: "p1" });
      const s = M.getPdfParserGovStatsV2();
      expect(s.totalPdfpProfilesV2).toBe(1);
      expect(s.totalPdfpParsesV2).toBe(1);
    });
  });
});
