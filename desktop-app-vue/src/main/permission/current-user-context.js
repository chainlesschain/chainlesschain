/**
 * current-user-context — authoritative "who is the current user" for the main
 * process, used to harden privileged IPC handlers that today trust a
 * renderer-supplied actor field (grantedBy / revokedBy / delegatorDid / userDID).
 *
 * Problem (memory `desktop_main_ipc_security_findings_2026_06_20`, findings #2-#4):
 * a renderer can call perm:grant-permission with grantedBy="some-admin-did" and
 * the handler records the grant as if that admin performed it — identity spoofing,
 * because the actor is taken from params and never checked against who is actually
 * unlocked. The authoritative source is the main-process DID manager's
 * `getCurrentIdentity()` (the unlocked/default identity); the renderer cannot
 * forge that.
 *
 * The provider is injected (index.js owns didManager) to avoid threading it
 * through the phase loader. Consumers call `resolveActorDid(claimed, …)`.
 *
 * Gated rollout (mirrors ipc-sender-guard), via `CC_IPC_ACTOR_GUARD`:
 *   - unset / "report" → DEFAULT: log anomalies (claimed actor != authenticated,
 *     or no unlocked user) but return the claimed value UNCHANGED — zero
 *     behavior change, so the logs reveal whether "actor == current user" always
 *     holds before we enforce.
 *   - "enforce" / "1"  → return the AUTHENTICATED did (override a mismatched
 *     claim); throw on a privileged action when no user is unlocked.
 *   - "0" / "off"      → disabled (return claimed verbatim).
 *
 * @module permission/current-user-context
 */
const { logger } = require("../utils/logger.js");

let _provider = null;

/** Inject the source of the current user's DID (index.js → didManager). */
function setCurrentUserProvider(fn) {
  _provider = typeof fn === "function" ? fn : null;
}

/** @returns {string|null} the unlocked user's DID, or null if none/unknown. */
function getCurrentUserDid() {
  if (!_provider) {
    return null;
  }
  try {
    const did = _provider();
    return typeof did === "string" && did ? did : null;
  } catch (err) {
    logger.error(
      "[actor-guard] current-user provider error:",
      err && err.message,
    );
    return null;
  }
}

function resolveActorMode() {
  const v = String(process.env.CC_IPC_ACTOR_GUARD || "").toLowerCase();
  if (v === "0" || v === "off" || v === "false" || v === "disable") {
    return "off";
  }
  if (v === "enforce" || v === "1" || v === "block" || v === "true") {
    return "enforce";
  }
  return "report";
}

/** DIDs are public identifiers, but keep logs short + tidy. */
function redact(did) {
  if (typeof did !== "string" || !did) {
    return "<none>";
  }
  return did.length > 22 ? `${did.slice(0, 22)}…` : did;
}

const _warned = new Set();
function warnOnce(key, msg) {
  if (_warned.has(key)) {
    return;
  }
  _warned.add(key);
  logger.warn(msg);
}

/**
 * Resolve the authoritative actor DID for a privileged action.
 * @param {*} claimed - renderer-supplied actor (grantedBy/userDID/delegatorDid/…)
 * @param {object} [opts]
 * @param {string} [opts.field]   - field name (for logs)
 * @param {string} [opts.channel] - IPC channel (for logs)
 * @param {() => string} [opts.getMode] - mode override (tests)
 * @returns {*} the DID to use as the actor (report: claimed verbatim; enforce:
 *   the authenticated DID; off: claimed verbatim). Throws in enforce when a
 *   privileged action is attempted with no unlocked user.
 */
function resolveActorDid(claimed, opts = {}) {
  const { field = "actor", channel = "?", getMode = resolveActorMode } = opts;
  const mode = getMode();
  if (mode === "off") {
    return claimed;
  }

  const cur = getCurrentUserDid();

  if (!cur) {
    if (mode === "enforce") {
      throw new Error(
        `[actor-guard] no authenticated user; refusing privileged "${channel}" (${field})`,
      );
    }
    warnOnce(
      `${channel}:${field}:no-user`,
      `[actor-guard] would-block "${channel}": no authenticated user ` +
        `(report mode — using claimed ${field}=${redact(claimed)})`,
    );
    return claimed; // report / off: no behavior change
  }

  const claimedStr = typeof claimed === "string" && claimed ? claimed : null;
  if (claimedStr && claimedStr !== cur) {
    if (mode === "enforce") {
      logger.warn(
        `[actor-guard] OVERRIDE "${channel}" ${field}: claimed ${redact(claimedStr)} → authenticated ${redact(cur)}`,
      );
      return cur;
    }
    warnOnce(
      `${channel}:${field}:mismatch`,
      `[actor-guard] would-override "${channel}" ${field}: claimed ` +
        `${redact(claimedStr)} != authenticated ${redact(cur)} (report mode)`,
    );
    return claimed; // report: verbatim, no behavior change
  }

  // claimed matches, or is absent: enforce fills in the authenticated did;
  // report returns claimed verbatim (which may be the same, or absent).
  if (mode === "enforce") {
    return cur;
  }
  return claimed;
}

module.exports = {
  setCurrentUserProvider,
  getCurrentUserDid,
  resolveActorDid,
  resolveActorMode,
};
