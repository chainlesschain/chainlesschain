import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let EvoMapDAO, getEvoMapDAO, PROPOSAL_STATUS;

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
  const mod = await import("../../../src/main/evomap/evomap-dao.js");
  EvoMapDAO = mod.EvoMapDAO;
  getEvoMapDAO = mod.getEvoMapDAO;
  PROPOSAL_STATUS = mod.PROPOSAL_STATUS;
});

describe("EvoMapDAO", () => {
  let dao;
  beforeEach(() => {
    dao = new EvoMapDAO({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(dao.initialized).toBe(false);
      expect(dao._proposals).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await dao.initialize();
      expect(dao.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      dao._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS evomap_governance_proposals",
      );
    });
  });

  describe("createProposal()", () => {
    it("should throw if title is missing", async () => {
      await expect(dao.createProposal({})).rejects.toThrow(
        "Proposal title is required",
      );
    });

    it("should create proposal", async () => {
      const result = await dao.createProposal({ title: "Test Proposal" });
      expect(result.title).toBe("Test Proposal");
      expect(result.status).toBe("active");
      expect(result.votes_for).toBe(0);
      expect(result.votes_against).toBe(0);
    });

    it("should persist to DB", async () => {
      await dao.createProposal({ title: "Test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should store in memory", async () => {
      await dao.createProposal({ title: "Test" });
      expect(dao._proposals.size).toBe(1);
    });
  });

  describe("castVote()", () => {
    it("should throw if proposalId is missing", async () => {
      await expect(dao.castVote({})).rejects.toThrow("Proposal ID is required");
    });

    it("should throw if vote is missing", async () => {
      await expect(dao.castVote({ proposalId: "p1" })).rejects.toThrow(
        "Vote is required (for/against)",
      );
    });

    it("should throw if proposal not found", async () => {
      await expect(
        dao.castVote({ proposalId: "unknown", vote: "for" }),
      ).rejects.toThrow("Proposal not found: unknown");
    });

    it("should throw if proposal is not active", async () => {
      dao._proposals.set("p1", {
        id: "p1",
        status: "passed",
        votes_for: 0,
        votes_against: 0,
      });
      await expect(
        dao.castVote({ proposalId: "p1", vote: "for" }),
      ).rejects.toThrow("Proposal is not active");
    });

    it("should cast for vote", async () => {
      await dao.createProposal({ title: "Test" });
      const proposalId = Array.from(dao._proposals.keys())[0];
      const result = await dao.castVote({ proposalId, vote: "for" });
      expect(result.vote).toBe("for");
      expect(result.totalVotes).toBe(1);
    });

    it("should cast against vote", async () => {
      await dao.createProposal({ title: "Test" });
      const proposalId = Array.from(dao._proposals.keys())[0];
      const result = await dao.castVote({ proposalId, vote: "against" });
      expect(result.vote).toBe("against");
    });

    it("should reach quorum after 3 votes", async () => {
      await dao.createProposal({ title: "Test" });
      const proposalId = Array.from(dao._proposals.keys())[0];
      await dao.castVote({ proposalId, vote: "for" });
      await dao.castVote({ proposalId, vote: "for" });
      const result = await dao.castVote({ proposalId, vote: "against" });
      expect(result.status).toBe("passed");
    });
  });

  describe("getGovernanceDashboard()", () => {
    it("should return empty dashboard", async () => {
      const dashboard = await dao.getGovernanceDashboard();
      expect(dashboard.totalProposals).toBe(0);
      expect(dashboard.active).toBe(0);
      expect(dashboard.passed).toBe(0);
      expect(dashboard.rejected).toBe(0);
    });

    it("should return dashboard with proposals", async () => {
      await dao.createProposal({ title: "Prop 1" });
      const dashboard = await dao.getGovernanceDashboard();
      expect(dashboard.totalProposals).toBe(1);
      expect(dashboard.active).toBe(1);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      dao._proposals.set("p1", {});
      await dao.close();
      expect(dao._proposals.size).toBe(0);
      expect(dao.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getEvoMapDAO();
      expect(instance).toBeInstanceOf(EvoMapDAO);
    });
  });
});
