/**
 * Note version control — track changes to notes with full history.
 */

/**
 * Ensure the note_versions table exists.
 */
export function ensureVersionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      category TEXT DEFAULT 'general',
      change_type TEXT DEFAULT 'edit',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Generate a simple ID.
 */
function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Get the next version number for a note.
 */
export function getNextVersion(db, noteId) {
  const row = db
    .prepare(
      "SELECT MAX(version) as max_ver FROM note_versions WHERE note_id = ?",
    )
    .get(noteId);
  return (row?.max_ver || 0) + 1;
}

/**
 * Save a version snapshot of a note.
 * @param {object} db - Database instance
 * @param {string} noteId - Note ID
 * @param {object} noteData - { title, content, tags, category }
 * @param {string} changeType - 'create' | 'edit' | 'revert'
 * @returns {object} The saved version record
 */
export function saveVersion(db, noteId, noteData, changeType = "edit") {
  ensureVersionsTable(db);
  const version = getNextVersion(db, noteId);
  const id = generateId();
  const tagsJson =
    typeof noteData.tags === "string"
      ? noteData.tags
      : JSON.stringify(noteData.tags || []);

  db.prepare(
    "INSERT INTO note_versions (id, note_id, version, title, content, tags, category, change_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    noteId,
    version,
    noteData.title || "",
    noteData.content || "",
    tagsJson,
    noteData.category || "general",
    changeType,
  );

  return {
    id,
    note_id: noteId,
    version,
    title: noteData.title || "",
    content: noteData.content || "",
    tags: tagsJson,
    category: noteData.category || "general",
    change_type: changeType,
  };
}

/**
 * Get the version history for a note.
 */
export function getHistory(db, noteId) {
  ensureVersionsTable(db);
  return db
    .prepare(
      "SELECT id, note_id, version, title, change_type, created_at FROM note_versions WHERE note_id = ? ORDER BY version DESC",
    )
    .all(noteId);
}

/**
 * Get a specific version of a note.
 */
export function getVersion(db, noteId, version) {
  ensureVersionsTable(db);
  return db
    .prepare("SELECT * FROM note_versions WHERE note_id = ? AND version = ?")
    .get(noteId, version);
}

/**
 * Compute a simple text diff between two strings.
 * Returns an array of { type: 'add'|'remove'|'same', line } objects.
 */
export function simpleDiff(oldText, newText) {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");
  const result = [];

  // Simple line-by-line diff using LCS approach
  const lcs = computeLcs(oldLines, newLines);
  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li]) {
      if (ni < newLines.length && newLines[ni] === lcs[li]) {
        result.push({ type: "same", line: lcs[li] });
        oi++;
        ni++;
        li++;
      } else if (ni < newLines.length) {
        result.push({ type: "add", line: newLines[ni] });
        ni++;
      }
    } else if (oi < oldLines.length) {
      if (li < lcs.length && oldLines[oi] !== lcs[li]) {
        result.push({ type: "remove", line: oldLines[oi] });
        oi++;
      } else if (li >= lcs.length) {
        result.push({ type: "remove", line: oldLines[oi] });
        oi++;
      }
    } else if (ni < newLines.length) {
      result.push({ type: "add", line: newLines[ni] });
      ni++;
    }
  }

  return result;
}

/**
 * Compute the Longest Common Subsequence of two string arrays.
 */
function computeLcs(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to get the LCS
  const result = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Format a diff result as a readable string.
 */
export function formatDiff(diffResult) {
  return diffResult
    .map((d) => {
      if (d.type === "add") return `+ ${d.line}`;
      if (d.type === "remove") return `- ${d.line}`;
      return `  ${d.line}`;
    })
    .join("\n");
}

/**
 * Revert a note to a specific version.
 * Saves the current state as a new version first, then applies the old version.
 */
export function revertToVersion(db, noteId, version) {
  ensureVersionsTable(db);

  // Get the target version
  const targetVersion = getVersion(db, noteId, version);
  if (!targetVersion) return null;

  // Get current note state
  const current = db
    .prepare("SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL")
    .get(noteId);
  if (!current) return null;

  // Save current state as a version before reverting
  saveVersion(db, noteId, current, "edit");

  // Apply the target version to the note
  db.prepare(
    "UPDATE notes SET title = ?, content = ?, tags = ?, category = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    targetVersion.title,
    targetVersion.content,
    targetVersion.tags,
    targetVersion.category,
    noteId,
  );

  // Save the revert action as a new version
  const revertRecord = saveVersion(db, noteId, targetVersion, "revert");

  return {
    note_id: noteId,
    reverted_to: version,
    new_version: revertRecord.version,
    title: targetVersion.title,
  };
}
