import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/chat-core.js";

describe("ChatCore V2 Surface", () => {
  beforeEach(() => M._resetStateChatCoreV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CHATGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CHATGOV_MESSAGE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CHATGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CHATGOV_MESSAGE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveChatgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveChatgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingChatgovMessagesPerProfileV2(33);
      expect(M.getMaxPendingChatgovMessagesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setChatgovProfileIdleMsV2(60000);
      expect(M.getChatgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setChatgovMessageStuckMsV2(45000);
      expect(M.getChatgovMessageStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveChatgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setChatgovMessageStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveChatgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveChatgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerChatgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default mode", () =>
      expect(M.registerChatgovProfileV2({ id: "p1", owner: "a" }).mode).toBe(
        "interactive",
      ));
    it("activate", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateChatgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      expect(M.staleChatgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateChatgovProfileV2("p1");
      M.staleChatgovProfileV2("p1");
      expect(M.activateChatgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      expect(M.archiveChatgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      M.archiveChatgovProfileV2("p1");
      expect(() => M.touchChatgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleChatgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerChatgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerChatgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getChatgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.registerChatgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listChatgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getChatgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getChatgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveChatgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerChatgovProfileV2({ id, owner: "a" }),
      );
      M.activateChatgovProfileV2("p1");
      M.activateChatgovProfileV2("p2");
      expect(() => M.activateChatgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveChatgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerChatgovProfileV2({ id, owner: "a" }),
      );
      M.activateChatgovProfileV2("p1");
      M.activateChatgovProfileV2("p2");
      M.staleChatgovProfileV2("p1");
      M.activateChatgovProfileV2("p3");
      expect(() => M.activateChatgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveChatgovProfilesPerOwnerV2(1);
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.registerChatgovProfileV2({ id: "p2", owner: "b" });
      M.activateChatgovProfileV2("p1");
      expect(() => M.activateChatgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("message lifecycle", () => {
    beforeEach(() => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
    });
    it("create→sending→complete", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.sendingChatgovMessageV2("r1");
      const r = M.completeMessageChatgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.sendingChatgovMessageV2("r1");
      expect(M.failChatgovMessageV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      expect(M.cancelChatgovMessageV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMessageChatgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createChatgovMessageV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingChatgovMessagesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createChatgovMessageV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createChatgovMessageV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("sending counts as pending", () => {
      M.setMaxPendingChatgovMessagesPerProfileV2(1);
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.sendingChatgovMessageV2("r1");
      expect(() =>
        M.createChatgovMessageV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingChatgovMessagesPerProfileV2(1);
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.sendingChatgovMessageV2("r1");
      M.completeMessageChatgovV2("r1");
      expect(() =>
        M.createChatgovMessageV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getChatgovMessageV2("nope")).toBeNull());
    it("list", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.createChatgovMessageV2({ id: "r2", profileId: "p1" });
      expect(M.listChatgovMessagesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createChatgovMessageV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createChatgovMessageV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      expect(M.cancelChatgovMessageV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setChatgovProfileIdleMsV2(1000);
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      const r = M.autoStaleIdleChatgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getChatgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      M.sendingChatgovMessageV2("r1");
      M.setChatgovMessageStuckMsV2(100);
      const r = M.autoFailStuckChatgovMessagesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setChatgovProfileIdleMsV2(1000);
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleChatgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getChatCoreGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.messagesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerChatgovProfileV2({ id: "p1", owner: "a" });
      M.activateChatgovProfileV2("p1");
      M.createChatgovMessageV2({ id: "r1", profileId: "p1" });
      const s2 = M.getChatCoreGovStatsV2();
      expect(s2.totalChatgovProfilesV2).toBe(1);
      expect(s2.totalChatgovMessagesV2).toBe(1);
    });
  });
});
