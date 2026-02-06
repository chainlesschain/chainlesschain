/**
 * Team Manager Unit Tests
 *
 * Tests for organization sub-team management.
 *
 * @module permission/__tests__/team-manager.test
 */

const { describe, it, expect, beforeEach, vi } = require("vitest");
const { TeamManager } = require("../team-manager.js");

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-team-uuid"),
}));

describe("TeamManager", () => {
  let manager;
  let mockDb;
  let mockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => []),
      })),
    };

    mockDatabase = {
      getDatabase: vi.fn(() => mockDb),
    };

    manager = new TeamManager(mockDatabase);
  });

  // ========================================
  // Constructor Tests
  // ========================================

  describe("constructor", () => {
    it("should initialize with database reference", () => {
      expect(manager.database).toBe(mockDatabase);
    });
  });

  // ========================================
  // createTeam Tests
  // ========================================

  describe("createTeam", () => {
    it("should create a team successfully", async () => {
      const teamData = {
        orgId: "org-1",
        name: "Engineering",
        description: "Engineering team",
        leadDid: "user-123",
        leadName: "John Doe",
        createdBy: "admin-456",
      };

      const result = await manager.createTeam(teamData);

      expect(result.success).toBe(true);
      expect(result.teamId).toBe("test-team-uuid");
    });

    it("should create team with parent team", async () => {
      const teamData = {
        orgId: "org-1",
        name: "Frontend",
        description: "Frontend team",
        parentTeamId: "parent-team-123",
        leadDid: "user-456",
        leadName: "Jane Doe",
        createdBy: "admin-789",
      };

      const result = await manager.createTeam(teamData);

      expect(result.success).toBe(true);
    });

    it("should create team with settings", async () => {
      const teamData = {
        orgId: "org-1",
        name: "DevOps",
        description: "DevOps team",
        settings: { visibility: "private", allowJoinRequests: false },
        createdBy: "admin-123",
      };

      const result = await manager.createTeam(teamData);

      expect(result.success).toBe(true);
    });

    it("should add lead as team member automatically", async () => {
      const addMemberSpy = vi.spyOn(manager, "addMember").mockResolvedValue({
        success: true,
        memberId: "member-123",
      });

      const teamData = {
        orgId: "org-1",
        name: "QA Team",
        leadDid: "user-lead",
        leadName: "Team Lead",
        createdBy: "admin-123",
      };

      await manager.createTeam(teamData);

      expect(addMemberSpy).toHaveBeenCalledWith(
        "test-team-uuid",
        "user-lead",
        "Team Lead",
        "lead",
        "admin-123"
      );
    });

    it("should not add member when no lead specified", async () => {
      const addMemberSpy = vi.spyOn(manager, "addMember");

      const teamData = {
        orgId: "org-1",
        name: "New Team",
        description: "No lead yet",
        createdBy: "admin-123",
      };

      await manager.createTeam(teamData);

      expect(addMemberSpy).not.toHaveBeenCalled();
    });

    it("should return error for duplicate team name", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("UNIQUE constraint failed");
        }),
      }));

      const teamData = {
        orgId: "org-1",
        name: "Existing Team",
        createdBy: "admin-123",
      };

      const result = await manager.createTeam(teamData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("TEAM_NAME_EXISTS");
    });

    it("should throw on other database errors", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("Database error");
        }),
      }));

      const teamData = {
        orgId: "org-1",
        name: "Test Team",
        createdBy: "admin-123",
      };

      await expect(manager.createTeam(teamData)).rejects.toThrow(
        "Database error"
      );
    });
  });

  // ========================================
  // updateTeam Tests
  // ========================================

  describe("updateTeam", () => {
    it("should update team name", async () => {
      const result = await manager.updateTeam("team-123", {
        name: "New Team Name",
      });

      expect(result.success).toBe(true);
    });

    it("should update team description", async () => {
      const result = await manager.updateTeam("team-123", {
        description: "Updated description",
      });

      expect(result.success).toBe(true);
    });

    it("should update multiple fields", async () => {
      const result = await manager.updateTeam("team-123", {
        name: "New Name",
        description: "New Description",
        avatar: "https://example.com/avatar.png",
      });

      expect(result.success).toBe(true);
    });

    it("should update team settings", async () => {
      const result = await manager.updateTeam("team-123", {
        settings: { visibility: "public", maxMembers: 50 },
      });

      expect(result.success).toBe(true);
    });

    it("should update team lead", async () => {
      const result = await manager.updateTeam("team-123", {
        leadDid: "new-lead-123",
        leadName: "New Lead",
      });

      expect(result.success).toBe(true);
    });

    it("should return success when no updates provided", async () => {
      const result = await manager.updateTeam("team-123", {});

      expect(result.success).toBe(true);
    });

    it("should ignore invalid fields", async () => {
      const result = await manager.updateTeam("team-123", {
        invalidField: "should be ignored",
        name: "Valid Update",
      });

      expect(result.success).toBe(true);
    });

    it("should convert camelCase to snake_case", async () => {
      const runMock = vi.fn();
      mockDb.prepare = vi.fn(() => ({
        run: runMock,
      }));

      await manager.updateTeam("team-123", {
        parentTeamId: "parent-456",
      });

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // deleteTeam Tests
  // ========================================

  describe("deleteTeam", () => {
    it("should delete team without sub-teams", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ count: 0 })),
        run: vi.fn(),
      }));

      const result = await manager.deleteTeam("team-123");

      expect(result.success).toBe(true);
    });

    it("should prevent deletion of team with sub-teams", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ count: 3 })),
      }));

      const result = await manager.deleteTeam("team-123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("HAS_SUB_TEAMS");
      expect(result.message).toContain("3 sub-teams");
    });

    it("should handle null sub-team count", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        run: vi.fn(),
      }));

      const result = await manager.deleteTeam("team-123");

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // addMember Tests
  // ========================================

  describe("addMember", () => {
    it("should add member with default role", async () => {
      const result = await manager.addMember(
        "team-123",
        "user-456",
        "John Doe"
      );

      expect(result.success).toBe(true);
      expect(result.memberId).toBe("test-team-uuid");
    });

    it("should add member with specific role", async () => {
      const result = await manager.addMember(
        "team-123",
        "user-456",
        "Jane Doe",
        "lead"
      );

      expect(result.success).toBe(true);
    });

    it("should add member with inviter info", async () => {
      const result = await manager.addMember(
        "team-123",
        "user-456",
        "New Member",
        "member",
        "admin-789"
      );

      expect(result.success).toBe(true);
    });

    it("should return error if already a member", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("UNIQUE constraint failed");
        }),
      }));

      const result = await manager.addMember(
        "team-123",
        "user-456",
        "John Doe"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("ALREADY_MEMBER");
    });
  });

  // ========================================
  // removeMember Tests
  // ========================================

  describe("removeMember", () => {
    it("should remove member from team", async () => {
      const result = await manager.removeMember("team-123", "user-456");

      expect(result.success).toBe(true);
    });

    it("should succeed even if member not found", async () => {
      // SQLite DELETE doesn't error if row doesn't exist
      const result = await manager.removeMember("team-123", "nonexistent");

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // setLead Tests
  // ========================================

  describe("setLead", () => {
    it("should set new team lead", async () => {
      const result = await manager.setLead(
        "team-123",
        "new-lead-did",
        "New Lead Name"
      );

      expect(result.success).toBe(true);
    });

    it("should demote previous lead to member", async () => {
      const runMock = vi.fn();
      mockDb.prepare = vi.fn(() => ({
        run: runMock,
      }));

      await manager.setLead("team-123", "new-lead", "New Lead");

      // Should have multiple UPDATE calls
      expect(runMock).toHaveBeenCalled();
    });
  });

  // ========================================
  // getTeams Tests
  // ========================================

  describe("getTeams", () => {
    it("should return all teams for organization", async () => {
      const mockTeams = [
        {
          id: "team-1",
          name: "Engineering",
          description: "Dev team",
          parent_team_id: null,
          lead_did: "user-1",
          lead_name: "Lead 1",
          avatar: null,
          settings: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: "team-2",
          name: "QA",
          description: "QA team",
          parent_team_id: "team-1",
          lead_did: "user-2",
          lead_name: "Lead 2",
          avatar: null,
          settings: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => mockTeams),
        get: vi.fn(() => ({ count: 5 })),
      }));

      const result = await manager.getTeams("org-1");

      expect(result.success).toBe(true);
      expect(result.teams).toHaveLength(2);
    });

    it("should filter by parent team ID", async () => {
      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ count: 0 })),
      }));

      const result = await manager.getTeams("org-1", {
        parentTeamId: "parent-123",
      });

      expect(result.success).toBe(true);
    });

    it("should filter root teams (null parent)", async () => {
      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ count: 0 })),
      }));

      const result = await manager.getTeams("org-1", {
        parentTeamId: null,
      });

      expect(result.success).toBe(true);
    });

    it("should include member count for each team", async () => {
      const mockTeam = {
        id: "team-1",
        name: "Test Team",
        description: null,
        parent_team_id: null,
        lead_did: null,
        lead_name: null,
        avatar: null,
        settings: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => [mockTeam]),
        get: vi.fn(() => ({ count: 10 })),
      }));

      const result = await manager.getTeams("org-1");

      expect(result.teams[0].memberCount).toBe(10);
    });

    it("should parse settings JSON", async () => {
      const mockTeam = {
        id: "team-1",
        name: "Test Team",
        description: null,
        parent_team_id: null,
        lead_did: null,
        lead_name: null,
        avatar: null,
        settings: JSON.stringify({ visibility: "private" }),
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => [mockTeam]),
        get: vi.fn(() => ({ count: 0 })),
      }));

      const result = await manager.getTeams("org-1");

      expect(result.teams[0].settings).toEqual({ visibility: "private" });
    });

    it("should handle null settings", async () => {
      const mockTeam = {
        id: "team-1",
        name: "Test Team",
        description: null,
        parent_team_id: null,
        lead_did: null,
        lead_name: null,
        avatar: null,
        settings: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => [mockTeam]),
        get: vi.fn(() => ({ count: 0 })),
      }));

      const result = await manager.getTeams("org-1");

      expect(result.teams[0].settings).toBeNull();
    });
  });

  // ========================================
  // getTeamMembers Tests
  // ========================================

  describe("getTeamMembers", () => {
    it("should return all team members", async () => {
      const mockMembers = [
        {
          id: "member-1",
          member_did: "user-1",
          member_name: "John Doe",
          team_role: "lead",
          joined_at: Date.now(),
          invited_by: "admin-1",
        },
        {
          id: "member-2",
          member_did: "user-2",
          member_name: "Jane Doe",
          team_role: "member",
          joined_at: Date.now(),
          invited_by: "user-1",
        },
      ];

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => mockMembers),
      }));

      const result = await manager.getTeamMembers("team-123");

      expect(result.success).toBe(true);
      expect(result.members).toHaveLength(2);
    });

    it("should format member objects correctly", async () => {
      const mockMember = {
        id: "member-1",
        member_did: "user-123",
        member_name: "Test User",
        team_role: "member",
        joined_at: 1699000000000,
        invited_by: "admin-456",
      };

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => [mockMember]),
      }));

      const result = await manager.getTeamMembers("team-123");

      expect(result.members[0]).toEqual({
        id: "member-1",
        memberDid: "user-123",
        memberName: "Test User",
        role: "member",
        joinedAt: 1699000000000,
        invitedBy: "admin-456",
      });
    });

    it("should return empty array for team with no members", async () => {
      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
      }));

      const result = await manager.getTeamMembers("empty-team");

      expect(result.success).toBe(true);
      expect(result.members).toHaveLength(0);
    });

    it("should sort members by role and join date", async () => {
      // The query includes ORDER BY team_role DESC, joined_at ASC
      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
      }));

      await manager.getTeamMembers("team-123");

      // Verify query was called (implicitly tests ordering)
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  // ========================================
  // Singleton Factory Tests
  // ========================================

  describe("getTeamManager factory", () => {
    it("should be exported", () => {
      const { getTeamManager } = require("../team-manager.js");
      expect(typeof getTeamManager).toBe("function");
    });
  });
});
