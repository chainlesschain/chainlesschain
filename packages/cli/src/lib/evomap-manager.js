/**
 * EvoMap Manager — local gene management for CLI.
 *
 * Manages downloaded genes on disk, tracks installed versions,
 * and provides gene packaging for publishing.
 */

import fs from "fs";
import path from "path";

// Exported for test injection
export const _deps = {
  fs,
  path,
};

export class EvoMapManager {
  /**
   * @param {object} options
   * @param {string} options.genesDir - Directory to store downloaded genes
   * @param {object|null} options.db - Database for tracking (optional)
   */
  constructor({ genesDir, db } = {}) {
    this.genesDir = genesDir || "";
    this.db = db || null;
    this._initialized = false;
  }

  /**
   * Initialize: create directories, DB table.
   */
  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    if (this.genesDir) {
      try {
        if (!_deps.fs.existsSync(this.genesDir)) {
          _deps.fs.mkdirSync(this.genesDir, { recursive: true });
        }
      } catch (_err) {
        // Non-critical
      }
    }

    if (this.db) {
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS evomap_genes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT DEFAULT '1.0.0',
            author TEXT DEFAULT '',
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'general',
            source_hub TEXT DEFAULT '',
            local_path TEXT DEFAULT '',
            installed_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);
      } catch (_err) {
        // Non-critical
      }
    }
  }

  /**
   * Save a downloaded gene to disk and register in DB.
   */
  saveGene(gene, content) {
    this.initialize();
    if (!gene || !gene.id) throw new Error("Gene ID required");

    const geneDir = _deps.path.join(this.genesDir, gene.id);
    if (!_deps.fs.existsSync(geneDir)) {
      _deps.fs.mkdirSync(geneDir, { recursive: true });
    }

    // Save metadata
    _deps.fs.writeFileSync(
      _deps.path.join(geneDir, "gene.json"),
      JSON.stringify(gene, null, 2),
      "utf-8",
    );

    // Save content
    if (content) {
      _deps.fs.writeFileSync(
        _deps.path.join(geneDir, "content.md"),
        content,
        "utf-8",
      );
    }

    // Register in DB
    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO evomap_genes (id, name, version, author, description, category, source_hub, local_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            gene.id,
            gene.name || gene.id,
            gene.version || "1.0.0",
            gene.author || "",
            gene.description || "",
            gene.category || "general",
            gene.sourceHub || "",
            geneDir,
          );
      } catch (_err) {
        // Non-critical
      }
    }

    return { path: geneDir };
  }

  /**
   * List locally installed genes.
   */
  listGenes() {
    this.initialize();

    if (this.db) {
      try {
        return this.db
          .prepare("SELECT * FROM evomap_genes ORDER BY installed_at DESC")
          .all();
      } catch (_err) {
        // Fall through to file-based
      }
    }

    // File-based fallback
    if (!this.genesDir || !_deps.fs.existsSync(this.genesDir)) return [];

    try {
      const dirs = _deps.fs
        .readdirSync(this.genesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      return dirs.map((d) => {
        const metaPath = _deps.path.join(this.genesDir, d.name, "gene.json");
        try {
          const meta = JSON.parse(_deps.fs.readFileSync(metaPath, "utf-8"));
          return {
            id: d.name,
            ...meta,
            local_path: _deps.path.join(this.genesDir, d.name),
          };
        } catch {
          return {
            id: d.name,
            name: d.name,
            local_path: _deps.path.join(this.genesDir, d.name),
          };
        }
      });
    } catch (_err) {
      return [];
    }
  }

  /**
   * Get a gene by ID.
   */
  getGene(geneId) {
    this.initialize();
    const geneDir = _deps.path.join(this.genesDir, geneId);

    if (!_deps.fs.existsSync(geneDir)) return null;

    try {
      const metaPath = _deps.path.join(geneDir, "gene.json");
      const meta = JSON.parse(_deps.fs.readFileSync(metaPath, "utf-8"));
      const contentPath = _deps.path.join(geneDir, "content.md");
      const content = _deps.fs.existsSync(contentPath)
        ? _deps.fs.readFileSync(contentPath, "utf-8")
        : null;
      return { ...meta, content, local_path: geneDir };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Remove a gene.
   */
  removeGene(geneId) {
    this.initialize();
    const geneDir = _deps.path.join(this.genesDir, geneId);

    if (_deps.fs.existsSync(geneDir)) {
      _deps.fs.rmSync(geneDir, { recursive: true, force: true });
    }

    if (this.db) {
      try {
        this.db.prepare("DELETE FROM evomap_genes WHERE id = ?").run(geneId);
      } catch (_err) {
        // Non-critical
      }
    }

    return { removed: true };
  }

  /**
   * Package a local skill/prompt as a gene for publishing.
   */
  packageGene({ name, description, category, content, author }) {
    return {
      id: `gene-${name}-${Date.now()}`,
      name,
      description: description || "",
      category: category || "general",
      author: author || "anonymous",
      version: "1.0.0",
      content: content || "",
      createdAt: new Date().toISOString(),
    };
  }
}

// ===== V2 Surface: EvoMap Manager governance overlay (CLI v0.135.0) =====
export const EVOMAP_MAP_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const EVOMAP_EVOLUTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _emMapTrans = new Map([
  [
    EVOMAP_MAP_MATURITY_V2.PENDING,
    new Set([EVOMAP_MAP_MATURITY_V2.ACTIVE, EVOMAP_MAP_MATURITY_V2.ARCHIVED]),
  ],
  [
    EVOMAP_MAP_MATURITY_V2.ACTIVE,
    new Set([EVOMAP_MAP_MATURITY_V2.STALE, EVOMAP_MAP_MATURITY_V2.ARCHIVED]),
  ],
  [
    EVOMAP_MAP_MATURITY_V2.STALE,
    new Set([EVOMAP_MAP_MATURITY_V2.ACTIVE, EVOMAP_MAP_MATURITY_V2.ARCHIVED]),
  ],
  [EVOMAP_MAP_MATURITY_V2.ARCHIVED, new Set()],
]);
const _emMapTerminal = new Set([EVOMAP_MAP_MATURITY_V2.ARCHIVED]);
const _emEvoTrans = new Map([
  [
    EVOMAP_EVOLUTION_LIFECYCLE_V2.QUEUED,
    new Set([
      EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING,
      EVOMAP_EVOLUTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING,
    new Set([
      EVOMAP_EVOLUTION_LIFECYCLE_V2.COMPLETED,
      EVOMAP_EVOLUTION_LIFECYCLE_V2.FAILED,
      EVOMAP_EVOLUTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EVOMAP_EVOLUTION_LIFECYCLE_V2.COMPLETED, new Set()],
  [EVOMAP_EVOLUTION_LIFECYCLE_V2.FAILED, new Set()],
  [EVOMAP_EVOLUTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _emMaps = new Map();
const _emEvos = new Map();
let _emMaxActivePerOwner = 10;
let _emMaxPendingPerMap = 15;
let _emMapIdleMs = 7 * 24 * 60 * 60 * 1000;
let _emEvoStuckMs = 5 * 60 * 1000;

function _emPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveEvoMapsPerOwnerV2(n) {
  _emMaxActivePerOwner = _emPos(n, "maxActiveEvoMapsPerOwner");
}
export function getMaxActiveEvoMapsPerOwnerV2() {
  return _emMaxActivePerOwner;
}
export function setMaxPendingEvoEvolutionsPerMapV2(n) {
  _emMaxPendingPerMap = _emPos(n, "maxPendingEvoEvolutionsPerMap");
}
export function getMaxPendingEvoEvolutionsPerMapV2() {
  return _emMaxPendingPerMap;
}
export function setEvoMapIdleMsV2(n) {
  _emMapIdleMs = _emPos(n, "evoMapIdleMs");
}
export function getEvoMapIdleMsV2() {
  return _emMapIdleMs;
}
export function setEvoEvolutionStuckMsV2(n) {
  _emEvoStuckMs = _emPos(n, "evoEvolutionStuckMs");
}
export function getEvoEvolutionStuckMsV2() {
  return _emEvoStuckMs;
}

export function _resetStateEvoMapManagerV2() {
  _emMaps.clear();
  _emEvos.clear();
  _emMaxActivePerOwner = 10;
  _emMaxPendingPerMap = 15;
  _emMapIdleMs = 7 * 24 * 60 * 60 * 1000;
  _emEvoStuckMs = 5 * 60 * 1000;
}

export function registerEvoMapV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_emMaps.has(id)) throw new Error(`evomap ${id} already registered`);
  const now = Date.now();
  const m = {
    id,
    owner,
    name: name || id,
    status: EVOMAP_MAP_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _emMaps.set(id, m);
  return { ...m, metadata: { ...m.metadata } };
}
function _emCheckM(from, to) {
  const a = _emMapTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evomap transition ${from} → ${to}`);
}
function _emCountActive(owner) {
  let n = 0;
  for (const m of _emMaps.values())
    if (m.owner === owner && m.status === EVOMAP_MAP_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateEvoMapV2(id) {
  const m = _emMaps.get(id);
  if (!m) throw new Error(`evomap ${id} not found`);
  _emCheckM(m.status, EVOMAP_MAP_MATURITY_V2.ACTIVE);
  const recovery = m.status === EVOMAP_MAP_MATURITY_V2.STALE;
  if (!recovery) {
    const a = _emCountActive(m.owner);
    if (a >= _emMaxActivePerOwner)
      throw new Error(
        `max active evomaps per owner (${_emMaxActivePerOwner}) reached for ${m.owner}`,
      );
  }
  const now = Date.now();
  m.status = EVOMAP_MAP_MATURITY_V2.ACTIVE;
  m.updatedAt = now;
  m.lastTouchedAt = now;
  if (!m.activatedAt) m.activatedAt = now;
  return { ...m, metadata: { ...m.metadata } };
}
export function staleEvoMapV2(id) {
  const m = _emMaps.get(id);
  if (!m) throw new Error(`evomap ${id} not found`);
  _emCheckM(m.status, EVOMAP_MAP_MATURITY_V2.STALE);
  m.status = EVOMAP_MAP_MATURITY_V2.STALE;
  m.updatedAt = Date.now();
  return { ...m, metadata: { ...m.metadata } };
}
export function archiveEvoMapV2(id) {
  const m = _emMaps.get(id);
  if (!m) throw new Error(`evomap ${id} not found`);
  _emCheckM(m.status, EVOMAP_MAP_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  m.status = EVOMAP_MAP_MATURITY_V2.ARCHIVED;
  m.updatedAt = now;
  if (!m.archivedAt) m.archivedAt = now;
  return { ...m, metadata: { ...m.metadata } };
}
export function touchEvoMapV2(id) {
  const m = _emMaps.get(id);
  if (!m) throw new Error(`evomap ${id} not found`);
  if (_emMapTerminal.has(m.status))
    throw new Error(`cannot touch terminal evomap ${id}`);
  const now = Date.now();
  m.lastTouchedAt = now;
  m.updatedAt = now;
  return { ...m, metadata: { ...m.metadata } };
}
export function getEvoMapV2(id) {
  const m = _emMaps.get(id);
  if (!m) return null;
  return { ...m, metadata: { ...m.metadata } };
}
export function listEvoMapsV2() {
  return [..._emMaps.values()].map((m) => ({
    ...m,
    metadata: { ...m.metadata },
  }));
}

function _emCountPending(mid) {
  let n = 0;
  for (const e of _emEvos.values())
    if (
      e.mapId === mid &&
      (e.status === EVOMAP_EVOLUTION_LIFECYCLE_V2.QUEUED ||
        e.status === EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createEvoEvolutionV2({ id, mapId, strategy, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!mapId || typeof mapId !== "string") throw new Error("mapId is required");
  if (_emEvos.has(id)) throw new Error(`evo evolution ${id} already exists`);
  if (!_emMaps.has(mapId)) throw new Error(`evomap ${mapId} not found`);
  const pending = _emCountPending(mapId);
  if (pending >= _emMaxPendingPerMap)
    throw new Error(
      `max pending evo evolutions per map (${_emMaxPendingPerMap}) reached for ${mapId}`,
    );
  const now = Date.now();
  const e = {
    id,
    mapId,
    strategy: strategy || "default",
    status: EVOMAP_EVOLUTION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _emEvos.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
function _emCheckE(from, to) {
  const a = _emEvoTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evo evolution transition ${from} → ${to}`);
}
export function startEvoEvolutionV2(id) {
  const e = _emEvos.get(id);
  if (!e) throw new Error(`evo evolution ${id} not found`);
  _emCheckE(e.status, EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  e.status = EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function completeEvoEvolutionV2(id) {
  const e = _emEvos.get(id);
  if (!e) throw new Error(`evo evolution ${id} not found`);
  _emCheckE(e.status, EVOMAP_EVOLUTION_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  e.status = EVOMAP_EVOLUTION_LIFECYCLE_V2.COMPLETED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function failEvoEvolutionV2(id, reason) {
  const e = _emEvos.get(id);
  if (!e) throw new Error(`evo evolution ${id} not found`);
  _emCheckE(e.status, EVOMAP_EVOLUTION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = EVOMAP_EVOLUTION_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function cancelEvoEvolutionV2(id, reason) {
  const e = _emEvos.get(id);
  if (!e) throw new Error(`evo evolution ${id} not found`);
  _emCheckE(e.status, EVOMAP_EVOLUTION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = EVOMAP_EVOLUTION_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function getEvoEvolutionV2(id) {
  const e = _emEvos.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}
export function listEvoEvolutionsV2() {
  return [..._emEvos.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}

export function autoStaleIdleEvoMapsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const m of _emMaps.values())
    if (
      m.status === EVOMAP_MAP_MATURITY_V2.ACTIVE &&
      t - m.lastTouchedAt >= _emMapIdleMs
    ) {
      m.status = EVOMAP_MAP_MATURITY_V2.STALE;
      m.updatedAt = t;
      flipped.push(m.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEvoEvolutionsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _emEvos.values())
    if (
      e.status === EVOMAP_EVOLUTION_LIFECYCLE_V2.RUNNING &&
      e.startedAt != null &&
      t - e.startedAt >= _emEvoStuckMs
    ) {
      e.status = EVOMAP_EVOLUTION_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  return { flipped, count: flipped.length };
}

export function getEvoMapManagerStatsV2() {
  const mapsByStatus = {};
  for (const s of Object.values(EVOMAP_MAP_MATURITY_V2)) mapsByStatus[s] = 0;
  for (const m of _emMaps.values()) mapsByStatus[m.status]++;
  const evosByStatus = {};
  for (const s of Object.values(EVOMAP_EVOLUTION_LIFECYCLE_V2))
    evosByStatus[s] = 0;
  for (const e of _emEvos.values()) evosByStatus[e.status]++;
  return {
    totalMapsV2: _emMaps.size,
    totalEvolutionsV2: _emEvos.size,
    maxActiveEvoMapsPerOwner: _emMaxActivePerOwner,
    maxPendingEvoEvolutionsPerMap: _emMaxPendingPerMap,
    evoMapIdleMs: _emMapIdleMs,
    evoEvolutionStuckMs: _emEvoStuckMs,
    mapsByStatus,
    evosByStatus,
  };
}

// === Iter28 V2 governance overlay: Emgrgov ===
export const EMGRGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const EMGRGOV_OP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  OPERATING: "operating",
  OPERATED: "operated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _emgrgovPTrans = new Map([
  [
    EMGRGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      EMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      EMGRGOV_PROFILE_MATURITY_V2.STALE,
      EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EMGRGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      EMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _emgrgovPTerminal = new Set([EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _emgrgovJTrans = new Map([
  [
    EMGRGOV_OP_LIFECYCLE_V2.QUEUED,
    new Set([
      EMGRGOV_OP_LIFECYCLE_V2.OPERATING,
      EMGRGOV_OP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EMGRGOV_OP_LIFECYCLE_V2.OPERATING,
    new Set([
      EMGRGOV_OP_LIFECYCLE_V2.OPERATED,
      EMGRGOV_OP_LIFECYCLE_V2.FAILED,
      EMGRGOV_OP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EMGRGOV_OP_LIFECYCLE_V2.OPERATED, new Set()],
  [EMGRGOV_OP_LIFECYCLE_V2.FAILED, new Set()],
  [EMGRGOV_OP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _emgrgovPsV2 = new Map();
const _emgrgovJsV2 = new Map();
let _emgrgovMaxActive = 8,
  _emgrgovMaxPending = 20,
  _emgrgovIdleMs = 2592000000,
  _emgrgovStuckMs = 60 * 1000;
function _emgrgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _emgrgovCheckP(from, to) {
  const a = _emgrgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid emgrgov profile transition ${from} → ${to}`);
}
function _emgrgovCheckJ(from, to) {
  const a = _emgrgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid emgrgov op transition ${from} → ${to}`);
}
function _emgrgovCountActive(owner) {
  let c = 0;
  for (const p of _emgrgovPsV2.values())
    if (p.owner === owner && p.status === EMGRGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _emgrgovCountPending(profileId) {
  let c = 0;
  for (const j of _emgrgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === EMGRGOV_OP_LIFECYCLE_V2.QUEUED ||
        j.status === EMGRGOV_OP_LIFECYCLE_V2.OPERATING)
    )
      c++;
  return c;
}
export function setMaxActiveEmgrProfilesPerOwnerV2(n) {
  _emgrgovMaxActive = _emgrgovPos(n, "maxActiveEmgrProfilesPerOwner");
}
export function getMaxActiveEmgrProfilesPerOwnerV2() {
  return _emgrgovMaxActive;
}
export function setMaxPendingEmgrOpsPerProfileV2(n) {
  _emgrgovMaxPending = _emgrgovPos(n, "maxPendingEmgrOpsPerProfile");
}
export function getMaxPendingEmgrOpsPerProfileV2() {
  return _emgrgovMaxPending;
}
export function setEmgrProfileIdleMsV2(n) {
  _emgrgovIdleMs = _emgrgovPos(n, "emgrgovProfileIdleMs");
}
export function getEmgrProfileIdleMsV2() {
  return _emgrgovIdleMs;
}
export function setEmgrOpStuckMsV2(n) {
  _emgrgovStuckMs = _emgrgovPos(n, "emgrgovOpStuckMs");
}
export function getEmgrOpStuckMsV2() {
  return _emgrgovStuckMs;
}
export function _resetStateEmgrgovV2() {
  _emgrgovPsV2.clear();
  _emgrgovJsV2.clear();
  _emgrgovMaxActive = 8;
  _emgrgovMaxPending = 20;
  _emgrgovIdleMs = 2592000000;
  _emgrgovStuckMs = 60 * 1000;
}
export function registerEmgrProfileV2({ id, owner, map, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_emgrgovPsV2.has(id))
    throw new Error(`emgrgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    map: map || "default",
    status: EMGRGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _emgrgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEmgrProfileV2(id) {
  const p = _emgrgovPsV2.get(id);
  if (!p) throw new Error(`emgrgov profile ${id} not found`);
  const isInitial = p.status === EMGRGOV_PROFILE_MATURITY_V2.PENDING;
  _emgrgovCheckP(p.status, EMGRGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _emgrgovCountActive(p.owner) >= _emgrgovMaxActive)
    throw new Error(`max active emgrgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = EMGRGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleEmgrProfileV2(id) {
  const p = _emgrgovPsV2.get(id);
  if (!p) throw new Error(`emgrgov profile ${id} not found`);
  _emgrgovCheckP(p.status, EMGRGOV_PROFILE_MATURITY_V2.STALE);
  p.status = EMGRGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEmgrProfileV2(id) {
  const p = _emgrgovPsV2.get(id);
  if (!p) throw new Error(`emgrgov profile ${id} not found`);
  _emgrgovCheckP(p.status, EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = EMGRGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEmgrProfileV2(id) {
  const p = _emgrgovPsV2.get(id);
  if (!p) throw new Error(`emgrgov profile ${id} not found`);
  if (_emgrgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal emgrgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEmgrProfileV2(id) {
  const p = _emgrgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEmgrProfilesV2() {
  return [..._emgrgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEmgrOpV2({ id, profileId, opId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_emgrgovJsV2.has(id)) throw new Error(`emgrgov op ${id} already exists`);
  if (!_emgrgovPsV2.has(profileId))
    throw new Error(`emgrgov profile ${profileId} not found`);
  if (_emgrgovCountPending(profileId) >= _emgrgovMaxPending)
    throw new Error(`max pending emgrgov ops for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    opId: opId || "",
    status: EMGRGOV_OP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _emgrgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function operatingEmgrOpV2(id) {
  const j = _emgrgovJsV2.get(id);
  if (!j) throw new Error(`emgrgov op ${id} not found`);
  _emgrgovCheckJ(j.status, EMGRGOV_OP_LIFECYCLE_V2.OPERATING);
  const now = Date.now();
  j.status = EMGRGOV_OP_LIFECYCLE_V2.OPERATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeOpEmgrV2(id) {
  const j = _emgrgovJsV2.get(id);
  if (!j) throw new Error(`emgrgov op ${id} not found`);
  _emgrgovCheckJ(j.status, EMGRGOV_OP_LIFECYCLE_V2.OPERATED);
  const now = Date.now();
  j.status = EMGRGOV_OP_LIFECYCLE_V2.OPERATED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEmgrOpV2(id, reason) {
  const j = _emgrgovJsV2.get(id);
  if (!j) throw new Error(`emgrgov op ${id} not found`);
  _emgrgovCheckJ(j.status, EMGRGOV_OP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EMGRGOV_OP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEmgrOpV2(id, reason) {
  const j = _emgrgovJsV2.get(id);
  if (!j) throw new Error(`emgrgov op ${id} not found`);
  _emgrgovCheckJ(j.status, EMGRGOV_OP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EMGRGOV_OP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEmgrOpV2(id) {
  const j = _emgrgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEmgrOpsV2() {
  return [..._emgrgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleEmgrProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _emgrgovPsV2.values())
    if (
      p.status === EMGRGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _emgrgovIdleMs
    ) {
      p.status = EMGRGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEmgrOpsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _emgrgovJsV2.values())
    if (
      j.status === EMGRGOV_OP_LIFECYCLE_V2.OPERATING &&
      j.startedAt != null &&
      t - j.startedAt >= _emgrgovStuckMs
    ) {
      j.status = EMGRGOV_OP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getEmgrgovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(EMGRGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _emgrgovPsV2.values()) profilesByStatus[p.status]++;
  const opsByStatus = {};
  for (const v of Object.values(EMGRGOV_OP_LIFECYCLE_V2)) opsByStatus[v] = 0;
  for (const j of _emgrgovJsV2.values()) opsByStatus[j.status]++;
  return {
    totalEmgrProfilesV2: _emgrgovPsV2.size,
    totalEmgrOpsV2: _emgrgovJsV2.size,
    maxActiveEmgrProfilesPerOwner: _emgrgovMaxActive,
    maxPendingEmgrOpsPerProfile: _emgrgovMaxPending,
    emgrgovProfileIdleMs: _emgrgovIdleMs,
    emgrgovOpStuckMs: _emgrgovStuckMs,
    profilesByStatus,
    opsByStatus,
  };
}
