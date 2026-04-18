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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — In-memory org-maturity + member-lifecycle layer.
 * Independent of the SQLite tables above; tracks org governance and
 * member onboarding/offboarding transitions with caps and auto-flip.
 * ═══════════════════════════════════════════════════════════════ */

export const ORG_MATURITY_V2 = Object.freeze({
  PROVISIONAL: "provisional",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});

export const MEMBER_LIFECYCLE_V2 = Object.freeze({
  INVITED: "invited",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
  DEPARTED: "departed",
});

const ORG_TRANSITIONS_V2 = new Map([
  ["provisional", new Set(["active", "archived"])],
  ["active", new Set(["suspended", "archived"])],
  ["suspended", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const ORG_TERMINALS_V2 = new Set(["archived"]);

const MEMBER_TRANSITIONS_V2 = new Map([
  ["invited", new Set(["active", "revoked"])],
  ["active", new Set(["suspended", "departed", "revoked"])],
  ["suspended", new Set(["active", "departed", "revoked"])],
  ["revoked", new Set()],
  ["departed", new Set()],
]);
const MEMBER_TERMINALS_V2 = new Set(["revoked", "departed"]);

export const ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER = 5;
export const ORG_DEFAULT_MAX_ACTIVE_MEMBERS_PER_ORG = 200;
export const ORG_DEFAULT_ORG_IDLE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
export const ORG_DEFAULT_INVITE_STALE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const _orgsV2 = new Map();
const _membersV2 = new Map();
let _maxActiveOrgsPerOwnerV2 = ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER;
let _maxActiveMembersPerOrgV2 = ORG_DEFAULT_MAX_ACTIVE_MEMBERS_PER_ORG;
let _orgIdleMsV2 = ORG_DEFAULT_ORG_IDLE_MS;
let _inviteStaleMsV2 = ORG_DEFAULT_INVITE_STALE_MS;

function _posIntOrgV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveOrgsPerOwnerV2() {
  return _maxActiveOrgsPerOwnerV2;
}
export function setMaxActiveOrgsPerOwnerV2(n) {
  _maxActiveOrgsPerOwnerV2 = _posIntOrgV2(n, "maxActiveOrgsPerOwner");
}
export function getMaxActiveMembersPerOrgV2() {
  return _maxActiveMembersPerOrgV2;
}
export function setMaxActiveMembersPerOrgV2(n) {
  _maxActiveMembersPerOrgV2 = _posIntOrgV2(n, "maxActiveMembersPerOrg");
}
export function getOrgIdleMsV2() {
  return _orgIdleMsV2;
}
export function setOrgIdleMsV2(n) {
  _orgIdleMsV2 = _posIntOrgV2(n, "orgIdleMs");
}
export function getInviteStaleMsV2() {
  return _inviteStaleMsV2;
}
export function setInviteStaleMsV2(n) {
  _inviteStaleMsV2 = _posIntOrgV2(n, "inviteStaleMs");
}

export function getActiveOrgCountV2(owner) {
  let n = 0;
  for (const o of _orgsV2.values()) {
    if (o.owner === owner && o.maturity === "active") n += 1;
  }
  return n;
}

export function getActiveMemberCountV2(orgId) {
  let n = 0;
  for (const m of _membersV2.values()) {
    if (m.orgId === orgId && m.status === "active") n += 1;
  }
  return n;
}

function _copyOrgV2(o) {
  return { ...o, metadata: { ...o.metadata } };
}
function _copyMemberV2(m) {
  return { ...m, metadata: { ...m.metadata } };
}

export function registerOrgV2(
  id,
  { owner, name, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!owner || typeof owner !== "string")
    throw new Error("owner must be a string");
  if (!name || typeof name !== "string")
    throw new Error("name must be a string");
  if (_orgsV2.has(id)) throw new Error(`org ${id} already exists`);
  const org = {
    id,
    owner,
    name,
    maturity: "provisional",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    metadata: { ...metadata },
  };
  _orgsV2.set(id, org);
  return _copyOrgV2(org);
}

export function getOrgV2(id) {
  const o = _orgsV2.get(id);
  return o ? _copyOrgV2(o) : null;
}

export function listOrgsV2({ owner, maturity } = {}) {
  const out = [];
  for (const o of _orgsV2.values()) {
    if (owner && o.owner !== owner) continue;
    if (maturity && o.maturity !== maturity) continue;
    out.push(_copyOrgV2(o));
  }
  return out;
}

export function setOrgMaturityV2(id, next, { now = Date.now() } = {}) {
  const o = _orgsV2.get(id);
  if (!o) throw new Error(`org ${id} not found`);
  if (!ORG_TRANSITIONS_V2.has(next))
    throw new Error(`unknown org maturity: ${next}`);
  if (ORG_TERMINALS_V2.has(o.maturity))
    throw new Error(`org ${id} is in terminal state ${o.maturity}`);
  const allowed = ORG_TRANSITIONS_V2.get(o.maturity);
  if (!allowed.has(next))
    throw new Error(`cannot transition org from ${o.maturity} to ${next}`);
  if (next === "active") {
    if (o.maturity === "provisional") {
      const count = getActiveOrgCountV2(o.owner);
      if (count >= _maxActiveOrgsPerOwnerV2)
        throw new Error(
          `owner ${o.owner} already at active-org cap (${_maxActiveOrgsPerOwnerV2})`,
        );
    }
    if (!o.activatedAt) o.activatedAt = now;
  }
  o.maturity = next;
  o.lastSeenAt = now;
  return _copyOrgV2(o);
}

export function activateOrgV2(id, opts) {
  return setOrgMaturityV2(id, "active", opts);
}
export function suspendOrgV2(id, opts) {
  return setOrgMaturityV2(id, "suspended", opts);
}
export function archiveOrgV2(id, opts) {
  return setOrgMaturityV2(id, "archived", opts);
}

export function touchOrgV2(id, { now = Date.now() } = {}) {
  const o = _orgsV2.get(id);
  if (!o) throw new Error(`org ${id} not found`);
  o.lastSeenAt = now;
  return _copyOrgV2(o);
}

export function inviteMemberV2(
  id,
  { orgId, userId, role = "member", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!orgId || typeof orgId !== "string")
    throw new Error("orgId must be a string");
  if (!userId || typeof userId !== "string")
    throw new Error("userId must be a string");
  if (!_orgsV2.has(orgId)) throw new Error(`org ${orgId} not found`);
  if (_membersV2.has(id)) throw new Error(`member ${id} already exists`);
  const member = {
    id,
    orgId,
    userId,
    role,
    status: "invited",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    departedAt: null,
    metadata: { ...metadata },
  };
  _membersV2.set(id, member);
  return _copyMemberV2(member);
}

export function getMemberV2(id) {
  const m = _membersV2.get(id);
  return m ? _copyMemberV2(m) : null;
}

export function listMembersV2({ orgId, status } = {}) {
  const out = [];
  for (const m of _membersV2.values()) {
    if (orgId && m.orgId !== orgId) continue;
    if (status && m.status !== status) continue;
    out.push(_copyMemberV2(m));
  }
  return out;
}

export function setMemberStatusV2(id, next, { now = Date.now() } = {}) {
  const m = _membersV2.get(id);
  if (!m) throw new Error(`member ${id} not found`);
  if (!MEMBER_TRANSITIONS_V2.has(next))
    throw new Error(`unknown member status: ${next}`);
  if (MEMBER_TERMINALS_V2.has(m.status))
    throw new Error(`member ${id} is in terminal state ${m.status}`);
  const allowed = MEMBER_TRANSITIONS_V2.get(m.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition member from ${m.status} to ${next}`);
  if (next === "active" && m.status === "invited") {
    const count = getActiveMemberCountV2(m.orgId);
    if (count >= _maxActiveMembersPerOrgV2)
      throw new Error(
        `org ${m.orgId} already at active-member cap (${_maxActiveMembersPerOrgV2})`,
      );
    if (!m.activatedAt) m.activatedAt = now;
  }
  if (MEMBER_TERMINALS_V2.has(next) && !m.departedAt) m.departedAt = now;
  m.status = next;
  m.lastSeenAt = now;
  return _copyMemberV2(m);
}

export function activateMemberV2(id, opts) {
  return setMemberStatusV2(id, "active", opts);
}
export function suspendMemberV2(id, opts) {
  return setMemberStatusV2(id, "suspended", opts);
}
export function revokeMemberV2(id, opts) {
  return setMemberStatusV2(id, "revoked", opts);
}
export function departMemberV2(id, opts) {
  return setMemberStatusV2(id, "departed", opts);
}

export function autoArchiveIdleOrgsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const o of _orgsV2.values()) {
    if (o.maturity === "archived") continue;
    if (o.maturity === "provisional") continue;
    if (now - o.lastSeenAt > _orgIdleMsV2) {
      o.maturity = "archived";
      o.lastSeenAt = now;
      flipped.push(_copyOrgV2(o));
    }
  }
  return flipped;
}

export function autoRevokeStaleInvitesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const m of _membersV2.values()) {
    if (m.status !== "invited") continue;
    if (now - m.lastSeenAt > _inviteStaleMsV2) {
      m.status = "revoked";
      m.lastSeenAt = now;
      if (!m.departedAt) m.departedAt = now;
      flipped.push(_copyMemberV2(m));
    }
  }
  return flipped;
}

export function getOrgManagerStatsV2() {
  const orgsByMaturity = {};
  for (const v of Object.values(ORG_MATURITY_V2)) orgsByMaturity[v] = 0;
  for (const o of _orgsV2.values()) orgsByMaturity[o.maturity] += 1;

  const membersByStatus = {};
  for (const v of Object.values(MEMBER_LIFECYCLE_V2)) membersByStatus[v] = 0;
  for (const m of _membersV2.values()) membersByStatus[m.status] += 1;

  return {
    totalOrgsV2: _orgsV2.size,
    totalMembersV2: _membersV2.size,
    maxActiveOrgsPerOwner: _maxActiveOrgsPerOwnerV2,
    maxActiveMembersPerOrg: _maxActiveMembersPerOrgV2,
    orgIdleMs: _orgIdleMsV2,
    inviteStaleMs: _inviteStaleMsV2,
    orgsByMaturity,
    membersByStatus,
  };
}

export function _resetStateOrgManagerV2() {
  _orgsV2.clear();
  _membersV2.clear();
  _maxActiveOrgsPerOwnerV2 = ORG_DEFAULT_MAX_ACTIVE_ORGS_PER_OWNER;
  _maxActiveMembersPerOrgV2 = ORG_DEFAULT_MAX_ACTIVE_MEMBERS_PER_ORG;
  _orgIdleMsV2 = ORG_DEFAULT_ORG_IDLE_MS;
  _inviteStaleMsV2 = ORG_DEFAULT_INVITE_STALE_MS;
}
