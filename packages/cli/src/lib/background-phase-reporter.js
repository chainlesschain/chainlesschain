/**
 * background-phase-reporter — the missing PRODUCER for the background-agent
 * `waiting_permission` phase (P0 state-machine slice,
 * CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12 §"后台 Agent 状态机").
 *
 * The consuming contract has existed for a while: `background-agent-phase.js`
 * normalizes `waiting_permission` and `pendingApprovals > 0` into the
 * dashboard's "Needs input" group, and `session-lifecycle.js` folds them into
 * `waitingApproval`. But nothing ever WROTE those fields — the worker only
 * emits `turn`/`idle`, so a background agent blocked on a human approval
 * (`--permission-prompt-tool`, `--remote-control`) showed as "Working"
 * indefinitely while a decision was actually pending.
 *
 * The production seam is the agent CHILD process, not the worker: the worker
 * spawns each turn with `CC_BACKGROUND_AGENT_ID` in the environment, and the
 * only places a plain headless run genuinely blocks on a human are the
 * confirmer overrides installed on the ApprovalGate. This module wraps those
 * confirmers: while one is awaiting a decision it patches the shared state
 * file with `phase: "waiting_permission"` + a live `pendingApprovals` count,
 * and restores `phase: "turn"` when every pending approval has settled.
 *
 * Safety properties:
 *  - Disabled (no `CC_BACKGROUND_AGENT_ID`) → `wrapConfirmer` returns the
 *    SAME function object; zero reads, zero writes, byte-identical behavior
 *    for every non-background run.
 *  - Never resurrects a terminal session: writes are skipped when the current
 *    on-disk status is anything other than absent/"running" (mirrors the
 *    worker's own writeHeartbeat guard).
 *  - Best-effort throughout: a state-file hiccup must never break an approval.
 *  - IO is injectable so tests never touch the real user data dir.
 */

import {
  readBackgroundAgentState,
  writeBackgroundAgentState,
} from "./background-agent-supervisor.js";

/**
 * Create a phase reporter for the current process.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.agentId] background session id; defaults to
 *   `process.env.CC_BACKGROUND_AGENT_ID`. Falsy → disabled no-op reporter.
 * @param {(id:string)=>object|null} [opts.readState] injectable state reader
 * @param {(state:object)=>void} [opts.writeState] injectable state writer
 */
export function createBackgroundPhaseReporter(opts = {}) {
  const agentId =
    opts.agentId !== undefined
      ? opts.agentId
      : process.env.CC_BACKGROUND_AGENT_ID;
  const readState = opts.readState || readBackgroundAgentState;
  const writeState = opts.writeState || writeBackgroundAgentState;
  const enabled = typeof agentId === "string" && agentId.trim() !== "";
  let pending = 0;

  function patch(fields) {
    if (!enabled) return false;
    try {
      const current = readState(agentId) || { id: agentId };
      // Terminal states are owned by the worker/stopper — never write a
      // "waiting" phase over a completed/failed/stopped record.
      if (current.status && current.status !== "running") return false;
      writeState({ ...current, id: agentId, ...fields });
      return true;
    } catch {
      return false; // state persistence must never break the approval itself
    }
  }

  return {
    enabled,
    /** Current in-process pending-approval count (for tests/introspection). */
    pendingCount() {
      return pending;
    },
    /** A human approval just started blocking progress. */
    beginApproval() {
      if (!enabled) return;
      pending++;
      patch({
        phase: "waiting_permission",
        pendingApprovals: pending,
      });
    },
    /** A previously reported approval settled (approved, denied, or failed). */
    endApproval() {
      if (!enabled) return;
      pending = Math.max(0, pending - 1);
      if (pending === 0) {
        // Back to a live turn — the worker owns the turn/idle transition, we
        // only hand the phase back to its steady in-turn value.
        patch({ phase: "turn", pendingApprovals: 0 });
      } else {
        patch({ pendingApprovals: pending });
      }
    },
    /**
     * A resumed run found side-effect ops whose outcome is UNKNOWN (the
     * ledger reconcile "inspect" bucket): surface `uncertain_side_effect` so
     * the dashboard demands a look before anything is replayed. The worker
     * clears the count at the next turn/idle boundary (the verify turn has
     * then run its course), so this is a within-window annotation, not a
     * sticky flag. Best-effort; returns whether the state was patched.
     */
    reportUncertainSideEffects(count) {
      if (!enabled) return false;
      const n = Number(count);
      if (!Number.isFinite(n) || n <= 0) return false;
      return patch({
        phase: "uncertain_side_effect",
        uncertainSideEffects: Math.floor(n),
      });
    },
    /**
     * The model asked the user a question in a background turn
     * (`ask_user_question`): there is no live channel to a human mid-turn, so
     * the question is PARKED — recorded in the shared state as
     * `pendingQuestion` with `phase: "needs_input"` (distinct from
     * waiting_permission: this is a question, not an approval). The worker
     * keeps `needs_input` through the idle boundary while the question is
     * unanswered and clears it when the user's reply starts the next turn.
     */
    reportQuestion(question) {
      if (!enabled) return false;
      const q = question && typeof question === "object" ? question : null;
      return patch({
        phase: "needs_input",
        pendingQuestion: {
          question: typeof q?.question === "string" ? q.question : "",
          options: Array.isArray(q?.options) ? q.options : null,
        },
      });
    },
    /**
     * Wrap a (potentially human-blocking) confirmer so the pending window is
     * visible in the background state. Disabled → returns `confirmer`
     * unchanged (same object identity, zero overhead).
     */
    wrapConfirmer(confirmer) {
      if (!enabled || typeof confirmer !== "function") return confirmer;
      const self = this;
      return async function phaseReportingConfirmer(...args) {
        self.beginApproval();
        try {
          return await confirmer(...args);
        } finally {
          self.endApproval();
        }
      };
    },
  };
}
