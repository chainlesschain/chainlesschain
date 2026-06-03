/**
 * Knowledge exporter — export notes to Markdown files or static HTML site.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * Ensure the notes table exists
 */
function ensureNotesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )
  `);
}

/**
 * Fetch all active notes from the database.
 */
export function fetchNotes(db, { category, tag, limit } = {}) {
  ensureNotesTable(db);

  let sql = "SELECT * FROM notes WHERE deleted_at IS NULL";
  const params = [];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }

  sql += " ORDER BY created_at DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  let notes = db.prepare(sql).all(...params);

  // Filter by tag in-memory
  if (tag) {
    notes = notes.filter((n) => {
      try {
        const tags = JSON.parse(n.tags || "[]");
        return tags.includes(tag);
      } catch {
        return false;
      }
    });
  }

  return notes;
}

/**
 * Sanitize a filename (remove invalid characters).
 */
export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 200);
}

// ─── Markdown Export ────────────────────────────────────────────────

/**
 * Convert a note to markdown with YAML frontmatter.
 */
export function noteToMarkdown(note) {
  const tags = JSON.parse(note.tags || "[]");
  const lines = [
    "---",
    `title: "${note.title.replace(/"/g, '\\"')}"`,
    `category: ${note.category || "general"}`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `date: ${note.created_at || ""}`,
    `id: ${note.id}`,
    "---",
    "",
    `# ${note.title}`,
    "",
    note.content || "",
  ];

  return lines.join("\n");
}

/**
 * Export notes to a directory as individual markdown files.
 * Groups notes by category into subdirectories.
 */
export function exportToMarkdown(db, outputDir, options = {}) {
  const notes = fetchNotes(db, options);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const exported = [];

  for (const note of notes) {
    const category = note.category || "general";
    const catDir = join(outputDir, sanitizeFilename(category));
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }

    const filename = `${sanitizeFilename(note.title)}.md`;
    const filePath = join(catDir, filename);
    const markdown = noteToMarkdown(note);

    writeFileSync(filePath, markdown, "utf-8");
    exported.push({
      id: note.id,
      title: note.title,
      path: `${category}/${filename}`,
    });
  }

  return exported;
}

// ─── Static HTML Site Export ────────────────────────────────────────

/**
 * Generate a minimal HTML page for a note.
 */
export function noteToHtml(note) {
  const tags = JSON.parse(note.tags || "[]");
  const tagsHtml = tags
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join(" ");
  const contentHtml = markdownToSimpleHtml(note.content || "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title)}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <nav><a href="../index.html">Home</a></nav>
  <article>
    <h1>${escapeHtml(note.title)}</h1>
    <div class="meta">
      <time>${note.created_at || ""}</time>
      <span class="category">${escapeHtml(note.category || "general")}</span>
      ${tagsHtml}
    </div>
    <div class="content">${contentHtml}</div>
  </article>
</body>
</html>`;
}

/**
 * Generate the index page listing all notes.
 */
export function generateIndexHtml(
  notes,
  siteTitle = "ChainlessChain Knowledge Base",
) {
  const noteLinks = notes
    .map((n) => {
      const tags = JSON.parse(n.tags || "[]");
      const tagsHtml = tags
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join(" ");
      const cat = sanitizeFilename(n.category || "general");
      const file = sanitizeFilename(n.title) + ".html";
      return `<li>
        <a href="${cat}/${file}">${escapeHtml(n.title)}</a>
        <span class="category">${escapeHtml(n.category || "general")}</span>
        ${tagsHtml}
        <time>${n.created_at || ""}</time>
      </li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><h1>${escapeHtml(siteTitle)}</h1></header>
  <main>
    <p>${notes.length} notes</p>
    <ul class="note-list">${noteLinks}</ul>
  </main>
</body>
</html>`;
}

/**
 * Generate a minimal CSS stylesheet.
 */
export function generateStyleCss() {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; line-height: 1.6; }
nav { margin-bottom: 2rem; }
nav a { color: #0066cc; text-decoration: none; }
h1 { margin-bottom: 1rem; }
.meta { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
.tag { background: #e8f0fe; color: #1a73e8; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-right: 4px; }
.category { color: #5f6368; margin-right: 8px; }
.content { line-height: 1.8; }
.content p { margin-bottom: 1rem; }
.content pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; margin-bottom: 1rem; }
.content code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
.note-list { list-style: none; }
.note-list li { padding: 0.75rem 0; border-bottom: 1px solid #eee; }
.note-list a { color: #1a73e8; text-decoration: none; font-weight: 500; margin-right: 8px; }
time { color: #999; font-size: 0.85rem; }
header { border-bottom: 2px solid #1a73e8; padding-bottom: 1rem; margin-bottom: 2rem; }`;
}

/**
 * Export notes as a static HTML site.
 */
export function exportToSite(db, outputDir, options = {}) {
  const notes = fetchNotes(db, options);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write CSS
  writeFileSync(join(outputDir, "style.css"), generateStyleCss(), "utf-8");

  // Write index
  writeFileSync(
    join(outputDir, "index.html"),
    generateIndexHtml(notes, options.title),
    "utf-8",
  );

  // Write individual pages
  const exported = [];
  for (const note of notes) {
    const category = note.category || "general";
    const catDir = join(outputDir, sanitizeFilename(category));
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }

    const filename = `${sanitizeFilename(note.title)}.html`;
    const filePath = join(catDir, filename);
    writeFileSync(filePath, noteToHtml(note), "utf-8");

    exported.push({
      id: note.id,
      title: note.title,
      path: `${sanitizeFilename(category)}/${filename}`,
    });
  }

  return exported;
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Very simple markdown→HTML for note content.
 * Handles headings, paragraphs, code blocks, bold, italic, links.
 */
function markdownToSimpleHtml(md) {
  return md
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}

// ─── V2 Governance Layer ────────────────────────────────────────────
//
// In-memory governance for export targets + export jobs, independent
// of the SQLite notes table read by legacy export* helpers. V2 tracks
// target maturity transitions, per-owner active-target caps, per-target
// pending-job caps, stamp-once timestamps, and bulk auto-flip routines.

export const TARGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

export const EXPORT_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _TARGET_TRANSITIONS_V2 = new Map([
  [
    TARGET_MATURITY_V2.PENDING,
    new Set([TARGET_MATURITY_V2.ACTIVE, TARGET_MATURITY_V2.ARCHIVED]),
  ],
  [
    TARGET_MATURITY_V2.ACTIVE,
    new Set([TARGET_MATURITY_V2.PAUSED, TARGET_MATURITY_V2.ARCHIVED]),
  ],
  [
    TARGET_MATURITY_V2.PAUSED,
    new Set([TARGET_MATURITY_V2.ACTIVE, TARGET_MATURITY_V2.ARCHIVED]),
  ],
  [TARGET_MATURITY_V2.ARCHIVED, new Set()],
]);

const _TARGET_TERMINALS_V2 = new Set([TARGET_MATURITY_V2.ARCHIVED]);

const _JOB_TRANSITIONS_V2 = new Map([
  [
    EXPORT_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      EXPORT_JOB_LIFECYCLE_V2.RUNNING,
      EXPORT_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EXPORT_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      EXPORT_JOB_LIFECYCLE_V2.COMPLETED,
      EXPORT_JOB_LIFECYCLE_V2.FAILED,
      EXPORT_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EXPORT_JOB_LIFECYCLE_V2.COMPLETED, new Set()],
  [EXPORT_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [EXPORT_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _JOB_TERMINALS_V2 = new Set([
  EXPORT_JOB_LIFECYCLE_V2.COMPLETED,
  EXPORT_JOB_LIFECYCLE_V2.FAILED,
  EXPORT_JOB_LIFECYCLE_V2.CANCELLED,
]);

export const EXPORTER_DEFAULT_MAX_ACTIVE_TARGETS_PER_OWNER = 12;
export const EXPORTER_DEFAULT_MAX_PENDING_JOBS_PER_TARGET = 3;
export const EXPORTER_DEFAULT_TARGET_IDLE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const EXPORTER_DEFAULT_JOB_STUCK_MS = 25 * 60 * 1000; // 25 min

const _stateV2 = {
  targets: new Map(),
  jobs: new Map(),
  maxActiveTargetsPerOwner: EXPORTER_DEFAULT_MAX_ACTIVE_TARGETS_PER_OWNER,
  maxPendingJobsPerTarget: EXPORTER_DEFAULT_MAX_PENDING_JOBS_PER_TARGET,
  targetIdleMs: EXPORTER_DEFAULT_TARGET_IDLE_MS,
  jobStuckMs: EXPORTER_DEFAULT_JOB_STUCK_MS,
};

function _posIntExporterV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer, got ${n}`);
  }
  return v;
}

export function getMaxActiveTargetsPerOwnerV2() {
  return _stateV2.maxActiveTargetsPerOwner;
}

export function setMaxActiveTargetsPerOwnerV2(n) {
  _stateV2.maxActiveTargetsPerOwner = _posIntExporterV2(
    n,
    "maxActiveTargetsPerOwner",
  );
}

export function getMaxPendingJobsPerTargetV2() {
  return _stateV2.maxPendingJobsPerTarget;
}

export function setMaxPendingJobsPerTargetV2(n) {
  _stateV2.maxPendingJobsPerTarget = _posIntExporterV2(
    n,
    "maxPendingJobsPerTarget",
  );
}

export function getTargetIdleMsV2() {
  return _stateV2.targetIdleMs;
}

export function setTargetIdleMsV2(ms) {
  _stateV2.targetIdleMs = _posIntExporterV2(ms, "targetIdleMs");
}

export function getJobStuckMsV2() {
  return _stateV2.jobStuckMs;
}

export function setJobStuckMsV2(ms) {
  _stateV2.jobStuckMs = _posIntExporterV2(ms, "jobStuckMs");
}

function _copyTargetV2(t) {
  return { ...t, metadata: { ...t.metadata } };
}

function _copyJobV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function getActiveTargetCountV2(ownerId) {
  let count = 0;
  for (const t of _stateV2.targets.values()) {
    if (t.ownerId === ownerId && t.status === TARGET_MATURITY_V2.ACTIVE)
      count++;
  }
  return count;
}

export function getPendingJobCountV2(targetId) {
  let count = 0;
  for (const j of _stateV2.jobs.values()) {
    if (
      j.targetId === targetId &&
      (j.status === EXPORT_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === EXPORT_JOB_LIFECYCLE_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerTargetV2(
  id,
  { ownerId, label, format, metadata } = {},
) {
  if (!id) throw new Error("target id is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!label) throw new Error("label is required");
  if (_stateV2.targets.has(id)) throw new Error(`target ${id} already exists`);
  const now = Date.now();
  const target = {
    id,
    ownerId,
    label,
    format: format || "markdown",
    status: TARGET_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.targets.set(id, target);
  return _copyTargetV2(target);
}

export function getTargetV2(id) {
  const t = _stateV2.targets.get(id);
  return t ? _copyTargetV2(t) : null;
}

export function listTargetsV2({ ownerId, status } = {}) {
  const out = [];
  for (const t of _stateV2.targets.values()) {
    if (ownerId && t.ownerId !== ownerId) continue;
    if (status && t.status !== status) continue;
    out.push(_copyTargetV2(t));
  }
  return out;
}

export function setTargetStatusV2(id, next) {
  const t = _stateV2.targets.get(id);
  if (!t) throw new Error(`target ${id} not found`);
  const allowed = _TARGET_TRANSITIONS_V2.get(t.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid target transition: ${t.status} → ${next}`);
  }
  if (
    t.status === TARGET_MATURITY_V2.PENDING &&
    next === TARGET_MATURITY_V2.ACTIVE
  ) {
    const count = getActiveTargetCountV2(t.ownerId);
    if (count >= _stateV2.maxActiveTargetsPerOwner) {
      throw new Error(
        `owner ${t.ownerId} active-target cap reached (${count}/${_stateV2.maxActiveTargetsPerOwner})`,
      );
    }
  }
  const now = Date.now();
  t.status = next;
  t.lastSeenAt = now;
  if (next === TARGET_MATURITY_V2.ACTIVE && !t.activatedAt) t.activatedAt = now;
  if (_TARGET_TERMINALS_V2.has(next) && !t.archivedAt) t.archivedAt = now;
  return _copyTargetV2(t);
}

export function activateTargetV2(id) {
  return setTargetStatusV2(id, TARGET_MATURITY_V2.ACTIVE);
}

export function pauseTargetV2(id) {
  return setTargetStatusV2(id, TARGET_MATURITY_V2.PAUSED);
}

export function archiveTargetV2(id) {
  return setTargetStatusV2(id, TARGET_MATURITY_V2.ARCHIVED);
}

export function touchTargetV2(id) {
  const t = _stateV2.targets.get(id);
  if (!t) throw new Error(`target ${id} not found`);
  t.lastSeenAt = Date.now();
  return _copyTargetV2(t);
}

export function createExportJobV2(id, { targetId, kind, metadata } = {}) {
  if (!id) throw new Error("job id is required");
  if (!targetId) throw new Error("targetId is required");
  if (_stateV2.jobs.has(id)) throw new Error(`job ${id} already exists`);
  const target = _stateV2.targets.get(targetId);
  if (!target) throw new Error(`target ${targetId} not found`);
  const pending = getPendingJobCountV2(targetId);
  if (pending >= _stateV2.maxPendingJobsPerTarget) {
    throw new Error(
      `target ${targetId} pending-job cap reached (${pending}/${_stateV2.maxPendingJobsPerTarget})`,
    );
  }
  const now = Date.now();
  const job = {
    id,
    targetId,
    kind: kind || "snapshot",
    status: EXPORT_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.jobs.set(id, job);
  return _copyJobV2(job);
}

export function getExportJobV2(id) {
  const j = _stateV2.jobs.get(id);
  return j ? _copyJobV2(j) : null;
}

export function listExportJobsV2({ targetId, status } = {}) {
  const out = [];
  for (const j of _stateV2.jobs.values()) {
    if (targetId && j.targetId !== targetId) continue;
    if (status && j.status !== status) continue;
    out.push(_copyJobV2(j));
  }
  return out;
}

export function setExportJobStatusV2(id, next) {
  const j = _stateV2.jobs.get(id);
  if (!j) throw new Error(`job ${id} not found`);
  const allowed = _JOB_TRANSITIONS_V2.get(j.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid job transition: ${j.status} → ${next}`);
  }
  const now = Date.now();
  j.status = next;
  j.lastSeenAt = now;
  if (next === EXPORT_JOB_LIFECYCLE_V2.RUNNING && !j.startedAt)
    j.startedAt = now;
  if (_JOB_TERMINALS_V2.has(next) && !j.settledAt) j.settledAt = now;
  return _copyJobV2(j);
}

export function startExportJobV2(id) {
  return setExportJobStatusV2(id, EXPORT_JOB_LIFECYCLE_V2.RUNNING);
}

export function completeExportJobV2(id) {
  return setExportJobStatusV2(id, EXPORT_JOB_LIFECYCLE_V2.COMPLETED);
}

export function failExportJobV2(id) {
  return setExportJobStatusV2(id, EXPORT_JOB_LIFECYCLE_V2.FAILED);
}

export function cancelExportJobV2(id) {
  return setExportJobStatusV2(id, EXPORT_JOB_LIFECYCLE_V2.CANCELLED);
}

export function autoPauseIdleTargetsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const t of _stateV2.targets.values()) {
    if (
      t.status === TARGET_MATURITY_V2.ACTIVE &&
      now - t.lastSeenAt > _stateV2.targetIdleMs
    ) {
      t.status = TARGET_MATURITY_V2.PAUSED;
      t.lastSeenAt = now;
      flipped.push(_copyTargetV2(t));
    }
  }
  return flipped;
}

export function autoFailStuckExportJobsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _stateV2.jobs.values()) {
    if (
      j.status === EXPORT_JOB_LIFECYCLE_V2.RUNNING &&
      now - j.lastSeenAt > _stateV2.jobStuckMs
    ) {
      j.status = EXPORT_JOB_LIFECYCLE_V2.FAILED;
      j.lastSeenAt = now;
      if (!j.settledAt) j.settledAt = now;
      flipped.push(_copyJobV2(j));
    }
  }
  return flipped;
}

export function getKnowledgeExporterStatsV2() {
  const targetsByStatus = {};
  for (const v of Object.values(TARGET_MATURITY_V2)) targetsByStatus[v] = 0;
  for (const t of _stateV2.targets.values()) targetsByStatus[t.status]++;

  const jobsByStatus = {};
  for (const v of Object.values(EXPORT_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _stateV2.jobs.values()) jobsByStatus[j.status]++;

  return {
    totalTargetsV2: _stateV2.targets.size,
    totalExportJobsV2: _stateV2.jobs.size,
    maxActiveTargetsPerOwner: _stateV2.maxActiveTargetsPerOwner,
    maxPendingJobsPerTarget: _stateV2.maxPendingJobsPerTarget,
    targetIdleMs: _stateV2.targetIdleMs,
    jobStuckMs: _stateV2.jobStuckMs,
    targetsByStatus,
    jobsByStatus,
  };
}

export function _resetStateKnowledgeExporterV2() {
  _stateV2.targets.clear();
  _stateV2.jobs.clear();
  _stateV2.maxActiveTargetsPerOwner =
    EXPORTER_DEFAULT_MAX_ACTIVE_TARGETS_PER_OWNER;
  _stateV2.maxPendingJobsPerTarget =
    EXPORTER_DEFAULT_MAX_PENDING_JOBS_PER_TARGET;
  _stateV2.targetIdleMs = EXPORTER_DEFAULT_TARGET_IDLE_MS;
  _stateV2.jobStuckMs = EXPORTER_DEFAULT_JOB_STUCK_MS;
}

// =====================================================================
// knowledge-exporter V2 governance overlay (iter22)
// =====================================================================
export const KEXPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const KEXPGOV_EXPORT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  EXPORTING: "exporting",
  EXPORTED: "exported",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _kexpgovPTrans = new Map([
  [
    KEXPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      KEXPGOV_PROFILE_MATURITY_V2.ACTIVE,
      KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    KEXPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      KEXPGOV_PROFILE_MATURITY_V2.STALE,
      KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    KEXPGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      KEXPGOV_PROFILE_MATURITY_V2.ACTIVE,
      KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _kexpgovPTerminal = new Set([KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _kexpgovJTrans = new Map([
  [
    KEXPGOV_EXPORT_LIFECYCLE_V2.QUEUED,
    new Set([
      KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING,
      KEXPGOV_EXPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING,
    new Set([
      KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTED,
      KEXPGOV_EXPORT_LIFECYCLE_V2.FAILED,
      KEXPGOV_EXPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTED, new Set()],
  [KEXPGOV_EXPORT_LIFECYCLE_V2.FAILED, new Set()],
  [KEXPGOV_EXPORT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _kexpgovPsV2 = new Map();
const _kexpgovJsV2 = new Map();
let _kexpgovMaxActive = 6,
  _kexpgovMaxPending = 15,
  _kexpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _kexpgovStuckMs = 60 * 1000;
function _kexpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _kexpgovCheckP(from, to) {
  const a = _kexpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid kexpgov profile transition ${from} → ${to}`);
}
function _kexpgovCheckJ(from, to) {
  const a = _kexpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid kexpgov export transition ${from} → ${to}`);
}
function _kexpgovCountActive(owner) {
  let c = 0;
  for (const p of _kexpgovPsV2.values())
    if (p.owner === owner && p.status === KEXPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _kexpgovCountPending(profileId) {
  let c = 0;
  for (const j of _kexpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === KEXPGOV_EXPORT_LIFECYCLE_V2.QUEUED ||
        j.status === KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING)
    )
      c++;
  return c;
}
export function setMaxActiveKexpgovProfilesPerOwnerV2(n) {
  _kexpgovMaxActive = _kexpgovPos(n, "maxActiveKexpgovProfilesPerOwner");
}
export function getMaxActiveKexpgovProfilesPerOwnerV2() {
  return _kexpgovMaxActive;
}
export function setMaxPendingKexpgovExportsPerProfileV2(n) {
  _kexpgovMaxPending = _kexpgovPos(n, "maxPendingKexpgovExportsPerProfile");
}
export function getMaxPendingKexpgovExportsPerProfileV2() {
  return _kexpgovMaxPending;
}
export function setKexpgovProfileIdleMsV2(n) {
  _kexpgovIdleMs = _kexpgovPos(n, "kexpgovProfileIdleMs");
}
export function getKexpgovProfileIdleMsV2() {
  return _kexpgovIdleMs;
}
export function setKexpgovExportStuckMsV2(n) {
  _kexpgovStuckMs = _kexpgovPos(n, "kexpgovExportStuckMs");
}
export function getKexpgovExportStuckMsV2() {
  return _kexpgovStuckMs;
}
export function _resetStateKnowledgeExporterGovV2() {
  _kexpgovPsV2.clear();
  _kexpgovJsV2.clear();
  _kexpgovMaxActive = 6;
  _kexpgovMaxPending = 15;
  _kexpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _kexpgovStuckMs = 60 * 1000;
}
export function registerKexpgovProfileV2({ id, owner, format, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_kexpgovPsV2.has(id))
    throw new Error(`kexpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    format: format || "json",
    status: KEXPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _kexpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateKexpgovProfileV2(id) {
  const p = _kexpgovPsV2.get(id);
  if (!p) throw new Error(`kexpgov profile ${id} not found`);
  const isInitial = p.status === KEXPGOV_PROFILE_MATURITY_V2.PENDING;
  _kexpgovCheckP(p.status, KEXPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _kexpgovCountActive(p.owner) >= _kexpgovMaxActive)
    throw new Error(`max active kexpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = KEXPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleKexpgovProfileV2(id) {
  const p = _kexpgovPsV2.get(id);
  if (!p) throw new Error(`kexpgov profile ${id} not found`);
  _kexpgovCheckP(p.status, KEXPGOV_PROFILE_MATURITY_V2.STALE);
  p.status = KEXPGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveKexpgovProfileV2(id) {
  const p = _kexpgovPsV2.get(id);
  if (!p) throw new Error(`kexpgov profile ${id} not found`);
  _kexpgovCheckP(p.status, KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = KEXPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchKexpgovProfileV2(id) {
  const p = _kexpgovPsV2.get(id);
  if (!p) throw new Error(`kexpgov profile ${id} not found`);
  if (_kexpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal kexpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getKexpgovProfileV2(id) {
  const p = _kexpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listKexpgovProfilesV2() {
  return [..._kexpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createKexpgovExportV2({
  id,
  profileId,
  destination,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_kexpgovJsV2.has(id))
    throw new Error(`kexpgov export ${id} already exists`);
  if (!_kexpgovPsV2.has(profileId))
    throw new Error(`kexpgov profile ${profileId} not found`);
  if (_kexpgovCountPending(profileId) >= _kexpgovMaxPending)
    throw new Error(
      `max pending kexpgov exports for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    destination: destination || "",
    status: KEXPGOV_EXPORT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _kexpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function exportingKexpgovExportV2(id) {
  const j = _kexpgovJsV2.get(id);
  if (!j) throw new Error(`kexpgov export ${id} not found`);
  _kexpgovCheckJ(j.status, KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING);
  const now = Date.now();
  j.status = KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeExportKexpgovV2(id) {
  const j = _kexpgovJsV2.get(id);
  if (!j) throw new Error(`kexpgov export ${id} not found`);
  _kexpgovCheckJ(j.status, KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTED);
  const now = Date.now();
  j.status = KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failKexpgovExportV2(id, reason) {
  const j = _kexpgovJsV2.get(id);
  if (!j) throw new Error(`kexpgov export ${id} not found`);
  _kexpgovCheckJ(j.status, KEXPGOV_EXPORT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = KEXPGOV_EXPORT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelKexpgovExportV2(id, reason) {
  const j = _kexpgovJsV2.get(id);
  if (!j) throw new Error(`kexpgov export ${id} not found`);
  _kexpgovCheckJ(j.status, KEXPGOV_EXPORT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = KEXPGOV_EXPORT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getKexpgovExportV2(id) {
  const j = _kexpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listKexpgovExportsV2() {
  return [..._kexpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleKexpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _kexpgovPsV2.values())
    if (
      p.status === KEXPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _kexpgovIdleMs
    ) {
      p.status = KEXPGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckKexpgovExportsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _kexpgovJsV2.values())
    if (
      j.status === KEXPGOV_EXPORT_LIFECYCLE_V2.EXPORTING &&
      j.startedAt != null &&
      t - j.startedAt >= _kexpgovStuckMs
    ) {
      j.status = KEXPGOV_EXPORT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getKnowledgeExporterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(KEXPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _kexpgovPsV2.values()) profilesByStatus[p.status]++;
  const exportsByStatus = {};
  for (const v of Object.values(KEXPGOV_EXPORT_LIFECYCLE_V2))
    exportsByStatus[v] = 0;
  for (const j of _kexpgovJsV2.values()) exportsByStatus[j.status]++;
  return {
    totalKexpgovProfilesV2: _kexpgovPsV2.size,
    totalKexpgovExportsV2: _kexpgovJsV2.size,
    maxActiveKexpgovProfilesPerOwner: _kexpgovMaxActive,
    maxPendingKexpgovExportsPerProfile: _kexpgovMaxPending,
    kexpgovProfileIdleMs: _kexpgovIdleMs,
    kexpgovExportStuckMs: _kexpgovStuckMs,
    profilesByStatus,
    exportsByStatus,
  };
}
