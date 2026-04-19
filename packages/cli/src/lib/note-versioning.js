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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Note governance layer.
 * Tracks per-author note maturity + per-note revision lifecycle
 * independent of legacy SQLite note_versions table.
 * ═══════════════════════════════════════════════════════════════ */

export const NOTE_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  LOCKED: "locked",
  ARCHIVED: "archived",
});

export const REVISION_LIFECYCLE_V2 = Object.freeze({
  PROPOSED: "proposed",
  REVIEWED: "reviewed",
  APPLIED: "applied",
  SUPERSEDED: "superseded",
  DISCARDED: "discarded",
});

const NOTE_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "archived"])],
  ["active", new Set(["locked", "archived"])],
  ["locked", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const NOTE_TERMINALS_V2 = new Set(["archived"]);

const REV_TRANSITIONS_V2 = new Map([
  ["proposed", new Set(["reviewed", "discarded"])],
  ["reviewed", new Set(["applied", "discarded", "superseded"])],
  ["applied", new Set(["superseded"])],
  ["superseded", new Set()],
  ["discarded", new Set()],
]);
const REV_TERMINALS_V2 = new Set(["superseded", "discarded"]);

export const NOTE_DEFAULT_MAX_ACTIVE_NOTES_PER_AUTHOR = 100;
export const NOTE_DEFAULT_MAX_OPEN_REVS_PER_NOTE = 10;
export const NOTE_DEFAULT_NOTE_IDLE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const NOTE_DEFAULT_REV_STUCK_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const _notesV2 = new Map();
const _revsV2 = new Map();
let _maxActiveNotesPerAuthorV2 = NOTE_DEFAULT_MAX_ACTIVE_NOTES_PER_AUTHOR;
let _maxOpenRevsPerNoteV2 = NOTE_DEFAULT_MAX_OPEN_REVS_PER_NOTE;
let _noteIdleMsV2 = NOTE_DEFAULT_NOTE_IDLE_MS;
let _revStuckMsV2 = NOTE_DEFAULT_REV_STUCK_MS;

function _posIntNoteV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveNotesPerAuthorV2() {
  return _maxActiveNotesPerAuthorV2;
}
export function setMaxActiveNotesPerAuthorV2(n) {
  _maxActiveNotesPerAuthorV2 = _posIntNoteV2(n, "maxActiveNotesPerAuthor");
}
export function getMaxOpenRevsPerNoteV2() {
  return _maxOpenRevsPerNoteV2;
}
export function setMaxOpenRevsPerNoteV2(n) {
  _maxOpenRevsPerNoteV2 = _posIntNoteV2(n, "maxOpenRevsPerNote");
}
export function getNoteIdleMsV2() {
  return _noteIdleMsV2;
}
export function setNoteIdleMsV2(n) {
  _noteIdleMsV2 = _posIntNoteV2(n, "noteIdleMs");
}
export function getRevStuckMsV2() {
  return _revStuckMsV2;
}
export function setRevStuckMsV2(n) {
  _revStuckMsV2 = _posIntNoteV2(n, "revStuckMs");
}

export function getActiveNoteCountV2(authorId) {
  let n = 0;
  for (const note of _notesV2.values()) {
    if (note.authorId === authorId && note.status === "active") n += 1;
  }
  return n;
}

export function getOpenRevCountV2(noteId) {
  let n = 0;
  for (const r of _revsV2.values()) {
    if (
      r.noteId === noteId &&
      (r.status === "proposed" || r.status === "reviewed")
    )
      n += 1;
  }
  return n;
}

function _copyNoteV2(n) {
  return { ...n, metadata: { ...n.metadata } };
}
function _copyRevV2(r) {
  return { ...r, metadata: { ...r.metadata } };
}

export function registerNoteV2(
  id,
  { authorId, title, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!authorId || typeof authorId !== "string")
    throw new Error("authorId must be a string");
  if (!title || typeof title !== "string")
    throw new Error("title must be a string");
  if (_notesV2.has(id)) throw new Error(`note ${id} already exists`);
  const note = {
    id,
    authorId,
    title,
    status: "draft",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _notesV2.set(id, note);
  return _copyNoteV2(note);
}

export function getNoteV2(id) {
  const note = _notesV2.get(id);
  return note ? _copyNoteV2(note) : null;
}

export function listNotesV2({ authorId, status } = {}) {
  const out = [];
  for (const note of _notesV2.values()) {
    if (authorId && note.authorId !== authorId) continue;
    if (status && note.status !== status) continue;
    out.push(_copyNoteV2(note));
  }
  return out;
}

export function setNoteStatusV2(id, next, { now = Date.now() } = {}) {
  const note = _notesV2.get(id);
  if (!note) throw new Error(`note ${id} not found`);
  if (!NOTE_TRANSITIONS_V2.has(next))
    throw new Error(`unknown note status: ${next}`);
  if (NOTE_TERMINALS_V2.has(note.status))
    throw new Error(`note ${id} is in terminal state ${note.status}`);
  const allowed = NOTE_TRANSITIONS_V2.get(note.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition note from ${note.status} to ${next}`);
  if (next === "active") {
    if (note.status === "draft") {
      const count = getActiveNoteCountV2(note.authorId);
      if (count >= _maxActiveNotesPerAuthorV2)
        throw new Error(
          `author ${note.authorId} already at active-note cap (${_maxActiveNotesPerAuthorV2})`,
        );
    }
    if (!note.activatedAt) note.activatedAt = now;
  }
  if (next === "archived" && !note.archivedAt) note.archivedAt = now;
  note.status = next;
  note.lastSeenAt = now;
  return _copyNoteV2(note);
}

export function activateNoteV2(id, opts) {
  return setNoteStatusV2(id, "active", opts);
}
export function lockNoteV2(id, opts) {
  return setNoteStatusV2(id, "locked", opts);
}
export function archiveNoteV2(id, opts) {
  return setNoteStatusV2(id, "archived", opts);
}

export function touchNoteV2(id, { now = Date.now() } = {}) {
  const note = _notesV2.get(id);
  if (!note) throw new Error(`note ${id} not found`);
  note.lastSeenAt = now;
  return _copyNoteV2(note);
}

export function createRevisionV2(
  id,
  { noteId, summary, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!noteId || typeof noteId !== "string")
    throw new Error("noteId must be a string");
  if (!summary || typeof summary !== "string")
    throw new Error("summary must be a string");
  if (_revsV2.has(id)) throw new Error(`revision ${id} already exists`);
  const count = getOpenRevCountV2(noteId);
  if (count >= _maxOpenRevsPerNoteV2)
    throw new Error(
      `note ${noteId} already at open-revision cap (${_maxOpenRevsPerNoteV2})`,
    );
  const r = {
    id,
    noteId,
    summary,
    status: "proposed",
    createdAt: now,
    lastSeenAt: now,
    reviewedAt: null,
    appliedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _revsV2.set(id, r);
  return _copyRevV2(r);
}

export function getRevisionV2(id) {
  const r = _revsV2.get(id);
  return r ? _copyRevV2(r) : null;
}

export function listRevisionsV2({ noteId, status } = {}) {
  const out = [];
  for (const r of _revsV2.values()) {
    if (noteId && r.noteId !== noteId) continue;
    if (status && r.status !== status) continue;
    out.push(_copyRevV2(r));
  }
  return out;
}

export function setRevisionStatusV2(id, next, { now = Date.now() } = {}) {
  const r = _revsV2.get(id);
  if (!r) throw new Error(`revision ${id} not found`);
  if (!REV_TRANSITIONS_V2.has(next))
    throw new Error(`unknown revision status: ${next}`);
  if (REV_TERMINALS_V2.has(r.status))
    throw new Error(`revision ${id} is in terminal state ${r.status}`);
  const allowed = REV_TRANSITIONS_V2.get(r.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition revision from ${r.status} to ${next}`);
  if (next === "reviewed" && !r.reviewedAt) r.reviewedAt = now;
  if (next === "applied" && !r.appliedAt) r.appliedAt = now;
  if (REV_TERMINALS_V2.has(next) && !r.settledAt) r.settledAt = now;
  r.status = next;
  r.lastSeenAt = now;
  return _copyRevV2(r);
}

export function reviewRevisionV2(id, opts) {
  return setRevisionStatusV2(id, "reviewed", opts);
}
export function applyRevisionV2(id, opts) {
  return setRevisionStatusV2(id, "applied", opts);
}
export function supersedeRevisionV2(id, opts) {
  return setRevisionStatusV2(id, "superseded", opts);
}
export function discardRevisionV2(id, opts) {
  return setRevisionStatusV2(id, "discarded", opts);
}

export function autoLockIdleNotesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const note of _notesV2.values()) {
    if (note.status !== "active") continue;
    if (now - note.lastSeenAt > _noteIdleMsV2) {
      note.status = "locked";
      note.lastSeenAt = now;
      flipped.push(_copyNoteV2(note));
    }
  }
  return flipped;
}

export function autoDiscardStaleRevisionsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const r of _revsV2.values()) {
    if (r.status !== "proposed" && r.status !== "reviewed") continue;
    if (now - r.lastSeenAt > _revStuckMsV2) {
      r.status = "discarded";
      r.lastSeenAt = now;
      if (!r.settledAt) r.settledAt = now;
      flipped.push(_copyRevV2(r));
    }
  }
  return flipped;
}

export function getNoteVersioningStatsV2() {
  const notesByStatus = {};
  for (const v of Object.values(NOTE_MATURITY_V2)) notesByStatus[v] = 0;
  for (const note of _notesV2.values()) notesByStatus[note.status] += 1;

  const revisionsByStatus = {};
  for (const v of Object.values(REVISION_LIFECYCLE_V2))
    revisionsByStatus[v] = 0;
  for (const r of _revsV2.values()) revisionsByStatus[r.status] += 1;

  return {
    totalNotesV2: _notesV2.size,
    totalRevisionsV2: _revsV2.size,
    maxActiveNotesPerAuthor: _maxActiveNotesPerAuthorV2,
    maxOpenRevsPerNote: _maxOpenRevsPerNoteV2,
    noteIdleMs: _noteIdleMsV2,
    revStuckMs: _revStuckMsV2,
    notesByStatus,
    revisionsByStatus,
  };
}

export function _resetStateNoteVersioningV2() {
  _notesV2.clear();
  _revsV2.clear();
  _maxActiveNotesPerAuthorV2 = NOTE_DEFAULT_MAX_ACTIVE_NOTES_PER_AUTHOR;
  _maxOpenRevsPerNoteV2 = NOTE_DEFAULT_MAX_OPEN_REVS_PER_NOTE;
  _noteIdleMsV2 = NOTE_DEFAULT_NOTE_IDLE_MS;
  _revStuckMsV2 = NOTE_DEFAULT_REV_STUCK_MS;
}

// =====================================================================
// note-versioning V2 governance overlay (iter23)
// =====================================================================
export const NTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const NTGOV_REVISION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  REVIEWING: "reviewing",
  MERGED: "merged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ntgovPTrans = new Map([
  [
    NTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      NTGOV_PROFILE_MATURITY_V2.ACTIVE,
      NTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    NTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      NTGOV_PROFILE_MATURITY_V2.STALE,
      NTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    NTGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      NTGOV_PROFILE_MATURITY_V2.ACTIVE,
      NTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [NTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ntgovPTerminal = new Set([NTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ntgovJTrans = new Map([
  [
    NTGOV_REVISION_LIFECYCLE_V2.QUEUED,
    new Set([
      NTGOV_REVISION_LIFECYCLE_V2.REVIEWING,
      NTGOV_REVISION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    NTGOV_REVISION_LIFECYCLE_V2.REVIEWING,
    new Set([
      NTGOV_REVISION_LIFECYCLE_V2.MERGED,
      NTGOV_REVISION_LIFECYCLE_V2.FAILED,
      NTGOV_REVISION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [NTGOV_REVISION_LIFECYCLE_V2.MERGED, new Set()],
  [NTGOV_REVISION_LIFECYCLE_V2.FAILED, new Set()],
  [NTGOV_REVISION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ntgovPsV2 = new Map();
const _ntgovJsV2 = new Map();
let _ntgovMaxActive = 10,
  _ntgovMaxPending = 30,
  _ntgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ntgovStuckMs = 60 * 1000;
function _ntgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ntgovCheckP(from, to) {
  const a = _ntgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ntgov profile transition ${from} → ${to}`);
}
function _ntgovCheckJ(from, to) {
  const a = _ntgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ntgov revision transition ${from} → ${to}`);
}
function _ntgovCountActive(owner) {
  let c = 0;
  for (const p of _ntgovPsV2.values())
    if (p.owner === owner && p.status === NTGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _ntgovCountPending(profileId) {
  let c = 0;
  for (const j of _ntgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === NTGOV_REVISION_LIFECYCLE_V2.QUEUED ||
        j.status === NTGOV_REVISION_LIFECYCLE_V2.REVIEWING)
    )
      c++;
  return c;
}
export function setMaxActiveNtgovProfilesPerOwnerV2(n) {
  _ntgovMaxActive = _ntgovPos(n, "maxActiveNtgovProfilesPerOwner");
}
export function getMaxActiveNtgovProfilesPerOwnerV2() {
  return _ntgovMaxActive;
}
export function setMaxPendingNtgovRevisionsPerProfileV2(n) {
  _ntgovMaxPending = _ntgovPos(n, "maxPendingNtgovRevisionsPerProfile");
}
export function getMaxPendingNtgovRevisionsPerProfileV2() {
  return _ntgovMaxPending;
}
export function setNtgovProfileIdleMsV2(n) {
  _ntgovIdleMs = _ntgovPos(n, "ntgovProfileIdleMs");
}
export function getNtgovProfileIdleMsV2() {
  return _ntgovIdleMs;
}
export function setNtgovRevisionStuckMsV2(n) {
  _ntgovStuckMs = _ntgovPos(n, "ntgovRevisionStuckMs");
}
export function getNtgovRevisionStuckMsV2() {
  return _ntgovStuckMs;
}
export function _resetStateNoteVersioningGovV2() {
  _ntgovPsV2.clear();
  _ntgovJsV2.clear();
  _ntgovMaxActive = 10;
  _ntgovMaxPending = 30;
  _ntgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ntgovStuckMs = 60 * 1000;
}
export function registerNtgovProfileV2({ id, owner, series, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ntgovPsV2.has(id)) throw new Error(`ntgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    series: series || "default",
    status: NTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ntgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateNtgovProfileV2(id) {
  const p = _ntgovPsV2.get(id);
  if (!p) throw new Error(`ntgov profile ${id} not found`);
  const isInitial = p.status === NTGOV_PROFILE_MATURITY_V2.PENDING;
  _ntgovCheckP(p.status, NTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ntgovCountActive(p.owner) >= _ntgovMaxActive)
    throw new Error(`max active ntgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = NTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleNtgovProfileV2(id) {
  const p = _ntgovPsV2.get(id);
  if (!p) throw new Error(`ntgov profile ${id} not found`);
  _ntgovCheckP(p.status, NTGOV_PROFILE_MATURITY_V2.STALE);
  p.status = NTGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveNtgovProfileV2(id) {
  const p = _ntgovPsV2.get(id);
  if (!p) throw new Error(`ntgov profile ${id} not found`);
  _ntgovCheckP(p.status, NTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = NTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchNtgovProfileV2(id) {
  const p = _ntgovPsV2.get(id);
  if (!p) throw new Error(`ntgov profile ${id} not found`);
  if (_ntgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ntgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getNtgovProfileV2(id) {
  const p = _ntgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listNtgovProfilesV2() {
  return [..._ntgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createNtgovRevisionV2({
  id,
  profileId,
  author,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ntgovJsV2.has(id))
    throw new Error(`ntgov revision ${id} already exists`);
  if (!_ntgovPsV2.has(profileId))
    throw new Error(`ntgov profile ${profileId} not found`);
  if (_ntgovCountPending(profileId) >= _ntgovMaxPending)
    throw new Error(
      `max pending ntgov revisions for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    author: author || "",
    status: NTGOV_REVISION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ntgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function reviewingNtgovRevisionV2(id) {
  const j = _ntgovJsV2.get(id);
  if (!j) throw new Error(`ntgov revision ${id} not found`);
  _ntgovCheckJ(j.status, NTGOV_REVISION_LIFECYCLE_V2.REVIEWING);
  const now = Date.now();
  j.status = NTGOV_REVISION_LIFECYCLE_V2.REVIEWING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRevisionNtgovV2(id) {
  const j = _ntgovJsV2.get(id);
  if (!j) throw new Error(`ntgov revision ${id} not found`);
  _ntgovCheckJ(j.status, NTGOV_REVISION_LIFECYCLE_V2.MERGED);
  const now = Date.now();
  j.status = NTGOV_REVISION_LIFECYCLE_V2.MERGED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failNtgovRevisionV2(id, reason) {
  const j = _ntgovJsV2.get(id);
  if (!j) throw new Error(`ntgov revision ${id} not found`);
  _ntgovCheckJ(j.status, NTGOV_REVISION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = NTGOV_REVISION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelNtgovRevisionV2(id, reason) {
  const j = _ntgovJsV2.get(id);
  if (!j) throw new Error(`ntgov revision ${id} not found`);
  _ntgovCheckJ(j.status, NTGOV_REVISION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = NTGOV_REVISION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getNtgovRevisionV2(id) {
  const j = _ntgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listNtgovRevisionsV2() {
  return [..._ntgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleNtgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ntgovPsV2.values())
    if (
      p.status === NTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ntgovIdleMs
    ) {
      p.status = NTGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckNtgovRevisionsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ntgovJsV2.values())
    if (
      j.status === NTGOV_REVISION_LIFECYCLE_V2.REVIEWING &&
      j.startedAt != null &&
      t - j.startedAt >= _ntgovStuckMs
    ) {
      j.status = NTGOV_REVISION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getNoteVersioningGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(NTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ntgovPsV2.values()) profilesByStatus[p.status]++;
  const revisionsByStatus = {};
  for (const v of Object.values(NTGOV_REVISION_LIFECYCLE_V2))
    revisionsByStatus[v] = 0;
  for (const j of _ntgovJsV2.values()) revisionsByStatus[j.status]++;
  return {
    totalNtgovProfilesV2: _ntgovPsV2.size,
    totalNtgovRevisionsV2: _ntgovJsV2.size,
    maxActiveNtgovProfilesPerOwner: _ntgovMaxActive,
    maxPendingNtgovRevisionsPerProfile: _ntgovMaxPending,
    ntgovProfileIdleMs: _ntgovIdleMs,
    ntgovRevisionStuckMs: _ntgovStuckMs,
    profilesByStatus,
    revisionsByStatus,
  };
}
