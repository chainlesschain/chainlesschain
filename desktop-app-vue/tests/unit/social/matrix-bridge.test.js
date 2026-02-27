import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-matrix-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;
let MatrixBridge, getMatrixBridge, MATRIX_EVENT_TYPES, LOGIN_STATE;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockGetStmt = { get: vi.fn(() => null) };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT") && sql.includes("= ?")) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod = await import("../../../src/main/social/matrix-bridge.js");
  MatrixBridge = mod.MatrixBridge;
  getMatrixBridge = mod.getMatrixBridge;
  MATRIX_EVENT_TYPES = mod.MATRIX_EVENT_TYPES;
  LOGIN_STATE = mod.LOGIN_STATE;
});

describe("Constants", () => {
  it("should define MATRIX_EVENT_TYPES", () => {
    expect(MATRIX_EVENT_TYPES.MESSAGE).toBe("m.room.message");
    expect(MATRIX_EVENT_TYPES.MEMBER).toBe("m.room.member");
    expect(MATRIX_EVENT_TYPES.ENCRYPTED).toBe("m.room.encrypted");
  });

  it("should define LOGIN_STATE", () => {
    expect(LOGIN_STATE.LOGGED_OUT).toBe("logged_out");
    expect(LOGIN_STATE.LOGGING_IN).toBe("logging_in");
    expect(LOGIN_STATE.LOGGED_IN).toBe("logged_in");
    expect(LOGIN_STATE.ERROR).toBe("error");
  });
});

describe("MatrixBridge", () => {
  let bridge;

  beforeEach(() => {
    bridge = new MatrixBridge({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(bridge.initialized).toBe(false);
      expect(bridge._homeserver).toBe("https://matrix.org");
      expect(bridge._loginState).toBe("logged_out");
      expect(bridge._rooms).toBeInstanceOf(Map);
      expect(bridge._e2eeEnabled).toBe(true);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });

    it("should load rooms from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { room_id: "!abc:matrix.org", name: "Test Room", status: "joined" },
      ]);
      await bridge.initialize();
      expect(bridge._rooms.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should create matrix tables", () => {
      bridge._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS matrix_rooms");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS matrix_events");
    });

    it("should not throw if database is null", () => {
      const b = new MatrixBridge(null);
      expect(() => b._ensureTables()).not.toThrow();
    });
  });

  describe("login()", () => {
    it("should throw if userId is missing", async () => {
      await expect(bridge.login({ password: "pass" })).rejects.toThrow(
        "User ID is required",
      );
    });

    it("should throw if password is missing", async () => {
      await expect(
        bridge.login({ userId: "@user:matrix.org" }),
      ).rejects.toThrow("Password is required");
    });

    it("should login successfully", async () => {
      const result = await bridge.login({
        userId: "@user:matrix.org",
        password: "pass123",
      });
      expect(result.success).toBe(true);
      expect(result.userId).toBe("@user:matrix.org");
      expect(bridge._loginState).toBe("logged_in");
    });

    it("should use custom homeserver", async () => {
      const result = await bridge.login({
        homeserver: "https://custom.matrix.org",
        userId: "@user:custom.matrix.org",
        password: "pass",
      });
      expect(result.homeserver).toBe("https://custom.matrix.org");
    });
  });

  describe("listRooms()", () => {
    it("should return rooms from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { room_id: "!abc:matrix.org", name: "Room 1", status: "joined" },
      ]);
      const rooms = await bridge.listRooms();
      expect(rooms).toHaveLength(1);
    });

    it("should fallback to in-memory rooms", async () => {
      const b = new MatrixBridge(null);
      b._rooms.set("!abc:matrix.org", {
        room_id: "!abc:matrix.org",
        name: "Test",
      });
      const rooms = await b.listRooms();
      expect(rooms).toHaveLength(1);
    });
  });

  describe("sendMessage()", () => {
    it("should throw if roomId is missing", async () => {
      await expect(bridge.sendMessage({ body: "hello" })).rejects.toThrow(
        "Room ID is required",
      );
    });

    it("should throw if body is missing", async () => {
      await expect(
        bridge.sendMessage({ roomId: "!abc:matrix.org" }),
      ).rejects.toThrow("Message body is required");
    });

    it("should send message successfully", async () => {
      const result = await bridge.sendMessage({
        roomId: "!abc:matrix.org",
        body: "Hello!",
      });
      expect(result.success).toBe(true);
      expect(result.event.room_id).toBe("!abc:matrix.org");
      expect(result.event.event_id).toBeDefined();
    });

    it("should store event in DB", async () => {
      await bridge.sendMessage({ roomId: "!abc:matrix.org", body: "Hello!" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should set encrypted event type when e2ee enabled", async () => {
      const result = await bridge.sendMessage({
        roomId: "!abc:matrix.org",
        body: "Secret",
      });
      expect(result.event.event_type).toBe("m.room.encrypted");
      expect(result.event.is_encrypted).toBe(1);
    });
  });

  describe("getMessages()", () => {
    it("should throw if roomId is missing", async () => {
      await expect(bridge.getMessages({})).rejects.toThrow(
        "Room ID is required",
      );
    });

    it("should return empty for null DB", async () => {
      const b = new MatrixBridge(null);
      const messages = await b.getMessages({ roomId: "!abc:matrix.org" });
      expect(messages).toEqual([]);
    });
  });

  describe("joinRoom()", () => {
    it("should throw if roomIdOrAlias is missing", async () => {
      await expect(bridge.joinRoom({})).rejects.toThrow(
        "Room ID or alias is required",
      );
    });

    it("should join room successfully", async () => {
      const result = await bridge.joinRoom({
        roomIdOrAlias: "#test:matrix.org",
      });
      expect(result.success).toBe(true);
      expect(result.room.name).toBe("#test:matrix.org");
      expect(result.room.status).toBe("joined");
    });

    it("should add room to internal Map", async () => {
      await bridge.joinRoom({ roomIdOrAlias: "!abc:matrix.org" });
      expect(bridge._rooms.size).toBe(1);
    });
  });

  describe("getLoginState()", () => {
    it("should return current state", () => {
      const state = bridge.getLoginState();
      expect(state.state).toBe("logged_out");
      expect(state.homeserver).toBe("https://matrix.org");
      expect(state.e2eeEnabled).toBe(true);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      bridge._rooms.set("!abc:matrix.org", {});
      bridge._loginState = "logged_in";
      await bridge.close();
      expect(bridge._rooms.size).toBe(0);
      expect(bridge._loginState).toBe("logged_out");
      expect(bridge.initialized).toBe(false);
    });
  });

  describe("getMatrixBridge singleton", () => {
    it("should return an instance", () => {
      const instance = getMatrixBridge();
      expect(instance).toBeInstanceOf(MatrixBridge);
    });
  });
});
