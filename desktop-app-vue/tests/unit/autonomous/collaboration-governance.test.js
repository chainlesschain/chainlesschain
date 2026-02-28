import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-collab-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let CollaborationGovernance,
  getCollaborationGovernance,
  DECISION_STATUS,
  DECISION_TYPES,
  AUTONOMY_LEVELS;

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
    await import("../../../src/main/ai-engine/autonomous/collaboration-governance.js");
  CollaborationGovernance = mod.CollaborationGovernance;
  getCollaborationGovernance = mod.getCollaborationGovernance;
  DECISION_STATUS = mod.DECISION_STATUS;
  DECISION_TYPES = mod.DECISION_TYPES;
  AUTONOMY_LEVELS = mod.AUTONOMY_LEVELS;
});

describe("Constants", () => {
  it("should define DECISION_STATUS", () => {
    expect(DECISION_STATUS.PENDING).toBe("pending");
    expect(DECISION_STATUS.APPROVED).toBe("approved");
    expect(DECISION_STATUS.REJECTED).toBe("rejected");
    expect(DECISION_STATUS.AUTO_APPROVED).toBe("auto_approved");
  });

  it("should define DECISION_TYPES", () => {
    expect(DECISION_TYPES.ARCHITECTURE).toBe("architecture");
    expect(DECISION_TYPES.SECURITY).toBe("security");
    expect(DECISION_TYPES.MIGRATION).toBe("migration");
  });

  it("should define AUTONOMY_LEVELS", () => {
    expect(AUTONOMY_LEVELS.NONE).toBe(0);
    expect(AUTONOMY_LEVELS.FULL).toBe(10);
  });
});

describe("CollaborationGovernance", () => {
  let gov;

  beforeEach(() => {
    gov = new CollaborationGovernance({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(gov.initialized).toBe(false);
      expect(gov._decisions).toBeInstanceOf(Map);
      expect(gov._autonomyLevels).toBeInstanceOf(Map);
      expect(gov._confidenceThreshold).toBe(0.7);
      expect(gov._autoApproveAbove).toBe(0.95);
      expect(gov._initialAutonomyLevel).toBe(2);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await gov.initialize();
      expect(gov.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      gov._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS governance_decisions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS autonomy_levels");
    });
  });

  describe("submitDecision()", () => {
    it("should throw if title is missing", async () => {
      await expect(gov.submitDecision({})).rejects.toThrow(
        "Decision title is required",
      );
    });

    it("should create pending decision", async () => {
      const decision = await gov.submitDecision({
        title: "Test Decision",
        confidence: 0.5,
      });
      expect(decision.status).toBe("pending");
      expect(decision.title).toBe("Test Decision");
    });

    it("should auto-approve high confidence non-critical decisions", async () => {
      const decision = await gov.submitDecision({
        title: "Auto Decision",
        confidence: 0.96,
        decisionType: "general",
      });
      expect(decision.status).toBe("auto_approved");
    });

    it("should not auto-approve architecture decisions", async () => {
      const decision = await gov.submitDecision({
        title: "Arch Decision",
        confidence: 0.96,
        decisionType: "architecture",
      });
      expect(decision.status).toBe("pending");
    });
  });

  describe("getPendingDecisions()", () => {
    it("should return pending decisions", async () => {
      const m = new CollaborationGovernance(null);
      m._decisions.set("d1", { id: "d1", status: "pending" });
      m._decisions.set("d2", { id: "d2", status: "approved" });
      const pending = await m.getPendingDecisions();
      expect(pending).toHaveLength(1);
    });
  });

  describe("approveDecision()", () => {
    it("should throw if decisionId is missing", async () => {
      await expect(gov.approveDecision({})).rejects.toThrow(
        "Decision ID is required",
      );
    });

    it("should throw if not found", async () => {
      await expect(
        gov.approveDecision({ decisionId: "nonexistent" }),
      ).rejects.toThrow("Decision not found");
    });

    it("should throw if not pending", async () => {
      gov._decisions.set("d1", { id: "d1", status: "approved" });
      await expect(gov.approveDecision({ decisionId: "d1" })).rejects.toThrow(
        "not pending",
      );
    });

    it("should approve decision", async () => {
      gov._decisions.set("d1", {
        id: "d1",
        status: "pending",
        decision_type: "general",
      });
      const decision = await gov.approveDecision({
        decisionId: "d1",
        reviewer: "admin",
      });
      expect(decision.status).toBe("approved");
      expect(decision.reviewer).toBe("admin");
    });
  });

  describe("rejectDecision()", () => {
    it("should reject decision", async () => {
      gov._decisions.set("d1", {
        id: "d1",
        status: "pending",
        decision_type: "general",
      });
      const decision = await gov.rejectDecision({
        decisionId: "d1",
        comment: "Not ready",
      });
      expect(decision.status).toBe("rejected");
      expect(decision.review_comment).toBe("Not ready");
    });
  });

  describe("getAutonomyLevel()", () => {
    it("should return default level for unknown scope", async () => {
      const level = await gov.getAutonomyLevel("unknown");
      expect(level.level).toBe(2);
    });

    it("should return stored level", async () => {
      gov._autonomyLevels.set("test", { scope: "test", level: 5 });
      const level = await gov.getAutonomyLevel("test");
      expect(level.level).toBe(5);
    });
  });

  describe("setAutonomyPolicy()", () => {
    it("should throw for invalid level", async () => {
      await expect(gov.setAutonomyPolicy({ level: 15 })).rejects.toThrow(
        "must be between",
      );
    });

    it("should update policy", async () => {
      const policy = await gov.setAutonomyPolicy({ scope: "test", level: 7 });
      expect(policy.level).toBe(7);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      gov._decisions.set("d1", {});
      await gov.close();
      expect(gov._decisions.size).toBe(0);
      expect(gov.initialized).toBe(false);
    });
  });

  describe("getCollaborationGovernance singleton", () => {
    it("should return an instance", () => {
      const instance = getCollaborationGovernance();
      expect(instance).toBeInstanceOf(CollaborationGovernance);
    });
  });
});
