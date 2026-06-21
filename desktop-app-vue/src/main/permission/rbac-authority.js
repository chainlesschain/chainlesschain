/**
 * rbac-authority — authorization gate for privileged RBAC-engine IPC ops.
 *
 * The sender-guard + actor-identity layers established WHO is acting (a trusted
 * frame, the authenticated DID). This layer answers MAY they: before an actor
 * grants/overrides another user's permissions, require that the actor actually
 * has authority in the target org. Without this, any authenticated user could
 * grant themselves (or anyone) permissions in any org — privilege escalation.
 *
 * Authority model (mirrors organization/permission-middleware's
 * `requireRole(["owner","admin"])`): the actor must be an org member with role
 * owner/admin, or the org's owner_did. The org creator is auto-added as an
 * "owner" member at creation (organization-manager), so there is no bootstrap
 * lockout — the owner can always manage and can promote admins.
 *
 * Authority is resolved by a direct read of organization_members /
 * organizations (the handlers already hold `db`), so no cross-subsystem manager
 * injection is needed. The actor defaults to the authenticated current user
 * (current-user-context), composing with the actor-identity layer.
 *
 * Gated rollout (mirrors the other guards), via `CC_IPC_RBAC_GUARD`:
 *   - unset / "report" → DEFAULT: log would-deny but ALLOW (zero behavior
 *     change). Authorization can falsely deny if an org's membership rows are
 *     shaped unexpectedly, so observe report logs (no `[rbac-guard] would-deny`
 *     for legit admins) before enforcing.
 *   - "enforce" / "1" → throw when the actor lacks authority.
 *   - "0" / "off"     → disabled.
 *
 * @module permission/rbac-authority
 */
const { logger } = require("../utils/logger.js");
const { getCurrentUserDid } = require("./current-user-context.js");

const MANAGE_ROLES = new Set(["owner", "admin"]);

function resolveRbacMode() {
  const v = String(process.env.CC_IPC_RBAC_GUARD || "").toLowerCase();
  if (v === "0" || v === "off" || v === "false" || v === "disable") {
    return "off";
  }
  if (v === "enforce" || v === "1" || v === "block" || v === "true") {
    return "enforce";
  }
  if (v === "report" || v === "audit" || v === "warn") {
    return "report";
  }
  // ENFORCE-FLIP POINT — the unset default. Change to "enforce" once report logs
  // confirm legit owners/admins pass; "report"/"audit" above stays the opt-out.
  // Procedure: docs/internal/ipc-security-guards-runbook.md.
  return "report";
}

/** The actor's active membership role in the org, or null if not a member.
 * Throws on a real db error so the caller can distinguish "not a member"
 * (null → deny) from "can't verify" (throw → fail-open). */
function actorOrgRole(db, orgId, actorDid) {
  const row = db
    .prepare(
      "SELECT role FROM organization_members WHERE org_id = ? AND member_did = ? AND status = 'active'",
    )
    .get(orgId, actorDid);
  return row && row.role ? row.role : null;
}

/** Is the actor the org's owner_did? (belt-and-suspenders vs membership row.)
 * Throws on a real db error (see actorOrgRole). */
function isOrgOwner(db, orgId, actorDid) {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM organizations WHERE org_id = ? AND owner_did = ?",
    )
    .get(orgId, actorDid);
  return !!row;
}

const _warned = new Set();

/**
 * Require that the actor may manage permissions in the target org.
 * @param {object} db - better-sqlite3 db (raw, from getDatabase())
 * @param {object} opts
 * @param {string} opts.orgId    - target org (no orgId → out of role scope, allowed)
 * @param {string} opts.channel  - IPC channel (logs)
 * @param {string} [opts.actorDid] - actor (defaults to authenticated current user)
 * @param {() => string} [opts.getMode] - mode override (tests)
 * @returns {boolean} true if allowed to proceed; throws in enforce when denied.
 */
function requireOrgManageAuthority(db, opts = {}) {
  const { orgId, channel = "?", actorDid, getMode = resolveRbacMode } = opts;
  const mode = getMode();
  if (mode === "off") {
    return true;
  }

  const actor = actorDid || getCurrentUserDid();

  let authorized = false;
  let reason;
  if (!actor) {
    reason = "no-actor";
  } else if (!orgId) {
    // No org scope to role-check against (e.g. personal/global grant) — don't
    // block; org-scoped escalation (the threat) always carries an orgId.
    return true;
  } else {
    try {
      const role = actorOrgRole(db, orgId, actor);
      authorized =
        (role && MANAGE_ROLES.has(role)) || isOrgOwner(db, orgId, actor);
      reason = authorized ? "ok" : `role=${role || "none"}`;
    } catch (err) {
      // Couldn't determine authority → fail OPEN (never brick on a guard bug).
      logger.error(
        `[rbac-guard] authority check error for "${channel}" (allowing): ${err && err.message}`,
      );
      return true;
    }
  }

  if (authorized) {
    return true;
  }

  const blocking = mode === "enforce";
  const key = `${channel}:${reason}`;
  if (blocking || !_warned.has(key)) {
    _warned.add(key);
    logger.warn(
      `[rbac-guard] ${blocking ? "DENIED" : "would-deny"} "${channel}": ` +
        `actor not authorized to manage org permissions (${reason})`,
    );
  }
  if (blocking) {
    throw new Error(
      `[rbac-guard] not authorized to manage permissions for "${channel}" (${reason})`,
    );
  }
  return true; // report: allow
}

/**
 * Authority gate for revoke (the org isn't in params — look it up from the
 * grant being revoked). Unknown grant → allow (revoke will no-op naturally);
 * db error → fail open.
 */
function requireOrgManageAuthorityForGrant(db, opts = {}) {
  const { grantId, channel = "?", actorDid, getMode = resolveRbacMode } = opts;
  if (getMode() === "off") {
    return true;
  }
  let orgId;
  try {
    const row = db
      .prepare("SELECT org_id FROM permission_grants WHERE id = ?")
      .get(grantId);
    if (!row) {
      return true;
    } // grant not found → let the op no-op, don't add auth noise
    orgId = row.org_id;
  } catch (err) {
    logger.error(
      `[rbac-guard] grant-org lookup error for "${channel}" (allowing): ${err && err.message}`,
    );
    return true; // fail open
  }
  return requireOrgManageAuthority(db, { orgId, channel, actorDid, getMode });
}

/**
 * Authority gate for team management (team:add-member): the team's org isn't in
 * params — look it up from org_teams, then require owner/admin of that org.
 * Unknown team → allow (op no-ops naturally); db error → fail open.
 */
function requireOrgManageAuthorityForTeam(db, opts = {}) {
  const { teamId, channel = "?", actorDid, getMode = resolveRbacMode } = opts;
  if (getMode() === "off") {
    return true;
  }
  let orgId;
  try {
    const row = db
      .prepare("SELECT org_id FROM org_teams WHERE id = ?")
      .get(teamId);
    if (!row) {
      return true;
    } // team not found → let the op no-op
    orgId = row.org_id;
  } catch (err) {
    logger.error(
      `[rbac-guard] team-org lookup error for "${channel}" (allowing): ${err && err.message}`,
    );
    return true; // fail open
  }
  return requireOrgManageAuthority(db, { orgId, channel, actorDid, getMode });
}

/**
 * Authority gate for a batch of grants — every distinct target org must be
 * manageable by the actor. Denies (enforce) if ANY org is unauthorized.
 */
function requireOrgManageAuthorityForGrants(db, opts = {}) {
  const { grants, channel = "?", actorDid, getMode = resolveRbacMode } = opts;
  if (getMode() === "off") {
    return true;
  }
  const orgIds = new Set(
    (Array.isArray(grants) ? grants : [])
      .map((g) => g && g.orgId)
      .filter(Boolean),
  );
  for (const orgId of orgIds) {
    requireOrgManageAuthority(db, { orgId, channel, actorDid, getMode });
  }
  return true;
}

/**
 * Authority gate for delegation — a delegator may only delegate permissions they
 * actually HOLD (a non-admin can delegate their own perms; nobody can delegate
 * what they lack). Distinct from owner/admin management authority.
 * @param {object} engine - PermissionEngine (has async checkPermission)
 * @returns {Promise<boolean>} throws in enforce when delegating an unheld perm.
 */
async function requireCanDelegate(engine, opts = {}) {
  const {
    orgId,
    delegatorDid,
    permissions,
    resourceScope,
    channel = "perm:delegate-permissions",
    getMode = resolveRbacMode,
  } = opts;
  const mode = getMode();
  if (mode === "off") {
    return true;
  }
  const actor = delegatorDid || getCurrentUserDid();
  const perms = Array.isArray(permissions) ? permissions : [];
  if (!actor || perms.length === 0) {
    // Can't meaningfully check (no actor / nothing to delegate) — report logs,
    // enforce refuses an actor-less privileged delegation.
    if (!actor && mode === "enforce") {
      throw new Error(
        `[rbac-guard] no authenticated delegator for "${channel}"`,
      );
    }
    return true;
  }
  const rt = (resourceScope && resourceScope.resourceType) || "*";
  const rid = (resourceScope && resourceScope.resourceId) || null;
  for (const permission of perms) {
    let held = false;
    try {
      const res = await engine.checkPermission({
        userDid: actor,
        orgId,
        resourceType: rt,
        resourceId: rid,
        permission,
      });
      held = !!(res && res.hasPermission);
    } catch (err) {
      logger.error(
        `[rbac-guard] delegate check error for "${channel}" perm=${permission} (allowing): ${err && err.message}`,
      );
      return true; // fail open
    }
    if (!held) {
      const blocking = mode === "enforce";
      const key = `${channel}:lacks:${permission}`;
      if (blocking || !_warned.has(key)) {
        _warned.add(key);
        logger.warn(
          `[rbac-guard] ${blocking ? "DENIED" : "would-deny"} "${channel}": ` +
            `delegator does not hold permission "${permission}"`,
        );
      }
      if (blocking) {
        throw new Error(
          `[rbac-guard] cannot delegate unheld permission "${permission}" for "${channel}"`,
        );
      }
    }
  }
  return true;
}

module.exports = {
  requireOrgManageAuthority,
  requireOrgManageAuthorityForGrant,
  requireOrgManageAuthorityForGrants,
  requireOrgManageAuthorityForTeam,
  requireCanDelegate,
  resolveRbacMode,
  // exported for tests
  _actorOrgRole: actorOrgRole,
  _isOrgOwner: isOrgOwner,
  MANAGE_ROLES,
};
