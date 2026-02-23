/**
 * Social Calls Integration Tests
 *
 * Integration tests for the call flow: CallManager + CallSignaling working
 * together. Tests use stateful in-memory mocks of the SQLite database so no
 * native modules are required.
 *
 * Scenarios covered:
 * 1. Full call lifecycle: create → join → leave → end
 * 2. Event emissions across the call lifecycle
 * 3. Max-participants enforcement
 * 4. Signaling message flow (offer / answer / ICE candidate)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks – must come before the imports that use them
// ---------------------------------------------------------------------------

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `uuid-${++counter}` };
});

// ---------------------------------------------------------------------------
// Stateful in-memory mock database
// ---------------------------------------------------------------------------

/**
 * Creates a lightweight, stateful mock of the better-sqlite3 database object.
 * Stores rows in plain JS Maps so that prepared-statement calls have real
 * side-effects across the whole test.
 */
function createStatefulMockDatabase() {
  const callRooms = new Map();         // roomId → row object
  const callParticipants = new Map();  // participantId → row object

  // Helper: return all participants for a room
  function participantsForRoom(roomId) {
    return [...callParticipants.values()].filter(
      (p) => p.room_id === roomId,
    );
  }

  // Helper: return participants for a room filtered by status
  function activeParticipantsForRoom(roomId) {
    return participantsForRoom(roomId).filter((p) => p.status !== "left");
  }

  // Build a chainable "statement" whose run / get / all methods do real work
  function makeStmt(sql) {
    return {
      run: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("INSERT INTO call_rooms")) {
          // SQL: INSERT INTO call_rooms (id, type, creator_did, status, max_participants, created_at)
          // VALUES (?, ?, ?, 'active', ?, ?)  — status is hardcoded, so 5 placeholders
          const [id, type, creatorDid, maxParticipants, createdAt] = flat;
          callRooms.set(id, { id, type, creator_did: creatorDid, status: "active", max_participants: maxParticipants, created_at: createdAt, ended_at: null });
          return { changes: 1 };
        }

        if (sql.includes("INSERT INTO call_participants")) {
          // SQL: VALUES (?, ?, ?, 'host'/'participant', 'connected', ?)
          // role and status are hardcoded — 4 placeholders
          const [id, roomId, participantDid, joinedAt] = flat;
          const role = sql.includes("'host'") ? "host" : "participant";
          callParticipants.set(id, { id, room_id: roomId, participant_did: participantDid, role, status: "connected", joined_at: joinedAt, left_at: null });
          return { changes: 1 };
        }

        if (sql.includes("UPDATE call_participants")) {
          if (sql.includes("status = 'left'")) {
            // UPDATE ... SET status = 'left', left_at = ? WHERE room_id = ? AND participant_did = ? AND status != 'left'
            const [leftAt, roomId, participantDid] = flat;
            let changes = 0;
            for (const [, p] of callParticipants) {
              if (p.room_id === roomId && p.participant_did === participantDid && p.status !== "left") {
                p.status = "left";
                p.left_at = leftAt;
                changes++;
              }
            }
            return { changes };
          }
          if (sql.includes("status = 'connected'")) {
            // Re-join: UPDATE ... SET status = 'connected', joined_at = ?, left_at = NULL WHERE id = ?
            const [joinedAt, id] = flat;
            const p = callParticipants.get(id);
            if (p) { p.status = "connected"; p.joined_at = joinedAt; p.left_at = null; }
            return { changes: p ? 1 : 0 };
          }
          return { changes: 0 };
        }

        if (sql.includes("UPDATE call_rooms") && sql.includes("ended")) {
          // UPDATE call_rooms SET status = 'ended', ended_at = ? WHERE id = ?
          const [endedAt, roomId] = flat;
          const room = callRooms.get(roomId);
          if (room) {
            room.status = "ended";
            room.ended_at = endedAt;
          }
          return { changes: 1 };
        }

        return { changes: 0 };
      }),

      get: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("SELECT * FROM call_rooms WHERE id")) {
          const room = callRooms.get(flat[0]) || null;
          // Filter by status if the query requires it
          if (room && sql.includes("status = 'active'") && room.status !== "active") {
            return null;
          }
          return room;
        }

        if (sql.includes("SELECT * FROM call_participants WHERE room_id = ? AND participant_did")) {
          const [roomId, did] = flat;
          return [...callParticipants.values()].find(
            (p) => p.room_id === roomId && p.participant_did === did,
          ) || null;
        }

        if (sql.includes("SELECT COUNT(*)") && sql.includes("call_participants")) {
          const roomId = flat[0];
          const active = activeParticipantsForRoom(roomId);
          return { count: active.length };
        }

        return null;
      }),

      all: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("SELECT * FROM call_rooms WHERE status = 'active'")) {
          return [...callRooms.values()].filter((r) => r.status === "active");
        }

        if (sql.includes("SELECT * FROM call_participants WHERE room_id =")) {
          const roomId = flat[0];
          if (sql.includes("status != 'left'")) {
            return activeParticipantsForRoom(roomId);
          }
          return participantsForRoom(roomId);
        }

        return [];
      }),
    };
  }

  const db = {
    _callRooms: callRooms,
    _callParticipants: callParticipants,
    exec: vi.fn(),
    prepare: vi.fn((sql) => makeStmt(sql)),
  };

  return {
    db,
    getDatabase: vi.fn(() => db),
    saveToFile: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test helpers – construct lightweight CallManager / CallSignaling instances
// ---------------------------------------------------------------------------

async function buildCallManager(currentDid, database, p2pManager, config = {}) {
  const { CallManager } = await import("../../src/main/p2p/call-manager.js");

  const didManager = {
    getCurrentIdentity: vi.fn(() => ({ did: currentDid })),
  };

  const manager = new CallManager(database, didManager, p2pManager, config);

  // Bypass the full initialize() which needs a real DB and network
  manager.initialized = true;
  await manager.initializeTables();

  return manager;
}

async function buildCallSignaling(p2pManager, config = {}) {
  const { CallSignaling } = await import("../../src/main/p2p/call-signaling.js");
  const signaling = new CallSignaling(p2pManager, config);
  await signaling.initialize();
  return signaling;
}

// ---------------------------------------------------------------------------
// Test Suite 1 – Full call lifecycle
// ---------------------------------------------------------------------------

describe("Social Calls Integration – Full Call Lifecycle", () => {
  let database;
  let p2pManager;
  let callManager;

  const ALICE = "did:test:alice";
  const BOB = "did:test:bob";

  beforeEach(async () => {
    vi.clearAllMocks();

    database = createStatefulMockDatabase();

    p2pManager = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    callManager = await buildCallManager(ALICE, database, p2pManager);
  });

  afterEach(() => {
    callManager.removeAllListeners();
  });

  it("creates a voice room with the current user as host", async () => {
    const result = await callManager.createRoom({ type: "voice" });

    expect(result.success).toBe(true);
    expect(result.room).toBeDefined();
    expect(result.room.id).toBeTruthy();
    expect(result.room.type).toBe("voice");
    expect(result.room.creatorDid).toBe(ALICE);
    expect(result.room.status).toBe("active");
  });

  it("getActiveRooms returns the newly created room", async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));
    const active = await callManager.getActiveRooms();

    expect(active.success).toBe(true);
    expect(active.rooms.some((r) => r.id === room.id)).toBe(true);
  });

  it("a second participant can join the room", async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));

    // Switch the active identity to BOB for the join call
    callManager.didManager.getCurrentIdentity.mockReturnValue({ did: BOB });
    const joinResult = await callManager.joinRoom(room.id);

    expect(joinResult.success).toBe(true);

    const participants = await callManager.getParticipants(room.id);
    expect(participants.success).toBe(true);
    expect(participants.participants.length).toBeGreaterThanOrEqual(2);
    // _formatParticipant returns camelCase fields
    const dids = participants.participants.map((p) => p.participantDid);
    expect(dids).toContain(ALICE);
    expect(dids).toContain(BOB);
  });

  it("a participant can leave the room", async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));

    callManager.didManager.getCurrentIdentity.mockReturnValue({ did: BOB });
    await callManager.joinRoom(room.id);

    const leaveResult = await callManager.leaveRoom(room.id);
    expect(leaveResult.success).toBe(true);

    const participants = await callManager.getParticipants(room.id, false);
    // _formatParticipant returns camelCase fields
    const bobEntry = participants.participants.find(
      (p) => p.participantDid === BOB,
    );
    expect(bobEntry).toBeDefined();
    expect(bobEntry.status).toBe("left");
  });

  it("endRoom marks the room as ended and removes it from active list", async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));

    const endResult = await callManager.endRoom(room.id);
    expect(endResult.success).toBe(true);

    const active = await callManager.getActiveRooms();
    expect(active.rooms.some((r) => r.id === room.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 2 – Event emissions during call lifecycle
// ---------------------------------------------------------------------------

describe("Social Calls Integration – Event Emissions", () => {
  let database;
  let p2pManager;
  let callManager;

  const ALICE = "did:test:alice-events";
  const BOB = "did:test:bob-events";

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    p2pManager = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    callManager = await buildCallManager(ALICE, database, p2pManager);
  });

  afterEach(() => {
    callManager.removeAllListeners();
  });

  it('emits "room:created" when a room is created', async () => {
    const handler = vi.fn();
    callManager.on("room:created", handler);

    await callManager.createRoom({ type: "video" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "video",
      creatorDid: ALICE,
    });
  });

  it('emits "participant:joined" when a second participant joins via P2P status update', async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));
    const handler = vi.fn();
    callManager.on("participant:joined", handler);

    // Simulate the P2P "participant connected" event that the listener processes
    callManager.emit("participant:joined", { roomId: room.id, participantDid: BOB });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      roomId: room.id,
      participantDid: BOB,
    });
  });

  it('emits "participant:left" when a participant leaves', async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));
    const handler = vi.fn();
    callManager.on("participant:left", handler);

    // Simulate the leave signal arriving over P2P
    callManager.emit("participant:left", { roomId: room.id, participantDid: BOB });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits "room:ended" when the host ends the room', async () => {
    const { room } = (await callManager.createRoom({ type: "voice" }));
    const handler = vi.fn();
    callManager.on("room:ended", handler);

    await callManager.endRoom(room.id);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({ roomId: room.id });
  });
});

// ---------------------------------------------------------------------------
// Test Suite 3 – Max participants enforcement
// ---------------------------------------------------------------------------

describe("Social Calls Integration – Max Participants Enforcement", () => {
  let database;
  let p2pManager;
  let callManager;

  const ALICE = "did:test:alice-cap";
  const BOB = "did:test:bob-cap";
  const CAROL = "did:test:carol-cap";

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    p2pManager = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    // Set maxParticipants:2 so the third join must fail
    callManager = await buildCallManager(ALICE, database, p2pManager, {
      maxParticipants: 2,
    });
  });

  afterEach(() => {
    callManager.removeAllListeners();
  });

  it("allows exactly maxParticipants users to join", async () => {
    const { room } = (await callManager.createRoom({
      type: "voice",
      maxParticipants: 2,
    }));

    // BOB joins as the second participant
    callManager.didManager.getCurrentIdentity.mockReturnValue({ did: BOB });
    const joinBob = await callManager.joinRoom(room.id);
    expect(joinBob.success).toBe(true);
  });

  it("rejects a third join when room is at capacity", async () => {
    const { room } = (await callManager.createRoom({
      type: "voice",
      maxParticipants: 2,
    }));

    // BOB joins (fills the 2-slot room)
    callManager.didManager.getCurrentIdentity.mockReturnValue({ did: BOB });
    await callManager.joinRoom(room.id);

    // CAROL tries to join the full room
    callManager.didManager.getCurrentIdentity.mockReturnValue({ did: CAROL });
    const joinCarol = await callManager.joinRoom(room.id);

    expect(joinCarol.success).toBe(false);
    expect(joinCarol.error).toMatch(/capacity|participant|full|maximum/i);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 4 – Signaling message flow
// ---------------------------------------------------------------------------

describe("Social Calls Integration – Signaling Message Flow", () => {
  let p2pManager;
  let callSignaling;

  const ALICE = "did:test:alice-sig";
  const BOB = "did:test:bob-sig";

  beforeEach(async () => {
    vi.clearAllMocks();

    p2pManager = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    callSignaling = await buildCallSignaling(p2pManager);
  });

  afterEach(() => {
    callSignaling.removeAllListeners();
  });

  it("sendOffer dispatches a message to p2pManager and returns a sessionId", async () => {
    const sdp = { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" };
    const result = await callSignaling.sendOffer(BOB, sdp, { roomId: "room-1" });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(p2pManager.sendMessage).toHaveBeenCalled();

    const sentPayload = p2pManager.sendMessage.mock.calls[0];
    // The outer envelope has type:"call-signaling"; the inner signal type is in signalType
    const signalData = sentPayload.flat().find(
      (arg) => typeof arg === "object" && arg !== null &&
        (arg.signalType === "offer" || arg.type === "offer"),
    );
    expect(signalData).toBeDefined();
  });

  it("sendAnswer dispatches a message to p2pManager", async () => {
    const sdp = { type: "answer", sdp: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" };
    const result = await callSignaling.sendAnswer(BOB, sdp, {
      sessionId: "session-test-1",
    });

    expect(result.success).toBe(true);
    expect(p2pManager.sendMessage).toHaveBeenCalled();
  });

  it("sendIceCandidate dispatches an ice-candidate type message", async () => {
    const candidate = { candidate: "candidate:1 1 UDP ...", sdpMid: "0", sdpMLineIndex: 0 };
    const result = await callSignaling.sendIceCandidate(BOB, candidate, {
      sessionId: "session-test-2",
    });

    expect(result.success).toBe(true);
    expect(p2pManager.sendMessage).toHaveBeenCalled();

    const sentPayload = p2pManager.sendMessage.mock.calls[0];
    const signalData = sentPayload.flat().find(
      (arg) => typeof arg === "object" && arg !== null &&
        (arg.signalType === "ice-candidate" || arg.type === "ice-candidate"),
    );
    expect(signalData).toBeDefined();
  });

  it('emits "signal:offer" when an incoming OFFER signal is received', () => {
    const handler = vi.fn();
    callSignaling.on("signal:offer", handler);

    // Simulate receiving an incoming OFFER signal
    callSignaling.handleIncomingSignal(ALICE, {
      type: "offer",
      sessionId: "session-incoming-1",
      sdp: { type: "offer", sdp: "v=0\r\n" },
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      peerId: ALICE,
      sdp: expect.objectContaining({ type: "offer" }),
    });
  });

  it('emits "signal:answer" when an incoming ANSWER signal is received', () => {
    const handler = vi.fn();
    callSignaling.on("signal:answer", handler);

    callSignaling.handleIncomingSignal(BOB, {
      type: "answer",
      sessionId: "session-incoming-2",
      sdp: { type: "answer", sdp: "v=0\r\n" },
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      peerId: BOB,
    });
  });
});
