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
  sendThreadReply,
  getThreadMessages,
  getThreadRoots,
  createSpace,
  addSpaceChild,
  removeSpaceChild,
  listSpaceChildren,
  listSpaces,
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

  // ── Threads ─────────────────────────────────────────────────────────

  describe("sendThreadReply (m.thread)", () => {
    it("sends a threaded reply with m.relates_to", () => {
      const r = sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root123",
        body: "reply one",
      });
      expect(r.success).toBe(true);
      expect(r.event.content.body).toBe("reply one");
      expect(r.event.content["m.relates_to"]).toEqual({
        rel_type: "m.thread",
        event_id: "$root123",
        is_falling_back: true,
        "m.in_reply_to": { event_id: "$root123" },
      });
    });

    it("uses explicit inReplyTo when provided", () => {
      const r = sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root",
        inReplyTo: "$sibling",
        body: "x",
      });
      expect(r.event.content["m.relates_to"]["m.in_reply_to"]).toEqual({
        event_id: "$sibling",
      });
    });

    it("respects isFallingBack=false", () => {
      const r = sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root",
        body: "x",
        isFallingBack: false,
      });
      expect(r.event.content["m.relates_to"].is_falling_back).toBe(false);
    });

    it("throws on missing fields", () => {
      expect(() =>
        sendThreadReply(db, { rootEventId: "$r", body: "x" }),
      ).toThrow("Room ID is required");
      expect(() =>
        sendThreadReply(db, { roomId: "!r:mx.org", body: "x" }),
      ).toThrow("rootEventId is required");
      expect(() =>
        sendThreadReply(db, { roomId: "!r:mx.org", rootEventId: "$r" }),
      ).toThrow("Message body is required");
    });

    it("persists to matrix_events", () => {
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root",
        body: "x",
      });
      const rows = db.data.get("matrix_events") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getThreadMessages", () => {
    it("returns replies in chronological order", () => {
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root",
        body: "first",
      });
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root",
        body: "second",
      });
      const replies = getThreadMessages("!room:mx.org", "$root");
      expect(replies.length).toBe(2);
      expect(replies[0].content.body).toBe("first");
      expect(replies[1].content.body).toBe("second");
    });

    it("excludes messages from other threads", () => {
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root-a",
        body: "in A",
      });
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root-b",
        body: "in B",
      });
      expect(getThreadMessages("!room:mx.org", "$root-a").length).toBe(1);
    });

    it("excludes non-thread messages", () => {
      sendMessage(db, "!room:mx.org", "plain");
      expect(getThreadMessages("!room:mx.org", "$root")).toEqual([]);
    });

    it("scopes to the given room", () => {
      sendThreadReply(db, {
        roomId: "!a:mx.org",
        rootEventId: "$root",
        body: "x",
      });
      expect(getThreadMessages("!b:mx.org", "$root")).toEqual([]);
    });

    it("throws on missing args", () => {
      expect(() => getThreadMessages("", "$r")).toThrow("Room ID is required");
      expect(() => getThreadMessages("!r:mx.org", "")).toThrow(
        "rootEventId is required",
      );
    });
  });

  describe("getThreadRoots", () => {
    it("rolls up replyCount and lastReplyAt per root", () => {
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root-a",
        body: "1",
      });
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root-a",
        body: "2",
      });
      sendThreadReply(db, {
        roomId: "!room:mx.org",
        rootEventId: "$root-b",
        body: "1",
      });
      const roots = getThreadRoots("!room:mx.org");
      const a = roots.find((r) => r.rootEventId === "$root-a");
      const b = roots.find((r) => r.rootEventId === "$root-b");
      expect(a.replyCount).toBe(2);
      expect(b.replyCount).toBe(1);
      expect(a.lastReplyAt).toBeTruthy();
    });

    it("returns empty when no threads exist", () => {
      sendMessage(db, "!room:mx.org", "plain");
      expect(getThreadRoots("!room:mx.org")).toEqual([]);
    });

    it("throws on missing roomId", () => {
      expect(() => getThreadRoots("")).toThrow("Room ID is required");
    });
  });

  // ── Spaces ──────────────────────────────────────────────────────────

  describe("createSpace", () => {
    it("creates a space with type m.space", () => {
      const r = createSpace(db, { name: "Engineering", topic: "Eng team" });
      expect(r.success).toBe(true);
      expect(r.space.name).toBe("Engineering");
      expect(r.space.topic).toBe("Eng team");
      expect(r.space.type).toBe("m.space");
      expect(r.space.isEncrypted).toBe(false);
      expect(r.space.roomId).toMatch(/^!space_/);
    });

    it("persists to matrix_rooms", () => {
      createSpace(db, { name: "X" });
      const rows = db.data.get("matrix_rooms") || [];
      expect(rows.length).toBe(1);
    });

    it("throws on missing name", () => {
      expect(() => createSpace(db, {})).toThrow("Space name is required");
    });
  });

  describe("addSpaceChild", () => {
    it("adds a child room to a space", () => {
      const { space } = createSpace(db, { name: "Parent" });
      const r = addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!child:mx.org",
      });
      expect(r.success).toBe(true);
      expect(r.spaceId).toBe(space.roomId);
      expect(r.childRoomId).toBe("!child:mx.org");
      expect(r.via).toEqual(["matrix.org"]);
    });

    it("accepts custom via list", () => {
      const { space } = createSpace(db, { name: "P" });
      const r = addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!child:mx.org",
        via: ["a.example", "b.example"],
      });
      expect(r.via).toEqual(["a.example", "b.example"]);
    });

    it("persists as m.space.child state event", () => {
      const { space } = createSpace(db, { name: "P" });
      addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!child:mx.org",
      });
      const rows = db.data.get("matrix_events") || [];
      expect(rows.length).toBe(1);
    });

    it("throws on missing args", () => {
      expect(() => addSpaceChild(db, { childRoomId: "!c:mx.org" })).toThrow(
        "spaceId is required",
      );
      expect(() => addSpaceChild(db, { spaceId: "!s" })).toThrow(
        "childRoomId is required",
      );
    });

    it("throws when space does not exist", () => {
      expect(() =>
        addSpaceChild(db, {
          spaceId: "!not_a_space",
          childRoomId: "!child:mx.org",
        }),
      ).toThrow("Space not found");
    });
  });

  describe("removeSpaceChild", () => {
    it("removes an existing child", () => {
      const { space } = createSpace(db, { name: "P" });
      addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!child:mx.org",
      });
      const r = removeSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!child:mx.org",
      });
      expect(r.removed).toBe(true);
      expect(listSpaceChildren(space.roomId)).toEqual([]);
    });

    it("returns removed=false when child was not present", () => {
      const { space } = createSpace(db, { name: "P" });
      const r = removeSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!nope:mx.org",
      });
      expect(r.removed).toBe(false);
    });
  });

  describe("listSpaceChildren", () => {
    it("returns all children with via metadata", () => {
      const { space } = createSpace(db, { name: "P" });
      addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!a:mx.org",
      });
      addSpaceChild(db, {
        spaceId: space.roomId,
        childRoomId: "!b:mx.org",
        via: ["x.example"],
      });
      const children = listSpaceChildren(space.roomId);
      expect(children.length).toBe(2);
      const a = children.find((c) => c.childRoomId === "!a:mx.org");
      const b = children.find((c) => c.childRoomId === "!b:mx.org");
      expect(a.via).toEqual(["matrix.org"]);
      expect(b.via).toEqual(["x.example"]);
    });

    it("returns empty for unknown space", () => {
      expect(listSpaceChildren("!unknown")).toEqual([]);
    });
  });

  describe("listSpaces", () => {
    it("returns only rooms with type=m.space", () => {
      createSpace(db, { name: "S1" });
      createSpace(db, { name: "S2" });
      joinRoom(db, "!regular:mx.org");
      const spaces = listSpaces();
      expect(spaces.length).toBe(2);
      expect(spaces.every((s) => s.type === "m.space")).toBe(true);
    });

    it("returns empty when no spaces exist", () => {
      joinRoom(db, "!regular:mx.org");
      expect(listSpaces()).toEqual([]);
    });
  });
});
