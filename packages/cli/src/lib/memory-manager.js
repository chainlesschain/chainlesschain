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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Memory governance layer.
 * Tracks per-category entry maturity + consolidation job lifecycle
 * independent of legacy SQLite memory_entries table.
 * ═══════════════════════════════════════════════════════════════ */

export const ENTRY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PARKED: "parked",
  ARCHIVED: "archived",
});

export const CONSOLIDATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const ENTRY_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "archived"])],
  ["active", new Set(["parked", "archived"])],
  ["parked", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const ENTRY_TERMINALS_V2 = new Set(["archived"]);

const JOB_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["succeeded", "failed", "cancelled"])],
  ["succeeded", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const JOB_TERMINALS_V2 = new Set(["succeeded", "failed", "cancelled"]);

export const MEMORY_DEFAULT_MAX_ACTIVE_ENTRIES_PER_CATEGORY = 200;
export const MEMORY_DEFAULT_MAX_RUNNING_JOBS_PER_SOURCE = 2;
export const MEMORY_DEFAULT_ENTRY_IDLE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
export const MEMORY_DEFAULT_JOB_STUCK_MS = 1000 * 60 * 10; // 10 minutes

const _entriesV2 = new Map();
const _jobsV2 = new Map();
let _maxActiveEntriesPerCategoryV2 =
  MEMORY_DEFAULT_MAX_ACTIVE_ENTRIES_PER_CATEGORY;
let _maxRunningJobsPerSourceV2 = MEMORY_DEFAULT_MAX_RUNNING_JOBS_PER_SOURCE;
let _entryIdleMsV2 = MEMORY_DEFAULT_ENTRY_IDLE_MS;
let _jobStuckMsV2 = MEMORY_DEFAULT_JOB_STUCK_MS;

function _posIntMemoryV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveEntriesPerCategoryV2() {
  return _maxActiveEntriesPerCategoryV2;
}
export function setMaxActiveEntriesPerCategoryV2(n) {
  _maxActiveEntriesPerCategoryV2 = _posIntMemoryV2(
    n,
    "maxActiveEntriesPerCategory",
  );
}
export function getMaxRunningJobsPerSourceV2() {
  return _maxRunningJobsPerSourceV2;
}
export function setMaxRunningJobsPerSourceV2(n) {
  _maxRunningJobsPerSourceV2 = _posIntMemoryV2(n, "maxRunningJobsPerSource");
}
export function getEntryIdleMsV2() {
  return _entryIdleMsV2;
}
export function setEntryIdleMsV2(n) {
  _entryIdleMsV2 = _posIntMemoryV2(n, "entryIdleMs");
}
export function getJobStuckMsV2() {
  return _jobStuckMsV2;
}
export function setJobStuckMsV2(n) {
  _jobStuckMsV2 = _posIntMemoryV2(n, "jobStuckMs");
}

export function getActiveEntryCountV2(category) {
  let n = 0;
  for (const e of _entriesV2.values()) {
    if (e.category === category && e.status === "active") n += 1;
  }
  return n;
}

export function getRunningJobCountV2(source) {
  let n = 0;
  for (const j of _jobsV2.values()) {
    if (j.source === source && j.status === "running") n += 1;
  }
  return n;
}

function _copyEntryV2(e) {
  return { ...e, metadata: { ...e.metadata } };
}
function _copyJobV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerEntryV2(
  id,
  { category, summary, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!category || typeof category !== "string")
    throw new Error("category must be a string");
  if (!summary || typeof summary !== "string")
    throw new Error("summary must be a string");
  if (_entriesV2.has(id)) throw new Error(`entry ${id} already exists`);
  const e = {
    id,
    category,
    summary,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _entriesV2.set(id, e);
  return _copyEntryV2(e);
}

export function getEntryV2(id) {
  const e = _entriesV2.get(id);
  return e ? _copyEntryV2(e) : null;
}

export function listEntriesV2({ category, status } = {}) {
  const out = [];
  for (const e of _entriesV2.values()) {
    if (category && e.category !== category) continue;
    if (status && e.status !== status) continue;
    out.push(_copyEntryV2(e));
  }
  return out;
}

export function setEntryStatusV2(id, next, { now = Date.now() } = {}) {
  const e = _entriesV2.get(id);
  if (!e) throw new Error(`entry ${id} not found`);
  if (!ENTRY_TRANSITIONS_V2.has(next))
    throw new Error(`unknown entry status: ${next}`);
  if (ENTRY_TERMINALS_V2.has(e.status))
    throw new Error(`entry ${id} is in terminal state ${e.status}`);
  const allowed = ENTRY_TRANSITIONS_V2.get(e.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition entry from ${e.status} to ${next}`);
  if (next === "active") {
    if (e.status === "pending") {
      const count = getActiveEntryCountV2(e.category);
      if (count >= _maxActiveEntriesPerCategoryV2)
        throw new Error(
          `category ${e.category} already at active-entry cap (${_maxActiveEntriesPerCategoryV2})`,
        );
    }
    if (!e.activatedAt) e.activatedAt = now;
  }
  if (next === "archived" && !e.archivedAt) e.archivedAt = now;
  e.status = next;
  e.lastSeenAt = now;
  return _copyEntryV2(e);
}

export function activateEntryV2(id, opts) {
  return setEntryStatusV2(id, "active", opts);
}
export function parkEntryV2(id, opts) {
  return setEntryStatusV2(id, "parked", opts);
}
export function archiveEntryV2(id, opts) {
  return setEntryStatusV2(id, "archived", opts);
}

export function touchEntryV2(id, { now = Date.now() } = {}) {
  const e = _entriesV2.get(id);
  if (!e) throw new Error(`entry ${id} not found`);
  e.lastSeenAt = now;
  return _copyEntryV2(e);
}

export function createConsolidationJobV2(
  id,
  { source, scope, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!source || typeof source !== "string")
    throw new Error("source must be a string");
  if (!scope || typeof scope !== "string")
    throw new Error("scope must be a string");
  if (_jobsV2.has(id)) throw new Error(`job ${id} already exists`);
  const j = {
    id,
    source,
    scope,
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    metadata: { ...metadata },
  };
  _jobsV2.set(id, j);
  return _copyJobV2(j);
}

export function getConsolidationJobV2(id) {
  const j = _jobsV2.get(id);
  return j ? _copyJobV2(j) : null;
}

export function listConsolidationJobsV2({ source, status } = {}) {
  const out = [];
  for (const j of _jobsV2.values()) {
    if (source && j.source !== source) continue;
    if (status && j.status !== status) continue;
    out.push(_copyJobV2(j));
  }
  return out;
}

export function setJobStatusV2(id, next, { now = Date.now() } = {}) {
  const j = _jobsV2.get(id);
  if (!j) throw new Error(`job ${id} not found`);
  if (!JOB_TRANSITIONS_V2.has(next))
    throw new Error(`unknown job status: ${next}`);
  if (JOB_TERMINALS_V2.has(j.status))
    throw new Error(`job ${id} is in terminal state ${j.status}`);
  const allowed = JOB_TRANSITIONS_V2.get(j.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition job from ${j.status} to ${next}`);
  if (next === "running") {
    if (j.status === "queued") {
      const count = getRunningJobCountV2(j.source);
      if (count >= _maxRunningJobsPerSourceV2)
        throw new Error(
          `source ${j.source} already at running-job cap (${_maxRunningJobsPerSourceV2})`,
        );
    }
    if (!j.startedAt) j.startedAt = now;
  }
  if (JOB_TERMINALS_V2.has(next) && !j.finishedAt) j.finishedAt = now;
  j.status = next;
  j.lastSeenAt = now;
  return _copyJobV2(j);
}

export function startConsolidationJobV2(id, opts) {
  return setJobStatusV2(id, "running", opts);
}
export function succeedConsolidationJobV2(id, opts) {
  return setJobStatusV2(id, "succeeded", opts);
}
export function failConsolidationJobV2(id, opts) {
  return setJobStatusV2(id, "failed", opts);
}
export function cancelConsolidationJobV2(id, opts) {
  return setJobStatusV2(id, "cancelled", opts);
}

export function autoParkIdleEntriesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const e of _entriesV2.values()) {
    if (e.status !== "active") continue;
    if (now - e.lastSeenAt > _entryIdleMsV2) {
      e.status = "parked";
      e.lastSeenAt = now;
      flipped.push(_copyEntryV2(e));
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
      if (!j.finishedAt) j.finishedAt = now;
      flipped.push(_copyJobV2(j));
    }
  }
  return flipped;
}

export function getMemoryManagerStatsV2() {
  const entriesByStatus = {};
  for (const v of Object.values(ENTRY_MATURITY_V2)) entriesByStatus[v] = 0;
  for (const e of _entriesV2.values()) entriesByStatus[e.status] += 1;

  const jobsByStatus = {};
  for (const v of Object.values(CONSOLIDATION_LIFECYCLE_V2))
    jobsByStatus[v] = 0;
  for (const j of _jobsV2.values()) jobsByStatus[j.status] += 1;

  return {
    totalEntriesV2: _entriesV2.size,
    totalJobsV2: _jobsV2.size,
    maxActiveEntriesPerCategory: _maxActiveEntriesPerCategoryV2,
    maxRunningJobsPerSource: _maxRunningJobsPerSourceV2,
    entryIdleMs: _entryIdleMsV2,
    jobStuckMs: _jobStuckMsV2,
    entriesByStatus,
    jobsByStatus,
  };
}

export function _resetStateMemoryManagerV2() {
  _entriesV2.clear();
  _jobsV2.clear();
  _maxActiveEntriesPerCategoryV2 =
    MEMORY_DEFAULT_MAX_ACTIVE_ENTRIES_PER_CATEGORY;
  _maxRunningJobsPerSourceV2 = MEMORY_DEFAULT_MAX_RUNNING_JOBS_PER_SOURCE;
  _entryIdleMsV2 = MEMORY_DEFAULT_ENTRY_IDLE_MS;
  _jobStuckMsV2 = MEMORY_DEFAULT_JOB_STUCK_MS;
}

// =====================================================================
// memory-manager V2 governance overlay (iter21)
// =====================================================================
export const MEMGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const MEMGOV_RECALL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RECALLING: "recalling",
  RECALLED: "recalled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _memgovPTrans = new Map([
  [
    MEMGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      MEMGOV_PROFILE_MATURITY_V2.ACTIVE,
      MEMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MEMGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      MEMGOV_PROFILE_MATURITY_V2.STALE,
      MEMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MEMGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      MEMGOV_PROFILE_MATURITY_V2.ACTIVE,
      MEMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [MEMGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _memgovPTerminal = new Set([MEMGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _memgovJTrans = new Map([
  [
    MEMGOV_RECALL_LIFECYCLE_V2.QUEUED,
    new Set([
      MEMGOV_RECALL_LIFECYCLE_V2.RECALLING,
      MEMGOV_RECALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MEMGOV_RECALL_LIFECYCLE_V2.RECALLING,
    new Set([
      MEMGOV_RECALL_LIFECYCLE_V2.RECALLED,
      MEMGOV_RECALL_LIFECYCLE_V2.FAILED,
      MEMGOV_RECALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MEMGOV_RECALL_LIFECYCLE_V2.RECALLED, new Set()],
  [MEMGOV_RECALL_LIFECYCLE_V2.FAILED, new Set()],
  [MEMGOV_RECALL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _memgovPsV2 = new Map();
const _memgovJsV2 = new Map();
let _memgovMaxActive = 10,
  _memgovMaxPending = 30,
  _memgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _memgovStuckMs = 60 * 1000;
function _memgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _memgovCheckP(from, to) {
  const a = _memgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid memgov profile transition ${from} → ${to}`);
}
function _memgovCheckJ(from, to) {
  const a = _memgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid memgov recall transition ${from} → ${to}`);
}
function _memgovCountActive(owner) {
  let c = 0;
  for (const p of _memgovPsV2.values())
    if (p.owner === owner && p.status === MEMGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _memgovCountPending(profileId) {
  let c = 0;
  for (const j of _memgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === MEMGOV_RECALL_LIFECYCLE_V2.QUEUED ||
        j.status === MEMGOV_RECALL_LIFECYCLE_V2.RECALLING)
    )
      c++;
  return c;
}
export function setMaxActiveMemgovProfilesPerOwnerV2(n) {
  _memgovMaxActive = _memgovPos(n, "maxActiveMemgovProfilesPerOwner");
}
export function getMaxActiveMemgovProfilesPerOwnerV2() {
  return _memgovMaxActive;
}
export function setMaxPendingMemgovRecallsPerProfileV2(n) {
  _memgovMaxPending = _memgovPos(n, "maxPendingMemgovRecallsPerProfile");
}
export function getMaxPendingMemgovRecallsPerProfileV2() {
  return _memgovMaxPending;
}
export function setMemgovProfileIdleMsV2(n) {
  _memgovIdleMs = _memgovPos(n, "memgovProfileIdleMs");
}
export function getMemgovProfileIdleMsV2() {
  return _memgovIdleMs;
}
export function setMemgovRecallStuckMsV2(n) {
  _memgovStuckMs = _memgovPos(n, "memgovRecallStuckMs");
}
export function getMemgovRecallStuckMsV2() {
  return _memgovStuckMs;
}
export function _resetStateMemoryManagerGovV2() {
  _memgovPsV2.clear();
  _memgovJsV2.clear();
  _memgovMaxActive = 10;
  _memgovMaxPending = 30;
  _memgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _memgovStuckMs = 60 * 1000;
}
export function registerMemgovProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_memgovPsV2.has(id))
    throw new Error(`memgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    scope: scope || "user",
    status: MEMGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _memgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateMemgovProfileV2(id) {
  const p = _memgovPsV2.get(id);
  if (!p) throw new Error(`memgov profile ${id} not found`);
  const isInitial = p.status === MEMGOV_PROFILE_MATURITY_V2.PENDING;
  _memgovCheckP(p.status, MEMGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _memgovCountActive(p.owner) >= _memgovMaxActive)
    throw new Error(`max active memgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = MEMGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleMemgovProfileV2(id) {
  const p = _memgovPsV2.get(id);
  if (!p) throw new Error(`memgov profile ${id} not found`);
  _memgovCheckP(p.status, MEMGOV_PROFILE_MATURITY_V2.STALE);
  p.status = MEMGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveMemgovProfileV2(id) {
  const p = _memgovPsV2.get(id);
  if (!p) throw new Error(`memgov profile ${id} not found`);
  _memgovCheckP(p.status, MEMGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = MEMGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchMemgovProfileV2(id) {
  const p = _memgovPsV2.get(id);
  if (!p) throw new Error(`memgov profile ${id} not found`);
  if (_memgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal memgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getMemgovProfileV2(id) {
  const p = _memgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listMemgovProfilesV2() {
  return [..._memgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createMemgovRecallV2({ id, profileId, key, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_memgovJsV2.has(id))
    throw new Error(`memgov recall ${id} already exists`);
  if (!_memgovPsV2.has(profileId))
    throw new Error(`memgov profile ${profileId} not found`);
  if (_memgovCountPending(profileId) >= _memgovMaxPending)
    throw new Error(
      `max pending memgov recalls for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    key: key || "",
    status: MEMGOV_RECALL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _memgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function recallingMemgovRecallV2(id) {
  const j = _memgovJsV2.get(id);
  if (!j) throw new Error(`memgov recall ${id} not found`);
  _memgovCheckJ(j.status, MEMGOV_RECALL_LIFECYCLE_V2.RECALLING);
  const now = Date.now();
  j.status = MEMGOV_RECALL_LIFECYCLE_V2.RECALLING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRecallMemgovV2(id) {
  const j = _memgovJsV2.get(id);
  if (!j) throw new Error(`memgov recall ${id} not found`);
  _memgovCheckJ(j.status, MEMGOV_RECALL_LIFECYCLE_V2.RECALLED);
  const now = Date.now();
  j.status = MEMGOV_RECALL_LIFECYCLE_V2.RECALLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failMemgovRecallV2(id, reason) {
  const j = _memgovJsV2.get(id);
  if (!j) throw new Error(`memgov recall ${id} not found`);
  _memgovCheckJ(j.status, MEMGOV_RECALL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = MEMGOV_RECALL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelMemgovRecallV2(id, reason) {
  const j = _memgovJsV2.get(id);
  if (!j) throw new Error(`memgov recall ${id} not found`);
  _memgovCheckJ(j.status, MEMGOV_RECALL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = MEMGOV_RECALL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getMemgovRecallV2(id) {
  const j = _memgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listMemgovRecallsV2() {
  return [..._memgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleMemgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _memgovPsV2.values())
    if (
      p.status === MEMGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _memgovIdleMs
    ) {
      p.status = MEMGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMemgovRecallsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _memgovJsV2.values())
    if (
      j.status === MEMGOV_RECALL_LIFECYCLE_V2.RECALLING &&
      j.startedAt != null &&
      t - j.startedAt >= _memgovStuckMs
    ) {
      j.status = MEMGOV_RECALL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getMemoryManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(MEMGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _memgovPsV2.values()) profilesByStatus[p.status]++;
  const recallsByStatus = {};
  for (const v of Object.values(MEMGOV_RECALL_LIFECYCLE_V2))
    recallsByStatus[v] = 0;
  for (const j of _memgovJsV2.values()) recallsByStatus[j.status]++;
  return {
    totalMemgovProfilesV2: _memgovPsV2.size,
    totalMemgovRecallsV2: _memgovJsV2.size,
    maxActiveMemgovProfilesPerOwner: _memgovMaxActive,
    maxPendingMemgovRecallsPerProfile: _memgovMaxPending,
    memgovProfileIdleMs: _memgovIdleMs,
    memgovRecallStuckMs: _memgovStuckMs,
    profilesByStatus,
    recallsByStatus,
  };
}
