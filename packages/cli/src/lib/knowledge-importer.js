/**
 * Knowledge importer — parse Markdown, Evernote ENEX, and Notion exports
 * into the notes table.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename, extname, relative } from "path";

/**
 * Ensure the notes table exists
 */
export function ensureNotesTable(db) {
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
 * Generate a simple UUID-like ID
 */
function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Insert a note into the database
 */
export function insertNote(db, { title, content, tags, category, createdAt }) {
  const id = generateId();
  const tagsJson = JSON.stringify(tags || []);
  const cat = category || "general";
  const created =
    createdAt || new Date().toISOString().replace("T", " ").slice(0, 19);

  db.prepare(
    "INSERT INTO notes (id, title, content, tags, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, title, content || "", tagsJson, cat, created, created);

  return { id, title, tags: tags || [], category: cat, created_at: created };
}

// ─── Markdown Import ────────────────────────────────────────────────

/**
 * Parse a single markdown file into a note object.
 * Extracts YAML frontmatter if present.
 */
export function parseMarkdownFile(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const name = basename(filePath, extname(filePath));

  let title = name;
  let content = raw;
  let tags = [];
  let category = "markdown";
  let createdAt = null;

  // Try to extract YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    content = fmMatch[2].trim();

    // Parse simple YAML fields
    const titleMatch = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1];

    const tagsMatch = frontmatter.match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/["']/g, ""))
        .filter(Boolean);
    }

    const catMatch = frontmatter.match(/^category:\s*["']?(.+?)["']?\s*$/m);
    if (catMatch) category = catMatch[1];

    const dateMatch = frontmatter.match(/^date:\s*["']?(.+?)["']?\s*$/m);
    if (dateMatch) createdAt = dateMatch[1];
  }

  // Use first H1 as title if no frontmatter title
  if (title === name && !fmMatch) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1];
  }

  return { title, content, tags, category, createdAt };
}

/**
 * Recursively collect all .md files from a directory.
 */
export function collectMarkdownFiles(dir) {
  const results = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (extname(entry).toLowerCase() === ".md") {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Import all markdown files from a directory into the database.
 */
export function importMarkdownDir(db, dir) {
  ensureNotesTable(db);
  const files = collectMarkdownFiles(dir);
  const imported = [];

  for (const file of files) {
    const parsed = parseMarkdownFile(file);
    const note = insertNote(db, parsed);
    note.source = relative(dir, file);
    imported.push(note);
  }

  return imported;
}

// ─── Evernote ENEX Import ───────────────────────────────────────────

/**
 * Parse an ENEX (Evernote Export) XML string into note objects.
 * ENEX format: <en-export><note><title>...</title><content>...</content><tag>...</tag></note>...</en-export>
 */
export function parseEnex(xmlString) {
  const notes = [];
  const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
  let noteMatch;

  while ((noteMatch = noteRegex.exec(xmlString)) !== null) {
    const noteXml = noteMatch[1];

    const titleMatch = noteXml.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    // Content is wrapped in CDATA inside <content>
    const contentMatch = noteXml.match(/<content>([\s\S]*?)<\/content>/i);
    let content = "";
    if (contentMatch) {
      let raw = contentMatch[1];
      // Strip CDATA wrapper
      const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      if (cdataMatch) raw = cdataMatch[1];
      // Strip ENML/HTML tags for plain text
      content = stripHtml(raw);
    }

    // Tags
    const tags = [];
    const tagRegex = /<tag>([\s\S]*?)<\/tag>/gi;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(noteXml)) !== null) {
      tags.push(tagMatch[1].trim());
    }

    // Created date
    const createdMatch = noteXml.match(/<created>([\s\S]*?)<\/created>/i);
    let createdAt = null;
    if (createdMatch) {
      // ENEX dates: 20210315T120000Z → 2021-03-15 12:00:00
      const d = createdMatch[1].trim();
      const parsed = d.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
      if (parsed) {
        createdAt = `${parsed[1]}-${parsed[2]}-${parsed[3]} ${parsed[4]}:${parsed[5]}:${parsed[6]}`;
      }
    }

    notes.push({ title, content, tags, category: "evernote", createdAt });
  }

  return notes;
}

/**
 * Strip HTML/ENML tags to plain text.
 */
export function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Import an Evernote ENEX file into the database.
 */
export function importEnexFile(db, filePath) {
  ensureNotesTable(db);
  const xmlString = readFileSync(filePath, "utf-8");
  const parsed = parseEnex(xmlString);
  const imported = [];

  for (const note of parsed) {
    const result = insertNote(db, note);
    imported.push(result);
  }

  return imported;
}

// ─── Notion Export Import ───────────────────────────────────────────

/**
 * Parse a Notion export directory.
 * Notion exports contain markdown files and may have metadata in filenames
 * or accompanying JSON/CSV files.
 */
export function parseNotionExport(dir) {
  const notes = [];
  const files = collectMarkdownFiles(dir);

  for (const file of files) {
    const raw = readFileSync(file, "utf-8");
    const fileName = basename(file, ".md");

    // Notion filenames often have a UUID suffix: "My Page abc123def456"
    // Remove the hex suffix to get the clean title
    const title = fileName.replace(/\s+[a-f0-9]{32}$/i, "") || fileName;

    // Notion uses # for the first heading, which is usually the page title
    let content = raw;
    const h1Match = raw.match(/^#\s+(.+)\n([\s\S]*)$/);
    if (h1Match) {
      content = h1Match[2].trim();
    }

    // Try to detect tags from Notion properties (sometimes at the top)
    const tags = [];
    const relPath = relative(dir, file);
    const parts = relPath.split(/[/\\]/);
    if (parts.length > 1) {
      // Use parent folder as a tag
      tags.push(parts[0]);
    }

    notes.push({ title, content, tags, category: "notion", createdAt: null });
  }

  return notes;
}

/**
 * Import a Notion export directory into the database.
 */
export function importNotionDir(db, dir) {
  ensureNotesTable(db);
  const parsed = parseNotionExport(dir);
  const imported = [];

  for (const note of parsed) {
    const result = insertNote(db, note);
    imported.push(result);
  }

  return imported;
}

// ─── V2 Governance Layer ────────────────────────────────────────────
//
// In-memory governance for source manifests + import jobs, independent
// of the SQLite notes table populated by the legacy import* helpers.
// V2 tracks maturity transitions, per-owner active-source caps, per-source
// pending-job caps, stamp-once timestamps, and bulk auto-flip routines.

export const SOURCE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

export const IMPORT_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _SOURCE_TRANSITIONS_V2 = new Map([
  [
    SOURCE_MATURITY_V2.PENDING,
    new Set([SOURCE_MATURITY_V2.ACTIVE, SOURCE_MATURITY_V2.ARCHIVED]),
  ],
  [
    SOURCE_MATURITY_V2.ACTIVE,
    new Set([SOURCE_MATURITY_V2.PAUSED, SOURCE_MATURITY_V2.ARCHIVED]),
  ],
  [
    SOURCE_MATURITY_V2.PAUSED,
    new Set([SOURCE_MATURITY_V2.ACTIVE, SOURCE_MATURITY_V2.ARCHIVED]),
  ],
  [SOURCE_MATURITY_V2.ARCHIVED, new Set()],
]);

const _SOURCE_TERMINALS_V2 = new Set([SOURCE_MATURITY_V2.ARCHIVED]);

const _JOB_TRANSITIONS_V2 = new Map([
  [
    IMPORT_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      IMPORT_JOB_LIFECYCLE_V2.RUNNING,
      IMPORT_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    IMPORT_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      IMPORT_JOB_LIFECYCLE_V2.COMPLETED,
      IMPORT_JOB_LIFECYCLE_V2.FAILED,
      IMPORT_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [IMPORT_JOB_LIFECYCLE_V2.COMPLETED, new Set()],
  [IMPORT_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [IMPORT_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _JOB_TERMINALS_V2 = new Set([
  IMPORT_JOB_LIFECYCLE_V2.COMPLETED,
  IMPORT_JOB_LIFECYCLE_V2.FAILED,
  IMPORT_JOB_LIFECYCLE_V2.CANCELLED,
]);

export const IMPORTER_DEFAULT_MAX_ACTIVE_SOURCES_PER_OWNER = 15;
export const IMPORTER_DEFAULT_MAX_PENDING_JOBS_PER_SOURCE = 3;
export const IMPORTER_DEFAULT_SOURCE_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const IMPORTER_DEFAULT_JOB_STUCK_MS = 20 * 60 * 1000; // 20 min

const _stateV2 = {
  sources: new Map(),
  jobs: new Map(),
  maxActiveSourcesPerOwner: IMPORTER_DEFAULT_MAX_ACTIVE_SOURCES_PER_OWNER,
  maxPendingJobsPerSource: IMPORTER_DEFAULT_MAX_PENDING_JOBS_PER_SOURCE,
  sourceIdleMs: IMPORTER_DEFAULT_SOURCE_IDLE_MS,
  jobStuckMs: IMPORTER_DEFAULT_JOB_STUCK_MS,
};

function _posIntImporterV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer, got ${n}`);
  }
  return v;
}

export function getMaxActiveSourcesPerOwnerV2() {
  return _stateV2.maxActiveSourcesPerOwner;
}

export function setMaxActiveSourcesPerOwnerV2(n) {
  _stateV2.maxActiveSourcesPerOwner = _posIntImporterV2(
    n,
    "maxActiveSourcesPerOwner",
  );
}

export function getMaxPendingJobsPerSourceV2() {
  return _stateV2.maxPendingJobsPerSource;
}

export function setMaxPendingJobsPerSourceV2(n) {
  _stateV2.maxPendingJobsPerSource = _posIntImporterV2(
    n,
    "maxPendingJobsPerSource",
  );
}

export function getSourceIdleMsV2() {
  return _stateV2.sourceIdleMs;
}

export function setSourceIdleMsV2(ms) {
  _stateV2.sourceIdleMs = _posIntImporterV2(ms, "sourceIdleMs");
}

export function getJobStuckMsV2() {
  return _stateV2.jobStuckMs;
}

export function setJobStuckMsV2(ms) {
  _stateV2.jobStuckMs = _posIntImporterV2(ms, "jobStuckMs");
}

function _copySourceV2(s) {
  return { ...s, metadata: { ...s.metadata } };
}

function _copyJobV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function getActiveSourceCountV2(ownerId) {
  let count = 0;
  for (const s of _stateV2.sources.values()) {
    if (s.ownerId === ownerId && s.status === SOURCE_MATURITY_V2.ACTIVE)
      count++;
  }
  return count;
}

export function getPendingJobCountV2(sourceId) {
  let count = 0;
  for (const j of _stateV2.jobs.values()) {
    if (
      j.sourceId === sourceId &&
      (j.status === IMPORT_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === IMPORT_JOB_LIFECYCLE_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerSourceV2(id, { ownerId, label, kind, metadata } = {}) {
  if (!id) throw new Error("source id is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!label) throw new Error("label is required");
  if (_stateV2.sources.has(id)) throw new Error(`source ${id} already exists`);
  const now = Date.now();
  const source = {
    id,
    ownerId,
    label,
    kind: kind || "markdown",
    status: SOURCE_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.sources.set(id, source);
  return _copySourceV2(source);
}

export function getSourceV2(id) {
  const s = _stateV2.sources.get(id);
  return s ? _copySourceV2(s) : null;
}

export function listSourcesV2({ ownerId, status } = {}) {
  const out = [];
  for (const s of _stateV2.sources.values()) {
    if (ownerId && s.ownerId !== ownerId) continue;
    if (status && s.status !== status) continue;
    out.push(_copySourceV2(s));
  }
  return out;
}

export function setSourceStatusV2(id, next) {
  const s = _stateV2.sources.get(id);
  if (!s) throw new Error(`source ${id} not found`);
  const allowed = _SOURCE_TRANSITIONS_V2.get(s.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid source transition: ${s.status} → ${next}`);
  }
  // Cap enforcement: pending → active only (recovery from paused exempt)
  if (
    s.status === SOURCE_MATURITY_V2.PENDING &&
    next === SOURCE_MATURITY_V2.ACTIVE
  ) {
    const count = getActiveSourceCountV2(s.ownerId);
    if (count >= _stateV2.maxActiveSourcesPerOwner) {
      throw new Error(
        `owner ${s.ownerId} active-source cap reached (${count}/${_stateV2.maxActiveSourcesPerOwner})`,
      );
    }
  }
  const now = Date.now();
  s.status = next;
  s.lastSeenAt = now;
  if (next === SOURCE_MATURITY_V2.ACTIVE && !s.activatedAt) s.activatedAt = now;
  if (_SOURCE_TERMINALS_V2.has(next) && !s.archivedAt) s.archivedAt = now;
  return _copySourceV2(s);
}

export function activateSourceV2(id) {
  return setSourceStatusV2(id, SOURCE_MATURITY_V2.ACTIVE);
}

export function pauseSourceV2(id) {
  return setSourceStatusV2(id, SOURCE_MATURITY_V2.PAUSED);
}

export function archiveSourceV2(id) {
  return setSourceStatusV2(id, SOURCE_MATURITY_V2.ARCHIVED);
}

export function touchSourceV2(id) {
  const s = _stateV2.sources.get(id);
  if (!s) throw new Error(`source ${id} not found`);
  s.lastSeenAt = Date.now();
  return _copySourceV2(s);
}

export function createImportJobV2(id, { sourceId, kind, metadata } = {}) {
  if (!id) throw new Error("job id is required");
  if (!sourceId) throw new Error("sourceId is required");
  if (_stateV2.jobs.has(id)) throw new Error(`job ${id} already exists`);
  const source = _stateV2.sources.get(sourceId);
  if (!source) throw new Error(`source ${sourceId} not found`);
  const pending = getPendingJobCountV2(sourceId);
  if (pending >= _stateV2.maxPendingJobsPerSource) {
    throw new Error(
      `source ${sourceId} pending-job cap reached (${pending}/${_stateV2.maxPendingJobsPerSource})`,
    );
  }
  const now = Date.now();
  const job = {
    id,
    sourceId,
    kind: kind || "scan",
    status: IMPORT_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateV2.jobs.set(id, job);
  return _copyJobV2(job);
}

export function getImportJobV2(id) {
  const j = _stateV2.jobs.get(id);
  return j ? _copyJobV2(j) : null;
}

export function listImportJobsV2({ sourceId, status } = {}) {
  const out = [];
  for (const j of _stateV2.jobs.values()) {
    if (sourceId && j.sourceId !== sourceId) continue;
    if (status && j.status !== status) continue;
    out.push(_copyJobV2(j));
  }
  return out;
}

export function setImportJobStatusV2(id, next) {
  const j = _stateV2.jobs.get(id);
  if (!j) throw new Error(`job ${id} not found`);
  const allowed = _JOB_TRANSITIONS_V2.get(j.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid job transition: ${j.status} → ${next}`);
  }
  const now = Date.now();
  j.status = next;
  j.lastSeenAt = now;
  if (next === IMPORT_JOB_LIFECYCLE_V2.RUNNING && !j.startedAt)
    j.startedAt = now;
  if (_JOB_TERMINALS_V2.has(next) && !j.settledAt) j.settledAt = now;
  return _copyJobV2(j);
}

export function startImportJobV2(id) {
  return setImportJobStatusV2(id, IMPORT_JOB_LIFECYCLE_V2.RUNNING);
}

export function completeImportJobV2(id) {
  return setImportJobStatusV2(id, IMPORT_JOB_LIFECYCLE_V2.COMPLETED);
}

export function failImportJobV2(id) {
  return setImportJobStatusV2(id, IMPORT_JOB_LIFECYCLE_V2.FAILED);
}

export function cancelImportJobV2(id) {
  return setImportJobStatusV2(id, IMPORT_JOB_LIFECYCLE_V2.CANCELLED);
}

export function autoPauseIdleSourcesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const s of _stateV2.sources.values()) {
    if (
      s.status === SOURCE_MATURITY_V2.ACTIVE &&
      now - s.lastSeenAt > _stateV2.sourceIdleMs
    ) {
      s.status = SOURCE_MATURITY_V2.PAUSED;
      s.lastSeenAt = now;
      flipped.push(_copySourceV2(s));
    }
  }
  return flipped;
}

export function autoFailStuckImportJobsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _stateV2.jobs.values()) {
    if (
      j.status === IMPORT_JOB_LIFECYCLE_V2.RUNNING &&
      now - j.lastSeenAt > _stateV2.jobStuckMs
    ) {
      j.status = IMPORT_JOB_LIFECYCLE_V2.FAILED;
      j.lastSeenAt = now;
      if (!j.settledAt) j.settledAt = now;
      flipped.push(_copyJobV2(j));
    }
  }
  return flipped;
}

export function getKnowledgeImporterStatsV2() {
  const sourcesByStatus = {};
  for (const v of Object.values(SOURCE_MATURITY_V2)) sourcesByStatus[v] = 0;
  for (const s of _stateV2.sources.values()) sourcesByStatus[s.status]++;

  const jobsByStatus = {};
  for (const v of Object.values(IMPORT_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _stateV2.jobs.values()) jobsByStatus[j.status]++;

  return {
    totalSourcesV2: _stateV2.sources.size,
    totalImportJobsV2: _stateV2.jobs.size,
    maxActiveSourcesPerOwner: _stateV2.maxActiveSourcesPerOwner,
    maxPendingJobsPerSource: _stateV2.maxPendingJobsPerSource,
    sourceIdleMs: _stateV2.sourceIdleMs,
    jobStuckMs: _stateV2.jobStuckMs,
    sourcesByStatus,
    jobsByStatus,
  };
}

export function _resetStateKnowledgeImporterV2() {
  _stateV2.sources.clear();
  _stateV2.jobs.clear();
  _stateV2.maxActiveSourcesPerOwner =
    IMPORTER_DEFAULT_MAX_ACTIVE_SOURCES_PER_OWNER;
  _stateV2.maxPendingJobsPerSource =
    IMPORTER_DEFAULT_MAX_PENDING_JOBS_PER_SOURCE;
  _stateV2.sourceIdleMs = IMPORTER_DEFAULT_SOURCE_IDLE_MS;
  _stateV2.jobStuckMs = IMPORTER_DEFAULT_JOB_STUCK_MS;
}
