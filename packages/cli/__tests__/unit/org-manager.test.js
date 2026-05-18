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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface Tests — org maturity + member lifecycle
 * ═══════════════════════════════════════════════════════════════ */

import {
  ORG_MATURITY_V2,
  MEMBER_LIFECYCLE_V2,
  ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER,
  ORG_DEFAULT_MAX_ACTIVE_MEMBERS_PER_ORG,
  ORG_DEFAULT_ORG_IDLE_MS,
  ORG_DEFAULT_INVITE_STALE_MS,
  getMaxActiveOrgsPerOwnerV2,
  setMaxActiveOrgsPerOwnerV2,
  getMaxActiveMembersPerOrgV2,
  setMaxActiveMembersPerOrgV2,
  getOrgIdleMsV2,
  setOrgIdleMsV2,
  getInviteStaleMsV2,
  setInviteStaleMsV2,
  getActiveOrgCountV2,
  getActiveMemberCountV2,
  registerOrgV2,
  getOrgV2,
  listOrgsV2,
  setOrgMaturityV2,
  activateOrgV2,
  suspendOrgV2,
  archiveOrgV2,
  touchOrgV2,
  inviteMemberV2,
  getMemberV2,
  listMembersV2,
  setMemberStatusV2,
  activateMemberV2,
  suspendMemberV2,
  revokeMemberV2,
  departMemberV2,
  autoArchiveIdleOrgsV2,
  autoRevokeStaleInvitesV2,
  getOrgManagerStatsV2,
  _resetStateOrgManagerV2,
} from "../../src/lib/org-manager.js";

describe("org-manager V2", () => {
  beforeEach(() => {
    _resetStateOrgManagerV2();
  });

  describe("enums + defaults", () => {
    it("exposes 4 org maturities + 5 member statuses", () => {
      expect(Object.values(ORG_MATURITY_V2)).toHaveLength(4);
      expect(Object.values(MEMBER_LIFECYCLE_V2)).toHaveLength(5);
    });

    it("defaults match exported constants", () => {
      expect(getMaxActiveOrgsPerOwnerV2()).toBe(
        ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER,
      );
      expect(getMaxActiveMembersPerOrgV2()).toBe(
        ORG_DEFAULT_MAX_ACTIVE_MEMBERS_PER_ORG,
      );
      expect(getOrgIdleMsV2()).toBe(ORG_DEFAULT_ORG_IDLE_MS);
      expect(getInviteStaleMsV2()).toBe(ORG_DEFAULT_INVITE_STALE_MS);
    });
  });

  describe("config setters", () => {
    it("accepts positive integers + floors floats", () => {
      setMaxActiveOrgsPerOwnerV2(7.9);
      setMaxActiveMembersPerOrgV2(99.4);
      setOrgIdleMsV2(1000.7);
      setInviteStaleMsV2(2000.9);
      expect(getMaxActiveOrgsPerOwnerV2()).toBe(7);
      expect(getMaxActiveMembersPerOrgV2()).toBe(99);
      expect(getOrgIdleMsV2()).toBe(1000);
      expect(getInviteStaleMsV2()).toBe(2000);
    });

    it("rejects ≤0 / NaN", () => {
      expect(() => setMaxActiveOrgsPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setMaxActiveMembersPerOrgV2(NaN)).toThrow(/positive/);
      expect(() => setOrgIdleMsV2(-5)).toThrow(/positive/);
      expect(() => setInviteStaleMsV2("nope")).toThrow(/positive/);
    });
  });

  describe("registerOrgV2", () => {
    it("creates a provisional org with metadata copy", () => {
      const o = registerOrgV2("o1", {
        owner: "alice",
        name: "Acme",
        metadata: { plan: "pro" },
      });
      expect(o.maturity).toBe("provisional");
      expect(o.activatedAt).toBeNull();
      expect(o.metadata).toEqual({ plan: "pro" });
    });

    it("rejects bad inputs + duplicates", () => {
      expect(() => registerOrgV2("", { owner: "a", name: "n" })).toThrow();
      expect(() => registerOrgV2("o", { owner: "", name: "n" })).toThrow();
      expect(() => registerOrgV2("o", { owner: "a", name: "" })).toThrow();
      registerOrgV2("dup", { owner: "a", name: "n" });
      expect(() => registerOrgV2("dup", { owner: "a", name: "n" })).toThrow(
        /already exists/,
      );
    });

    it("returns defensive copies", () => {
      registerOrgV2("o", { owner: "a", name: "n", metadata: { x: 1 } });
      const got = getOrgV2("o");
      got.metadata.x = 999;
      expect(getOrgV2("o").metadata.x).toBe(1);
    });
  });

  describe("org maturity transitions", () => {
    beforeEach(() => {
      registerOrgV2("o1", { owner: "alice", name: "Acme" });
    });

    it("provisional → active stamps activatedAt once", () => {
      const a1 = activateOrgV2("o1", { now: 1000 });
      expect(a1.activatedAt).toBe(1000);
      suspendOrgV2("o1", { now: 2000 });
      const a2 = activateOrgV2("o1", { now: 3000 });
      expect(a2.activatedAt).toBe(1000);
    });

    it("active ↔ suspended recovery works", () => {
      activateOrgV2("o1");
      suspendOrgV2("o1");
      expect(getOrgV2("o1").maturity).toBe("suspended");
      activateOrgV2("o1");
      expect(getOrgV2("o1").maturity).toBe("active");
    });

    it("archived is terminal", () => {
      activateOrgV2("o1");
      archiveOrgV2("o1");
      expect(() => activateOrgV2("o1")).toThrow(/terminal/);
    });

    it("rejects unknown next state", () => {
      expect(() => setOrgMaturityV2("o1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal transitions", () => {
      expect(() => suspendOrgV2("o1")).toThrow(/cannot transition/);
    });

    it("throws on unknown id", () => {
      expect(() => activateOrgV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-owner active-org cap", () => {
    it("enforces cap on provisional → active", () => {
      setMaxActiveOrgsPerOwnerV2(2);
      registerOrgV2("a", { owner: "x", name: "A" });
      registerOrgV2("b", { owner: "x", name: "B" });
      registerOrgV2("c", { owner: "x", name: "C" });
      activateOrgV2("a");
      activateOrgV2("b");
      expect(() => activateOrgV2("c")).toThrow(/cap/);
    });

    it("does not enforce cap on suspended → active recovery", () => {
      setMaxActiveOrgsPerOwnerV2(1);
      registerOrgV2("a", { owner: "x", name: "A" });
      activateOrgV2("a");
      suspendOrgV2("a");
      expect(() => activateOrgV2("a")).not.toThrow();
    });

    it("getActiveOrgCountV2 counts only active", () => {
      registerOrgV2("a", { owner: "x", name: "A" });
      registerOrgV2("b", { owner: "x", name: "B" });
      activateOrgV2("a");
      activateOrgV2("b");
      suspendOrgV2("b");
      expect(getActiveOrgCountV2("x")).toBe(1);
    });
  });

  describe("touchOrgV2", () => {
    it("updates lastSeenAt", () => {
      registerOrgV2("o", { owner: "a", name: "n" });
      const t = touchOrgV2("o", { now: 5000 });
      expect(t.lastSeenAt).toBe(5000);
    });

    it("throws on unknown id", () => {
      expect(() => touchOrgV2("nope")).toThrow(/not found/);
    });
  });

  describe("inviteMemberV2", () => {
    beforeEach(() => {
      registerOrgV2("o1", { owner: "a", name: "Acme" });
    });

    it("creates invited member under existing org", () => {
      const m = inviteMemberV2("m1", { orgId: "o1", userId: "u1" });
      expect(m.status).toBe("invited");
      expect(m.role).toBe("member");
      expect(m.activatedAt).toBeNull();
      expect(m.departedAt).toBeNull();
    });

    it("rejects unknown org", () => {
      expect(() =>
        inviteMemberV2("m", { orgId: "ghost", userId: "u" }),
      ).toThrow(/not found/);
    });

    it("rejects duplicate id", () => {
      inviteMemberV2("m", { orgId: "o1", userId: "u" });
      expect(() => inviteMemberV2("m", { orgId: "o1", userId: "u" })).toThrow(
        /already exists/,
      );
    });

    it("rejects bad inputs", () => {
      expect(() => inviteMemberV2("", { orgId: "o1", userId: "u" })).toThrow();
      expect(() => inviteMemberV2("z", { orgId: "", userId: "u" })).toThrow();
      expect(() => inviteMemberV2("z", { orgId: "o1", userId: "" })).toThrow();
    });
  });

  describe("member lifecycle transitions", () => {
    beforeEach(() => {
      registerOrgV2("o1", { owner: "a", name: "Acme" });
      inviteMemberV2("m1", { orgId: "o1", userId: "u1" });
    });

    it("invited → active stamps activatedAt once", () => {
      const r = activateMemberV2("m1", { now: 100 });
      expect(r.activatedAt).toBe(100);
    });

    it("active → suspended → active recovery preserves activatedAt", () => {
      const a1 = activateMemberV2("m1", { now: 100 });
      suspendMemberV2("m1");
      const a2 = activateMemberV2("m1", { now: 200 });
      expect(a2.activatedAt).toBe(a1.activatedAt);
    });

    it("revoke from invited stamps departedAt", () => {
      const r = revokeMemberV2("m1", { now: 500 });
      expect(r.status).toBe("revoked");
      expect(r.departedAt).toBe(500);
    });

    it("depart from active terminal stamps departedAt", () => {
      activateMemberV2("m1");
      const r = departMemberV2("m1", { now: 999 });
      expect(r.status).toBe("departed");
      expect(r.departedAt).toBe(999);
    });

    it("terminals are sticky", () => {
      revokeMemberV2("m1");
      expect(() => activateMemberV2("m1")).toThrow(/terminal/);
    });

    it("invited → suspended forbidden", () => {
      expect(() => suspendMemberV2("m1")).toThrow(/cannot transition/);
    });

    it("rejects unknown next state", () => {
      expect(() => setMemberStatusV2("m1", "bogus")).toThrow(/unknown/);
    });

    it("throws on unknown id", () => {
      expect(() => activateMemberV2("ghost")).toThrow(/not found/);
    });
  });

  describe("per-org active-member cap", () => {
    beforeEach(() => {
      registerOrgV2("o1", { owner: "a", name: "Acme" });
    });

    it("enforces cap on invited → active", () => {
      setMaxActiveMembersPerOrgV2(2);
      inviteMemberV2("a", { orgId: "o1", userId: "u1" });
      inviteMemberV2("b", { orgId: "o1", userId: "u2" });
      inviteMemberV2("c", { orgId: "o1", userId: "u3" });
      activateMemberV2("a");
      activateMemberV2("b");
      expect(() => activateMemberV2("c")).toThrow(/cap/);
    });

    it("does not enforce cap on suspended → active recovery", () => {
      setMaxActiveMembersPerOrgV2(1);
      inviteMemberV2("a", { orgId: "o1", userId: "u1" });
      activateMemberV2("a");
      suspendMemberV2("a");
      expect(() => activateMemberV2("a")).not.toThrow();
    });

    it("getActiveMemberCountV2 counts only active", () => {
      inviteMemberV2("a", { orgId: "o1", userId: "u1" });
      inviteMemberV2("b", { orgId: "o1", userId: "u2" });
      activateMemberV2("a");
      activateMemberV2("b");
      suspendMemberV2("b");
      expect(getActiveMemberCountV2("o1")).toBe(1);
    });
  });

  describe("listOrgsV2 / listMembersV2", () => {
    it("filters orgs by owner + maturity", () => {
      registerOrgV2("a", { owner: "x", name: "A" });
      registerOrgV2("b", { owner: "x", name: "B" });
      registerOrgV2("c", { owner: "y", name: "C" });
      activateOrgV2("a");
      expect(listOrgsV2({ owner: "x" })).toHaveLength(2);
      expect(listOrgsV2({ maturity: "active" })).toHaveLength(1);
    });

    it("filters members by org + status", () => {
      registerOrgV2("o1", { owner: "a", name: "A" });
      inviteMemberV2("m1", { orgId: "o1", userId: "u1" });
      inviteMemberV2("m2", { orgId: "o1", userId: "u2" });
      activateMemberV2("m1");
      expect(listMembersV2({ orgId: "o1" })).toHaveLength(2);
      expect(listMembersV2({ status: "active" })).toHaveLength(1);
      expect(listMembersV2({ status: "invited" })).toHaveLength(1);
    });
  });

  describe("autoArchiveIdleOrgsV2", () => {
    it("archives non-provisional orgs whose lastSeenAt exceeds idle window", () => {
      setOrgIdleMsV2(1000);
      registerOrgV2("a", { owner: "x", name: "A", now: 0 });
      registerOrgV2("b", { owner: "x", name: "B", now: 0 });
      activateOrgV2("a", { now: 0 });
      activateOrgV2("b", { now: 5000 });
      const flipped = autoArchiveIdleOrgsV2({ now: 2000 });
      expect(flipped.map((o) => o.id)).toEqual(["a"]);
      expect(getOrgV2("a").maturity).toBe("archived");
      expect(getOrgV2("b").maturity).toBe("active");
    });

    it("ignores provisional orgs", () => {
      setOrgIdleMsV2(1);
      registerOrgV2("p", { owner: "x", name: "P", now: 0 });
      const flipped = autoArchiveIdleOrgsV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoRevokeStaleInvitesV2", () => {
    it("revokes only invites whose lastSeenAt exceeds stale window", () => {
      setInviteStaleMsV2(1000);
      registerOrgV2("o", { owner: "a", name: "O" });
      inviteMemberV2("m1", { orgId: "o", userId: "u1", now: 0 });
      inviteMemberV2("m2", { orgId: "o", userId: "u2", now: 5000 });
      const flipped = autoRevokeStaleInvitesV2({ now: 2000 });
      expect(flipped.map((m) => m.id)).toEqual(["m1"]);
      expect(getMemberV2("m1").status).toBe("revoked");
      expect(getMemberV2("m2").status).toBe("invited");
    });

    it("stamps departedAt on auto-revoke", () => {
      setInviteStaleMsV2(1);
      registerOrgV2("o", { owner: "a", name: "O" });
      inviteMemberV2("m1", { orgId: "o", userId: "u1", now: 0 });
      autoRevokeStaleInvitesV2({ now: 1_000_000 });
      expect(getMemberV2("m1").departedAt).toBe(1_000_000);
    });

    it("ignores active members", () => {
      setInviteStaleMsV2(1);
      registerOrgV2("o", { owner: "a", name: "O" });
      inviteMemberV2("m", { orgId: "o", userId: "u", now: 0 });
      activateMemberV2("m");
      const flipped = autoRevokeStaleInvitesV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getOrgManagerStatsV2", () => {
    it("zero-init all enum buckets", () => {
      const s = getOrgManagerStatsV2();
      expect(s.totalOrgsV2).toBe(0);
      expect(s.totalMembersV2).toBe(0);
      expect(s.orgsByMaturity).toEqual({
        provisional: 0,
        active: 0,
        suspended: 0,
        archived: 0,
      });
      expect(s.membersByStatus).toEqual({
        invited: 0,
        active: 0,
        suspended: 0,
        revoked: 0,
        departed: 0,
      });
    });

    it("reflects live state", () => {
      registerOrgV2("o", { owner: "a", name: "O" });
      activateOrgV2("o");
      inviteMemberV2("m1", { orgId: "o", userId: "u1" });
      inviteMemberV2("m2", { orgId: "o", userId: "u2" });
      activateMemberV2("m1");
      revokeMemberV2("m2");
      const s = getOrgManagerStatsV2();
      expect(s.totalOrgsV2).toBe(1);
      expect(s.totalMembersV2).toBe(2);
      expect(s.orgsByMaturity.active).toBe(1);
      expect(s.membersByStatus.active).toBe(1);
      expect(s.membersByStatus.revoked).toBe(1);
    });
  });

  describe("_resetStateOrgManagerV2", () => {
    it("clears Maps + restores default config", () => {
      registerOrgV2("o", { owner: "a", name: "O" });
      setMaxActiveOrgsPerOwnerV2(99);
      _resetStateOrgManagerV2();
      expect(getOrgManagerStatsV2().totalOrgsV2).toBe(0);
      expect(getMaxActiveOrgsPerOwnerV2()).toBe(
        ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER,
      );
    });
  });
});
