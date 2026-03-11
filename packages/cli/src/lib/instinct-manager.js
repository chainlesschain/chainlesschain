/**
 * Instinct Manager — learns user preferences from agent interactions.
 * Tracks patterns like preferred tools, coding style, response format, etc.
 */

/**
 * Ensure instincts table exists.
 */
export function ensureInstinctsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instincts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      pattern TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      occurrences INTEGER DEFAULT 1,
      last_seen TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Instinct categories.
 */
export const INSTINCT_CATEGORIES = {
  TOOL_PREFERENCE: "tool_preference",
  CODING_STYLE: "coding_style",
  RESPONSE_FORMAT: "response_format",
  LANGUAGE: "language",
  WORKFLOW: "workflow",
  BEHAVIOR: "behavior",
};

/**
 * Record an instinct observation.
 * If an instinct with the same category+pattern exists, increment its confidence and occurrences.
 */
export function recordInstinct(db, category, pattern) {
  ensureInstinctsTable(db);

  // Check if exists
  const existing = db
    .prepare("SELECT * FROM instincts WHERE category = ? AND pattern = ?")
    .get(category, pattern);

  if (existing) {
    // Boost confidence (asymptotic approach to 1.0)
    const newConfidence = Math.min(
      0.99,
      existing.confidence + (1 - existing.confidence) * 0.1,
    );
    db.prepare(
      "UPDATE instincts SET confidence = ?, occurrences = occurrences + 1, last_seen = datetime('now') WHERE id = ?",
    ).run(newConfidence, existing.id);

    return {
      id: existing.id,
      category,
      pattern,
      confidence: newConfidence,
      occurrences: (existing.occurrences || 1) + 1,
      isNew: false,
    };
  }

  // Create new instinct
  const id = generateId();
  db.prepare(
    "INSERT INTO instincts (id, category, pattern, confidence, occurrences) VALUES (?, ?, ?, ?, ?)",
  ).run(id, category, pattern, 0.5, 1);

  return {
    id,
    category,
    pattern,
    confidence: 0.5,
    occurrences: 1,
    isNew: true,
  };
}

/**
 * Get all instincts, optionally filtered by category.
 */
export function getInstincts(db, options = {}) {
  ensureInstinctsTable(db);

  let sql = "SELECT * FROM instincts";
  const params = [];

  if (options.category) {
    sql += " WHERE category = ?";
    params.push(options.category);
  }

  sql += " ORDER BY confidence DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params);
}

/**
 * Get top instincts (confidence >= threshold).
 */
export function getStrongInstincts(db, threshold = 0.7) {
  ensureInstinctsTable(db);
  return db
    .prepare(
      "SELECT * FROM instincts WHERE confidence >= ? ORDER BY confidence DESC",
    )
    .all(threshold);
}

/**
 * Delete an instinct by ID or prefix.
 */
export function deleteInstinct(db, id) {
  ensureInstinctsTable(db);
  const result = db
    .prepare("DELETE FROM instincts WHERE id LIKE ?")
    .run(`${id}%`);
  return result.changes > 0;
}

/**
 * Reset all instincts (clear the table).
 */
export function resetInstincts(db) {
  ensureInstinctsTable(db);
  const result = db.prepare("DELETE FROM instincts WHERE 1=1").run();
  return result.changes;
}

/**
 * Decay instincts that haven't been seen recently.
 * Reduces confidence of old instincts over time.
 */
export function decayInstincts(db, daysThreshold = 30) {
  ensureInstinctsTable(db);
  // Simple decay: multiply confidence by 0.9 for old instincts
  const rows = db.prepare("SELECT * FROM instincts").all();
  let decayed = 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);
  const cutoffStr = cutoff.toISOString().replace("T", " ").slice(0, 19);

  for (const row of rows) {
    if (row.last_seen && row.last_seen < cutoffStr) {
      const newConfidence = Math.max(0.1, (row.confidence || 0.5) * 0.9);
      db.prepare("UPDATE instincts SET confidence = ? WHERE id = ?").run(
        newConfidence,
        row.id,
      );
      decayed++;
    }
  }

  return decayed;
}

/**
 * Generate a system prompt fragment from strong instincts.
 */
export function generateInstinctPrompt(db) {
  const strong = getStrongInstincts(db, 0.6);
  if (strong.length === 0) return "";

  const lines = ["Based on learned preferences:"];
  for (const inst of strong) {
    lines.push(
      `- [${inst.category}] ${inst.pattern} (confidence: ${(inst.confidence * 100).toFixed(0)}%)`,
    );
  }

  return lines.join("\n");
}
