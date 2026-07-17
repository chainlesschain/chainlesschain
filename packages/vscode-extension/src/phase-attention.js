/**
 * Single source of truth for "is this background session blocked on a human?".
 *
 * The supervisor's phase reporter (CLI `background-agent-phase.js`) writes one
 * of a small set of blocking phases while a worker is parked — an approval
 * (`waiting_permission`), a question (`needs_input`), or, after a resume that
 * found irreversible ops with unknown outcome, `uncertain_side_effect`. Several
 * panel surfaces (summary cards, the Background Agents rows, the unified
 * Sessions Workbench sort/badge) each need the same verdict; deriving it in
 * three places let one surface silently miss a newly-added phase. This pure
 * predicate mirrors the CLI's alias table so every surface classifies alike.
 */

/** Producer spellings → canonical blocking phase (kebab / *_approval / legacy). */
const BLOCKING_PHASE_ALIASES = new Set([
  "needs_input",
  "needs-input",
  "awaiting_input",
  "question",
  "waiting_permission",
  "waiting-permission",
  "waiting_approval",
  "awaiting_approval",
  "uncertain_side_effect",
  "uncertain-side-effect",
]);

/**
 * True when a human decision is blocking progress: a genuinely pending approval
 * wins over any phase label; otherwise the (normalized) phase must be a known
 * blocking one. Never throws. Callers still gate on `status === "running"`.
 */
function isBlockingPhase(phase, pendingApprovals) {
  if (Number(pendingApprovals) > 0) return true;
  if (typeof phase !== "string") return false;
  const p = phase.trim().toLowerCase();
  return (
    BLOCKING_PHASE_ALIASES.has(p) || p.replace(/-/g, "_").includes("approval")
  );
}

module.exports = { isBlockingPhase, BLOCKING_PHASE_ALIASES };
