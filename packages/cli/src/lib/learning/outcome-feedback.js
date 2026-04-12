/**
 * OutcomeFeedback — Connects tool execution results to quality scores,
 * producing reward signals for the learning loop.
 *
 * Three signal sources:
 *   1. Auto-score — heuristic based on error rate, retries, final status
 *   2. User feedback — explicit 👍/👎 or /feedback command
 *   3. Correction detection — user redoes/corrects within a time window
 *
 * Propagation:
 *   - TrajectoryStore (backfill outcome_score)
 *   - InstinctManager (tool preference / workflow patterns)
 *   - EvolutionSystem (capability assessment)
 */

import { INSTINCT_CATEGORIES, recordInstinct } from "../instinct-manager.js";
import { assessCapability } from "../evolution-system.js";

// ── Auto-scoring ────────────────────────────────────────

/**
 * Detect retries: same tool called consecutively 2+ times.
 * @param {Array<{tool:string}>} chain
 * @returns {boolean}
 */
export function hasRetries(chain) {
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].tool === chain[i - 1].tool) return true;
  }
  return false;
}

/**
 * Auto-score a trajectory based on execution quality heuristics.
 * @param {{toolChain:Array<{status:string, tool:string}>}} trajectory
 * @returns {number} score 0-1
 */
export function autoScore(trajectory) {
  const chain = trajectory.toolChain || [];
  if (chain.length === 0) return 0.5;

  let score = 0.5;

  const errorCount = chain.filter(
    (t) => t.status === "error" || t.status === "failed",
  ).length;
  const totalCount = chain.length;

  // No errors → +0.2
  if (errorCount === 0) score += 0.2;

  // Error rate > 50% → -0.3
  if (totalCount > 0 && errorCount / totalCount > 0.5) score -= 0.3;

  // Has retries → -0.1
  if (hasRetries(chain)) score -= 0.1;

  // Final tool succeeded → +0.1
  const lastTool = chain[chain.length - 1];
  if (lastTool && lastTool.status === "completed") score += 0.1;

  return Math.max(0, Math.min(1, score));
}

// ── Correction detection ────────────────────────────────

/**
 * Negation patterns for correction detection (Chinese + English).
 */
const NEGATION_PATTERNS = [
  /不[是对]/,
  /错了/,
  /重[新做来]/,
  /别这样/,
  /不要这样/,
  /not\s+right/i,
  /wrong/i,
  /redo/i,
  /don't/i,
  /undo/i,
  /try\s+again/i,
  /that's\s+not/i,
  /incorrect/i,
];

/**
 * Detect if a user message is correcting the previous agent action.
 * @param {string} currentMessage — the user's latest input
 * @param {{toolChain:Array<{tool:string}>}} [previousTrajectory] — previous turn's trajectory
 * @returns {{isCorrection:boolean, detail:string}}
 */
export function detectCorrection(currentMessage, previousTrajectory) {
  if (!currentMessage || !previousTrajectory) {
    return { isCorrection: false, detail: "" };
  }

  const msg = currentMessage.trim();

  // Strategy 1: negation pattern match
  for (const pattern of NEGATION_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        isCorrection: true,
        detail: `Negation detected: "${msg.slice(0, 80)}"`,
      };
    }
  }

  // Strategy 2: user references same tool/file from previous trajectory
  const prevTools = (previousTrajectory.toolChain || []).map((t) => t.tool);
  const prevArgs = (previousTrajectory.toolChain || [])
    .map((t) => {
      if (!t.args) return [];
      return Object.values(t.args).filter((v) => typeof v === "string");
    })
    .flat();

  // Check if user mentions a file path from previous tool args
  for (const arg of prevArgs) {
    if (arg.length > 3 && msg.includes(arg)) {
      // User references same file → could be correction
      // Only flag if combined with imperative language
      if (/instead|rather|actually|but|however/i.test(msg)) {
        return {
          isCorrection: true,
          detail: `References previous arg "${arg}" with correction language`,
        };
      }
    }
  }

  return { isCorrection: false, detail: "" };
}

// ── OutcomeFeedback class ───────────────────────────────

export class OutcomeFeedback {
  /**
   * @param {import("better-sqlite3").Database} db
   * @param {import("./trajectory-store.js").TrajectoryStore} trajectoryStore
   */
  constructor(db, trajectoryStore) {
    this.db = db;
    this.trajectoryStore = trajectoryStore;
  }

  /**
   * Auto-score a trajectory and backfill the score.
   * @param {string} trajectoryId
   * @returns {number} the computed score
   */
  scoreTrajectory(trajectoryId) {
    const traj = this.trajectoryStore.getTrajectory(trajectoryId);
    if (!traj) return 0.5;

    const score = autoScore(traj);
    this.trajectoryStore.setOutcomeScore(trajectoryId, score, "auto");
    return score;
  }

  /**
   * Record explicit user feedback, overriding auto-score.
   * @param {string} trajectoryId
   * @param {{rating:"positive"|"negative"|number, comment?:string}} feedback
   */
  recordUserFeedback(trajectoryId, feedback) {
    let score;
    if (typeof feedback.rating === "number") {
      score = Math.max(0, Math.min(1, feedback.rating));
    } else {
      score = feedback.rating === "positive" ? 1.0 : 0.0;
    }

    this.trajectoryStore.setOutcomeScore(trajectoryId, score, "user");
  }

  /**
   * Check if a new user message is a correction of the previous turn,
   * and if so, downgrade the previous trajectory's score.
   * @param {string} currentMessage
   * @param {string} previousTrajectoryId
   * @returns {{isCorrection:boolean, detail:string}}
   */
  checkCorrection(currentMessage, previousTrajectoryId) {
    const prevTraj = this.trajectoryStore.getTrajectory(previousTrajectoryId);
    if (!prevTraj) return { isCorrection: false, detail: "" };

    const result = detectCorrection(currentMessage, prevTraj);
    if (result.isCorrection) {
      // Downgrade the previous trajectory's score
      const currentScore = prevTraj.outcomeScore ?? 0.5;
      const newScore = Math.max(0, currentScore - 0.3);
      this.trajectoryStore.setOutcomeScore(
        previousTrajectoryId,
        newScore,
        "user",
      );
    }
    return result;
  }

  /**
   * Propagate a trajectory's feedback signal to Instinct and Evolution.
   * Call this after scoring is finalized.
   * @param {string} trajectoryId
   */
  propagateFeedback(trajectoryId) {
    const traj = this.trajectoryStore.getTrajectory(trajectoryId);
    if (!traj || traj.outcomeScore == null) return;

    const score = traj.outcomeScore;
    const tools = (traj.toolChain || []).map((t) => t.tool);
    const uniqueTools = [...new Set(tools)];

    // Propagate to Instinct
    try {
      if (score >= 0.8 && uniqueTools.length > 0) {
        // High score → record tool preference
        const toolPattern = uniqueTools.join(" → ");
        recordInstinct(
          this.db,
          INSTINCT_CATEGORIES.TOOL_PREFERENCE,
          toolPattern,
        );
      } else if (score <= 0.3 && uniqueTools.length > 0) {
        // Low score → record as workflow to avoid
        const toolPattern = `avoid: ${uniqueTools.join(" → ")}`;
        recordInstinct(this.db, INSTINCT_CATEGORIES.WORKFLOW, toolPattern);
      }
    } catch (_err) {
      // Instinct propagation failure is non-critical
    }

    // Propagate to Evolution
    try {
      for (const tool of uniqueTools) {
        assessCapability(this.db, tool, score, "tool");
      }
    } catch (_err) {
      // Evolution propagation failure is non-critical
    }
  }
}
