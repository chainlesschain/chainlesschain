import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/matrix-bridge.js";

describe("Matrix Bridge V2 Surface", () => {
  beforeEach(() => M._resetStateMatrixBridgeV2());

  describe("enums", () => {
    it("room maturity has 4 states", () => expect(Object.keys(M.MX_ROOM_MATURITY_V2)).toHaveLength(4));
    it("message lifecycle has 5 states", () => expect(Object.keys(M.MX_MESSAGE_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.MX_ROOM_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.MX_MESSAGE_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveMatrixRoomsPerOwnerV2", () => { M.setMaxActiveMatrixRoomsPerOwnerV2(30); expect(M.getMaxActiveMatrixRoomsPerOwnerV2()).toBe(30); });
    it("setMaxPendingMatrixMessagesPerRoomV2", () => { M.setMaxPendingMatrixMessagesPerRoomV2(100); expect(M.getMaxPendingMatrixMessagesPerRoomV2()).toBe(100); });
    it("setMatrixRoomIdleMsV2", () => { M.setMatrixRoomIdleMsV2(3600000); expect(M.getMatrixRoomIdleMsV2()).toBe(3600000); });
    it("setMatrixMessageStuckMsV2", () => { M.setMatrixMessageStuckMsV2(60000); expect(M.getMatrixMessageStuckMsV2()).toBe(60000); });
    it("rejects zero", () => expect(() => M.setMaxActiveMatrixRoomsPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setMatrixMessageStuckMsV2("nope")).toThrow());
    it("floors decimals", () => { M.setMaxActiveMatrixRoomsPerOwnerV2(3.7); expect(M.getMaxActiveMatrixRoomsPerOwnerV2()).toBe(3); });
  });

  describe("room lifecycle", () => {
    it("register", () => { const r = M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); expect(r.status).toBe("pending"); });
    it("activate", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); const r = M.activateMatrixRoomV2("r1"); expect(r.status).toBe("active"); expect(r.activatedAt).toBeTruthy(); });
    it("mute active→muted", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); M.activateMatrixRoomV2("r1"); expect(M.muteMatrixRoomV2("r1").status).toBe("muted"); });
    it("recovery muted→active preserves activatedAt", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); const a = M.activateMatrixRoomV2("r1"); M.muteMatrixRoomV2("r1"); const re = M.activateMatrixRoomV2("r1"); expect(re.activatedAt).toBe(a.activatedAt); });
    it("archive terminal", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); M.activateMatrixRoomV2("r1"); const r = M.archiveMatrixRoomV2("r1"); expect(r.status).toBe("archived"); expect(r.archivedAt).toBeTruthy(); });
    it("cannot touch archived", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); M.activateMatrixRoomV2("r1"); M.archiveMatrixRoomV2("r1"); expect(() => M.touchMatrixRoomV2("r1")).toThrow(); });
    it("invalid transition", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); expect(() => M.muteMatrixRoomV2("r1")).toThrow(); });
    it("duplicate id rejected", () => { M.registerMatrixRoomV2({ id: "r1", owner: "alice" }); expect(() => M.registerMatrixRoomV2({ id: "r1", owner: "b" })).toThrow(); });
    it("missing owner", () => expect(() => M.registerMatrixRoomV2({ id: "r1" })).toThrow());
    it("list all", () => { M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.registerMatrixRoomV2({ id: "r2", owner: "b" }); expect(M.listMatrixRoomsV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getMatrixRoomV2("nope")).toBeNull());
    it("defensive copy", () => { M.registerMatrixRoomV2({ id: "r1", owner: "a", metadata: { x: 1 } }); const r = M.getMatrixRoomV2("r1"); r.metadata.x = 99; expect(M.getMatrixRoomV2("r1").metadata.x).toBe(1); });
  });

  describe("active-room cap", () => {
    it("enforced", () => { M.setMaxActiveMatrixRoomsPerOwnerV2(2); ["r1","r2","r3"].forEach(id => M.registerMatrixRoomV2({ id, owner: "a" })); M.activateMatrixRoomV2("r1"); M.activateMatrixRoomV2("r2"); expect(() => M.activateMatrixRoomV2("r3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveMatrixRoomsPerOwnerV2(2); ["r1","r2","r3"].forEach(id => M.registerMatrixRoomV2({ id, owner: "a" })); M.activateMatrixRoomV2("r1"); M.activateMatrixRoomV2("r2"); M.muteMatrixRoomV2("r1"); M.activateMatrixRoomV2("r3"); expect(() => M.activateMatrixRoomV2("r1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveMatrixRoomsPerOwnerV2(1); M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.registerMatrixRoomV2({ id: "r2", owner: "b" }); M.activateMatrixRoomV2("r1"); expect(() => M.activateMatrixRoomV2("r2")).not.toThrow(); });
  });

  describe("message lifecycle", () => {
    beforeEach(() => { M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.activateMatrixRoomV2("r1"); });
    it("create→start→deliver", () => { M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); M.startMatrixMessageV2("m1"); const m = M.deliverMatrixMessageV2("m1"); expect(m.status).toBe("delivered"); });
    it("fail", () => { M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); M.startMatrixMessageV2("m1"); const m = M.failMatrixMessageV2("m1", "timeout"); expect(m.metadata.failReason).toBe("timeout"); });
    it("cancel from queued", () => { M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); expect(M.cancelMatrixMessageV2("m1").status).toBe("cancelled"); });
    it("cannot deliver from queued", () => { M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); expect(() => M.deliverMatrixMessageV2("m1")).toThrow(); });
    it("unknown room rejected", () => expect(() => M.createMatrixMessageV2({ id: "m1", roomId: "none" })).toThrow());
    it("per-room pending cap", () => { M.setMaxPendingMatrixMessagesPerRoomV2(2); ["m1","m2"].forEach(id => M.createMatrixMessageV2({ id, roomId: "r1" })); expect(() => M.createMatrixMessageV2({ id: "m3", roomId: "r1" })).toThrow(/max pending/); });
    it("sending counts toward pending", () => { M.setMaxPendingMatrixMessagesPerRoomV2(1); M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); M.startMatrixMessageV2("m1"); expect(() => M.createMatrixMessageV2({ id: "m2", roomId: "r1" })).toThrow(); });
    it("delivered frees slot", () => { M.setMaxPendingMatrixMessagesPerRoomV2(1); M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); M.startMatrixMessageV2("m1"); M.deliverMatrixMessageV2("m1"); expect(() => M.createMatrixMessageV2({ id: "m2", roomId: "r1" })).not.toThrow(); });
  });

  describe("auto flips", () => {
    it("autoMuteIdle", () => { M.setMatrixRoomIdleMsV2(1000); M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.activateMatrixRoomV2("r1"); const r = M.autoMuteIdleMatrixRoomsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getMatrixRoomV2("r1").status).toBe("muted"); });
    it("autoFailStuck", () => { M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.activateMatrixRoomV2("r1"); M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); M.startMatrixMessageV2("m1"); M.setMatrixMessageStuckMsV2(100); const r = M.autoFailStuckMatrixMessagesV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getMatrixMessageV2("m1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all status keys", () => { const s = M.getMatrixBridgeStatsV2(); expect(s.roomsByStatus.pending).toBe(0); expect(s.msgsByStatus.queued).toBe(0); });
    it("counts", () => { M.registerMatrixRoomV2({ id: "r1", owner: "a" }); M.activateMatrixRoomV2("r1"); M.createMatrixMessageV2({ id: "m1", roomId: "r1" }); const s = M.getMatrixBridgeStatsV2(); expect(s.totalRoomsV2).toBe(1); expect(s.totalMessagesV2).toBe(1); });
  });
});
