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
