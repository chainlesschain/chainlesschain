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

/* ═══════════════════════════════════════════════════════════════
 * V2 SURFACE — Phase 94 lifecycle state machines
 * ═══════════════════════════════════════════════════════════════
 *
 * V2 adds two parallel lifecycles on top of the legacy entity/relation
 * store. Nothing above is modified.
 *
 *   Entity maturity: active → { deprecated, archived }
 *                   deprecated → { active, archived, removed }
 *                   archived  → { active, removed }
 *                   Terminal:  removed
 *
 *   Relation status: active     → { deprecated, removed }
 *                    deprecated → { active, removed }
 *                    Terminal:  removed
 *
 * Caps: per-owner active-entity count + per-source-entity active-relation
 *       count.
 *
 * Auto-flip: stale-entity auto-archive + stale-relation auto-remove.
 *
 * Stats: all enum keys zero-initialized for stable CI regression shape.
 * ═════════════════════════════════════════════════════════════ */

export const ENTITY_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
  REMOVED: "removed",
});

export const RELATION_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  REMOVED: "removed",
});

const ENTITY_TRANSITIONS_V2 = new Map([
  ["active", new Set(["deprecated", "archived"])],
  ["deprecated", new Set(["active", "archived", "removed"])],
  ["archived", new Set(["active", "removed"])],
]);
const ENTITY_TERMINALS_V2 = new Set(["removed"]);

const RELATION_TRANSITIONS_V2 = new Map([
  ["active", new Set(["deprecated", "removed"])],
  ["deprecated", new Set(["active", "removed"])],
]);
const RELATION_TERMINALS_V2 = new Set(["removed"]);

export const KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER = 1000;
export const KG_DEFAULT_MAX_RELATIONS_PER_ENTITY = 100;
export const KG_DEFAULT_ENTITY_STALE_MS = 180 * 86400000; // 180 days
export const KG_DEFAULT_RELATION_STALE_MS = 365 * 86400000; // 365 days

let _maxActiveEntitiesPerOwnerV2 = KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER;
let _maxRelationsPerEntityV2 = KG_DEFAULT_MAX_RELATIONS_PER_ENTITY;
let _entityStaleMsV2 = KG_DEFAULT_ENTITY_STALE_MS;
let _relationStaleMsV2 = KG_DEFAULT_RELATION_STALE_MS;

const _entityStatesV2 = new Map(); // entityId → V2 record
const _relationStatesV2 = new Map(); // relationId → V2 record

function _positiveIntV2(n, label) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(num);
}

function _validEntityStatusV2(status) {
  return (
    status === "active" ||
    status === "deprecated" ||
    status === "archived" ||
    status === "removed"
  );
}

function _validRelationStatusV2(status) {
  return status === "active" || status === "deprecated" || status === "removed";
}

export function getDefaultMaxActiveEntitiesPerOwnerV2() {
  return KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER;
}
export function getMaxActiveEntitiesPerOwnerV2() {
  return _maxActiveEntitiesPerOwnerV2;
}
export function setMaxActiveEntitiesPerOwnerV2(n) {
  _maxActiveEntitiesPerOwnerV2 = _positiveIntV2(n, "maxActiveEntitiesPerOwner");
  return _maxActiveEntitiesPerOwnerV2;
}

export function getDefaultMaxRelationsPerEntityV2() {
  return KG_DEFAULT_MAX_RELATIONS_PER_ENTITY;
}
export function getMaxRelationsPerEntityV2() {
  return _maxRelationsPerEntityV2;
}
export function setMaxRelationsPerEntityV2(n) {
  _maxRelationsPerEntityV2 = _positiveIntV2(n, "maxRelationsPerEntity");
  return _maxRelationsPerEntityV2;
}

export function getDefaultEntityStaleMsV2() {
  return KG_DEFAULT_ENTITY_STALE_MS;
}
export function getEntityStaleMsV2() {
  return _entityStaleMsV2;
}
export function setEntityStaleMsV2(ms) {
  _entityStaleMsV2 = _positiveIntV2(ms, "entityStaleMs");
  return _entityStaleMsV2;
}

export function getDefaultRelationStaleMsV2() {
  return KG_DEFAULT_RELATION_STALE_MS;
}
export function getRelationStaleMsV2() {
  return _relationStaleMsV2;
}
export function setRelationStaleMsV2(ms) {
  _relationStaleMsV2 = _positiveIntV2(ms, "relationStaleMs");
  return _relationStaleMsV2;
}

/* ── Entity V2 ─────────────────────────────────────────────── */

export function registerEntityV2(db, config = {}) {
  void db;
  const entityId = String(config.entityId || "").trim();
  if (!entityId) throw new Error("entityId is required");
  const ownerId = String(config.ownerId || "").trim();
  if (!ownerId) throw new Error("ownerId is required");
  if (_entityStatesV2.has(entityId)) {
    throw new Error(`Entity already registered in V2: ${entityId}`);
  }

  let activeCount = 0;
  for (const rec of _entityStatesV2.values()) {
    if (rec.ownerId === ownerId && rec.status === "active") activeCount += 1;
  }
  if (activeCount >= _maxActiveEntitiesPerOwnerV2) {
    throw new Error(
      `Max active entities per owner reached (${_maxActiveEntitiesPerOwnerV2})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const record = {
    entityId,
    ownerId,
    name: config.name ? String(config.name) : null,
    type: config.type ? String(config.type) : null,
    status: "active",
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    reason: null,
  };
  _entityStatesV2.set(entityId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getEntityV2(entityId) {
  const rec = _entityStatesV2.get(String(entityId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setEntityStatusV2(db, entityId, newStatus, patch = {}) {
  void db;
  const id = String(entityId || "");
  const record = _entityStatesV2.get(id);
  if (!record) throw new Error(`Entity not registered in V2: ${id}`);
  if (!_validEntityStatusV2(newStatus)) {
    throw new Error(`Invalid entity status: ${newStatus}`);
  }
  if (ENTITY_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Entity is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = ENTITY_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }
  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function deprecateEntity(db, entityId, reason) {
  return setEntityStatusV2(db, entityId, "deprecated", { reason });
}
export function archiveEntityV2(db, entityId, reason) {
  return setEntityStatusV2(db, entityId, "archived", { reason });
}
export function removeEntityV2(db, entityId, reason) {
  return setEntityStatusV2(db, entityId, "removed", { reason });
}
export function reviveEntity(db, entityId, reason) {
  return setEntityStatusV2(db, entityId, "active", { reason });
}

export function touchEntityActivity(entityId) {
  const rec = _entityStatesV2.get(String(entityId || ""));
  if (!rec) throw new Error(`Entity not registered in V2: ${entityId}`);
  rec.lastActivityAt = Date.now();
  return { ...rec, metadata: { ...rec.metadata } };
}

/* ── Relation V2 ───────────────────────────────────────────── */

export function registerRelationV2(db, config = {}) {
  void db;
  const relationId = String(config.relationId || "").trim();
  if (!relationId) throw new Error("relationId is required");
  const sourceEntityId = String(config.sourceEntityId || "").trim();
  if (!sourceEntityId) throw new Error("sourceEntityId is required");
  const targetEntityId = String(config.targetEntityId || "").trim();
  if (!targetEntityId) throw new Error("targetEntityId is required");
  const relationType = String(config.relationType || "").trim();
  if (!relationType) throw new Error("relationType is required");

  if (sourceEntityId === targetEntityId) {
    throw new Error("Cannot create self-referencing relation");
  }
  if (_relationStatesV2.has(relationId)) {
    throw new Error(`Relation already registered in V2: ${relationId}`);
  }

  const src = _entityStatesV2.get(sourceEntityId);
  if (!src) {
    throw new Error(`Source entity not registered in V2: ${sourceEntityId}`);
  }
  if (src.status !== "active" && src.status !== "deprecated") {
    throw new Error(`Source entity is ${src.status}, cannot create relation`);
  }
  const tgt = _entityStatesV2.get(targetEntityId);
  if (!tgt) {
    throw new Error(`Target entity not registered in V2: ${targetEntityId}`);
  }
  if (tgt.status !== "active" && tgt.status !== "deprecated") {
    throw new Error(`Target entity is ${tgt.status}, cannot create relation`);
  }

  let sourceCount = 0;
  for (const rel of _relationStatesV2.values()) {
    if (rel.sourceEntityId === sourceEntityId && rel.status === "active") {
      sourceCount += 1;
    }
  }
  if (sourceCount >= _maxRelationsPerEntityV2) {
    throw new Error(
      `Max active relations per entity reached (${_maxRelationsPerEntityV2})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const record = {
    relationId,
    sourceEntityId,
    targetEntityId,
    relationType,
    status: "active",
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    reason: null,
  };
  _relationStatesV2.set(relationId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getRelationV2(relationId) {
  const rec = _relationStatesV2.get(String(relationId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setRelationStatusV2(db, relationId, newStatus, patch = {}) {
  void db;
  const id = String(relationId || "");
  const record = _relationStatesV2.get(id);
  if (!record) throw new Error(`Relation not registered in V2: ${id}`);
  if (!_validRelationStatusV2(newStatus)) {
    throw new Error(`Invalid relation status: ${newStatus}`);
  }
  if (RELATION_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Relation is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = RELATION_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }
  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function deprecateRelation(db, relationId, reason) {
  return setRelationStatusV2(db, relationId, "deprecated", { reason });
}
export function removeRelationV2(db, relationId, reason) {
  return setRelationStatusV2(db, relationId, "removed", { reason });
}
export function reviveRelation(db, relationId, reason) {
  return setRelationStatusV2(db, relationId, "active", { reason });
}

/* ── Counts ────────────────────────────────────────────────── */

export function getActiveEntityCount(ownerId) {
  let n = 0;
  for (const rec of _entityStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (ownerId !== undefined && rec.ownerId !== String(ownerId)) continue;
    n += 1;
  }
  return n;
}

export function getActiveRelationCount(sourceEntityId) {
  let n = 0;
  for (const rel of _relationStatesV2.values()) {
    if (rel.status !== "active") continue;
    if (
      sourceEntityId !== undefined &&
      rel.sourceEntityId !== String(sourceEntityId)
    ) {
      continue;
    }
    n += 1;
  }
  return n;
}

/* ── Auto-flip Bulk Ops ────────────────────────────────────── */

export function autoArchiveStaleEntities(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _entityStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (now - rec.lastActivityAt > _entityStaleMsV2) {
      rec.status = "archived";
      rec.updatedAt = now;
      rec.reason = "stale";
      flipped.push(rec.entityId);
    }
  }
  return flipped;
}

export function autoRemoveStaleRelations(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rel of _relationStatesV2.values()) {
    if (rel.status === "removed") continue;
    if (now - rel.updatedAt > _relationStaleMsV2) {
      rel.status = "removed";
      rel.updatedAt = now;
      rel.reason = "stale";
      flipped.push(rel.relationId);
    }
  }
  return flipped;
}

/* ── Stats V2 ──────────────────────────────────────────────── */

export function getKnowledgeGraphStatsV2() {
  const entitiesByStatus = {
    active: 0,
    deprecated: 0,
    archived: 0,
    removed: 0,
  };
  const relationsByStatus = {
    active: 0,
    deprecated: 0,
    removed: 0,
  };
  for (const rec of _entityStatesV2.values()) {
    if (entitiesByStatus[rec.status] !== undefined) {
      entitiesByStatus[rec.status] += 1;
    }
  }
  for (const rel of _relationStatesV2.values()) {
    if (relationsByStatus[rel.status] !== undefined) {
      relationsByStatus[rel.status] += 1;
    }
  }
  return {
    totalEntitiesV2: _entityStatesV2.size,
    totalRelationsV2: _relationStatesV2.size,
    maxActiveEntitiesPerOwner: _maxActiveEntitiesPerOwnerV2,
    maxRelationsPerEntity: _maxRelationsPerEntityV2,
    entityStaleMs: _entityStaleMsV2,
    relationStaleMs: _relationStaleMsV2,
    entitiesByStatus,
    relationsByStatus,
  };
}

/* ── Reset V2 (tests) ──────────────────────────────────────── */

export function _resetStateV2() {
  _entityStatesV2.clear();
  _relationStatesV2.clear();
  _maxActiveEntitiesPerOwnerV2 = KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER;
  _maxRelationsPerEntityV2 = KG_DEFAULT_MAX_RELATIONS_PER_ENTITY;
  _entityStaleMsV2 = KG_DEFAULT_ENTITY_STALE_MS;
  _relationStaleMsV2 = KG_DEFAULT_RELATION_STALE_MS;
}

// =====================================================================
// knowledge-graph V2 governance overlay (iter16)
// =====================================================================
export const KGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const KGOV_IMPORT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  IMPORTING: "importing",
  IMPORTED: "imported",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _kgovPTrans = new Map([
  [
    KGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      KGOV_PROFILE_MATURITY_V2.ACTIVE,
      KGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    KGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      KGOV_PROFILE_MATURITY_V2.STALE,
      KGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    KGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      KGOV_PROFILE_MATURITY_V2.ACTIVE,
      KGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [KGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _kgovPTerminal = new Set([KGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _kgovJTrans = new Map([
  [
    KGOV_IMPORT_LIFECYCLE_V2.QUEUED,
    new Set([
      KGOV_IMPORT_LIFECYCLE_V2.IMPORTING,
      KGOV_IMPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    KGOV_IMPORT_LIFECYCLE_V2.IMPORTING,
    new Set([
      KGOV_IMPORT_LIFECYCLE_V2.IMPORTED,
      KGOV_IMPORT_LIFECYCLE_V2.FAILED,
      KGOV_IMPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [KGOV_IMPORT_LIFECYCLE_V2.IMPORTED, new Set()],
  [KGOV_IMPORT_LIFECYCLE_V2.FAILED, new Set()],
  [KGOV_IMPORT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _kgovPsV2 = new Map();
const _kgovJsV2 = new Map();
let _kgovMaxActive = 6,
  _kgovMaxPending = 20,
  _kgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _kgovStuckMs = 60 * 1000;
function _kgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _kgovCheckP(from, to) {
  const a = _kgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid kgov profile transition ${from} → ${to}`);
}
function _kgovCheckJ(from, to) {
  const a = _kgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid kgov import transition ${from} → ${to}`);
}
function _kgovCountActive(owner) {
  let c = 0;
  for (const p of _kgovPsV2.values())
    if (p.owner === owner && p.status === KGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _kgovCountPending(profileId) {
  let c = 0;
  for (const j of _kgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === KGOV_IMPORT_LIFECYCLE_V2.QUEUED ||
        j.status === KGOV_IMPORT_LIFECYCLE_V2.IMPORTING)
    )
      c++;
  return c;
}
export function setMaxActiveKgovProfilesPerOwnerV2(n) {
  _kgovMaxActive = _kgovPos(n, "maxActiveKgovProfilesPerOwner");
}
export function getMaxActiveKgovProfilesPerOwnerV2() {
  return _kgovMaxActive;
}
export function setMaxPendingKgovImportsPerProfileV2(n) {
  _kgovMaxPending = _kgovPos(n, "maxPendingKgovImportsPerProfile");
}
export function getMaxPendingKgovImportsPerProfileV2() {
  return _kgovMaxPending;
}
export function setKgovProfileIdleMsV2(n) {
  _kgovIdleMs = _kgovPos(n, "kgovProfileIdleMs");
}
export function getKgovProfileIdleMsV2() {
  return _kgovIdleMs;
}
export function setKgovImportStuckMsV2(n) {
  _kgovStuckMs = _kgovPos(n, "kgovImportStuckMs");
}
export function getKgovImportStuckMsV2() {
  return _kgovStuckMs;
}
export function _resetStateKnowledgeGraphV2() {
  _kgovPsV2.clear();
  _kgovJsV2.clear();
  _kgovMaxActive = 6;
  _kgovMaxPending = 20;
  _kgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _kgovStuckMs = 60 * 1000;
}
export function registerKgovProfileV2({ id, owner, namespace, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_kgovPsV2.has(id)) throw new Error(`kgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    namespace: namespace || "default",
    status: KGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _kgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateKgovProfileV2(id) {
  const p = _kgovPsV2.get(id);
  if (!p) throw new Error(`kgov profile ${id} not found`);
  const isInitial = p.status === KGOV_PROFILE_MATURITY_V2.PENDING;
  _kgovCheckP(p.status, KGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _kgovCountActive(p.owner) >= _kgovMaxActive)
    throw new Error(`max active kgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = KGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleKgovProfileV2(id) {
  const p = _kgovPsV2.get(id);
  if (!p) throw new Error(`kgov profile ${id} not found`);
  _kgovCheckP(p.status, KGOV_PROFILE_MATURITY_V2.STALE);
  p.status = KGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveKgovProfileV2(id) {
  const p = _kgovPsV2.get(id);
  if (!p) throw new Error(`kgov profile ${id} not found`);
  _kgovCheckP(p.status, KGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = KGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchKgovProfileV2(id) {
  const p = _kgovPsV2.get(id);
  if (!p) throw new Error(`kgov profile ${id} not found`);
  if (_kgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal kgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getKgovProfileV2(id) {
  const p = _kgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listKgovProfilesV2() {
  return [..._kgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createKgovImportV2({ id, profileId, source, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_kgovJsV2.has(id)) throw new Error(`kgov import ${id} already exists`);
  if (!_kgovPsV2.has(profileId))
    throw new Error(`kgov profile ${profileId} not found`);
  if (_kgovCountPending(profileId) >= _kgovMaxPending)
    throw new Error(
      `max pending kgov imports for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    source: source || "",
    status: KGOV_IMPORT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _kgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function importingKgovImportV2(id) {
  const j = _kgovJsV2.get(id);
  if (!j) throw new Error(`kgov import ${id} not found`);
  _kgovCheckJ(j.status, KGOV_IMPORT_LIFECYCLE_V2.IMPORTING);
  const now = Date.now();
  j.status = KGOV_IMPORT_LIFECYCLE_V2.IMPORTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeImportKgovV2(id) {
  const j = _kgovJsV2.get(id);
  if (!j) throw new Error(`kgov import ${id} not found`);
  _kgovCheckJ(j.status, KGOV_IMPORT_LIFECYCLE_V2.IMPORTED);
  const now = Date.now();
  j.status = KGOV_IMPORT_LIFECYCLE_V2.IMPORTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failKgovImportV2(id, reason) {
  const j = _kgovJsV2.get(id);
  if (!j) throw new Error(`kgov import ${id} not found`);
  _kgovCheckJ(j.status, KGOV_IMPORT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = KGOV_IMPORT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelKgovImportV2(id, reason) {
  const j = _kgovJsV2.get(id);
  if (!j) throw new Error(`kgov import ${id} not found`);
  _kgovCheckJ(j.status, KGOV_IMPORT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = KGOV_IMPORT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getKgovImportV2(id) {
  const j = _kgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listKgovImportsV2() {
  return [..._kgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleKgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _kgovPsV2.values())
    if (
      p.status === KGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _kgovIdleMs
    ) {
      p.status = KGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckKgovImportsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _kgovJsV2.values())
    if (
      j.status === KGOV_IMPORT_LIFECYCLE_V2.IMPORTING &&
      j.startedAt != null &&
      t - j.startedAt >= _kgovStuckMs
    ) {
      j.status = KGOV_IMPORT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getKnowledgeGraphGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(KGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _kgovPsV2.values()) profilesByStatus[p.status]++;
  const importsByStatus = {};
  for (const v of Object.values(KGOV_IMPORT_LIFECYCLE_V2))
    importsByStatus[v] = 0;
  for (const j of _kgovJsV2.values()) importsByStatus[j.status]++;
  return {
    totalKgovProfilesV2: _kgovPsV2.size,
    totalKgovImportsV2: _kgovJsV2.size,
    maxActiveKgovProfilesPerOwner: _kgovMaxActive,
    maxPendingKgovImportsPerProfile: _kgovMaxPending,
    kgovProfileIdleMs: _kgovIdleMs,
    kgovImportStuckMs: _kgovStuckMs,
    profilesByStatus,
    importsByStatus,
  };
}
