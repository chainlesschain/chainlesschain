"use strict";

const { randomUUID } = require("node:crypto");
const { createBoardReadCheck } = require("../task/board-read-authority");

function deny(code = "ORG_ROLE_WRITE_DENIED") {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function text(value, limit = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    deny("ORG_ROLE_INVALID_REQUEST");
  return value;
}
function permissions(value) {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((p) => typeof p !== "string" || !p || p.length > 128)
  )
    deny("ORG_ROLE_INVALID_REQUEST");
  return [...new Set(value)];
}
function parsePermissions(raw) {
  try {
    return permissions(JSON.parse(raw));
  } catch {
    deny();
  }
}
function permits(held, permission) {
  return held.some(
    (p) =>
      p === "*" ||
      p === permission ||
      (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))),
  );
}

// These mutations deliberately use synchronous SQL, including the audit record.
// Legacy managers await identity/permission providers before writing and cannot
// supply the same transaction boundary. No renderer actor is accepted here.
function executeOrganizationRoleWrite(
  database,
  event,
  action,
  params,
  dependencies = {},
) {
  const required = {
    create: "role.create",
    update: "role.manage",
    delete: "role.delete",
    assign: "member.manage",
    invite: "member.invite",
  }[action];
  if (
    !required ||
    !params ||
    typeof params !== "object" ||
    Array.isArray(params)
  )
    deny("ORG_ROLE_INVALID_REQUEST");
  const db = database?.getDatabase ? database.getDatabase() : database;
  if (!db?.prepare || !db?.exec) deny();
  let role =
    action === "update" || action === "delete"
      ? db
          .prepare("SELECT * FROM organization_roles WHERE id=?")
          .get(text(params.roleId))
      : null;
  const orgId = role?.org_id || params.orgId;
  if ((action === "update" || action === "delete") && !role) deny();
  text(orgId);
  const getActor =
    dependencies.getActor ||
    require("../task/project-goal-auth-session").getProjectGoalActor;
  const actor = getActor();
  let checkSession;
  try {
    checkSession = createBoardReadCheck(
      database,
      event,
      { orgId },
      dependencies,
    );
  } catch {
    deny();
  }
  const authority = () => {
    try {
      checkSession();
    } catch {
      deny();
    }
    if (getActor() !== actor) deny();
    const row = db
      .prepare(
        "SELECT m.role, r.permissions, o.owner_did FROM organization_members m JOIN organization_info o ON o.org_id=m.org_id JOIN organization_roles r ON r.org_id=m.org_id AND r.name=m.role WHERE m.org_id=? AND m.member_did=? AND m.status='active'",
      )
      .get(orgId, actor);
    const held = parsePermissions(row?.permissions);
    if (row.role === "owner" && row.owner_did !== actor) deny();
    if (!permits(held, required)) deny();
    return { held, owner: row.owner_did === actor && row.role === "owner" };
  };
  authority();
  const savepoint = `org_role_${randomUUID().replaceAll("-", "")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const auth = authority();
    if (role) {
      role = db
        .prepare("SELECT * FROM organization_roles WHERE id=? AND org_id=?")
        .get(params.roleId, orgId);
      if (!role) deny();
    }
    const now = Date.now();
    let result, targetId, metadata;
    const grantable = (values) => {
      const next = permissions(values);
      if (!auth.owner && next.some((p) => !permits(auth.held, p))) deny();
      return next;
    };
    if (action === "invite") {
      const data = params.inviteData;
      if (!data || typeof data !== "object" || Array.isArray(data))
        deny("ORG_ROLE_INVALID_REQUEST");
      const name = text(data.role || "member", 100);
      if (name === "owner") deny("ORG_ROLE_OWNER_PROTECTED");
      if (!["admin", "member", "viewer"].includes(name))
        deny("ORG_ROLE_INVALID_REQUEST");
      const targetRole = db
        .prepare(
          "SELECT permissions FROM organization_roles WHERE org_id=? AND name=?",
        )
        .get(orgId, name);
      if (!targetRole) deny();
      grantable(parsePermissions(targetRole.permissions));
      const maxUses = data.maxUses ?? 1,
        expireAt = data.expireAt ?? null;
      if (
        !Number.isSafeInteger(maxUses) ||
        maxUses < 1 ||
        maxUses > 10000 ||
        (expireAt !== null &&
          (!Number.isSafeInteger(expireAt) || expireAt <= now))
      )
        deny("ORG_ROLE_INVALID_REQUEST");
      targetId = randomUUID();
      const code = randomUUID().replaceAll("-", "");
      db.prepare(
        "INSERT INTO organization_invitations (id,org_id,invite_code,invited_by,role,max_uses,used_count,expire_at,created_at) VALUES (?,?,?,?,?,?,0,?,?)",
      ).run(targetId, orgId, code, actor, name, maxUses, expireAt, now);
      result = {
        id: targetId,
        org_id: orgId,
        invite_code: code,
        invited_by: actor,
        role: name,
        max_uses: maxUses,
        used_count: 0,
        expire_at: expireAt,
        created_at: now,
      };
      metadata = { role: name, maxUses, expireAt };
    } else if (action === "create") {
      const data = params.roleData;
      if (!data || typeof data !== "object" || Array.isArray(data))
        deny("ORG_ROLE_INVALID_REQUEST");
      const name = text(data.name, 100);
      if (["owner", "admin", "member", "viewer"].includes(name))
        deny("ORG_ROLE_BUILTIN_PROTECTED");
      const next = grantable(data.permissions);
      targetId = randomUUID();
      db.prepare(
        "INSERT INTO organization_roles (id,org_id,name,description,permissions,is_builtin,created_at) VALUES (?,?,?,?,?,0,?)",
      ).run(
        targetId,
        orgId,
        name,
        data.description || "",
        JSON.stringify(next),
        now,
      );
      result = {
        id: targetId,
        org_id: orgId,
        name,
        description: data.description || "",
        permissions: next,
        is_builtin: 0,
        created_at: now,
      };
      metadata = { roleName: name, permissions: next };
    } else if (action === "update") {
      const updates = params.updates;
      if (!updates || typeof updates !== "object" || Array.isArray(updates))
        deny("ORG_ROLE_INVALID_REQUEST");
      const keys = Object.keys(updates);
      let name = role.name,
        description = role.description,
        next = parsePermissions(role.permissions);
      if (role.is_builtin) {
        // Production membership has a four-role CHECK. Explicit owner-only board
        // configuration makes grants usable without silently migrating that table.
        if (!auth.owner || keys.length !== 1 || keys[0] !== "boardPermissions")
          deny("ORG_ROLE_BUILTIN_PROTECTED");
        const board = permissions(updates.boardPermissions);
        if (
          board.some(
            (p) => !/^board\.(?:[a-z][a-z-]*\.)*(?:[a-z][a-z-]*|\*)$/.test(p),
          )
        )
          deny("ORG_ROLE_INVALID_REQUEST");
        next = [...next.filter((p) => !p.startsWith("board.")), ...board];
      } else {
        if (
          keys.some((k) => !["name", "description", "permissions"].includes(k))
        )
          deny("ORG_ROLE_INVALID_REQUEST");
        if (updates.name !== undefined) {
          name = text(updates.name, 100);
          if (["owner", "admin", "member", "viewer"].includes(name))
            deny("ORG_ROLE_BUILTIN_PROTECTED");
          // Renaming a role with members could silently change their authority.
          if (
            name !== role.name &&
            db
              .prepare(
                "SELECT 1 FROM organization_members WHERE org_id=? AND role=? LIMIT 1",
              )
              .get(orgId, role.name)
          )
            deny("ORG_ROLE_IN_USE");
        }
        if (updates.description !== undefined)
          description = updates.description;
        if (updates.permissions !== undefined)
          next = grantable(updates.permissions);
      }
      targetId = role.id;
      if (
        db
          .prepare(
            "UPDATE organization_roles SET name=?,description=?,permissions=? WHERE id=? AND org_id=?",
          )
          .run(name, description ?? "", JSON.stringify(next), role.id, orgId)
          .changes !== 1
      )
        deny();
      result = { ...role, name, description, permissions: next };
      metadata = { roleName: name, permissions: next };
    } else if (action === "delete") {
      if (role.is_builtin) deny("ORG_ROLE_BUILTIN_PROTECTED");
      if (
        db
          .prepare(
            "SELECT 1 FROM organization_members WHERE org_id=? AND role=? AND status='active' LIMIT 1",
          )
          .get(orgId, role.name)
      )
        deny("ORG_ROLE_IN_USE");
      targetId = role.id;
      if (
        db
          .prepare("DELETE FROM organization_roles WHERE id=? AND org_id=?")
          .run(role.id, orgId).changes !== 1
      )
        deny();
      result = { success: true };
      metadata = { roleName: role.name };
    } else {
      const memberDid = text(params.memberDID),
        newRole = text(params.newRole, 100);
      const member = db
        .prepare(
          "SELECT role FROM organization_members WHERE org_id=? AND member_did=? AND status='active'",
        )
        .get(orgId, memberDid);
      const targetRole = db
        .prepare(
          "SELECT permissions FROM organization_roles WHERE org_id=? AND name=?",
        )
        .get(orgId, newRole);
      const ownerDid = db
        .prepare("SELECT owner_did FROM organization_info WHERE org_id=?")
        .get(orgId)?.owner_did;
      if (!member || !targetRole) deny();
      if (
        (member.role === "owner" ||
          memberDid === ownerDid ||
          newRole === "owner") &&
        (memberDid !== ownerDid || newRole !== "owner")
      )
        deny("ORG_ROLE_OWNER_PROTECTED");
      const next = grantable(parsePermissions(targetRole.permissions));
      targetId = memberDid;
      if (
        db
          .prepare(
            "UPDATE organization_members SET role=?,permissions=? WHERE org_id=? AND member_did=? AND status='active'",
          )
          .run(newRole, JSON.stringify(next), orgId, memberDid).changes !== 1
      )
        deny();
      result = { success: true };
      metadata = { newRole };
    }
    db.prepare(
      "INSERT INTO organization_activities (id,org_id,actor_did,action,resource_type,resource_id,metadata,timestamp) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      orgId,
      actor,
      {
        create: "create_role",
        update: "update_role",
        delete: "delete_role",
        assign: "update_member_role",
        invite: "create_invitation",
      }[action],
      action === "assign"
        ? "member"
        : action === "invite"
          ? "invitation"
          : "role",
      targetId,
      JSON.stringify(metadata),
      now,
    );
    authority();
    db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

module.exports = { executeOrganizationRoleWrite };
