/**
 * CallManager unit tests
 *
 * Covers: initialize (table creation, idempotency), createRoom (UUID generation,
 * DB insert, emit, success shape), joinRoom (room lookup, insert, emit),
 * leaveRoom (status update, emit), endRoom (status update, emit, cleanup),
 * getActiveRooms (query delegation), getParticipants (query delegation),
 * destroy (cleanup), error handling for missing deps and bad inputs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ────────────────────────────────────────────────────────
const { CallManager } = require("../call-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockPrepResult() {
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
}

/**
 * Build a mock database object that mirrors the real app pattern:
 * `database.getDatabase()` returns the inner db with exec / prepare / run.
 */
function createMockDatabase() {
  const prepResult = createMockPrepResult();
  const innerDb = {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
  return {
    getDatabase: vi.fn().mockReturnValue(innerDb),
    _inner: innerDb,
  };
}

function createMockP2PManager() {
  return {
    broadcast: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getConnectedPeers: vi.fn().mockReturnValue([]),
  };
}

function createMockDIDManager(did = "did:test:creator") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

/**
 * Return a minimal room row as stored in the DB.
 */
function makeRoomRow(overrides = {}) {
  return {
    id: "test-uuid-1",
    type: "voice",
    creator_did: "did:test:creator",
    status: "active",
    max_participants: 8,
    created_at: 1700000000000,
    ended_at: null,
    ...overrides,
  };
}

/**
 * Return a minimal participant row as stored in the DB.
 */
function makeParticipantRow(overrides = {}) {
  return {
    id: "test-uuid-2",
    room_id: "test-uuid-1",
    participant_did: "did:test:participant",
    role: "participant",
    status: "connected",
    joined_at: 1700000000000,
    left_at: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CallManager", () => {
  let manager;
  let db;
  let innerDb;
  let p2pManager;
  let didManager;

  beforeEach(() => {
    uuidCounter = 0;
    db = createMockDatabase();
    innerDb = db._inner;
    p2pManager = createMockP2PManager();
    didManager = createMockDIDManager();
    manager = new CallManager(db, didManager, p2pManager);
    vi.clearAllMocks();
    // Re-wire after clearAllMocks so getDatabase still works
    db.getDatabase.mockReturnValue(innerDb);
    innerDb.prepare.mockReturnValue(innerDb._prep || createMockPrepResult());
    // Store fresh prep on inner for re-use in tests
    const freshPrep = createMockPrepResult();
    innerDb.prepare = vi.fn().mockReturnValue(freshPrep);
    innerDb._prep = freshPrep;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should store database, didManager, and p2pManager references", () => {
      const m = new CallManager(db, didManager, p2pManager);
      expect(m.database).toBe(db);
      expect(m.didManager).toBe(didManager);
      expect(m.p2pManager).toBe(p2pManager);
    });

    it("should start with initialized=false", () => {
      const m = new CallManager(db, didManager, p2pManager);
      expect(m.initialized).toBe(false);
    });

    it("should be an EventEmitter", () => {
      const m = new CallManager(db, didManager, p2pManager);
      expect(typeof m.on).toBe("function");
      expect(typeof m.emit).toBe("function");
    });

    it("should merge default config with provided overrides", () => {
      const m = new CallManager(db, didManager, p2pManager, {
        maxParticipants: 4,
        ringTimeoutMs: 5000,
      });
      expect(m.config.maxParticipants).toBe(4);
      expect(m.config.ringTimeoutMs).toBe(5000);
      expect(m.config.roomIdleTimeoutMs).toBe(300000); // default preserved
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create call_rooms and call_participants tables on initialize", async () => {
      // recoverActiveRooms reads active rooms — return empty array
      innerDb._prep.all.mockReturnValue([]);

      await manager.initialize();

      expect(innerDb.exec).toHaveBeenCalled();
      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const allSql = execCalls.join(" ");
      expect(allSql).toContain("call_rooms");
      expect(allSql).toContain("call_participants");
    });

    it("should set initialized=true on success", async () => {
      innerDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent — second call does not re-exec", async () => {
      innerDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const execCountAfterFirst = innerDb.exec.mock.calls.length;

      // second call — should bail early via the `if (this.initialized)` guard
      await manager.initialize();
      expect(innerDb.exec.mock.calls.length).toBe(execCountAfterFirst);
    });

    it("should create indexes in the same exec chain", async () => {
      innerDb._prep.all.mockReturnValue([]);
      await manager.initialize();

      const allSql = innerDb.exec.mock.calls.map((c) => c[0]).join(" ");
      expect(allSql).toContain("idx_call_rooms_status");
      expect(allSql).toContain("idx_call_participants_room");
    });

    it("should recover active rooms from the database on startup", async () => {
      // First call: active rooms list; second call: participants for that room
      innerDb._prep.all
        .mockReturnValueOnce([makeRoomRow()]) // active rooms
        .mockReturnValueOnce([makeParticipantRow()]); // participants for room

      await manager.initialize();

      expect(manager.activeRooms.size).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createRoom()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createRoom()", () => {
    beforeEach(() => {
      manager.initialized = true;
      // No active rooms to recover (not called in createRoom, but safe to set)
    });

    it("should return success=true with room object for voice type", async () => {
      const result = await manager.createRoom({ type: "voice" });

      expect(result.success).toBe(true);
      expect(result.room).toBeDefined();
      expect(result.room.type).toBe("voice");
      expect(result.room.status).toBe("active");
    });

    it("should return success=true with room object for video type", async () => {
      const result = await manager.createRoom({ type: "video" });
      expect(result.success).toBe(true);
      expect(result.room.type).toBe("video");
    });

    it("should call db.prepare().run() to insert room into call_rooms", async () => {
      await manager.createRoom({ type: "voice" });

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find((sql) =>
        sql.includes("INSERT INTO call_rooms"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should call db.prepare().run() to add creator as host in call_participants", async () => {
      await manager.createRoom({ type: "voice" });

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const hostInsert = prepCalls.find(
        (sql) => sql.includes("call_participants") && sql.includes("INSERT"),
      );
      expect(hostInsert).toBeTruthy();
    });

    it("should emit room:created with the new room object", async () => {
      const spy = vi.fn();
      manager.on("room:created", spy);

      await manager.createRoom({ type: "voice" });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "voice", status: "active" }),
      );
    });

    it("should include the creator DID from didManager", async () => {
      const result = await manager.createRoom({ type: "voice" });
      expect(result.room.creatorDid).toBe("did:test:creator");
    });

    it("should return success=false for invalid call type", async () => {
      const result = await manager.createRoom({ type: "chat" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid call type");
    });

    it("should return success=false when DID is unavailable", async () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      const result = await manager.createRoom({ type: "voice" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No active DID identity");
    });

    it("should respect custom maxParticipants option", async () => {
      const result = await manager.createRoom({
        type: "video",
        maxParticipants: 4,
      });
      expect(result.success).toBe(true);
      expect(result.room.maxParticipants).toBe(4);
    });

    it("should track the new room in activeRooms map", async () => {
      const result = await manager.createRoom({ type: "voice" });
      const roomId = result.room.id;
      expect(manager.activeRooms.has(roomId)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // joinRoom()
  // ─────────────────────────────────────────────────────────────────────────
  describe("joinRoom()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should return success=true when joining an active room", async () => {
      const roomRow = makeRoomRow();
      // room lookup, participant count, existing participant check
      innerDb._prep.get
        .mockReturnValueOnce(roomRow) // active room found
        .mockReturnValueOnce({ count: 1 }) // participant count (not full)
        .mockReturnValueOnce(null); // not already joined

      const result = await manager.joinRoom("test-uuid-1");
      expect(result.success).toBe(true);
    });

    it("should insert into call_participants with status=connected", async () => {
      const roomRow = makeRoomRow();
      innerDb._prep.get
        .mockReturnValueOnce(roomRow)
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce(null);

      await manager.joinRoom("test-uuid-1");

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const insertCall = prepCalls.find(
        (sql) => sql.includes("call_participants") && sql.includes("INSERT"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should emit participant:joined event", async () => {
      const spy = vi.fn();
      manager.on("participant:joined", spy);

      const roomRow = makeRoomRow();
      innerDb._prep.get
        .mockReturnValueOnce(roomRow)
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce(null);

      await manager.joinRoom("test-uuid-1");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("should return success=false when room not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null); // room not found
      const result = await manager.joinRoom("nonexistent-room");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Room not found");
    });

    it("should return success=false when room is full", async () => {
      const roomRow = makeRoomRow({ max_participants: 2 });
      innerDb._prep.get
        .mockReturnValueOnce(roomRow)
        .mockReturnValueOnce({ count: 2 }); // at capacity

      const result = await manager.joinRoom("test-uuid-1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("full");
    });

    it("should return alreadyJoined=true when participant is already connected", async () => {
      const roomRow = makeRoomRow();
      const existingParticipant = makeParticipantRow({
        participant_did: "did:test:creator",
        status: "connected",
      });
      innerDb._prep.get
        .mockReturnValueOnce(roomRow)
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce(existingParticipant); // already in room

      const result = await manager.joinRoom("test-uuid-1");
      expect(result.success).toBe(true);
      expect(result.alreadyJoined).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // leaveRoom()
  // ─────────────────────────────────────────────────────────────────────────
  describe("leaveRoom()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should return success=true when leaving a room", async () => {
      // UPDATE returns changes=1, then _checkRoomEmpty count > 0
      innerDb._prep.run.mockReturnValue({ changes: 1 });
      innerDb._prep.get.mockReturnValueOnce({ count: 1 }); // still has participants

      const result = await manager.leaveRoom("test-uuid-1");
      expect(result.success).toBe(true);
    });

    it("should call db prepare with UPDATE call_participants SET status='left'", async () => {
      innerDb._prep.run.mockReturnValue({ changes: 1 });
      innerDb._prep.get.mockReturnValueOnce({ count: 1 });

      await manager.leaveRoom("test-uuid-1");

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const updateCall = prepCalls.find(
        (sql) => sql.includes("call_participants") && sql.includes("left"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should emit participant:left event", async () => {
      const spy = vi.fn();
      manager.on("participant:left", spy);

      innerDb._prep.run.mockReturnValue({ changes: 1 });
      innerDb._prep.get.mockReturnValueOnce({ count: 1 });

      await manager.leaveRoom("test-uuid-1");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("should auto-end the room when the last participant leaves", async () => {
      const spy = vi.fn();
      manager.on("room:ended", spy);

      innerDb._prep.run.mockReturnValue({ changes: 1 });
      // _checkRoomEmpty: count = 0 → triggers endRoom
      innerDb._prep.get
        .mockReturnValueOnce({ count: 0 }) // checkRoomEmpty
        .mockReturnValueOnce(makeRoomRow()); // endRoom room lookup

      await manager.leaveRoom("test-uuid-1");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("should return success=true with message when not in room", async () => {
      innerDb._prep.run.mockReturnValue({ changes: 0 }); // no rows affected
      const result = await manager.leaveRoom("test-uuid-1");
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // endRoom()
  // ─────────────────────────────────────────────────────────────────────────
  describe("endRoom()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should update room status to ended", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeRoomRow({ status: "active" }));

      await manager.endRoom("test-uuid-1");

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const updateCall = prepCalls.find(
        (sql) =>
          sql.includes("call_rooms") &&
          sql.includes("ended") &&
          sql.includes("UPDATE"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should emit room:ended event with roomId", async () => {
      const spy = vi.fn();
      manager.on("room:ended", spy);

      innerDb._prep.get.mockReturnValueOnce(makeRoomRow({ status: "active" }));

      await manager.endRoom("test-uuid-1");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: "test-uuid-1" }),
      );
    });

    it("should mark remaining participants as left", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeRoomRow({ status: "active" }));

      await manager.endRoom("test-uuid-1");

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const leftUpdate = prepCalls.find(
        (sql) => sql.includes("call_participants") && sql.includes("left"),
      );
      expect(leftUpdate).toBeTruthy();
    });

    it("should remove the room from activeRooms map", async () => {
      manager.activeRooms.set("test-uuid-1", { id: "test-uuid-1" });
      innerDb._prep.get.mockReturnValueOnce(makeRoomRow({ status: "active" }));

      await manager.endRoom("test-uuid-1");

      expect(manager.activeRooms.has("test-uuid-1")).toBe(false);
    });

    it("should return success=false when room not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);
      const result = await manager.endRoom("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Room not found");
    });

    it("should be idempotent — returns success when room is already ended", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeRoomRow({ status: "ended" }));
      const result = await manager.endRoom("test-uuid-1");
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getActiveRooms()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getActiveRooms()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should return success=true with rooms array", async () => {
      innerDb._prep.all
        .mockReturnValueOnce([makeRoomRow()]) // rooms query
        .mockReturnValueOnce([]); // participants for that room

      const result = await manager.getActiveRooms();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.rooms)).toBe(true);
    });

    it("should return empty rooms array when no active rooms", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const result = await manager.getActiveRooms();
      expect(result.success).toBe(true);
      expect(result.rooms).toHaveLength(0);
    });

    it("should query call_rooms WHERE status='active'", async () => {
      innerDb._prep.all.mockReturnValue([]);
      await manager.getActiveRooms();

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const roomsQuery = prepCalls.find(
        (sql) => sql.includes("call_rooms") && sql.includes("active"),
      );
      expect(roomsQuery).toBeTruthy();
    });

    it("should include participant count for each room", async () => {
      const participant = makeParticipantRow();
      innerDb._prep.all
        .mockReturnValueOnce([makeRoomRow()])
        .mockReturnValueOnce([participant]);

      const result = await manager.getActiveRooms();
      expect(result.rooms[0].participantCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getParticipants()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getParticipants()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should return success=true with participants array", async () => {
      innerDb._prep.all.mockReturnValueOnce([makeParticipantRow()]);
      const result = await manager.getParticipants("test-uuid-1");
      expect(result.success).toBe(true);
      expect(Array.isArray(result.participants)).toBe(true);
      expect(result.participants).toHaveLength(1);
    });

    it("should return empty participants when no one is in the room", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const result = await manager.getParticipants("test-uuid-1");
      expect(result.success).toBe(true);
      expect(result.participants).toHaveLength(0);
    });

    it("should query call_participants for the given roomId", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      await manager.getParticipants("my-room-42");

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const query = prepCalls.find((sql) => sql.includes("call_participants"));
      expect(query).toBeTruthy();
    });

    it("should filter out left participants by default (activeOnly=true)", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      await manager.getParticipants("test-uuid-1", true);

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      const query = prepCalls.find(
        (sql) => sql.includes("call_participants") && sql.includes("left"),
      );
      expect(query).toBeTruthy();
    });

    it("should include left participants when activeOnly=false", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      await manager.getParticipants("test-uuid-1", false);

      const prepCalls = innerDb.prepare.mock.calls.map((c) => c[0]);
      // When activeOnly=false, the query should NOT contain the 'left' filter
      const queryWithLeft = prepCalls.find(
        (sql) =>
          sql.includes("call_participants") &&
          !sql.includes("status != 'left'"),
      );
      expect(queryWithLeft).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getRoomById()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getRoomById()", () => {
    beforeEach(() => {
      manager.initialized = true;
    });

    it("should return success=true with room and participants", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeRoomRow());
      innerDb._prep.all.mockReturnValueOnce([makeParticipantRow()]);

      const result = await manager.getRoomById("test-uuid-1");
      expect(result.success).toBe(true);
      expect(result.room.id).toBe("test-uuid-1");
      expect(result.room.participantCount).toBe(1);
    });

    it("should return success=false when room not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);
      const result = await manager.getRoomById("ghost-room");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Room not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // destroy()
  // ─────────────────────────────────────────────────────────────────────────
  describe("destroy()", () => {
    it("should clear activeRooms", async () => {
      manager.activeRooms.set("r1", {});
      await manager.destroy();
      expect(manager.activeRooms.size).toBe(0);
    });

    it("should set initialized=false", async () => {
      manager.initialized = true;
      await manager.destroy();
      expect(manager.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      manager.on("room:ended", vi.fn());
      await manager.destroy();
      expect(manager.listenerCount("room:ended")).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _getCurrentDid() edge cases
  // ─────────────────────────────────────────────────────────────────────────
  describe("_getCurrentDid()", () => {
    it("should return null when didManager is absent", () => {
      const m = new CallManager(db, null, p2pManager);
      expect(m._getCurrentDid()).toBeNull();
    });

    it("should return null when getCurrentIdentity returns null", () => {
      didManager.getCurrentIdentity.mockReturnValue(null);
      expect(manager._getCurrentDid()).toBeNull();
    });

    it("should return the DID string from identity object", () => {
      expect(manager._getCurrentDid()).toBe("did:test:creator");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // setupP2PListeners()
  // ─────────────────────────────────────────────────────────────────────────
  describe("setupP2PListeners()", () => {
    it("should register message:call-invite listener on p2pManager", () => {
      manager.setupP2PListeners();
      expect(p2pManager.on).toHaveBeenCalledWith(
        "message:call-invite",
        expect.any(Function),
      );
    });

    it("should not throw when p2pManager is null", () => {
      const m = new CallManager(db, didManager, null);
      expect(() => m.setupP2PListeners()).not.toThrow();
    });
  });
});
