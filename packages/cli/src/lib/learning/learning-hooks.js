/**
 * Learning Loop — Hook registration.
 *
 * Wires the TrajectoryStore into the existing hook infrastructure:
 *   - UserPromptSubmit → startTrajectory()
 *   - PostToolUse      → appendToolCall()
 *   - SessionEnd       → (reserved for ReflectionEngine in P3)
 *
 * This module does NOT modify agent-core.js or agent-repl.js.
 * Instead it provides an init function that the REPL calls once
 * during session setup, passing a LearningLoop context object.
 *
 * Design:
 *   - Fire-and-forget: learning failures never break the host flow
 *   - No-op when learningCtx is null or disabled
 *   - Stateless — the trajectory ID is tracked on learningCtx
 */

/**
 * @typedef {object} LearningContext
 * @property {import("./trajectory-store.js").TrajectoryStore} trajectoryStore
 * @property {string|null} currentTrajectoryId — set per user turn
 * @property {boolean} enabled
 * @property {string} sessionId
 */

/**
 * Called on UserPromptSubmit — starts a new trajectory for this turn.
 * @param {LearningContext} ctx
 * @param {string} prompt — the user's raw input
 */
export function onUserPromptSubmit(ctx, prompt) {
  if (!ctx || !ctx.enabled || !ctx.trajectoryStore) return;
  try {
    ctx.currentTrajectoryId = ctx.trajectoryStore.startTrajectory(
      ctx.sessionId,
      prompt,
    );
  } catch (_err) {
    // Learning failures never break the REPL
    ctx.currentTrajectoryId = null;
  }
}

/**
 * Called on PostToolUse — appends a tool call to the current trajectory.
 * @param {LearningContext} ctx
 * @param {{tool:string, args:any, result:any, durationMs?:number, status?:string}} record
 */
export function onPostToolUse(ctx, record) {
  if (!ctx || !ctx.enabled || !ctx.trajectoryStore || !ctx.currentTrajectoryId)
    return;
  try {
    ctx.trajectoryStore.appendToolCall(ctx.currentTrajectoryId, record);
  } catch (_err) {
    // Swallow — never break the agent loop
  }
}

/**
 * Called on response-complete — completes the current trajectory.
 * @param {LearningContext} ctx
 * @param {{finalResponse?:string, tags?:string[]}} data
 * @returns {object|null} completed trajectory or null
 */
export function onResponseComplete(ctx, data) {
  if (!ctx || !ctx.enabled || !ctx.trajectoryStore || !ctx.currentTrajectoryId)
    return null;
  try {
    const trajectory = ctx.trajectoryStore.completeTrajectory(
      ctx.currentTrajectoryId,
      data,
    );
    // Reset for next turn
    const finishedId = ctx.currentTrajectoryId;
    ctx.currentTrajectoryId = null;
    return trajectory;
  } catch (_err) {
    ctx.currentTrajectoryId = null;
    return null;
  }
}

/**
 * Called on SessionEnd — reserved for ReflectionEngine (P3).
 * Currently a no-op placeholder.
 * @param {LearningContext} ctx
 */
export function onSessionEnd(ctx) {
  if (!ctx || !ctx.enabled) return;
  // P3: will call reflectionEngine.onSessionEnd(ctx.sessionId)
}

/**
 * Create a LearningContext for a session.
 * Returns null if db is not available or learning is disabled.
 *
 * @param {import("better-sqlite3").Database|null} db
 * @param {string} sessionId
 * @param {{enabled?:boolean}} [config]
 * @returns {LearningContext|null}
 */
export function createLearningContext(db, sessionId, config = {}) {
  if (!db) return null;
  const enabled = config.enabled !== false;
  if (!enabled) return null;

  // Lazy import to avoid circular deps — TrajectoryStore calls ensureLearningTables
  const { TrajectoryStore } = require("./trajectory-store.js");

  return {
    trajectoryStore: new TrajectoryStore(db),
    currentTrajectoryId: null,
    enabled: true,
    sessionId,
  };
}
