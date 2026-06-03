/**
 * @module ai-engine/knowledge/enterprise-kg
 * Phase 94: Enterprise Knowledge Graph with entity extraction, graph query, reasoning, GraphRAG
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class EnterpriseKG extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._entities = new Map();
    this._relationships = new Map();
    this._entityIndex = new Map(); // type -> Set of entity IDs
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadGraph();
    this.initialized = true;
    logger.info(
      `[EnterpriseKG] Initialized: ${this._entities.size} entities, ${this._relationships.size} relationships`,
    );
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kg_entities (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, properties TEXT,
          embedding TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS kg_relationships (
          id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT,
          properties TEXT, weight REAL DEFAULT 1.0, created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[EnterpriseKG] Table creation warning:", error.message);
    }
  }

  async _loadGraph() {
    try {
      const entities = this.db.prepare("SELECT * FROM kg_entities").all();
      for (const e of entities) {
        const entity = { ...e, properties: JSON.parse(e.properties || "{}") };
        this._entities.set(e.id, entity);
        if (!this._entityIndex.has(e.type)) {
          this._entityIndex.set(e.type, new Set());
        }
        this._entityIndex.get(e.type).add(e.id);
      }
      const rels = this.db.prepare("SELECT * FROM kg_relationships").all();
      for (const r of rels) {
        this._relationships.set(r.id, {
          ...r,
          properties: JSON.parse(r.properties || "{}"),
        });
      }
    } catch (error) {
      logger.warn("[EnterpriseKG] Failed to load graph:", error.message);
    }
  }

  addEntity(name, type, properties = {}) {
    const id = `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entity = { id, name, type, properties };
    this._entities.set(id, entity);
    if (!this._entityIndex.has(type)) {
      this._entityIndex.set(type, new Set());
    }
    this._entityIndex.get(type).add(id);
    try {
      this.db
        .prepare(
          "INSERT INTO kg_entities (id, name, type, properties) VALUES (?, ?, ?, ?)",
        )
        .run(id, name, type, JSON.stringify(properties));
    } catch (error) {
      logger.error("[EnterpriseKG] Entity persist failed:", error.message);
    }
    this.emit("kg:entity-added", { id, name, type });
    return entity;
  }

  addRelationship(sourceId, targetId, type, properties = {}, weight = 1.0) {
    const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rel = {
      id,
      source_id: sourceId,
      target_id: targetId,
      type,
      properties,
      weight,
    };
    this._relationships.set(id, rel);
    try {
      this.db
        .prepare(
          "INSERT INTO kg_relationships (id, source_id, target_id, type, properties, weight) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, sourceId, targetId, type, JSON.stringify(properties), weight);
    } catch (error) {
      logger.error(
        "[EnterpriseKG] Relationship persist failed:",
        error.message,
      );
    }
    return rel;
  }

  query(queryDef) {
    let results = [];
    if (queryDef.entityType) {
      const ids = this._entityIndex.get(queryDef.entityType) || new Set();
      results = Array.from(ids)
        .map((id) => this._entities.get(id))
        .filter(Boolean);
    } else if (queryDef.entityId) {
      const entity = this._entities.get(queryDef.entityId);
      if (entity) {
        const rels = Array.from(this._relationships.values()).filter(
          (r) =>
            r.source_id === queryDef.entityId ||
            r.target_id === queryDef.entityId,
        );
        results = [{ entity, relationships: rels }];
      }
    } else if (queryDef.name) {
      const searchName = queryDef.name.toLowerCase();
      results = Array.from(this._entities.values()).filter((e) =>
        e.name.toLowerCase().includes(searchName),
      );
    } else {
      results = Array.from(this._entities.values()).slice(
        0,
        queryDef.limit || 50,
      );
    }
    return results;
  }

  visualize(options = {}) {
    const nodes = Array.from(this._entities.values()).map((e) => ({
      id: e.id,
      label: e.name,
      type: e.type,
    }));
    const edges = Array.from(this._relationships.values()).map((r) => ({
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      weight: r.weight,
    }));
    return {
      nodes: nodes.slice(0, options.maxNodes || 200),
      edges: edges.slice(0, options.maxEdges || 500),
      stats: { totalNodes: nodes.length, totalEdges: edges.length },
    };
  }

  reason(entityId, depth = 2) {
    const visited = new Set();
    const paths = [];
    this._traverse(entityId, depth, [], visited, paths);
    return {
      entityId,
      depth,
      paths: paths.slice(0, 20),
      inferences:
        paths.length > 0
          ? [
              `Entity has ${paths.length} connection paths within depth ${depth}`,
            ]
          : [],
    };
  }

  _traverse(entityId, depth, currentPath, visited, allPaths) {
    if (depth === 0 || visited.has(entityId)) {
      return;
    }
    visited.add(entityId);
    const entity = this._entities.get(entityId);
    if (!entity) {
      return;
    }
    const newPath = [
      ...currentPath,
      { id: entityId, name: entity.name, type: entity.type },
    ];
    const rels = Array.from(this._relationships.values()).filter(
      (r) => r.source_id === entityId,
    );
    if (rels.length === 0) {
      allPaths.push(newPath);
      return;
    }
    for (const rel of rels) {
      this._traverse(
        rel.target_id,
        depth - 1,
        [...newPath, { rel: rel.type }],
        visited,
        allPaths,
      );
    }
  }

  graphRAGSearch(query, options = {}) {
    const searchTerm = query.toLowerCase();
    const matchedEntities = Array.from(this._entities.values()).filter(
      (e) =>
        e.name.toLowerCase().includes(searchTerm) ||
        (e.properties.description || "").toLowerCase().includes(searchTerm),
    );
    const context = [];
    for (const entity of matchedEntities.slice(0, 5)) {
      const rels = Array.from(this._relationships.values()).filter(
        (r) => r.source_id === entity.id || r.target_id === entity.id,
      );
      const neighbors = rels
        .map((r) => {
          const neighborId =
            r.source_id === entity.id ? r.target_id : r.source_id;
          return this._entities.get(neighborId);
        })
        .filter(Boolean);
      context.push({
        entity,
        relationships: rels.length,
        neighbors: neighbors.map((n) => n.name),
      });
    }
    return { query, results: context, totalMatches: matchedEntities.length };
  }

  importData(data) {
    let entitiesAdded = 0,
      relsAdded = 0;
    if (data.entities) {
      for (const e of data.entities) {
        this.addEntity(e.name, e.type, e.properties || {});
        entitiesAdded++;
      }
    }
    if (data.relationships) {
      for (const r of data.relationships) {
        this.addRelationship(r.source, r.target, r.type, r.properties || {});
        relsAdded++;
      }
    }
    return { entitiesAdded, relationshipsAdded: relsAdded };
  }

  exportData() {
    return {
      entities: Array.from(this._entities.values()),
      relationships: Array.from(this._relationships.values()),
      exportedAt: Date.now(),
    };
  }

  getStats() {
    const types = {};
    for (const [type, ids] of this._entityIndex) {
      types[type] = ids.size;
    }
    return {
      entities: this._entities.size,
      relationships: this._relationships.size,
      entityTypes: types,
    };
  }
}

let instance = null;
function getEnterpriseKG() {
  if (!instance) {
    instance = new EnterpriseKG();
  }
  return instance;
}
module.exports = { EnterpriseKG, getEnterpriseKG };
