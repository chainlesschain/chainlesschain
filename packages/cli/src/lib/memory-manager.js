/**
 * Persistent memory manager for CLI
 *
 * Manages daily notes and long-term memory files.
 * Lightweight port of desktop-app-vue/src/main/llm/permanent-memory-manager.js
 */

import fs from "fs";
import path from "path";

/**
 * Ensure the memory directory structure exists
 */
function ensureMemoryDirs(memoryDir) {
  try {
    const dailyDir = path.join(memoryDir, "daily");
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create memory directory: ${err.message}`);
  }
}

function ensureMemoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      importance INTEGER DEFAULT 3,
      source TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Get the memory directory path
 */
export function getMemoryDir(dataDir) {
  return path.join(dataDir, "memory");
}

/**
 * Add an entry to memory (stored in DB)
 */
export function addMemory(db, content, options = {}) {
  ensureMemoryTable(db);

  if (!content || !content.trim()) {
    throw new Error("Memory content cannot be empty");
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const category = options.category || "general";
  const importance = Math.max(
    1,
    Math.min(5, parseInt(options.importance) || 3),
  );
  const source = options.source || "user";

  db.prepare(
    `INSERT INTO memory_entries (id, content, category, importance, source) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, content, category, importance, source);

  return { id, content, category, importance };
}

/**
 * Search memory entries
 */
export function searchMemory(db, query, options = {}) {
  ensureMemoryTable(db);

  if (!query || !query.trim()) return [];

  const limit = Math.max(1, parseInt(options.limit) || 20);
  const pattern = `%${query}%`;

  return db
    .prepare(
      `SELECT * FROM memory_entries
       WHERE content LIKE ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(pattern, limit);
}

/**
 * List all memory entries
 */
export function listMemory(db, options = {}) {
  ensureMemoryTable(db);

  const limit = Math.max(1, parseInt(options.limit) || 50);
  const category = options.category;

  if (category) {
    return db
      .prepare(
        `SELECT * FROM memory_entries WHERE category = ? ORDER BY importance DESC, created_at DESC LIMIT ?`,
      )
      .all(category, limit);
  }

  return db
    .prepare(
      `SELECT * FROM memory_entries ORDER BY importance DESC, created_at DESC LIMIT ?`,
    )
    .all(limit);
}

/**
 * Delete a memory entry
 */
export function deleteMemory(db, id) {
  ensureMemoryTable(db);

  // Try exact match first, then prefix match
  let result = db.prepare("DELETE FROM memory_entries WHERE id = ?").run(id);

  if (result.changes === 0 && id.length >= 4) {
    result = db
      .prepare("DELETE FROM memory_entries WHERE id LIKE ? LIMIT 1")
      .run(`${id}%`);
  }

  return result.changes > 0;
}

/**
 * Append to today's daily note
 */
export function appendDailyNote(memoryDir, content) {
  ensureMemoryDirs(memoryDir);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(memoryDir, "daily", `${today}.md`);

  const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const entry = `\n## ${timestamp}\n\n${content}\n`;

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, entry, "utf8");
  } else {
    const header = `# Daily Note: ${today}\n${entry}`;
    fs.writeFileSync(filePath, header, "utf8");
  }

  return { date: today, path: filePath };
}

/**
 * Read a daily note
 */
export function getDailyNote(memoryDir, date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const filePath = path.join(memoryDir, "daily", `${date}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

/**
 * List available daily notes
 */
export function listDailyNotes(memoryDir, options = {}) {
  ensureMemoryDirs(memoryDir);

  const dailyDir = path.join(memoryDir, "daily");
  const limit = Math.max(1, parseInt(options.limit) || 30);

  try {
    const files = fs
      .readdirSync(dailyDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map((f) => {
      const filePath = path.join(dailyDir, f);
      const stat = fs.statSync(filePath);
      return {
        date: f.replace(".md", ""),
        path: filePath,
        size: stat.size,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Read or update the MEMORY.md file (long-term knowledge)
 */
export function getMemoryFile(memoryDir) {
  ensureMemoryDirs(memoryDir);
  const filePath = path.join(memoryDir, "MEMORY.md");
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

export function updateMemoryFile(memoryDir, content) {
  ensureMemoryDirs(memoryDir);
  const filePath = path.join(memoryDir, "MEMORY.md");
  fs.writeFileSync(filePath, content, "utf8");
  return { path: filePath };
}
