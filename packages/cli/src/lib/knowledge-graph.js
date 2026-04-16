/**
 * Knowledge Graph — CLI port of Phase 94 企业知识图谱
 * (docs/design/modules/59_企业知识图谱.md).
 *
 * The Desktop build drives knowledge graph with GraphRAG fusion (entity
 * embeddings + vector retrieval + LLM augmentation) and force-directed
 * visualization. The CLI can't host Qdrant / force-directed layout, so this
 * port ships the tractable scaffolding:
 *
 *   - EntityStore: add/list/show/query with type + name-substring filters.
 *   - RelationStore: add/list/filter with source/target/type/weight.
 *   - Graph traversal: BFS multi-hop reasoning with depth limit and path
 *     reconstruction (no vector rerank).
 *   - Stats: entity/relationship counts, type distribution, avg degree.
 *   - Import/export: JSON serialization.
 *   - Catalogs: ENTITY_TYPES (7 standard types).
 *
 * GraphRAG fusion search, vector embeddings, force-directed visualization
 * layout, and real-time graph editing UI are Desktop-only.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

// 7 standard entity types — match Desktop defaults (37_技能市场系统 §2.2).
// `type` field on entities is a free-form string; these are the recommended
// classifiers. CLI does NOT enforce — a user can create entities with
// custom types for their domain.
export const ENTITY_TYPES = Object.freeze({
  PERSON: { name: "Person", description: "人员（员工、客户、合作伙伴）" },
  ORGANIZATION: {
    name: "Organization",
    description: "组织（部门、公司、团队）",
  },
  PROJECT: { name: "Project", description: "项目（产品、工程、研究课题）" },
  TECHNOLOGY: {
    name: "Technology",
    description: "技术（编程语言、框架、工具）",
  },
  DOCUMENT: { name: "Document", description: "文档（设计稿、报告、规范）" },
  CONCEPT: { name: "Concept", description: "概念（领域知识、术语、理论）" },
  EVENT: { name: "Event", description: "事件（会议、里程碑、发布）" },
});

/* ── State ─────────────────────────────────────────────────── */

const _entities = new Map(); // id → entity
const _relations = new Map(); // id → relation
// Adjacency indexes for fast traversal (rebuilt on add/remove)
const _outEdges = new Map(); // sourceId → Set<relationId>
const _inEdges = new Map(); // targetId → Set<relationId>
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureKnowledgeGraphTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      properties TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_relationships (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      properties TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kg_rel_source ON kg_relationships(source_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kg_rel_target ON kg_relationships(target_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kg_rel_type ON kg_relationships(relation_type)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listEntityTypes() {
  return Object.values(ENTITY_TYPES).map((t) => ({ ...t }));
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/* ── Entities ──────────────────────────────────────────────── */

function _persistEntity(db, entity) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO kg_entities
     (id, name, type, properties, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entity.id,
    entity.name,
    entity.type,
    entity.properties ? JSON.stringify(entity.properties) : null,
    entity.tags ? JSON.stringify(entity.tags) : null,
    entity.createdAt,
    entity.updatedAt,
  );
}

export function addEntity(db, config = {}) {
  const name = String(config.name || "").trim();
  if (!name) throw new Error("entity name is required");

  const type = String(config.type || "").trim();
  if (!type) throw new Error("entity type is required");

  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  if (_entities.has(id)) {
    throw new Error(`Entity already exists: ${id}`);
  }

  const entity = {
    id,
    name,
    type,
    properties: config.properties || null,
    tags: Array.isArray(config.tags) ? [...config.tags] : null,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _entities.set(id, entity);
  _persistEntity(db, entity);
  return _strip(entity);
}

export function getEntity(id) {
  const e = _entities.get(String(id || ""));
  return e ? _strip(e) : null;
}

export function listEntities(opts = {}) {
  let rows = [..._entities.values()];
  if (opts.type) {
    const t = String(opts.type);
    rows = rows.filter((e) => e.type === t);
  }
  if (opts.name) {
    const q = String(opts.name).toLowerCase();
    rows = rows.filter((e) => e.name.toLowerCase().includes(q));
  }
  if (opts.tag) {
    const tag = String(opts.tag);
    rows = rows.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

export function removeEntity(db, id) {
  const entity = _entities.get(id);
  if (!entity) return false;

  // Cascade: remove all relations touching this entity
  const touching = [];
  for (const r of _relations.values()) {
    if (r.sourceId === id || r.targetId === id) touching.push(r.id);
  }
  for (const rid of touching) removeRelation(db, rid);

  _entities.delete(id);
  if (db) {
    db.prepare(`DELETE FROM kg_entities WHERE id = ?`).run(id);
  }
  return true;
}

/* ── Relations ─────────────────────────────────────────────── */

function _persistRelation(db, relation) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO kg_relationships
     (id, source_id, target_id, relation_type, weight, properties, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    relation.id,
    relation.sourceId,
    relation.targetId,
    relation.relationType,
    relation.weight,
    relation.properties ? JSON.stringify(relation.properties) : null,
    relation.createdAt,
  );
}

function _indexRelation(relation) {
  let outSet = _outEdges.get(relation.sourceId);
  if (!outSet) {
    outSet = new Set();
    _outEdges.set(relation.sourceId, outSet);
  }
  outSet.add(relation.id);
  let inSet = _inEdges.get(relation.targetId);
  if (!inSet) {
    inSet = new Set();
    _inEdges.set(relation.targetId, inSet);
  }
  inSet.add(relation.id);
}

function _unindexRelation(relation) {
  const outSet = _outEdges.get(relation.sourceId);
  if (outSet) {
    outSet.delete(relation.id);
    if (outSet.size === 0) _outEdges.delete(relation.sourceId);
  }
  const inSet = _inEdges.get(relation.targetId);
  if (inSet) {
    inSet.delete(relation.id);
    if (inSet.size === 0) _inEdges.delete(relation.targetId);
  }
}

export function addRelation(db, config = {}) {
  const sourceId = String(config.sourceId || "").trim();
  const targetId = String(config.targetId || "").trim();
  const relationType = String(config.relationType || "").trim();

  if (!sourceId) throw new Error("sourceId is required");
  if (!targetId) throw new Error("targetId is required");
  if (!relationType) throw new Error("relationType is required");
  if (sourceId === targetId) {
    throw new Error("Cannot create self-referencing relation");
  }

  if (!_entities.has(sourceId)) {
    throw new Error(`Source entity not found: ${sourceId}`);
  }
  if (!_entities.has(targetId)) {
    throw new Error(`Target entity not found: ${targetId}`);
  }

  const weight = Number(config.weight ?? 1.0);
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error(`Invalid weight: ${config.weight} (must be >= 0)`);
  }

  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  const relation = {
    id,
    sourceId,
    targetId,
    relationType,
    weight,
    properties: config.properties || null,
    createdAt: now,
    _seq: ++_seq,
  };
  _relations.set(id, relation);
  _indexRelation(relation);
  _persistRelation(db, relation);
  return _strip(relation);
}

export function getRelation(id) {
  const r = _relations.get(String(id || ""));
  return r ? _strip(r) : null;
}

export function listRelations(opts = {}) {
  let rows = [..._relations.values()];
  if (opts.sourceId) {
    const s = String(opts.sourceId);
    rows = rows.filter((r) => r.sourceId === s);
  }
  if (opts.targetId) {
    const t = String(opts.targetId);
    rows = rows.filter((r) => r.targetId === t);
  }
  if (opts.relationType) {
    const t = String(opts.relationType);
    rows = rows.filter((r) => r.relationType === t);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

export function removeRelation(db, id) {
  const relation = _relations.get(id);
  if (!relation) return false;
  _unindexRelation(relation);
  _relations.delete(id);
  if (db) {
    db.prepare(`DELETE FROM kg_relationships WHERE id = ?`).run(id);
  }
  return true;
}

/* ── Traversal / Reasoning ─────────────────────────────────── */

/**
 * BFS multi-hop traversal from a start entity.
 * Returns entities reachable within `maxDepth` hops, along with the path
 * (array of relation ids) that reaches each.
 *
 * opts:
 *   - maxDepth: hop limit (default 3)
 *   - direction: "out" | "in" | "both" (default "out")
 *   - relationType: filter edges by relation_type
 *   - includeStart: include start entity in result (default false)
 */
export function reason(startEntityId, opts = {}) {
  const start = String(startEntityId || "").trim();
  if (!_entities.has(start)) {
    throw new Error(`Start entity not found: ${start}`);
  }

  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 3;
  if (maxDepth < 0) throw new Error(`Invalid maxDepth: ${opts.maxDepth}`);

  const direction = opts.direction || "out";
  if (!["out", "in", "both"].includes(direction)) {
    throw new Error(`Invalid direction: ${opts.direction}`);
  }

  const relTypeFilter = opts.relationType || null;

  const visited = new Map(); // entityId → { depth, pathRelationIds[] }
  visited.set(start, { depth: 0, path: [] });

  const queue = [start];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentNode = visited.get(currentId);
    if (currentNode.depth >= maxDepth) continue;

    const edgeIds = new Set();
    if (direction === "out" || direction === "both") {
      const out = _outEdges.get(currentId);
      if (out) for (const id of out) edgeIds.add(id);
    }
    if (direction === "in" || direction === "both") {
      const inn = _inEdges.get(currentId);
      if (inn) for (const id of inn) edgeIds.add(id);
    }

    for (const relId of edgeIds) {
      const rel = _relations.get(relId);
      if (!rel) continue;
      if (relTypeFilter && rel.relationType !== relTypeFilter) continue;

      const nextId = rel.sourceId === currentId ? rel.targetId : rel.sourceId;
      if (visited.has(nextId)) continue;

      visited.set(nextId, {
        depth: currentNode.depth + 1,
        path: [...currentNode.path, relId],
      });
      queue.push(nextId);
    }
  }

  const results = [];
  for (const [entityId, node] of visited.entries()) {
    if (!opts.includeStart && entityId === start) continue;
    const entity = _entities.get(entityId);
    results.push({
      entity: _strip(entity),
      depth: node.depth,
      path: [...node.path],
    });
  }
  results.sort(
    (a, b) => a.depth - b.depth || a.entity.createdAt - b.entity.createdAt,
  );
  return results;
}

/**
 * Simple name/type match query — returns entities that pass all active
 * filters. Lightweight alternative to `listEntities` for programmatic
 * callers (callers don't need to care about default limits).
 */
export function query(opts = {}) {
  return listEntities({ ...opts, limit: opts.limit || 100 });
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getStats() {
  const entityCount = _entities.size;
  const relationCount = _relations.size;

  const typeDistribution = {};
  for (const e of _entities.values()) {
    typeDistribution[e.type] = (typeDistribution[e.type] || 0) + 1;
  }

  const relationTypeDistribution = {};
  for (const r of _relations.values()) {
    relationTypeDistribution[r.relationType] =
      (relationTypeDistribution[r.relationType] || 0) + 1;
  }

  // Average degree = 2 × edges / nodes (undirected interpretation:
  // each edge contributes to 2 endpoints). 0 when no entities.
  const avgDegree =
    entityCount > 0
      ? Number(((2 * relationCount) / entityCount).toFixed(4))
      : 0;

  // Density = edges / (nodes × (nodes-1)) for directed graph; 0 when <2.
  const density =
    entityCount > 1
      ? Number((relationCount / (entityCount * (entityCount - 1))).toFixed(6))
      : 0;

  return {
    entityCount,
    relationCount,
    typeDistribution,
    relationTypeDistribution,
    avgDegree,
    density,
  };
}

/* ── Import / Export ───────────────────────────────────────── */

export function exportGraph() {
  return {
    entities: [..._entities.values()].map(_strip),
    relations: [..._relations.values()].map(_strip),
    exportedAt: Date.now(),
  };
}

/**
 * Batch import. Input shape: `{ entities[], relations[] }`.
 * - Entities without `id` get generated ones
 * - Relations referencing unknown sourceId/targetId are skipped
 * - Returns `{ importedEntities, importedRelations, skippedRelations }`
 */
export function importGraph(db, data = {}) {
  const entities = Array.isArray(data.entities) ? data.entities : [];
  const relations = Array.isArray(data.relations) ? data.relations : [];

  let importedEntities = 0;
  const idMap = new Map(); // original-id → final-id (for relation resolution)
  for (const raw of entities) {
    const originalId = raw.id || null;
    try {
      const entity = addEntity(db, {
        id: raw.id,
        name: raw.name,
        type: raw.type,
        properties: raw.properties,
        tags: raw.tags,
        now: raw.createdAt,
      });
      if (originalId) idMap.set(originalId, entity.id);
      importedEntities += 1;
    } catch {
      // Skip malformed entity
    }
  }

  let importedRelations = 0;
  let skippedRelations = 0;
  for (const raw of relations) {
    const sourceId = idMap.get(raw.sourceId) || raw.sourceId;
    const targetId = idMap.get(raw.targetId) || raw.targetId;
    if (!_entities.has(sourceId) || !_entities.has(targetId)) {
      skippedRelations += 1;
      continue;
    }
    try {
      addRelation(db, {
        id: raw.id,
        sourceId,
        targetId,
        relationType: raw.relationType,
        weight: raw.weight,
        properties: raw.properties,
        now: raw.createdAt,
      });
      importedRelations += 1;
    } catch {
      skippedRelations += 1;
    }
  }

  return { importedEntities, importedRelations, skippedRelations };
}

/* ── Reset (tests) ─────────────────────────────────────────── */

export function _resetState() {
  _entities.clear();
  _relations.clear();
  _outEdges.clear();
  _inEdges.clear();
  _seq = 0;
}
