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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Permanent memory governance layer.
 * Tracks per-owner pin maturity + per-pin retention-job lifecycle
 * independent of file/SQLite/BM25 layers.
 * ═══════════════════════════════════════════════════════════════ */

export const PIN_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DORMANT: "dormant",
  ARCHIVED: "archived",
});

export const RETENTION_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const PIN_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "archived"])],
  ["active", new Set(["dormant", "archived"])],
  ["dormant", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const PIN_TERMINALS_V2 = new Set(["archived"]);

const JOB_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["completed", "failed", "cancelled"])],
  ["completed", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const JOB_TERMINALS_V2 = new Set(["completed", "failed", "cancelled"]);

export const PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER = 500;
export const PERMMEM_DEFAULT_MAX_PENDING_JOBS_PER_PIN = 2;
export const PERMMEM_DEFAULT_PIN_IDLE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
export const PERMMEM_DEFAULT_JOB_STUCK_MS = 1000 * 60 * 15; // 15 min

const _pinsV2 = new Map();
const _jobsV2 = new Map();
let _maxActivePinsPerOwnerV2 = PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER;
let _maxPendingJobsPerPinV2 = PERMMEM_DEFAULT_MAX_PENDING_JOBS_PER_PIN;
let _pinIdleMsV2 = PERMMEM_DEFAULT_PIN_IDLE_MS;
let _jobStuckMsV2 = PERMMEM_DEFAULT_JOB_STUCK_MS;

function _posIntPermMemV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActivePinsPerOwnerV2() {
  return _maxActivePinsPerOwnerV2;
}
export function setMaxActivePinsPerOwnerV2(n) {
  _maxActivePinsPerOwnerV2 = _posIntPermMemV2(n, "maxActivePinsPerOwner");
}
export function getMaxPendingJobsPerPinV2() {
  return _maxPendingJobsPerPinV2;
}
export function setMaxPendingJobsPerPinV2(n) {
  _maxPendingJobsPerPinV2 = _posIntPermMemV2(n, "maxPendingJobsPerPin");
}
export function getPinIdleMsV2() {
  return _pinIdleMsV2;
}
export function setPinIdleMsV2(n) {
  _pinIdleMsV2 = _posIntPermMemV2(n, "pinIdleMs");
}
export function getJobStuckMsV2() {
  return _jobStuckMsV2;
}
export function setJobStuckMsV2(n) {
  _jobStuckMsV2 = _posIntPermMemV2(n, "jobStuckMs");
}

export function getActivePinCountV2(ownerId) {
  let n = 0;
  for (const p of _pinsV2.values()) {
    if (p.ownerId === ownerId && p.status === "active") n += 1;
  }
  return n;
}

export function getPendingJobCountV2(pinId) {
  let n = 0;
  for (const j of _jobsV2.values()) {
    if (j.pinId === pinId && (j.status === "queued" || j.status === "running"))
      n += 1;
  }
  return n;
}

function _copyPinV2(p) {
  return { ...p, metadata: { ...p.metadata } };
}
function _copyJobV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerPinV2(
  id,
  { ownerId, label, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!ownerId || typeof ownerId !== "string")
    throw new Error("ownerId must be a string");
  if (!label || typeof label !== "string")
    throw new Error("label must be a string");
  if (_pinsV2.has(id)) throw new Error(`pin ${id} already exists`);
  const p = {
    id,
    ownerId,
    label,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _pinsV2.set(id, p);
  return _copyPinV2(p);
}

export function getPinV2(id) {
  const p = _pinsV2.get(id);
  return p ? _copyPinV2(p) : null;
}

export function listPinsV2({ ownerId, status } = {}) {
  const out = [];
  for (const p of _pinsV2.values()) {
    if (ownerId && p.ownerId !== ownerId) continue;
    if (status && p.status !== status) continue;
    out.push(_copyPinV2(p));
  }
  return out;
}

export function setPinStatusV2(id, next, { now = Date.now() } = {}) {
  const p = _pinsV2.get(id);
  if (!p) throw new Error(`pin ${id} not found`);
  if (!PIN_TRANSITIONS_V2.has(next))
    throw new Error(`unknown pin status: ${next}`);
  if (PIN_TERMINALS_V2.has(p.status))
    throw new Error(`pin ${id} is in terminal state ${p.status}`);
  const allowed = PIN_TRANSITIONS_V2.get(p.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition pin from ${p.status} to ${next}`);
  if (next === "active") {
    if (p.status === "pending") {
      const count = getActivePinCountV2(p.ownerId);
      if (count >= _maxActivePinsPerOwnerV2)
        throw new Error(
          `owner ${p.ownerId} already at active-pin cap (${_maxActivePinsPerOwnerV2})`,
        );
    }
    if (!p.activatedAt) p.activatedAt = now;
  }
  if (next === "archived" && !p.archivedAt) p.archivedAt = now;
  p.status = next;
  p.lastSeenAt = now;
  return _copyPinV2(p);
}

export function activatePinV2(id, opts) {
  return setPinStatusV2(id, "active", opts);
}
export function dormantPinV2(id, opts) {
  return setPinStatusV2(id, "dormant", opts);
}
export function archivePinV2(id, opts) {
  return setPinStatusV2(id, "archived", opts);
}

export function touchPinV2(id, { now = Date.now() } = {}) {
  const p = _pinsV2.get(id);
  if (!p) throw new Error(`pin ${id} not found`);
  p.lastSeenAt = now;
  return _copyPinV2(p);
}

export function createRetentionJobV2(
  id,
  { pinId, kind = "review", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!pinId || typeof pinId !== "string")
    throw new Error("pinId must be a string");
  if (_jobsV2.has(id)) throw new Error(`job ${id} already exists`);
  const count = getPendingJobCountV2(pinId);
  if (count >= _maxPendingJobsPerPinV2)
    throw new Error(
      `pin ${pinId} already at pending-job cap (${_maxPendingJobsPerPinV2})`,
    );
  const j = {
    id,
    pinId,
    kind,
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _jobsV2.set(id, j);
  return _copyJobV2(j);
}

export function getRetentionJobV2(id) {
  const j = _jobsV2.get(id);
  return j ? _copyJobV2(j) : null;
}

export function listRetentionJobsV2({ pinId, status } = {}) {
  const out = [];
  for (const j of _jobsV2.values()) {
    if (pinId && j.pinId !== pinId) continue;
    if (status && j.status !== status) continue;
    out.push(_copyJobV2(j));
  }
  return out;
}

export function setRetentionJobStatusV2(id, next, { now = Date.now() } = {}) {
  const j = _jobsV2.get(id);
  if (!j) throw new Error(`job ${id} not found`);
  if (!JOB_TRANSITIONS_V2.has(next))
    throw new Error(`unknown job status: ${next}`);
  if (JOB_TERMINALS_V2.has(j.status))
    throw new Error(`job ${id} is in terminal state ${j.status}`);
  const allowed = JOB_TRANSITIONS_V2.get(j.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition job from ${j.status} to ${next}`);
  if (next === "running" && !j.startedAt) j.startedAt = now;
  if (JOB_TERMINALS_V2.has(next) && !j.settledAt) j.settledAt = now;
  j.status = next;
  j.lastSeenAt = now;
  return _copyJobV2(j);
}

export function startRetentionJobV2(id, opts) {
  return setRetentionJobStatusV2(id, "running", opts);
}
export function completeRetentionJobV2(id, opts) {
  return setRetentionJobStatusV2(id, "completed", opts);
}
export function failRetentionJobV2(id, opts) {
  return setRetentionJobStatusV2(id, "failed", opts);
}
export function cancelRetentionJobV2(id, opts) {
  return setRetentionJobStatusV2(id, "cancelled", opts);
}

export function autoDormantIdlePinsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _pinsV2.values()) {
    if (p.status !== "active") continue;
    if (now - p.lastSeenAt > _pinIdleMsV2) {
      p.status = "dormant";
      p.lastSeenAt = now;
      flipped.push(_copyPinV2(p));
    }
  }
  return flipped;
}

export function autoFailStuckJobsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _jobsV2.values()) {
    if (j.status !== "running") continue;
    if (now - j.lastSeenAt > _jobStuckMsV2) {
      j.status = "failed";
      j.lastSeenAt = now;
      if (!j.settledAt) j.settledAt = now;
      flipped.push(_copyJobV2(j));
    }
  }
  return flipped;
}

export function getPermanentMemoryStatsV2() {
  const pinsByStatus = {};
  for (const v of Object.values(PIN_MATURITY_V2)) pinsByStatus[v] = 0;
  for (const p of _pinsV2.values()) pinsByStatus[p.status] += 1;

  const jobsByStatus = {};
  for (const v of Object.values(RETENTION_JOB_LIFECYCLE_V2))
    jobsByStatus[v] = 0;
  for (const j of _jobsV2.values()) jobsByStatus[j.status] += 1;

  return {
    totalPinsV2: _pinsV2.size,
    totalJobsV2: _jobsV2.size,
    maxActivePinsPerOwner: _maxActivePinsPerOwnerV2,
    maxPendingJobsPerPin: _maxPendingJobsPerPinV2,
    pinIdleMs: _pinIdleMsV2,
    jobStuckMs: _jobStuckMsV2,
    pinsByStatus,
    jobsByStatus,
  };
}

export function _resetStatePermanentMemoryV2() {
  _pinsV2.clear();
  _jobsV2.clear();
  _maxActivePinsPerOwnerV2 = PERMMEM_DEFAULT_MAX_ACTIVE_PINS_PER_OWNER;
  _maxPendingJobsPerPinV2 = PERMMEM_DEFAULT_MAX_PENDING_JOBS_PER_PIN;
  _pinIdleMsV2 = PERMMEM_DEFAULT_PIN_IDLE_MS;
  _jobStuckMsV2 = PERMMEM_DEFAULT_JOB_STUCK_MS;
}

// =====================================================================
// permanent-memory V2 governance overlay (iter23)
// =====================================================================
export const PMGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DORMANT: "dormant",
  ARCHIVED: "archived",
});
export const PMGOV_PIN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PINNING: "pinning",
  PINNED: "pinned",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pmgovPTrans = new Map([
  [
    PMGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PMGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PMGOV_PROFILE_MATURITY_V2.DORMANT,
      PMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMGOV_PROFILE_MATURITY_V2.DORMANT,
    new Set([
      PMGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PMGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pmgovPTerminal = new Set([PMGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pmgovJTrans = new Map([
  [
    PMGOV_PIN_LIFECYCLE_V2.QUEUED,
    new Set([PMGOV_PIN_LIFECYCLE_V2.PINNING, PMGOV_PIN_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    PMGOV_PIN_LIFECYCLE_V2.PINNING,
    new Set([
      PMGOV_PIN_LIFECYCLE_V2.PINNED,
      PMGOV_PIN_LIFECYCLE_V2.FAILED,
      PMGOV_PIN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PMGOV_PIN_LIFECYCLE_V2.PINNED, new Set()],
  [PMGOV_PIN_LIFECYCLE_V2.FAILED, new Set()],
  [PMGOV_PIN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pmgovPsV2 = new Map();
const _pmgovJsV2 = new Map();
let _pmgovMaxActive = 10,
  _pmgovMaxPending = 30,
  _pmgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _pmgovStuckMs = 60 * 1000;
function _pmgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pmgovCheckP(from, to) {
  const a = _pmgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmgov profile transition ${from} → ${to}`);
}
function _pmgovCheckJ(from, to) {
  const a = _pmgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmgov pin transition ${from} → ${to}`);
}
function _pmgovCountActive(owner) {
  let c = 0;
  for (const p of _pmgovPsV2.values())
    if (p.owner === owner && p.status === PMGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _pmgovCountPending(profileId) {
  let c = 0;
  for (const j of _pmgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PMGOV_PIN_LIFECYCLE_V2.QUEUED ||
        j.status === PMGOV_PIN_LIFECYCLE_V2.PINNING)
    )
      c++;
  return c;
}
export function setMaxActivePmgovProfilesPerOwnerV2(n) {
  _pmgovMaxActive = _pmgovPos(n, "maxActivePmgovProfilesPerOwner");
}
export function getMaxActivePmgovProfilesPerOwnerV2() {
  return _pmgovMaxActive;
}
export function setMaxPendingPmgovPinsPerProfileV2(n) {
  _pmgovMaxPending = _pmgovPos(n, "maxPendingPmgovPinsPerProfile");
}
export function getMaxPendingPmgovPinsPerProfileV2() {
  return _pmgovMaxPending;
}
export function setPmgovProfileIdleMsV2(n) {
  _pmgovIdleMs = _pmgovPos(n, "pmgovProfileIdleMs");
}
export function getPmgovProfileIdleMsV2() {
  return _pmgovIdleMs;
}
export function setPmgovPinStuckMsV2(n) {
  _pmgovStuckMs = _pmgovPos(n, "pmgovPinStuckMs");
}
export function getPmgovPinStuckMsV2() {
  return _pmgovStuckMs;
}
export function _resetStatePermanentMemoryGovV2() {
  _pmgovPsV2.clear();
  _pmgovJsV2.clear();
  _pmgovMaxActive = 10;
  _pmgovMaxPending = 30;
  _pmgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _pmgovStuckMs = 60 * 1000;
}
export function registerPmgovProfileV2({ id, owner, bucket, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pmgovPsV2.has(id)) throw new Error(`pmgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    bucket: bucket || "default",
    status: PMGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePmgovProfileV2(id) {
  const p = _pmgovPsV2.get(id);
  if (!p) throw new Error(`pmgov profile ${id} not found`);
  const isInitial = p.status === PMGOV_PROFILE_MATURITY_V2.PENDING;
  _pmgovCheckP(p.status, PMGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pmgovCountActive(p.owner) >= _pmgovMaxActive)
    throw new Error(`max active pmgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PMGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function dormantPmgovProfileV2(id) {
  const p = _pmgovPsV2.get(id);
  if (!p) throw new Error(`pmgov profile ${id} not found`);
  _pmgovCheckP(p.status, PMGOV_PROFILE_MATURITY_V2.DORMANT);
  p.status = PMGOV_PROFILE_MATURITY_V2.DORMANT;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePmgovProfileV2(id) {
  const p = _pmgovPsV2.get(id);
  if (!p) throw new Error(`pmgov profile ${id} not found`);
  _pmgovCheckP(p.status, PMGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PMGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPmgovProfileV2(id) {
  const p = _pmgovPsV2.get(id);
  if (!p) throw new Error(`pmgov profile ${id} not found`);
  if (_pmgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pmgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPmgovProfileV2(id) {
  const p = _pmgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPmgovProfilesV2() {
  return [..._pmgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPmgovPinV2({ id, profileId, key, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pmgovJsV2.has(id)) throw new Error(`pmgov pin ${id} already exists`);
  if (!_pmgovPsV2.has(profileId))
    throw new Error(`pmgov profile ${profileId} not found`);
  if (_pmgovCountPending(profileId) >= _pmgovMaxPending)
    throw new Error(`max pending pmgov pins for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    key: key || "",
    status: PMGOV_PIN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function pinningPmgovPinV2(id) {
  const j = _pmgovJsV2.get(id);
  if (!j) throw new Error(`pmgov pin ${id} not found`);
  _pmgovCheckJ(j.status, PMGOV_PIN_LIFECYCLE_V2.PINNING);
  const now = Date.now();
  j.status = PMGOV_PIN_LIFECYCLE_V2.PINNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completePinPmgovV2(id) {
  const j = _pmgovJsV2.get(id);
  if (!j) throw new Error(`pmgov pin ${id} not found`);
  _pmgovCheckJ(j.status, PMGOV_PIN_LIFECYCLE_V2.PINNED);
  const now = Date.now();
  j.status = PMGOV_PIN_LIFECYCLE_V2.PINNED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPmgovPinV2(id, reason) {
  const j = _pmgovJsV2.get(id);
  if (!j) throw new Error(`pmgov pin ${id} not found`);
  _pmgovCheckJ(j.status, PMGOV_PIN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PMGOV_PIN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPmgovPinV2(id, reason) {
  const j = _pmgovJsV2.get(id);
  if (!j) throw new Error(`pmgov pin ${id} not found`);
  _pmgovCheckJ(j.status, PMGOV_PIN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PMGOV_PIN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPmgovPinV2(id) {
  const j = _pmgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPmgovPinsV2() {
  return [..._pmgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDormantIdlePmgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pmgovPsV2.values())
    if (
      p.status === PMGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pmgovIdleMs
    ) {
      p.status = PMGOV_PROFILE_MATURITY_V2.DORMANT;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPmgovPinsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pmgovJsV2.values())
    if (
      j.status === PMGOV_PIN_LIFECYCLE_V2.PINNING &&
      j.startedAt != null &&
      t - j.startedAt >= _pmgovStuckMs
    ) {
      j.status = PMGOV_PIN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getPermanentMemoryGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PMGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pmgovPsV2.values()) profilesByStatus[p.status]++;
  const pinsByStatus = {};
  for (const v of Object.values(PMGOV_PIN_LIFECYCLE_V2)) pinsByStatus[v] = 0;
  for (const j of _pmgovJsV2.values()) pinsByStatus[j.status]++;
  return {
    totalPmgovProfilesV2: _pmgovPsV2.size,
    totalPmgovPinsV2: _pmgovJsV2.size,
    maxActivePmgovProfilesPerOwner: _pmgovMaxActive,
    maxPendingPmgovPinsPerProfile: _pmgovMaxPending,
    pmgovProfileIdleMs: _pmgovIdleMs,
    pmgovPinStuckMs: _pmgovStuckMs,
    profilesByStatus,
    pinsByStatus,
  };
}
