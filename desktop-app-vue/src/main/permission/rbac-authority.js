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

module.exports = {
  requireOrgManageAuthority,
  resolveRbacMode,
  // exported for tests
  _actorOrgRole: actorOrgRole,
  _isOrgOwner: isOrgOwner,
  MANAGE_ROLES,
};
