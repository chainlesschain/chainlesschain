/**
 * CLI Permanent Memory — cross-session persistent memory with Daily Notes,
 * MEMORY.md knowledge base, and BM25 hybrid search.
 *
 * Graceful degradation: works without DB (file-only mode).
 * Keeps CLI < 2MB — uses BM25 for search, no heavy vector dependencies.
 */

import fs from "fs";
import path from "path";
import { BM25Search } from "./bm25-search.js";

// Exported for test injection
export const _deps = {
  fs,
  path,
  BM25Search,
};

export class CLIPermanentMemory {
  /**
   * @param {object} options
   * @param {object|null} options.db - Database instance (null for file-only mode)
   * @param {string} options.memoryDir - Directory for memory files
   */
  constructor({ db, memoryDir } = {}) {
    this.db = db || null;
    this.memoryDir = memoryDir || "";
    this._bm25 = null;
    this._initialized = false;
    this._memoryFileContent = "";
    this._dailyNotes = [];
    this._dbEntries = [];
  }

  /**
   * Initialize: create tables, load MEMORY.md, build BM25 index.
   */
  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    // Ensure directories
    if (this.memoryDir) {
      try {
        const dailyDir = _deps.path.join(this.memoryDir, "daily");
        if (!_deps.fs.existsSync(this.memoryDir)) {
          _deps.fs.mkdirSync(this.memoryDir, { recursive: true });
        }
        if (!_deps.fs.existsSync(dailyDir)) {
          _deps.fs.mkdirSync(dailyDir, { recursive: true });
        }
      } catch (_err) {
        // Directory creation failed — continue in degraded mode
      }
    }

    // Create DB table
    if (this.db) {
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS permanent_memory (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            source TEXT DEFAULT 'auto',
            category TEXT DEFAULT 'general',
            importance REAL DEFAULT 0.5,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);
      } catch (_err) {
        // Table creation failed — continue without DB
      }
    }

    // Load MEMORY.md
    this._loadMemoryFile();

    // Load daily notes (recent 7 days)
    this._loadRecentDailyNotes();

    // Load DB entries
    this._loadDbEntries();

    // Build BM25 index
    this._buildIndex();
  }

  /**
   * Append content to today's daily note.
   */
  appendDailyNote(content) {
    if (!this.memoryDir || !content) return null;

    try {
      const today = new Date().toISOString().slice(0, 10);
      const dailyDir = _deps.path.join(this.memoryDir, "daily");
      const filePath = _deps.path.join(dailyDir, `${today}.md`);
      const timestamp = new Date().toISOString().slice(11, 19);
      const entry = `\n## ${timestamp}\n\n${content}\n`;

      if (_deps.fs.existsSync(filePath)) {
        _deps.fs.appendFileSync(filePath, entry, "utf-8");
      } else {
        _deps.fs.writeFileSync(
          filePath,
          `# Daily Note: ${today}\n${entry}`,
          "utf-8",
        );
      }

      // Rebuild index
      this._loadRecentDailyNotes();
      this._buildIndex();

      return { date: today, path: filePath };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Update a section of MEMORY.md.
   * If section exists, replaces it. Otherwise appends.
   */
  updateMemoryFile(section, content) {
    if (!this.memoryDir) return null;

    try {
      const filePath = _deps.path.join(this.memoryDir, "MEMORY.md");
      let existing = "";
      if (_deps.fs.existsSync(filePath)) {
        existing = _deps.fs.readFileSync(filePath, "utf-8");
      }

      const sectionHeader = `## ${section}`;
      const sectionIdx = existing.indexOf(sectionHeader);

      if (sectionIdx >= 0) {
        // Find next ## or end of file
        const afterHeader = existing.indexOf(
          "\n## ",
          sectionIdx + sectionHeader.length,
        );
        const endIdx = afterHeader >= 0 ? afterHeader : existing.length;
        const newContent =
          existing.slice(0, sectionIdx) +
          `${sectionHeader}\n\n${content}\n` +
          existing.slice(endIdx);
        _deps.fs.writeFileSync(filePath, newContent, "utf-8");
      } else {
        // Append new section
        const append = existing
          ? `\n${sectionHeader}\n\n${content}\n`
          : `# Memory\n\n${sectionHeader}\n\n${content}\n`;
        _deps.fs.writeFileSync(filePath, existing + append, "utf-8");
      }

      this._loadMemoryFile();
      this._buildIndex();
      return { path: filePath };
    } catch (_err) {
      return null;
    }
  }

  /**
   * BM25 hybrid search across all memory sources.
   */
  hybridSearch(query, { topK = 5 } = {}) {
    if (!this._bm25 || !query) return [];

    try {
      return this._bm25.search(query, { topK, threshold: 0.1 });
    } catch (_err) {
      return [];
    }
  }

  /**
   * Get relevant context for a query (used by CLIContextEngineering).
   * Returns array of { content, source, score }.
   */
  getRelevantContext(query, limit = 3) {
    if (!query) return [];

    this.initialize();
    const results = this.hybridSearch(query, { topK: limit });
    return results.map((r) => ({
      content: (r.doc.content || "").substring(0, 300),
      source: r.doc.source || "memory",
      score: r.score,
    }));
  }

  /**
   * Auto-summarize session messages and store key facts.
   * Called at session end.
   */
  autoSummarize(sessionMessages) {
    if (!sessionMessages || sessionMessages.length < 4) return [];

    const facts = [];

    // Extract tool usage patterns
    const toolUses = sessionMessages.filter(
      (m) => m.role === "tool" || m.tool_calls,
    );
    if (toolUses.length > 0) {
      const toolNames = new Set();
      for (const m of sessionMessages) {
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            toolNames.add(tc.function?.name || tc.name || "unknown");
          }
        }
      }
      if (toolNames.size > 0) {
        facts.push(`Tools used: ${[...toolNames].join(", ")}`);
      }
    }

    // Extract user questions/topics
    const userMsgs = sessionMessages.filter((m) => m.role === "user");
    if (userMsgs.length > 0) {
      const topics = userMsgs
        .slice(0, 3)
        .map((m) => (m.content || "").substring(0, 60).replace(/\n/g, " "))
        .filter(Boolean);
      if (topics.length > 0) {
        facts.push(`Topics discussed: ${topics.join("; ")}`);
      }
    }

    // Store facts
    for (const fact of facts) {
      this._storeEntry(fact, "auto-summary");
    }

    // Append to daily note
    if (facts.length > 0) {
      this.appendDailyNote(
        `Session summary:\n${facts.map((f) => `- ${f}`).join("\n")}`,
      );
    }

    return facts;
  }

  /**
   * Store a permanent memory entry in DB.
   */
  _storeEntry(content, source = "auto", importance = 0.5) {
    if (!this.db) return null;
    try {
      const id = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.db
        .prepare(
          "INSERT INTO permanent_memory (id, content, source, importance) VALUES (?, ?, ?, ?)",
        )
        .run(id, content, source, importance);
      return id;
    } catch (_err) {
      return null;
    }
  }

  // ─── Internal ───

  _loadMemoryFile() {
    if (!this.memoryDir) return;
    try {
      const filePath = _deps.path.join(this.memoryDir, "MEMORY.md");
      if (_deps.fs.existsSync(filePath)) {
        this._memoryFileContent = _deps.fs.readFileSync(filePath, "utf-8");
      }
    } catch (_err) {
      this._memoryFileContent = "";
    }
  }

  _loadRecentDailyNotes() {
    if (!this.memoryDir) return;
    this._dailyNotes = [];
    try {
      const dailyDir = _deps.path.join(this.memoryDir, "daily");
      if (!_deps.fs.existsSync(dailyDir)) return;

      const files = _deps.fs
        .readdirSync(dailyDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, 7);

      for (const f of files) {
        const content = _deps.fs.readFileSync(
          _deps.path.join(dailyDir, f),
          "utf-8",
        );
        this._dailyNotes.push({
          date: f.replace(".md", ""),
          content,
        });
      }
    } catch (_err) {
      // Non-critical
    }
  }

  _loadDbEntries() {
    if (!this.db) return;
    this._dbEntries = [];
    try {
      this._dbEntries = this.db
        .prepare(
          "SELECT id, content, source, importance FROM permanent_memory ORDER BY importance DESC LIMIT 100",
        )
        .all();
    } catch (_err) {
      // Table may not exist
    }
  }

  _buildIndex() {
    const docs = [];

    // MEMORY.md sections
    if (this._memoryFileContent) {
      const sections = this._memoryFileContent.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const firstLine = section.split("\n")[0].trim();
        docs.push({
          id: `memfile-${firstLine.substring(0, 30)}`,
          title: firstLine,
          content: section.substring(0, 500),
          source: "MEMORY.md",
        });
      }
    }

    // Daily notes
    for (const note of this._dailyNotes) {
      docs.push({
        id: `daily-${note.date}`,
        title: `Daily Note ${note.date}`,
        content: note.content.substring(0, 500),
        source: "daily-note",
      });
    }

    // DB entries
    for (const entry of this._dbEntries) {
      docs.push({
        id: entry.id,
        title: (entry.content || "").substring(0, 60),
        content: entry.content || "",
        source: entry.source || "db",
      });
    }

    if (docs.length > 0) {
      this._bm25 = new _deps.BM25Search();
      this._bm25.indexDocuments(docs);
    } else {
      this._bm25 = null;
    }
  }
}
