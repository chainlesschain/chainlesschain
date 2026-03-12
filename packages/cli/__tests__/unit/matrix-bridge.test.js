import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureMatrixTables,
  login,
  listRooms,
  sendMessage,
  getMessages,
  joinRoom,
  getLoginState,
  _resetState,
} from "../../src/lib/matrix-bridge.js";

describe("matrix-bridge", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureMatrixTables(db);
  });

  describe("ensureMatrixTables", () => {
    it("creates matrix_rooms and matrix_events tables", () => {
      expect(db.tables.has("matrix_rooms")).toBe(true);
      expect(db.tables.has("matrix_events")).toBe(true);
    });

    it("is idempotent", () => {
      ensureMatrixTables(db);
      expect(db.tables.has("matrix_rooms")).toBe(true);
    });
  });

  describe("login", () => {
    it("logs in successfully", () => {
      const r = login(
        db,
        "https://matrix.org",
        "@alice:matrix.org",
        "password",
      );
      expect(r.success).toBe(true);
      expect(r.userId).toBe("@alice:matrix.org");
      expect(r.homeserver).toBe("https://matrix.org");
      expect(r.accessToken).toContain("...");
    });

    it("uses default homeserver", () => {
      const r = login(db, null, "@bob:matrix.org", "pass");
      expect(r.homeserver).toBe("https://matrix.org");
    });

    it("throws on missing user ID", () => {
      expect(() => login(db, null, "", "pass")).toThrow("User ID is required");
    });

    it("throws on missing password", () => {
      expect(() => login(db, null, "@user:mx.org", "")).toThrow(
        "Password is required",
      );
    });

    it("updates login state", () => {
      login(db, null, "@alice:matrix.org", "pass");
      const state = getLoginState();
      expect(state.state).toBe("logged_in");
      expect(state.userId).toBe("@alice:matrix.org");
      expect(state.e2eeEnabled).toBe(true);
    });
  });

  describe("joinRoom", () => {
    it("joins a room", () => {
      const r = joinRoom(db, "!room1:matrix.org");
      expect(r.success).toBe(true);
      expect(r.room.roomId).toBe("!room1:matrix.org");
      expect(r.room.status).toBe("joined");
    });

    it("throws on missing room ID", () => {
      expect(() => joinRoom(db, "")).toThrow("Room ID or alias is required");
    });

    it("deduplicates room joins", () => {
      joinRoom(db, "!room1:matrix.org");
      const r = joinRoom(db, "!room1:matrix.org");
      expect(r.success).toBe(true);
      expect(listRooms().length).toBe(1);
    });

    it("persists to database", () => {
      joinRoom(db, "!room1:matrix.org");
      const rows = db.data.get("matrix_rooms") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listRooms", () => {
    it("returns empty initially", () => {
      expect(listRooms()).toEqual([]);
    });

    it("returns joined rooms", () => {
      joinRoom(db, "!a:mx.org");
      joinRoom(db, "!b:mx.org");
      expect(listRooms().length).toBe(2);
    });
  });

  describe("sendMessage", () => {
    it("sends a message", () => {
      const r = sendMessage(db, "!room1:mx.org", "Hello Matrix");
      expect(r.success).toBe(true);
      expect(r.event.content.body).toBe("Hello Matrix");
      expect(r.event.eventId).toMatch(/^\$/);
    });

    it("throws on missing room ID", () => {
      expect(() => sendMessage(db, "", "msg")).toThrow("Room ID is required");
    });

    it("throws on missing body", () => {
      expect(() => sendMessage(db, "!room:mx.org", "")).toThrow(
        "Message body is required",
      );
    });

    it("uses logged-in user as sender", () => {
      login(db, null, "@alice:mx.org", "pass");
      const r = sendMessage(db, "!room:mx.org", "test");
      expect(r.event.sender).toBe("@alice:mx.org");
    });

    it("persists to database", () => {
      sendMessage(db, "!room:mx.org", "test");
      const rows = db.data.get("matrix_events") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getMessages", () => {
    it("throws on missing room ID", () => {
      expect(() => getMessages("")).toThrow("Room ID is required");
    });

    it("returns empty for room with no messages", () => {
      expect(getMessages("!room:mx.org")).toEqual([]);
    });

    it("returns messages for a room", () => {
      sendMessage(db, "!room:mx.org", "A");
      sendMessage(db, "!room:mx.org", "B");
      sendMessage(db, "!other:mx.org", "C");
      expect(getMessages("!room:mx.org").length).toBe(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) sendMessage(db, "!room:mx.org", `msg${i}`);
      expect(getMessages("!room:mx.org", { limit: 3 }).length).toBe(3);
    });
  });
});
