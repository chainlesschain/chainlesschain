import { validateApprovalDecision } from "./app-server/protocol.js";

export const REMOTE_APPROVAL_DECISION_CAPABILITY = "approval-decision-v1";

const LEGACY_TRUE = new Set([true, "true", "yes"]);
const LEGACY_FALSE = new Set([false, "false", "no"]);

function parseLegacyValue(value) {
  if (LEGACY_TRUE.has(value)) return true;
  if (LEGACY_FALSE.has(value)) return false;
  return null;
}

function invalid(reason) {
  return Object.freeze({ ok: false, reason });
}

/**
 * Normalize a remote approval response at the transport boundary.
 *
 * New clients send a canonical ApprovalDecision plus the N-1 boolean
 * projection. Legacy clients may still send only answer/approved. Remote
 * binary approval UIs cannot safely review scoped grants, so only acceptOnce
 * and decline are admitted here.
 */
export function normalizeRemoteApprovalDecision(
  event,
  { requireCanonical = false } = {},
) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return invalid("decision-required");
  }

  const hasCanonical = Object.prototype.hasOwnProperty.call(event, "decision");
  let canonicalApproved = null;
  let canonicalKind = null;
  if (hasCanonical) {
    const validation = validateApprovalDecision(event.decision);
    if (!validation.ok) return invalid("canonical-decision-invalid");
    canonicalKind = event.decision.kind;
    if (canonicalKind === "acceptOnce") canonicalApproved = true;
    else if (canonicalKind === "decline") canonicalApproved = false;
    else return invalid("remote-decision-kind-not-supported");
  } else if (requireCanonical) {
    return invalid("canonical-decision-required");
  }

  const legacyValues = [];
  for (const field of ["answer", "approved"]) {
    const value = event[field];
    // Preserve the old `answer ?? approved` behavior for a null answer.
    if (value === null || value === undefined) continue;
    const parsed = parseLegacyValue(value);
    if (parsed === null) return invalid("legacy-decision-invalid");
    legacyValues.push(parsed);
  }
  if (legacyValues.some((value) => value !== legacyValues[0])) {
    return invalid("legacy-decision-conflict");
  }
  const legacyApproved = legacyValues.length > 0 ? legacyValues[0] : null;

  if (canonicalApproved === null && legacyApproved === null) {
    return invalid("decision-required");
  }
  if (
    canonicalApproved !== null &&
    legacyApproved !== null &&
    canonicalApproved !== legacyApproved
  ) {
    return invalid("canonical-legacy-decision-conflict");
  }

  return Object.freeze({
    ok: true,
    approved: canonicalApproved ?? legacyApproved,
    kind: canonicalKind || (legacyApproved === true ? "acceptOnce" : "decline"),
    canonical: hasCanonical,
  });
}

export function requireRemoteApprovalDecision(event, options) {
  const result = normalizeRemoteApprovalDecision(event, options);
  if (!result.ok) {
    throw new TypeError(`Invalid remote approval decision: ${result.reason}`);
  }
  return result;
}
