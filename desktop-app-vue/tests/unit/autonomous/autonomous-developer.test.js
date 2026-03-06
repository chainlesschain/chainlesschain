import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-autodev-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let AutonomousDeveloper, getAutonomousDeveloper, SESSION_STATUS, REVIEW_CHECKS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod =
    await import("../../../src/main/ai-engine/autonomous/autonomous-developer.js");
  AutonomousDeveloper = mod.AutonomousDeveloper;
  getAutonomousDeveloper = mod.getAutonomousDeveloper;
  SESSION_STATUS = mod.SESSION_STATUS;
  REVIEW_CHECKS = mod.REVIEW_CHECKS;
});

describe("Constants", () => {
  it("should define SESSION_STATUS", () => {
    expect(SESSION_STATUS.INTENT).toBe("intent");
    expect(SESSION_STATUS.COMPLETE).toBe("complete");
    expect(SESSION_STATUS.GENERATING).toBe("generating");
  });

  it("should define REVIEW_CHECKS", () => {
    expect(REVIEW_CHECKS.SECURITY).toBe("security");
    expect(REVIEW_CHECKS.PERFORMANCE).toBe("performance");
  });
});

describe("AutonomousDeveloper", () => {
  let dev;

  beforeEach(() => {
    dev = new AutonomousDeveloper({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(dev.initialized).toBe(false);
      expect(dev._sessions).toBeInstanceOf(Map);
      expect(dev._maxConversationTurns).toBe(20);
      expect(dev._selfReviewEnabled).toBe(true);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await dev.initialize();
      expect(dev.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      dev._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS dev_sessions");
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS architecture_decisions",
      );
    });
  });

  describe("startSession()", () => {
    it("should throw if intent is missing", async () => {
      await expect(dev.startSession({})).rejects.toThrow(
        "Development intent is required",
      );
    });

    it("should start a session", async () => {
      const session = await dev.startSession({ intent: "Build a REST API" });
      expect(session.intent).toBe("Build a REST API");
      expect(session.status).toBe("intent");
      expect(session.turn_count).toBe(1);
    });

    it("should persist to DB", async () => {
      await dev.startSession({ intent: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("refineSession()", () => {
    it("should throw if sessionId is missing", async () => {
      await expect(dev.refineSession({})).rejects.toThrow(
        "Session ID is required",
      );
    });

    it("should throw if session not found", async () => {
      await expect(
        dev.refineSession({ sessionId: "nonexistent" }),
      ).rejects.toThrow("Session not found");
    });

    it("should refine session and generate PRD", async () => {
      dev._sessions.set("s1", {
        id: "s1",
        intent: "test",
        turn_count: 1,
        status: "intent",
      });
      const session = await dev.refineSession({ sessionId: "s1" });
      expect(session.status).toBe("prd");
      expect(session.prd).toBeDefined();
      expect(session.turn_count).toBe(2);
    });

    it("should throw if max turns exceeded", async () => {
      dev._sessions.set("s1", { id: "s1", turn_count: 20 });
      await expect(dev.refineSession({ sessionId: "s1" })).rejects.toThrow(
        "Maximum conversation turns exceeded",
      );
    });
  });

  describe("generateCode()", () => {
    it("should throw if sessionId is missing", async () => {
      await expect(dev.generateCode({})).rejects.toThrow(
        "Session ID is required",
      );
    });

    it("should generate code for session", async () => {
      dev._sessions.set("s1", { id: "s1", intent: "test", status: "prd" });
      const session = await dev.generateCode({ sessionId: "s1" });
      expect(session.status).toBe("complete");
      expect(session.generated_code).toBeDefined();
      expect(session.review_result).toBeDefined();
    });
  });

  describe("reviewCode()", () => {
    it("should throw if sessionId is missing", async () => {
      await expect(dev.reviewCode({})).rejects.toThrow(
        "Session ID is required",
      );
    });

    it("should review code for session", async () => {
      dev._sessions.set("s1", { id: "s1" });
      const review = await dev.reviewCode({ sessionId: "s1" });
      expect(review.security).toBeDefined();
      expect(review.performance).toBeDefined();
      expect(review.overallScore).toBeGreaterThan(0);
    });
  });

  describe("listSessions()", () => {
    it("should return sessions from memory", async () => {
      const m = new AutonomousDeveloper(null);
      m._sessions.set("s1", { id: "s1", status: "complete" });
      const sessions = await m.listSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      dev._sessions.set("s1", {});
      await dev.close();
      expect(dev._sessions.size).toBe(0);
      expect(dev.initialized).toBe(false);
    });
  });

  describe("getAutonomousDeveloper singleton", () => {
    it("should return an instance", () => {
      const instance = getAutonomousDeveloper();
      expect(instance).toBeInstanceOf(AutonomousDeveloper);
    });
  });
});
