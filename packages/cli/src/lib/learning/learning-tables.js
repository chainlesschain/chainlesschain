/**
 * Learning Loop — Database table definitions.
 *
 * Tables:
 *   - learning_trajectories    — full execution traces (intent → tools → response)
 *   - learning_trajectory_tags — per-trajectory tag index for pattern matching
 *   - skill_improvement_log    — skill patch history (Phase P2)
 */

/**
 * Create all learning-related tables. Idempotent (IF NOT EXISTS).
 * @param {import("better-sqlite3").Database} db
 */
export function ensureLearningTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_trajectories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_intent TEXT,
      tool_chain TEXT NOT NULL DEFAULT '[]',
      tool_count INTEGER DEFAULT 0,
      final_response TEXT,
      outcome_score REAL,
      outcome_source TEXT,
      complexity_level TEXT DEFAULT 'simple',
      synthesized_skill TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traj_session
      ON learning_trajectories(session_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traj_score
      ON learning_trajectories(outcome_score)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traj_complexity
      ON learning_trajectories(complexity_level)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_trajectory_tags (
      trajectory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      UNIQUE(trajectory_id, tag)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traj_tags_tid
      ON learning_trajectory_tags(trajectory_id)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_improvement_log (
      skill_name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/** datetime('now')-style timestamp for rows missing one on import. */
function _learningNowSqlite() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Export ALL learning trajectories (full dump) for §8.3 cross-device backup.
 * Includes the synthesized_skill linkage (synthesized skills travel with the
 * trajectories that produced them). The learning_trajectory_tags side-table is
 * derived and intentionally not exported in v1.
 */
export function exportTrajectories(db) {
  ensureLearningTables(db);
  return db
    .prepare(
      `SELECT id, session_id, user_intent, tool_chain, tool_count, final_response,
              outcome_score, outcome_source, complexity_level, synthesized_skill,
              created_at, completed_at
       FROM learning_trajectories ORDER BY created_at ASC, id ASC`,
    )
    .all();
}

/**
 * Import learning trajectories (§8.3 restore): idempotent upsert by id —
 * preserves created_at, updates the rest. Never aborts mid-batch.
 */
export function importTrajectories(db, rows) {
  ensureLearningTables(db);
  if (!Array.isArray(rows)) {
    throw new Error("importTrajectories: rows must be a JSON array");
  }
  const stmt = db.prepare(
    `INSERT INTO learning_trajectories
       (id, session_id, user_intent, tool_chain, tool_count, final_response,
        outcome_score, outcome_source, complexity_level, synthesized_skill,
        created_at, completed_at)
     VALUES (@id, @session_id, @user_intent, @tool_chain, @tool_count, @final_response,
             @outcome_score, @outcome_source, @complexity_level, @synthesized_skill,
             @created_at, @completed_at)
     ON CONFLICT(id) DO UPDATE SET
       session_id = excluded.session_id,
       user_intent = excluded.user_intent,
       tool_chain = excluded.tool_chain,
       tool_count = excluded.tool_count,
       final_response = excluded.final_response,
       outcome_score = excluded.outcome_score,
       outcome_source = excluded.outcome_source,
       complexity_level = excluded.complexity_level,
       synthesized_skill = excluded.synthesized_skill,
       completed_at = excluded.completed_at`,
  );
  let imported = 0;
  let failed = 0;
  const errors = [];
  for (const r of rows) {
    try {
      if (!r || !r.id || !r.session_id) {
        throw new Error("invalid trajectory (need id + session_id)");
      }
      stmt.run({
        id: String(r.id),
        session_id: String(r.session_id),
        user_intent: r.user_intent ?? null,
        tool_chain: r.tool_chain ?? "[]",
        tool_count: Number.isInteger(r.tool_count) ? r.tool_count : 0,
        final_response: r.final_response ?? null,
        outcome_score: typeof r.outcome_score === "number" ? r.outcome_score : null,
        outcome_source: r.outcome_source ?? null,
        complexity_level: r.complexity_level ?? "simple",
        synthesized_skill: r.synthesized_skill ?? null,
        created_at: r.created_at || _learningNowSqlite(),
        completed_at: r.completed_at ?? null,
      });
      imported += 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 10) errors.push({ id: r && r.id, error: e.message });
    }
  }
  return { ok: failed === 0, imported, failed, errors };
}
