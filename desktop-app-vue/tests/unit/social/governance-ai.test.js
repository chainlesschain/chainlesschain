import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-gov-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;
let GovernanceAI,
  getGovernanceAI,
  PROPOSAL_STATUS,
  PROPOSAL_TYPES,
  IMPACT_LEVELS;

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

  const mod = await import("../../../src/main/social/governance-ai.js");
  GovernanceAI = mod.GovernanceAI;
  getGovernanceAI = mod.getGovernanceAI;
  PROPOSAL_STATUS = mod.PROPOSAL_STATUS;
  PROPOSAL_TYPES = mod.PROPOSAL_TYPES;
  IMPACT_LEVELS = mod.IMPACT_LEVELS;
});

describe("Constants", () => {
  it("should define PROPOSAL_STATUS", () => {
    expect(PROPOSAL_STATUS.DRAFT).toBe("draft");
    expect(PROPOSAL_STATUS.ACTIVE).toBe("active");
    expect(PROPOSAL_STATUS.PASSED).toBe("passed");
    expect(PROPOSAL_STATUS.REJECTED).toBe("rejected");
  });

  it("should define PROPOSAL_TYPES", () => {
    expect(PROPOSAL_TYPES.FEATURE_REQUEST).toBe("feature_request");
    expect(PROPOSAL_TYPES.PARAMETER_CHANGE).toBe("parameter_change");
    expect(PROPOSAL_TYPES.POLICY_UPDATE).toBe("policy_update");
    expect(PROPOSAL_TYPES.BUDGET_ALLOCATION).toBe("budget_allocation");
  });

  it("should define IMPACT_LEVELS", () => {
    expect(IMPACT_LEVELS.LOW).toBe("low");
    expect(IMPACT_LEVELS.MEDIUM).toBe("medium");
    expect(IMPACT_LEVELS.HIGH).toBe("high");
    expect(IMPACT_LEVELS.CRITICAL).toBe("critical");
  });
});

describe("GovernanceAI", () => {
  let gov;

  beforeEach(() => {
    gov = new GovernanceAI({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(gov.initialized).toBe(false);
      expect(gov._proposals).toBeInstanceOf(Map);
      expect(gov._votingDuration).toBe(7 * 24 * 60 * 60 * 1000);
      expect(gov._quorumPercentage).toBe(51);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await gov.initialize();
      expect(gov.initialized).toBe(true);
    });

    it("should load proposals from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        {
          id: "p1",
          title: "Test",
          status: "draft",
          metadata: "{}",
          impact_analysis: null,
        },
      ]);
      await gov.initialize();
      expect(gov._proposals.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should create governance tables", () => {
      gov._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS governance_proposals");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS governance_votes");
    });

    it("should not throw if database is null", () => {
      const g = new GovernanceAI(null);
      expect(() => g._ensureTables()).not.toThrow();
    });
  });

  describe("createProposal()", () => {
    it("should throw if title is missing", async () => {
      await expect(gov.createProposal({})).rejects.toThrow(
        "Proposal title is required",
      );
    });

    it("should throw for invalid type", async () => {
      await expect(
        gov.createProposal({ title: "Test", type: "invalid" }),
      ).rejects.toThrow("Invalid proposal type");
    });

    it("should create proposal with default type", async () => {
      const proposal = await gov.createProposal({ title: "New Feature" });
      expect(proposal.title).toBe("New Feature");
      expect(proposal.type).toBe("feature_request");
      expect(proposal.status).toBe("draft");
      expect(gov._proposals.has(proposal.id)).toBe(true);
    });

    it("should persist to DB", async () => {
      await gov.createProposal({ title: "Test", description: "Desc" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should accept custom type and description", async () => {
      const proposal = await gov.createProposal({
        title: "Budget Request",
        description: "Need more funding",
        type: "budget_allocation",
      });
      expect(proposal.type).toBe("budget_allocation");
      expect(proposal.description).toBe("Need more funding");
    });
  });

  describe("listProposals()", () => {
    it("should return proposals from in-memory", async () => {
      gov._proposals.set("p1", {
        id: "p1",
        status: "draft",
        type: "feature_request",
      });
      gov._proposals.set("p2", {
        id: "p2",
        status: "active",
        type: "policy_update",
      });
      // Use null DB to force in-memory
      const g = new GovernanceAI(null);
      g._proposals = gov._proposals;
      const proposals = await g.listProposals();
      expect(proposals).toHaveLength(2);
    });

    it("should filter by status", async () => {
      gov._proposals.set("p1", {
        id: "p1",
        status: "draft",
        type: "feature_request",
      });
      gov._proposals.set("p2", {
        id: "p2",
        status: "active",
        type: "feature_request",
      });
      const g = new GovernanceAI(null);
      g._proposals = gov._proposals;
      const proposals = await g.listProposals({ status: "active" });
      expect(proposals).toHaveLength(1);
    });
  });

  describe("analyzeImpact()", () => {
    it("should throw if proposalId is missing", async () => {
      await expect(gov.analyzeImpact({})).rejects.toThrow(
        "Proposal ID is required",
      );
    });

    it("should throw if proposal not found", async () => {
      await expect(
        gov.analyzeImpact({ proposalId: "nonexistent" }),
      ).rejects.toThrow("Proposal not found");
    });

    it("should return impact analysis", async () => {
      gov._proposals.set("p1", { id: "p1", title: "Test" });
      const analysis = await gov.analyzeImpact({ proposalId: "p1" });
      expect(analysis.impact_level).toBeDefined();
      expect(analysis.affected_components).toBeInstanceOf(Array);
      expect(analysis.risk_score).toBeGreaterThanOrEqual(0);
      expect(analysis.benefit_score).toBeGreaterThanOrEqual(0);
      expect(analysis.recommendations).toBeInstanceOf(Array);
    });

    it("should update proposal in DB", async () => {
      gov._proposals.set("p1", { id: "p1", title: "Test" });
      await gov.analyzeImpact({ proposalId: "p1" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("predictVote()", () => {
    it("should throw if proposalId is missing", async () => {
      await expect(gov.predictVote({})).rejects.toThrow(
        "Proposal ID is required",
      );
    });

    it("should throw if proposal not found", async () => {
      await expect(
        gov.predictVote({ proposalId: "nonexistent" }),
      ).rejects.toThrow("Proposal not found");
    });

    it("should return prediction", async () => {
      gov._proposals.set("p1", { id: "p1", title: "Test" });
      const prediction = await gov.predictVote({ proposalId: "p1" });
      expect(prediction.proposalId).toBe("p1");
      expect(prediction.predicted_yes).toBeGreaterThanOrEqual(0);
      expect(prediction.predicted_no).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(["pass", "reject"]).toContain(prediction.predicted_outcome);
    });
  });

  describe("buildGovernanceContext()", () => {
    it("should return null when no active proposals", () => {
      expect(gov.buildGovernanceContext("hint", 5)).toBeNull();
    });

    it("should return context when active proposals exist", () => {
      gov._proposals.set("p1", { status: "active" });
      const ctx = gov.buildGovernanceContext("hint", 5);
      expect(ctx).toContain("[Governance]");
      expect(ctx).toContain("1 active proposals");
    });
  });

  describe("getGovernanceAI singleton", () => {
    it("should return an instance", () => {
      const instance = getGovernanceAI();
      expect(instance).toBeInstanceOf(GovernanceAI);
    });
  });
});
