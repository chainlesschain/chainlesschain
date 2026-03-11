/**
 * Org Manager — Organization, team, and approval workflow management for CLI.
 * Supports org creation, member management, role assignment, and approval workflows.
 */

import crypto from "crypto";

/**
 * Ensure organization tables exist.
 */
export function ensureOrgTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      settings TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'active',
      invited_by TEXT,
      joined_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      lead_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      added_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      approver_id TEXT,
      request_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      data TEXT,
      status TEXT DEFAULT 'pending',
      decision_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT
    )
  `);
}

// ─── Organization CRUD ──────────────────────────────────

/**
 * Create an organization.
 */
export function createOrg(db, name, ownerId, description) {
  ensureOrgTables(db);
  const id = `org-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO organizations (id, name, description, owner_id, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, description || null, ownerId, "active");

  // Add owner as admin member
  const memberId = `member-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO org_members (id, org_id, user_id, role, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(memberId, id, ownerId, "admin", "active");

  return { id, name, description, ownerId, status: "active" };
}

/**
 * Get an organization by ID.
 */
export function getOrg(db, orgId) {
  ensureOrgTables(db);
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
}

/**
 * List all organizations.
 */
export function listOrgs(db) {
  ensureOrgTables(db);
  return db
    .prepare("SELECT * FROM organizations ORDER BY created_at DESC")
    .all();
}

/**
 * Update an organization.
 */
export function updateOrg(db, orgId, updates) {
  ensureOrgTables(db);
  const { name, description, status } = updates;
  if (name)
    db.prepare("UPDATE organizations SET name = ? WHERE id = ?").run(
      name,
      orgId,
    );
  if (description !== undefined)
    db.prepare("UPDATE organizations SET description = ? WHERE id = ?").run(
      description,
      orgId,
    );
  if (status)
    db.prepare("UPDATE organizations SET status = ? WHERE id = ?").run(
      status,
      orgId,
    );
  return getOrg(db, orgId);
}

/**
 * Delete an organization.
 */
export function deleteOrg(db, orgId) {
  ensureOrgTables(db);
  db.prepare(
    "DELETE FROM org_team_members WHERE team_id IN (SELECT id FROM org_teams WHERE org_id = ?)",
  ).run(orgId);
  db.prepare("DELETE FROM org_teams WHERE org_id = ?").run(orgId);
  db.prepare("DELETE FROM org_members WHERE org_id = ?").run(orgId);
  db.prepare("DELETE FROM approval_requests WHERE org_id = ?").run(orgId);
  const result = db
    .prepare("DELETE FROM organizations WHERE id = ?")
    .run(orgId);
  return result.changes > 0;
}

// ─── Members ────────────────────────────────────────────

/**
 * Invite a member to an organization.
 */
export function inviteMember(db, orgId, userId, displayName, role, invitedBy) {
  ensureOrgTables(db);
  const org = getOrg(db, orgId);
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  const id = `member-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO org_members (id, org_id, user_id, display_name, role, status, invited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    orgId,
    userId,
    displayName || null,
    role || "member",
    "invited",
    invitedBy || null,
  );

  return {
    id,
    orgId,
    userId,
    displayName,
    role: role || "member",
    status: "invited",
  };
}

/**
 * Accept an invitation.
 */
export function acceptInvite(db, memberId) {
  ensureOrgTables(db);
  const result = db
    .prepare("UPDATE org_members SET status = ? WHERE id = ?")
    .run("active", memberId);
  return result.changes > 0;
}

/**
 * Get members of an organization.
 */
export function getMembers(db, orgId) {
  ensureOrgTables(db);
  return db
    .prepare(
      "SELECT * FROM org_members WHERE org_id = ? ORDER BY joined_at ASC",
    )
    .all(orgId);
}

/**
 * Update a member's role.
 */
export function updateMemberRole(db, memberId, newRole) {
  ensureOrgTables(db);
  const result = db
    .prepare("UPDATE org_members SET role = ? WHERE id = ?")
    .run(newRole, memberId);
  return result.changes > 0;
}

/**
 * Remove a member from an organization.
 */
export function removeMember(db, memberId) {
  ensureOrgTables(db);
  const result = db
    .prepare("DELETE FROM org_members WHERE id = ?")
    .run(memberId);
  return result.changes > 0;
}

// ─── Teams ──────────────────────────────────────────────

/**
 * Create a team within an organization.
 */
export function createTeam(db, orgId, name, description, leadId) {
  ensureOrgTables(db);
  const org = getOrg(db, orgId);
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  const id = `team-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO org_teams (id, org_id, name, description, lead_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, orgId, name, description || null, leadId || null);

  return { id, orgId, name, description, leadId };
}

/**
 * List teams in an organization.
 */
export function listTeams(db, orgId) {
  ensureOrgTables(db);
  return db
    .prepare("SELECT * FROM org_teams WHERE org_id = ? ORDER BY created_at ASC")
    .all(orgId);
}

/**
 * Add a member to a team.
 */
export function addTeamMember(db, teamId, userId, role) {
  ensureOrgTables(db);
  db.prepare(
    `INSERT INTO org_team_members (team_id, user_id, role) VALUES (?, ?, ?)`,
  ).run(teamId, userId, role || "member");
  return { teamId, userId, role: role || "member" };
}

/**
 * Get team members.
 */
export function getTeamMembers(db, teamId) {
  ensureOrgTables(db);
  return db
    .prepare("SELECT * FROM org_team_members WHERE team_id = ?")
    .all(teamId);
}

/**
 * Remove a team member.
 */
export function removeTeamMember(db, teamId, userId) {
  ensureOrgTables(db);
  const result = db
    .prepare("DELETE FROM org_team_members WHERE team_id = ? AND user_id = ?")
    .run(teamId, userId);
  return result.changes > 0;
}

/**
 * Delete a team.
 */
export function deleteTeam(db, teamId) {
  ensureOrgTables(db);
  db.prepare("DELETE FROM org_team_members WHERE team_id = ?").run(teamId);
  const result = db.prepare("DELETE FROM org_teams WHERE id = ?").run(teamId);
  return result.changes > 0;
}

// ─── Approvals ──────────────────────────────────────────

/**
 * Submit an approval request.
 */
export function submitApproval(
  db,
  orgId,
  requesterId,
  requestType,
  title,
  description,
  data,
) {
  ensureOrgTables(db);
  const id = `approval-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO approval_requests (id, org_id, requester_id, request_type, title, description, data, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    orgId,
    requesterId,
    requestType,
    title,
    description || null,
    data ? JSON.stringify(data) : null,
    "pending",
  );

  return { id, orgId, requesterId, requestType, title, status: "pending" };
}

/**
 * Approve a request.
 */
export function approveRequest(db, approvalId, approverId, note) {
  ensureOrgTables(db);
  const result = db
    .prepare(
      "UPDATE approval_requests SET status = ?, approver_id = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?",
    )
    .run("approved", approverId, note || null, approvalId);
  return result.changes > 0;
}

/**
 * Reject a request.
 */
export function rejectRequest(db, approvalId, approverId, note) {
  ensureOrgTables(db);
  const result = db
    .prepare(
      "UPDATE approval_requests SET status = ?, approver_id = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?",
    )
    .run("rejected", approverId, note || null, approvalId);
  return result.changes > 0;
}

/**
 * Get approval requests.
 */
export function getApprovals(db, options = {}) {
  ensureOrgTables(db);
  const { orgId, status, requesterId } = options;

  let sql = "SELECT * FROM approval_requests WHERE 1=1";
  const params = [];

  if (orgId) {
    sql += " AND org_id = ?";
    params.push(orgId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (requesterId) {
    sql += " AND requester_id = ?";
    params.push(requesterId);
  }

  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params);
}

/**
 * Get a single approval request.
 */
export function getApproval(db, approvalId) {
  ensureOrgTables(db);
  return db
    .prepare("SELECT * FROM approval_requests WHERE id = ?")
    .get(approvalId);
}

/**
 * Get org summary statistics.
 */
export function getOrgSummary(db, orgId) {
  ensureOrgTables(db);
  const members = db
    .prepare("SELECT COUNT(*) as c FROM org_members WHERE org_id = ?")
    .get(orgId);
  const teams = db
    .prepare("SELECT COUNT(*) as c FROM org_teams WHERE org_id = ?")
    .get(orgId);
  const pending = db
    .prepare(
      "SELECT COUNT(*) as c FROM approval_requests WHERE org_id = ? AND status = ?",
    )
    .get(orgId, "pending");

  return {
    memberCount: members?.c || 0,
    teamCount: teams?.c || 0,
    pendingApprovals: pending?.c || 0,
  };
}
