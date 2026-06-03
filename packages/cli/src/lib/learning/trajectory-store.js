/**
 * TrajectoryStore — Records complete execution trajectories for the
 * autonomous learning loop.
 *
 * A trajectory captures the full chain:
 *   user intent → tool calls (with args/results) → final response
 *
 * Consumed by:
 *   - OutcomeFeedback (P1) — backfills outcome_score
 *   - SkillSynthesizer (P2) — finds complex high-quality patterns
 *   - SkillImprover (P2) — finds similar trajectories for comparison
 *   - ReflectionEngine (P3) — periodic review
 */

import { ensureLearningTables } from "./learning-tables.js";

// ── Helpers ──────────────────────────────────────────────

function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Classify complexity based on tool call count.
 * @param {number} toolCount
 * @returns {"simple"|"moderate"|"complex"}
 */
export function classifyComplexity(toolCount) {
  if (toolCount <= 2) return "simple";
  if (toolCount <= 5) return "moderate";
  return "complex";
}

// ── _deps (for test injection, per CLI convention) ──────

const _deps = { generateId };

// ── TrajectoryStore ─────────────────────────────────────

export class TrajectoryStore {
  /**
   * @param {import("better-sqlite3").Database} db
   */
  constructor(db) {
    this.db = db;
    ensureLearningTables(db);
  }

  // ── Write path ──────────────────────────────────────

  /**
   * Start recording a new trajectory (called on UserPromptSubmit).
   * @param {string} sessionId
   * @param {string} userIntent — the user's raw input
   * @returns {string} trajectoryId
   */
  startTrajectory(sessionId, userIntent) {
    const id = _deps.generateId();
    this.db
      .prepare(
        `INSERT INTO learning_trajectories (id, session_id, user_intent, tool_chain, tool_count, complexity_level)
         VALUES (?, ?, ?, '[]', 0, 'simple')`,
      )
      .run(id, sessionId, userIntent || "");
    return id;
  }

  /**
   * Append a tool call record to the trajectory (called on PostToolUse).
   * @param {string} trajectoryId
   * @param {{tool:string, args:any, result:any, durationMs:number, status:string}} record
   */
  appendToolCall(trajectoryId, record) {
    if (!trajectoryId) return;

    const row = this.db
      .prepare(
        "SELECT tool_chain, tool_count FROM learning_trajectories WHERE id = ?",
      )
      .get(trajectoryId);
    if (!row) return;

    let chain;
    try {
      chain = JSON.parse(row.tool_chain);
    } catch {
      chain = [];
    }

    // Truncate large results to keep DB lean (max 500 chars)
    const truncatedResult =
      typeof record.result === "string" && record.result.length > 500
        ? record.result.slice(0, 500) + "...[truncated]"
        : typeof record.result === "object"
          ? JSON.stringify(record.result).slice(0, 500)
          : String(record.result ?? "");

    chain.push({
      tool: record.tool,
      args: record.args,
      result: truncatedResult,
      durationMs: record.durationMs || 0,
      status: record.status || "completed",
    });

    const newCount = chain.length;
    this.db
      .prepare(
        `UPDATE learning_trajectories
         SET tool_chain = ?, tool_count = ?, complexity_level = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(chain),
        newCount,
        classifyComplexity(newCount),
        trajectoryId,
      );
  }

  /**
   * Mark trajectory as complete (called on response-complete event).
   * @param {string} trajectoryId
   * @param {{finalResponse?:string, tags?:string[]}} data
   * @returns {object|null} the completed trajectory row
   */
  completeTrajectory(trajectoryId, data = {}) {
    if (!trajectoryId) return null;

    this.db
      .prepare(
        `UPDATE learning_trajectories
         SET final_response = ?, completed_at = datetime('now')
         WHERE id = ?`,
      )
      .run(data.finalResponse || "", trajectoryId);

    // Insert tags
    if (Array.isArray(data.tags) && data.tags.length > 0) {
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO learning_trajectory_tags (trajectory_id, tag) VALUES (?, ?)",
      );
      for (const tag of data.tags) {
        insert.run(trajectoryId, tag);
      }
    }

    return this.getTrajectory(trajectoryId);
  }

  /**
   * Backfill outcome score (called by OutcomeFeedback).
   * @param {string} trajectoryId
   * @param {number} score 0-1
   * @param {"auto"|"user"|"reflection"} source
   */
  setOutcomeScore(trajectoryId, score, source) {
    if (!trajectoryId) return;
    const clamped = Math.max(0, Math.min(1, score));
    this.db
      .prepare(
        `UPDATE learning_trajectories
         SET outcome_score = ?, outcome_source = ?
         WHERE id = ?`,
      )
      .run(clamped, source || "auto", trajectoryId);
  }

  /**
   * Mark that a skill was synthesized from this trajectory.
   * @param {string} trajectoryId
   * @param {string} skillName
   */
  markSynthesized(trajectoryId, skillName) {
    if (!trajectoryId) return;
    this.db
      .prepare(
        "UPDATE learning_trajectories SET synthesized_skill = ? WHERE id = ?",
      )
      .run(skillName, trajectoryId);
  }

  // ── Read path ───────────────────────────────────────

  /**
   * Get a single trajectory by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getTrajectory(id) {
    const row = this.db
      .prepare("SELECT * FROM learning_trajectories WHERE id = ?")
      .get(id);
    return row ? this._hydrate(row) : null;
  }

  /**
   * List trajectories for a session.
   * @param {string} sessionId
   * @param {{limit?:number}} options
   * @returns {object[]}
   */
  listBySession(sessionId, options = {}) {
    const limit = options.limit || 50;
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_trajectories
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionId, limit);
    return rows.map((r) => this._hydrate(r));
  }

  /**
   * Find complex, high-score, un-synthesized trajectories.
   * Used by SkillSynthesizer to find candidates.
   * @param {{minToolCount?:number, minScore?:number, limit?:number}} options
   * @returns {object[]}
   */
  findComplexUnprocessed(options = {}) {
    const minToolCount = options.minToolCount ?? 5;
    const minScore = options.minScore ?? 0.7;
    const limit = options.limit ?? 10;

    const rows = this.db
      .prepare(
        `SELECT * FROM learning_trajectories
         WHERE tool_count >= ?
           AND outcome_score >= ?
           AND synthesized_skill IS NULL
           AND completed_at IS NOT NULL
         ORDER BY outcome_score DESC, tool_count DESC
         LIMIT ?`,
      )
      .all(minToolCount, minScore, limit);
    return rows.map((r) => this._hydrate(r));
  }

  /**
   * Find trajectories with similar tool usage patterns.
   * Similarity = Jaccard index of tool name sets.
   * @param {string[]} toolNames — tool names to match against
   * @param {{minSimilarity?:number, limit?:number, excludeId?:string}} options
   * @returns {object[]}
   */
  findSimilar(toolNames, options = {}) {
    const minSimilarity = options.minSimilarity ?? 0.5;
    const limit = options.limit ?? 20;
    const excludeId = options.excludeId || null;

    // Fetch all completed trajectories (bounded)
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_trajectories
         WHERE completed_at IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 200`,
      )
      .all();

    const inputSet = new Set(toolNames);
    const results = [];

    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;

      let chain;
      try {
        chain = JSON.parse(row.tool_chain);
      } catch {
        continue;
      }

      const rowTools = new Set(chain.map((t) => t.tool));
      const intersection = [...inputSet].filter((t) => rowTools.has(t)).length;
      const union = new Set([...inputSet, ...rowTools]).size;
      const similarity = union > 0 ? intersection / union : 0;

      if (similarity >= minSimilarity) {
        results.push({ ...this._hydrate(row), similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Get recent trajectories (for CLI display).
   * @param {{limit?:number, sessionId?:string}} options
   * @returns {object[]}
   */
  getRecent(options = {}) {
    const limit = options.limit || 20;
    if (options.sessionId) {
      return this.listBySession(options.sessionId, { limit });
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM learning_trajectories
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => this._hydrate(r));
  }

  /**
   * Get basic stats.
   * @returns {{total:number, complex:number, scored:number, synthesized:number}}
   */
  getStats() {
    const total = this.db
      .prepare("SELECT COUNT(*) as c FROM learning_trajectories")
      .get().c;
    const complex = this.db
      .prepare(
        "SELECT COUNT(*) as c FROM learning_trajectories WHERE complexity_level = 'complex'",
      )
      .get().c;
    const scored = this.db
      .prepare(
        "SELECT COUNT(*) as c FROM learning_trajectories WHERE outcome_score IS NOT NULL",
      )
      .get().c;
    const synthesized = this.db
      .prepare(
        "SELECT COUNT(*) as c FROM learning_trajectories WHERE synthesized_skill IS NOT NULL",
      )
      .get().c;
    return { total, complex, scored, synthesized };
  }

  // ── Maintenance ─────────────────────────────────────

  /**
   * Delete trajectories older than retentionDays.
   * @param {number} [retentionDays=90]
   * @returns {number} deleted count
   */
  cleanup(retentionDays = 90) {
    // Delete tags first (FK-like cleanup)
    this.db
      .prepare(
        `DELETE FROM learning_trajectory_tags
         WHERE trajectory_id IN (
           SELECT id FROM learning_trajectories
           WHERE created_at < datetime('now', ?)
         )`,
      )
      .run(`-${retentionDays} days`);

    const result = this.db
      .prepare(
        `DELETE FROM learning_trajectories
         WHERE created_at < datetime('now', ?)`,
      )
      .run(`-${retentionDays} days`);

    return result.changes;
  }

  // ── Internal ────────────────────────────────────────

  /**
   * Hydrate a DB row: parse JSON fields, attach tags.
   * @param {object} row
   * @returns {object}
   */
  _hydrate(row) {
    let toolChain;
    try {
      toolChain = JSON.parse(row.tool_chain);
    } catch {
      toolChain = [];
    }

    const tags = this.db
      .prepare(
        "SELECT tag FROM learning_trajectory_tags WHERE trajectory_id = ?",
      )
      .all(row.id)
      .map((r) => r.tag);

    return {
      id: row.id,
      sessionId: row.session_id,
      userIntent: row.user_intent,
      toolChain,
      toolCount: row.tool_count,
      finalResponse: row.final_response,
      outcomeScore: row.outcome_score,
      outcomeSource: row.outcome_source,
      complexityLevel: row.complexity_level,
      synthesizedSkill: row.synthesized_skill,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      tags,
    };
  }
}

export { _deps };
