import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureOrgTables,
  createOrg,
  getOrg,
  listOrgs,
  updateOrg,
  deleteOrg,
  inviteMember,
  acceptInvite,
  getMembers,
  updateMemberRole,
  removeMember,
  createTeam,
  listTeams,
  addTeamMember,
  getTeamMembers,
  removeTeamMember,
  deleteTeam,
  submitApproval,
  approveRequest,
  rejectRequest,
  getApprovals,
  getApproval,
  getOrgSummary,
} from "../../src/lib/org-manager.js";

describe("Org Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureOrgTables ──────────────────────────────────

  describe("ensureOrgTables", () => {
    it("should create org tables", () => {
      ensureOrgTables(db);
      expect(db.tables.has("organizations")).toBe(true);
      expect(db.tables.has("org_members")).toBe(true);
      expect(db.tables.has("org_teams")).toBe(true);
      expect(db.tables.has("org_team_members")).toBe(true);
      expect(db.tables.has("approval_requests")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureOrgTables(db);
      ensureOrgTables(db);
      expect(db.tables.has("organizations")).toBe(true);
    });
  });

  // ─── Organization CRUD ────────────────────────────────

  describe("createOrg", () => {
    it("should create an organization", () => {
      const org = createOrg(db, "Acme Corp", "user-1", "A test org");
      expect(org.id).toMatch(/^org-/);
      expect(org.name).toBe("Acme Corp");
      expect(org.ownerId).toBe("user-1");
      expect(org.status).toBe("active");
    });

    it("should auto-add owner as admin member", () => {
      const org = createOrg(db, "Acme Corp", "user-1");
      const members = getMembers(db, org.id);
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe("admin");
    });
  });

  describe("getOrg", () => {
    it("should get org by ID", () => {
      const org = createOrg(db, "Test", "user-1");
      const found = getOrg(db, org.id);
      expect(found).toBeDefined();
      expect(found.name).toBe("Test");
    });

    it("should return null for non-existent org", () => {
      ensureOrgTables(db);
      expect(getOrg(db, "org-nope")).toBeNull();
    });
  });

  describe("listOrgs", () => {
    it("should list all organizations", () => {
      createOrg(db, "Org 1", "user-1");
      createOrg(db, "Org 2", "user-2");
      expect(listOrgs(db)).toHaveLength(2);
    });

    it("should return empty when no orgs", () => {
      ensureOrgTables(db);
      expect(listOrgs(db)).toHaveLength(0);
    });
  });

  describe("updateOrg", () => {
    it("should update org name", () => {
      const org = createOrg(db, "Old Name", "user-1");
      updateOrg(db, org.id, { name: "New Name" });
      const updated = getOrg(db, org.id);
      expect(updated.name).toBe("New Name");
    });
  });

  describe("deleteOrg", () => {
    it("should delete an org and its members/teams", () => {
      const org = createOrg(db, "Test", "user-1");
      createTeam(db, org.id, "Team A");
      const ok = deleteOrg(db, org.id);
      expect(ok).toBe(true);
      expect(getOrg(db, org.id)).toBeNull();
    });

    it("should return false for non-existent org", () => {
      ensureOrgTables(db);
      expect(deleteOrg(db, "org-nope")).toBe(false);
    });
  });

  // ─── Members ──────────────────────────────────────────

  describe("inviteMember", () => {
    it("should invite a member", () => {
      const org = createOrg(db, "Test", "user-1");
      const member = inviteMember(
        db,
        org.id,
        "user-2",
        "Bob",
        "member",
        "user-1",
      );
      expect(member.id).toMatch(/^member-/);
      expect(member.status).toBe("invited");
      expect(member.role).toBe("member");
    });

    it("should throw for non-existent org", () => {
      ensureOrgTables(db);
      expect(() => inviteMember(db, "org-nope", "user-2")).toThrow(
        "Organization not found",
      );
    });
  });

  describe("acceptInvite", () => {
    it("should accept an invitation", () => {
      const org = createOrg(db, "Test", "user-1");
      const member = inviteMember(db, org.id, "user-2");
      const ok = acceptInvite(db, member.id);
      expect(ok).toBe(true);
    });
  });

  describe("getMembers", () => {
    it("should get org members", () => {
      const org = createOrg(db, "Test", "user-1");
      inviteMember(db, org.id, "user-2");
      const members = getMembers(db, org.id);
      expect(members).toHaveLength(2); // owner + invited
    });
  });

  describe("updateMemberRole", () => {
    it("should update member role", () => {
      const org = createOrg(db, "Test", "user-1");
      const member = inviteMember(db, org.id, "user-2");
      const ok = updateMemberRole(db, member.id, "admin");
      expect(ok).toBe(true);
    });
  });

  describe("removeMember", () => {
    it("should remove a member", () => {
      const org = createOrg(db, "Test", "user-1");
      const member = inviteMember(db, org.id, "user-2");
      const ok = removeMember(db, member.id);
      expect(ok).toBe(true);
    });
  });

  // ─── Teams ────────────────────────────────────────────

  describe("createTeam", () => {
    it("should create a team", () => {
      const org = createOrg(db, "Test", "user-1");
      const team = createTeam(db, org.id, "Dev Team", "Development");
      expect(team.id).toMatch(/^team-/);
      expect(team.name).toBe("Dev Team");
    });

    it("should throw for non-existent org", () => {
      ensureOrgTables(db);
      expect(() => createTeam(db, "org-nope", "Team")).toThrow(
        "Organization not found",
      );
    });
  });

  describe("listTeams", () => {
    it("should list teams in an org", () => {
      const org = createOrg(db, "Test", "user-1");
      createTeam(db, org.id, "Team A");
      createTeam(db, org.id, "Team B");
      expect(listTeams(db, org.id)).toHaveLength(2);
    });
  });

  describe("addTeamMember", () => {
    it("should add a member to a team", () => {
      const org = createOrg(db, "Test", "user-1");
      const team = createTeam(db, org.id, "Dev Team");
      const result = addTeamMember(db, team.id, "user-2", "developer");
      expect(result.teamId).toBe(team.id);
      expect(result.role).toBe("developer");
    });
  });

  describe("getTeamMembers", () => {
    it("should get team members", () => {
      const org = createOrg(db, "Test", "user-1");
      const team = createTeam(db, org.id, "Dev Team");
      addTeamMember(db, team.id, "user-1");
      addTeamMember(db, team.id, "user-2");
      expect(getTeamMembers(db, team.id)).toHaveLength(2);
    });
  });

  describe("removeTeamMember", () => {
    it("should remove a team member", () => {
      const org = createOrg(db, "Test", "user-1");
      const team = createTeam(db, org.id, "Dev Team");
      addTeamMember(db, team.id, "user-2");
      const ok = removeTeamMember(db, team.id, "user-2");
      expect(ok).toBe(true);
    });
  });

  describe("deleteTeam", () => {
    it("should delete a team", () => {
      const org = createOrg(db, "Test", "user-1");
      const team = createTeam(db, org.id, "Dev Team");
      const ok = deleteTeam(db, team.id);
      expect(ok).toBe(true);
      expect(listTeams(db, org.id)).toHaveLength(0);
    });
  });

  // ─── Approvals ────────────────────────────────────────

  describe("submitApproval", () => {
    it("should submit an approval request", () => {
      const org = createOrg(db, "Test", "user-1");
      const approval = submitApproval(
        db,
        org.id,
        "user-2",
        "access",
        "Need admin access",
      );
      expect(approval.id).toMatch(/^approval-/);
      expect(approval.status).toBe("pending");
      expect(approval.title).toBe("Need admin access");
    });
  });

  describe("approveRequest", () => {
    it("should approve a request", () => {
      const org = createOrg(db, "Test", "user-1");
      const approval = submitApproval(
        db,
        org.id,
        "user-2",
        "access",
        "Need access",
      );
      const ok = approveRequest(db, approval.id, "user-1", "Approved");
      expect(ok).toBe(true);
    });

    it("should return false for non-existent request", () => {
      ensureOrgTables(db);
      expect(approveRequest(db, "approval-nope", "user-1")).toBe(false);
    });
  });

  describe("rejectRequest", () => {
    it("should reject a request", () => {
      const org = createOrg(db, "Test", "user-1");
      const approval = submitApproval(
        db,
        org.id,
        "user-2",
        "access",
        "Need access",
      );
      const ok = rejectRequest(db, approval.id, "user-1", "Denied");
      expect(ok).toBe(true);
    });
  });

  describe("getApprovals", () => {
    it("should get approval requests", () => {
      const org = createOrg(db, "Test", "user-1");
      submitApproval(db, org.id, "user-2", "access", "Request 1");
      submitApproval(db, org.id, "user-3", "access", "Request 2");
      const approvals = getApprovals(db);
      expect(approvals).toHaveLength(2);
    });

    it("should filter by status", () => {
      const org = createOrg(db, "Test", "user-1");
      submitApproval(db, org.id, "user-2", "access", "Request 1");
      const approvals = getApprovals(db, { status: "pending" });
      expect(approvals).toHaveLength(1);
    });
  });

  describe("getApproval", () => {
    it("should get a single approval", () => {
      const org = createOrg(db, "Test", "user-1");
      const approval = submitApproval(db, org.id, "user-2", "access", "Test");
      const found = getApproval(db, approval.id);
      expect(found).toBeDefined();
      expect(found.title).toBe("Test");
    });
  });

  // ─── getOrgSummary ────────────────────────────────────

  describe("getOrgSummary", () => {
    it("should return org summary", () => {
      const org = createOrg(db, "Test", "user-1");
      createTeam(db, org.id, "Team A");
      submitApproval(db, org.id, "user-2", "access", "Request 1");
      const summary = getOrgSummary(db, org.id);
      expect(summary.memberCount).toBe(1);
      expect(summary.teamCount).toBe(1);
      expect(summary.pendingApprovals).toBe(1);
    });
  });
});
