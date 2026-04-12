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
