/**
 * Background-agent phase vocabulary + dashboard grouping (P0 state-machine
 * slice — CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12 §"后台 Agent
 * 状态机").
 *
 * A session has two orthogonal axes:
 *   - `status` — running | completed | failed | stopped | lost — owned by the
 *     supervisor's liveness reconciliation.
 *   - `phase`  — the live sub-state WHILE running, persisted by the worker.
 *
 * Historically the worker only emitted "turn" (a turn is executing) and
 * "idle" (between turns, transport open), and the dashboard mislabeled *idle*
 * as "Needs input" — so an agent that had simply finished a turn and was
 * parked shouted for attention it didn't need. Claude-Code's Agent View keeps
 * these distinct (Working / Needs input / Idle / …).
 *
 * This module is the single source of truth that (a) names the fuller phase
 * vocabulary the runtime is growing into and (b) classifies a session into a
 * dashboard group, crucially separating `idle` (finished a turn, nothing
 * blocking) from a genuine *needs-input* state (a human decision — a question
 * or a pending permission — is blocking progress). Pure + zero-dependency so
 * the worker, the supervisor and the REPL dashboard can all share it without a
 * worker ever importing UI code.
 */

/**
 * Canonical running sub-phases. `working`/`idle` are the steady states;
 * `needs_input`/`waiting_permission` mark a turn that cannot advance without a
 * human. `starting` is the brief pre-first-turn window.
 */
export const BACKGROUND_AGENT_PHASES = Object.freeze({
  STARTING: "starting",
  WORKING: "working",
  IDLE: "idle",
  NEEDS_INPUT: "needs_input",
  WAITING_PERMISSION: "waiting_permission",
});

/**
 * Aliases accepted from producers / older state schemas → canonical phase.
 * The legacy worker emits "turn" for a live turn; map it to `working` so old
 * on-disk states and new ones classify identically. Kebab and *_approval
 * spellings are tolerated because different producers naturally reach for
 * different casing.
 */
const PHASE_ALIASES = new Map([
  ["turn", BACKGROUND_AGENT_PHASES.WORKING],
  ["working", BACKGROUND_AGENT_PHASES.WORKING],
  ["starting", BACKGROUND_AGENT_PHASES.STARTING],
  ["idle", BACKGROUND_AGENT_PHASES.IDLE],
  ["needs_input", BACKGROUND_AGENT_PHASES.NEEDS_INPUT],
  ["needs-input", BACKGROUND_AGENT_PHASES.NEEDS_INPUT],
  ["awaiting_input", BACKGROUND_AGENT_PHASES.NEEDS_INPUT],
  ["question", BACKGROUND_AGENT_PHASES.NEEDS_INPUT],
  ["waiting_permission", BACKGROUND_AGENT_PHASES.WAITING_PERMISSION],
  ["waiting-permission", BACKGROUND_AGENT_PHASES.WAITING_PERMISSION],
  ["waiting_approval", BACKGROUND_AGENT_PHASES.WAITING_PERMISSION],
  ["awaiting_approval", BACKGROUND_AGENT_PHASES.WAITING_PERMISSION],
]);

/**
 * Normalize a raw phase value to a canonical phase, or null when absent /
 * unrecognized (callers treat null as "no declared phase"). Never throws.
 */
export function normalizeBackgroundAgentPhase(value) {
  if (typeof value !== "string") return null;
  return PHASE_ALIASES.get(value.trim().toLowerCase()) || null;
}

/** Phases where a human decision is blocking progress → "Needs input". */
const BLOCKING_PHASES = new Set([
  BACKGROUND_AGENT_PHASES.NEEDS_INPUT,
  BACKGROUND_AGENT_PHASES.WAITING_PERMISSION,
]);

/**
 * Dashboard group for a session. Running sessions split by phase:
 *   - a pending approval OR a blocking phase (needs_input / waiting_permission)
 *     → "needs-input" (a human decision unblocks it)
 *   - "idle" (finished a turn, transport open, available but nothing blocking)
 *     → "idle"
 *   - everything else (working / turn / starting / unknown) → "working"
 * Terminal statuses map to their own groups; lost/unknown → "failed".
 *
 * `pendingApprovals` wins over `phase` because an approval that is genuinely
 * pending blocks progress regardless of the phase label the worker last wrote.
 */
export function phaseGroupKey(session) {
  const status = session?.status;
  if (status === "running") {
    if (Number(session?.pendingApprovals) > 0) return "needs-input";
    const phase = normalizeBackgroundAgentPhase(session?.phase);
    if (BLOCKING_PHASES.has(phase)) return "needs-input";
    if (phase === BACKGROUND_AGENT_PHASES.IDLE) return "idle";
    return "working";
  }
  if (status === "completed") return "completed";
  if (status === "stopped") return "stopped";
  return "failed"; // failed | lost | unknown
}
