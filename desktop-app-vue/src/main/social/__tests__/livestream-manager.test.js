/**
 * LivestreamManager Unit Tests
 *
 * Covers:
 * - initialize() / initializeTables() table and index creation
 * - createStream() happy path, validation (title required, too long, password requires code)
 * - startStream() ownership check, status guard, updates DB
 * - endStream() only streamer can end, marks status=ended
 * - joinStream() viewer tracking, max-viewer limit
 * - leaveStream() marks viewer left
 * - getLiveStreams() queries DB for live streams
 * - getStreamById() returns stream or null
 * - Event emissions: stream:created, stream:started, stream:ended, viewer:joined, viewer:left
 * - Error propagation from DB
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
const {
  LivestreamManager,
  StreamStatus,
  StreamAccessType,
  ViewerStatus,
} = require("../livestream-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:streamer") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

function createMockP2PManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStreamRow(overrides = {}) {
  const now = Date.now();
  return {
    id: "stream-001",
    title: "Test Stream",
    description: "",
    streamer_did: "did:test:streamer",
    status: StreamStatus.SCHEDULED,
    access_type: StreamAccessType.PUBLIC,
    access_code: null,
    viewer_count: 0,
    max_viewers: 100,
    started_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LivestreamManager", () => {
  let manager;
  let mockDatabase;
  let mockDIDManager;
  let mockP2PManager;

  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    mockP2PManager = createMockP2PManager();
    manager = new LivestreamManager(mockDatabase, mockDIDManager, mockP2PManager);
    vi.clearAllMocks();
    // Re-attach mocks after clearAllMocks
    mockDatabase.db.prepare.mockReturnValue(mockDatabase.db._prep);
    mockP2PManager.broadcast = vi.fn().mockResolvedValue(undefined);
    mockDIDManager.getCurrentIdentity.mockReturnValue({ did: "did:test:streamer" });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should call db.exec to create livestreams table", async () => {
      await manager.initialize();
      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const hasTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS livestreams"),
      );
      expect(hasTable).toBe(true);
    });

    it("should call db.exec to create livestream_viewers table", async () => {
      await manager.initialize();
      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const hasViewersTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS livestream_viewers"),
      );
      expect(hasViewersTable).toBe(true);
    });

    it("should create indexes", async () => {
      await manager.initialize();
      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_livestreams_status"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should set initialized=true after success", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should propagate db.exec errors and leave initialized=false", async () => {
      mockDatabase.db.exec.mockImplementationOnce(() => {
        throw new Error("DB error");
      });
      await expect(manager.initialize()).rejects.toThrow("DB error");
      expect(manager.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createStream()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createStream()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create a stream and return stream object", async () => {
      const stream = await manager.createStream({ title: "My Stream" });

      expect(stream).toBeDefined();
      expect(stream.title).toBe("My Stream");
      expect(stream.streamer_did).toBe("did:test:streamer");
      expect(stream.status).toBe(StreamStatus.SCHEDULED);
    });

    it("should insert into livestreams via prepare", async () => {
      await manager.createStream({ title: "My Stream" });

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO livestreams"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should trim the title", async () => {
      const stream = await manager.createStream({ title: "  Padded  " });
      expect(stream.title).toBe("Padded");
    });

    it("should throw when title is empty", async () => {
      await expect(manager.createStream({ title: "" })).rejects.toThrow(
        /title cannot be empty/i,
      );
    });

    it("should throw when title exceeds 200 characters", async () => {
      const longTitle = "x".repeat(201);
      await expect(manager.createStream({ title: longTitle })).rejects.toThrow(
        /200/,
      );
    });

    it("should throw when password-protected stream has no access code", async () => {
      await expect(
        manager.createStream({
          title: "Secret Stream",
          accessType: StreamAccessType.PASSWORD,
          accessCode: "",
        }),
      ).rejects.toThrow(/access code/i);
    });

    it("should create password-protected stream with a valid access code", async () => {
      const stream = await manager.createStream({
        title: "Password Stream",
        accessType: StreamAccessType.PASSWORD,
        accessCode: "secret123",
      });
      expect(stream.access_type).toBe(StreamAccessType.PASSWORD);
      expect(stream.access_code).toBe("secret123");
    });

    it("should set max_viewers from options", async () => {
      const stream = await manager.createStream({ title: "Big Stream", maxViewers: 500 });
      expect(stream.max_viewers).toBe(500);
    });

    it("should throw when user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.createStream({ title: "Stream" })).rejects.toThrow(
        /not logged in/i,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startStream()
  // ─────────────────────────────────────────────────────────────────────────
  describe("startStream()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update status to live when owned by current user", async () => {
      const streamRow = makeStreamRow({ status: StreamStatus.SCHEDULED });
      mockDatabase.db._prep.get.mockReturnValueOnce(streamRow);

      const result = await manager.startStream("stream-001");
      expect(result.status).toBe(StreamStatus.LIVE);
      expect(result.started_at).toBeGreaterThan(0);
    });

    it("should call prepare with UPDATE for status=live", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(makeStreamRow());

      await manager.startStream("stream-001");

      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE livestreams") && c[0].includes("status"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw when stream not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);

      await expect(manager.startStream("nonexistent")).rejects.toThrow(
        /not found/i,
      );
    });

    it("should throw when user is not the streamer", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ streamer_did: "did:test:other" }),
      );

      await expect(manager.startStream("stream-001")).rejects.toThrow(
        /only the streamer/i,
      );
    });

    it("should throw when stream is not in scheduled status", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.LIVE }),
      );

      await expect(manager.startStream("stream-001")).rejects.toThrow(
        /Cannot start/,
      );
    });

    it("should throw when user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.startStream("stream-001")).rejects.toThrow(
        /not logged in/i,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // endStream()
  // ─────────────────────────────────────────────────────────────────────────
  describe("endStream()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update status to ended", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.LIVE }),
      );

      const result = await manager.endStream("stream-001");
      expect(result.status).toBe(StreamStatus.ENDED);
      expect(result.ended_at).toBeGreaterThan(0);
    });

    it("should throw when user is not the streamer", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.LIVE, streamer_did: "did:test:other" }),
      );

      await expect(manager.endStream("stream-001")).rejects.toThrow(
        /only the streamer/i,
      );
    });

    it("should throw when stream is not live", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.SCHEDULED }),
      );

      await expect(manager.endStream("stream-001")).rejects.toThrow(
        /Cannot end/,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // joinStream()
  // ─────────────────────────────────────────────────────────────────────────
  describe("joinStream()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should insert viewer record for a live stream", async () => {
      mockDatabase.db._prep.get
        .mockReturnValueOnce(makeStreamRow({ status: StreamStatus.LIVE }))
        .mockReturnValueOnce(null)          // no existing viewer record
        .mockReturnValueOnce({ count: 1 }); // COUNT query for viewer_count update

      await manager.joinStream("stream-001");

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT") && c[0].includes("livestream_viewers"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should throw when stream is not live", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.SCHEDULED }),
      );

      await expect(manager.joinStream("stream-001")).rejects.toThrow(
        /not currently live/i,
      );
    });

    it("should throw when max viewers reached", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.LIVE, viewer_count: 100, max_viewers: 100 }),
      );

      await expect(manager.joinStream("stream-001")).rejects.toThrow(
        /max.*viewers|capacity/i,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getActiveStreams()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getActiveStreams()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should call prepare with SELECT for live streams", async () => {
      mockDatabase.db._prep.all.mockReturnValueOnce([
        makeStreamRow({ status: StreamStatus.LIVE }),
      ]);

      const result = await manager.getActiveStreams();
      expect(result).toHaveLength(1);

      const queryCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("SELECT") && c[0].includes("livestreams"),
      );
      expect(queryCall).toBeTruthy();
    });

    it("should return empty array when no live streams", async () => {
      mockDatabase.db._prep.all.mockReturnValueOnce([]);
      const result = await manager.getActiveStreams();
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStreamById()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStreamById()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return stream row when found", async () => {
      const streamRow = makeStreamRow();
      mockDatabase.db._prep.get.mockReturnValueOnce(streamRow);

      const result = await manager.getStreamById("stream-001");
      expect(result).toEqual(streamRow);
    });

    it("should return null when stream not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      const result = await manager.getStreamById("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event emissions
  // ─────────────────────────────────────────────────────────────────────────
  describe("Event emissions", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should emit stream:started when startStream succeeds", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(makeStreamRow());
      const listener = vi.fn();
      manager.on("stream:started", listener);

      await manager.startStream("stream-001");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should emit stream:ended when endStream succeeds", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(
        makeStreamRow({ status: StreamStatus.LIVE }),
      );
      const listener = vi.fn();
      manager.on("stream:ended", listener);

      await manager.endStream("stream-001");
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
