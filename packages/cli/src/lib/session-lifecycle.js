/**
 * Unified session lifecycle state machine (P0#4 "会话生命周期可靠性 —
 * 统一状态机" from CLAUDE_CODE_IDE_GAP_ANALYSIS.md).
 *
 * A running agent session is described by THREE divergent representations that
 * grew independently and disagree on vocabulary:
 *
 *   1. supervisor `status`  — running | completed | failed | stopped | lost
 *      (liveness reconciliation, owns the terminal verdict). See
 *      background-agent-supervisor.js.
 *   2. worker `phase`       — starting | working | idle | needs_input |
 *      waiting_permission (the live sub-state WHILE running). See
 *      [[background-agent-phase.js]].
 *   3. IDE connection state — starting | ready | running | disconnected |
 *      crashed (the transport/process view the VS Code / JetBrains panel keeps).
 *
 * None of the three alone can answer the question that matters on reconnect:
 * "is a dangerous tool call about to be silently retried?" The gap doc's P0#4
 * asks for ONE state machine — starting / ready / running / waitingApproval /
 * cancelling / disconnected / recovering / completed / failed / stopped — that
 * every producer folds into, so the supervisor, the IDE bridge and the resume
 * path reason about the same lifecycle.
 *
 * This module is that single source of truth. It is pure (no fs / process /
 * clock): `deriveSessionState` collapses the three axes into one canonical
 * state with a documented precedence, `canTransition` encodes the legal graph,
 * and `requiresIdempotencyGuard` marks the `recovering` window during which a
 * resumed session MUST re-check a dangerous tool's ledger before re-executing
 * (the "危险工具恢复时不得静默重试" invariant) rather than blindly replaying it.
 */

/**
 * The canonical unified lifecycle. camelCase mirrors the gap doc's wording.
 * `ready` is the parked/idle steady state (transport open, no active turn);
 * `running` is a live turn. The three terminal states are mutually exclusive
 * and absorbing.
 */
export const SESSION_STATES = Object.freeze({
  STARTING: "starting",
  READY: "ready",
  RUNNING: "running",
  WAITING_APPROVAL: "waitingApproval",
  CANCELLING: "cancelling",
  DISCONNECTED: "disconnected",
  RECOVERING: "recovering",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
});

const ALL_STATES = new Set(Object.values(SESSION_STATES));

/** Terminal (absorbing) states — a session can never leave one. */
const TERMINAL_STATES = new Set([
  SESSION_STATES.COMPLETED,
  SESSION_STATES.FAILED,
  SESSION_STATES.STOPPED,
]);

/**
 * Every vocabulary the three producers emit → canonical unified state. Callers
 * that hold a native representation (a supervisor status, a worker phase, an
 * IDE connection state) map it here before reasoning about the lifecycle.
 */
const STATE_ALIASES = new Map([
  // canonical
  ["starting", SESSION_STATES.STARTING],
  ["ready", SESSION_STATES.READY],
  ["running", SESSION_STATES.RUNNING],
  ["waitingapproval", SESSION_STATES.WAITING_APPROVAL],
  ["cancelling", SESSION_STATES.CANCELLING],
  ["disconnected", SESSION_STATES.DISCONNECTED],
  ["recovering", SESSION_STATES.RECOVERING],
  ["completed", SESSION_STATES.COMPLETED],
  ["failed", SESSION_STATES.FAILED],
  ["stopped", SESSION_STATES.STOPPED],
  // worker phase (background-agent-phase.js)
  ["working", SESSION_STATES.RUNNING],
  ["turn", SESSION_STATES.RUNNING],
  ["idle", SESSION_STATES.READY],
  ["needs_input", SESSION_STATES.WAITING_APPROVAL],
  ["needs-input", SESSION_STATES.WAITING_APPROVAL],
  ["awaiting_input", SESSION_STATES.WAITING_APPROVAL],
  ["question", SESSION_STATES.WAITING_APPROVAL],
  ["waiting_permission", SESSION_STATES.WAITING_APPROVAL],
  ["waiting-permission", SESSION_STATES.WAITING_APPROVAL],
  ["waiting_approval", SESSION_STATES.WAITING_APPROVAL],
  ["awaiting_approval", SESSION_STATES.WAITING_APPROVAL],
  // supervisor liveness — a running process that vanished is a failure.
  ["lost", SESSION_STATES.FAILED],
  // IDE connection / transport
  ["connected", SESSION_STATES.READY],
  ["reconnecting", SESSION_STATES.RECOVERING],
  ["resuming", SESSION_STATES.RECOVERING],
  ["reattaching", SESSION_STATES.RECOVERING],
  ["cancelled", SESSION_STATES.STOPPED],
  ["canceled", SESSION_STATES.STOPPED],
  ["cancelling", SESSION_STATES.CANCELLING],
  ["stopping", SESSION_STATES.CANCELLING],
  ["crashed", SESSION_STATES.FAILED],
  ["error", SESSION_STATES.FAILED],
]);

/**
 * Normalize any producer's state/status/phase token to a canonical unified
 * state, or null when absent / unrecognized. Case- and whitespace-tolerant;
 * never throws.
 */
export function normalizeSessionState(value) {
  if (typeof value !== "string") return null;
  return STATE_ALIASES.get(value.trim().toLowerCase()) || null;
}

/** Legal transition graph. Terminal states have no outgoing edges. */
const TRANSITIONS = Object.freeze({
  starting: [
    "ready",
    "running",
    "waitingApproval",
    "disconnected",
    "failed",
    "stopped",
  ],
  ready: [
    "running",
    "waitingApproval",
    "cancelling",
    "disconnected",
    "completed",
    "failed",
    "stopped",
  ],
  running: [
    "ready",
    "waitingApproval",
    "cancelling",
    "disconnected",
    "completed",
    "failed",
    "stopped",
  ],
  waitingApproval: [
    "running",
    "ready",
    "cancelling",
    "disconnected",
    "completed",
    "failed",
    "stopped",
  ],
  // a turn may finish (or die) before a cancel lands, so completed/failed are legal.
  cancelling: ["stopped", "failed", "completed", "disconnected"],
  disconnected: ["recovering", "failed", "stopped", "completed"],
  recovering: [
    "ready",
    "running",
    "waitingApproval",
    "disconnected",
    "completed",
    "failed",
    "stopped",
  ],
  completed: [],
  failed: [],
  stopped: [],
});

/** Is `state` a terminal (absorbing) state? */
export function isTerminalSessionState(state) {
  return TERMINAL_STATES.has(state);
}

/** Is `state` a live (non-terminal, known) state? */
export function isActiveSessionState(state) {
  return ALL_STATES.has(state) && !TERMINAL_STATES.has(state);
}

/**
 * Is `from → to` a legal transition? A self-transition (from === to) is always
 * allowed (idempotent re-assert of the current state). Unknown states → false.
 */
export function canTransitionSessionState(from, to) {
  if (!ALL_STATES.has(from) || !ALL_STATES.has(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * States during which a resumed/reconnected session must NOT silently replay a
 * dangerous tool call — it has to re-check the command ledger first (P0#4
 * "危险工具恢复时不得静默重试"). `recovering` is the reattach/replay window;
 * `disconnected` is guarded too because the very next legal step is recovery
 * and a re-dispatch across the gap is exactly the at-most-once hazard.
 */
export function requiresIdempotencyGuard(state) {
  return (
    state === SESSION_STATES.RECOVERING || state === SESSION_STATES.DISCONNECTED
  );
}

/**
 * Collapse the three divergent axes into ONE canonical unified state.
 *
 * Precedence (strongest first), each documented by WHY it outranks the next:
 *   1. terminal `status` (completed/failed/stopped/lost) — a settled verdict
 *      from the supervisor is authoritative and absorbing; nothing un-settles it.
 *   2. `recovering` (connection reconnecting/resuming, or explicit flag) — an
 *      active reattach is the state that carries the idempotency guard, so it
 *      must surface even mid-cancel.
 *   3. `disconnected` (connection lost) — the transport is gone; we cannot
 *      observe cancel/approval progress, so report the disconnect, not a stale
 *      inner phase.
 *   4. `cancelling` (cancel requested, not yet settled) — outranks approval /
 *      running because a pending cancel is what the operator is waiting on.
 *   5. `waitingApproval` (pendingApprovals > 0 OR a blocking worker phase) — a
 *      human decision blocks progress; mirrors phaseGroupKey's approval-wins rule.
 *   6. worker phase: working/turn → running, idle → ready, starting → starting.
 *   7. fallback: a running session with an unknown/absent phase is `running`
 *      (never idle) — the safe default, matching phaseGroupKey.
 *
 * @param {object} input
 * @param {string} [input.status]           supervisor liveness status
 * @param {string} [input.phase]            worker sub-phase
 * @param {string} [input.connection]       IDE transport state
 * @param {boolean} [input.cancelRequested] a cancel is in flight
 * @param {boolean} [input.recovering]      an explicit reattach/replay flag
 * @param {number} [input.pendingApprovals] count of blocking approvals
 * @returns {string} a canonical SESSION_STATES value
 */
export function deriveSessionState(input) {
  const s = input && typeof input === "object" ? input : {};
  const status = normalizeSessionState(s.status);
  const connection = normalizeSessionState(s.connection);
  const phase = normalizeSessionState(s.phase);

  // 1. terminal verdict absorbs everything.
  if (status && TERMINAL_STATES.has(status)) return status;

  // 2. active recovery (explicit flag or a reconnecting/resuming transport).
  if (s.recovering === true || connection === SESSION_STATES.RECOVERING) {
    return SESSION_STATES.RECOVERING;
  }

  // 3. transport gone.
  if (connection === SESSION_STATES.DISCONNECTED)
    return SESSION_STATES.DISCONNECTED;

  // 4. cancel in flight (flag, or a producer that reported a cancelling state).
  if (
    s.cancelRequested === true ||
    phase === SESSION_STATES.CANCELLING ||
    connection === SESSION_STATES.CANCELLING
  ) {
    return SESSION_STATES.CANCELLING;
  }

  // 5. blocked on a human decision.
  if (
    Number(s.pendingApprovals) > 0 ||
    phase === SESSION_STATES.WAITING_APPROVAL
  ) {
    return SESSION_STATES.WAITING_APPROVAL;
  }

  // 6. steady sub-states from the worker phase.
  if (phase === SESSION_STATES.RUNNING) return SESSION_STATES.RUNNING;
  if (phase === SESSION_STATES.READY) return SESSION_STATES.READY;
  if (phase === SESSION_STATES.STARTING) return SESSION_STATES.STARTING;
  if (connection === SESSION_STATES.STARTING) return SESSION_STATES.STARTING;
  if (connection === SESSION_STATES.READY) return SESSION_STATES.READY;

  // 7. a running session with no legible phase is running, never idle.
  if (status === SESSION_STATES.RUNNING) return SESSION_STATES.RUNNING;

  // nothing legible at all → the session is starting up.
  return SESSION_STATES.STARTING;
}

/** Human-readable one-liner for a canonical state (dashboards / logs). */
export function describeSessionState(state) {
  switch (state) {
    case SESSION_STATES.STARTING:
      return "starting: process spawned, first turn not begun";
    case SESSION_STATES.READY:
      return "ready: transport open, parked between turns";
    case SESSION_STATES.RUNNING:
      return "running: a turn is executing";
    case SESSION_STATES.WAITING_APPROVAL:
      return "waiting for approval: a human decision blocks progress";
    case SESSION_STATES.CANCELLING:
      return "cancelling: a cancel is in flight, not yet settled";
    case SESSION_STATES.DISCONNECTED:
      return "disconnected: transport lost, session may still be alive";
    case SESSION_STATES.RECOVERING:
      return "recovering: reattaching; dangerous tools must re-check the ledger";
    case SESSION_STATES.COMPLETED:
      return "completed: finished successfully (terminal)";
    case SESSION_STATES.FAILED:
      return "failed: ended in error or was lost (terminal)";
    case SESSION_STATES.STOPPED:
      return "stopped: cancelled by the user (terminal)";
    default:
      return "unknown session state";
  }
}
