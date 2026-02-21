/**
 * Code Knowledge Graph — v2.1.0
 *
 * Builds a code-centric knowledge graph by scanning workspace files for
 * entities (modules, classes, functions, components) and relationships
 * (imports, exports, extends, implements, calls, contains, depends_on).
 *
 * Reuses import/export regex patterns from impact-analyzer; adds entity
 * detection, centrality analysis, hotspot detection, and circular
 * dependency detection.
 *
 * @module ai-engine/cowork/code-knowledge-graph
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");

// ============================================================
// Constants
// ============================================================

const ENTITY_TYPES = {
  MODULE: "module",
  CLASS: "class",
  FUNCTION: "function",
  VARIABLE: "variable",
  INTERFACE: "interface",
  TYPE: "type",
  ENUM: "enum",
  COMPONENT: "component",
};

const RELATIONSHIP_TYPES = {
  IMPORTS: "imports",
  EXPORTS: "exports",
  EXTENDS: "extends",
  IMPLEMENTS: "implements",
  CALLS: "calls",
  CONTAINS: "contains",
  DEPENDS_ON: "depends_on",
};

const SCAN_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".mjs",
  ".cjs",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".cache",
  "coverage",
  ".next",
  ".nuxt",
]);

// ============================================================
// Regex patterns for entity and relationship detection
// ============================================================

const PATTERNS = {
  // Imports
  esImport:
    /import\s+(?:(?:\{([^}]*)\})|(?:(\w+)(?:\s*,\s*\{([^}]*)\})?)|(?:\*\s+as\s+(\w+)))\s+from\s+['"]([^'"]+)['"]/g,
  requireImport:
    /(?:const|let|var)\s+(?:(\{[^}]*\})|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,

  // Exports
  namedExport:
    /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g,
  defaultExport: /export\s+default\s+(?:class|function)?\s*(\w+)?/g,
  moduleExports: /module\.exports\s*=\s*(?:\{([^}]*)\}|(\w+))/g,

  // Classes & interfaces
  classDecl:
    /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+(\w+(?:\s*,\s*\w+)*))?/g,
  interfaceDecl:
    /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+(\w+(?:\s*,\s*\w+)*))?/g,
  typeDecl: /(?:export\s+)?type\s+(\w+)\s*=/g,
  enumDecl: /(?:export\s+)?enum\s+(\w+)/g,

  // Functions
  functionDecl: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
  arrowFunction:
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,

  // Vue components
  vueComponent:
    /(?:name:\s*['"](\w+)['"]|defineComponent\s*\(\s*\{[^}]*name:\s*['"](\w+)['"])/g,
  vueDefineOptions: /defineOptions\s*\(\s*\{[^}]*name:\s*['"](\w+)['"]/g,

  // Function calls (simplified — captures top-level calls)
  functionCall: /(?<!\w)(\w+)\s*\(/g,
};

// ============================================================
// CodeKnowledgeGraph class
// ============================================================

class CodeKnowledgeGraph {
  constructor() {
    this.db = null;
    this.initialized = false;

    // In-memory caches
    this._entities = new Map(); // id → entity
    this._relationships = new Map(); // id → relationship
    this._entityByPath = new Map(); // filePath → [entityIds]
    this._entityByName = new Map(); // name → [entityIds]
  }

  /**
   * Initialize with database
   * @param {Object} db - Database manager
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadFromDB();
    this.initialized = true;
    logger.info(
      `[CodeKG] Initialized: ${this._entities.size} entities, ${this._relationships.size} relationships`,
    );
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS code_kg_entities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          file_path TEXT,
          line_start INTEGER,
          line_end INTEGER,
          language TEXT,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON code_kg_entities(type);
        CREATE INDEX IF NOT EXISTS idx_kg_entities_file ON code_kg_entities(file_path);
        CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON code_kg_entities(name);

        CREATE TABLE IF NOT EXISTS code_kg_relationships (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          type TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (source_id) REFERENCES code_kg_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES code_kg_entities(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_kg_rels_source ON code_kg_relationships(source_id);
        CREATE INDEX IF NOT EXISTS idx_kg_rels_target ON code_kg_relationships(target_id);
        CREATE INDEX IF NOT EXISTS idx_kg_rels_type ON code_kg_relationships(type);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[CodeKG] Table creation error:", e.message);
    }
  }

  async _loadFromDB() {
    try {
      const entities = this.db.prepare("SELECT * FROM code_kg_entities").all();
      for (const row of entities) {
        const entity = this._rowToEntity(row);
        this._entities.set(entity.id, entity);
        this._indexEntity(entity);
      }

      const rels = this.db.prepare("SELECT * FROM code_kg_relationships").all();
      for (const row of rels) {
        const rel = this._rowToRelationship(row);
        this._relationships.set(rel.id, rel);
      }
    } catch (e) {
      logger.error("[CodeKG] Load from DB error:", e.message);
    }
  }

  // ============================================================
  // Scanning
  // ============================================================

  /**
   * Scan an entire workspace directory
   * @param {string} rootDir - Workspace root
   * @param {Object} options - { extensions, ignoreDirs }
   * @returns {Object} Scan results
   */
  async scanWorkspace(rootDir, options = {}) {
    const extensions = options.extensions
      ? new Set(options.extensions)
      : SCAN_EXTENSIONS;
    const ignoreDirs = options.ignoreDirs
      ? new Set(options.ignoreDirs)
      : IGNORE_DIRS;

    logger.info(`[CodeKG] Scanning workspace: ${rootDir}`);
    const startTime = Date.now();

    // Clear existing data for this workspace
    this._clearAll();

    const files = this._collectFiles(rootDir, extensions, ignoreDirs);
    let entityCount = 0;
    let relCount = 0;

    for (const filePath of files) {
      try {
        const result = await this.scanFile(filePath, rootDir);
        entityCount += result.entities;
        relCount += result.relationships;
      } catch (e) {
        logger.warn(`[CodeKG] Scan error for ${filePath}: ${e.message}`);
      }
    }

    // Second pass: resolve cross-file relationships
    const crossRels = this._resolveCrossFileRelationships();
    relCount += crossRels;

    const duration = Date.now() - startTime;
    logger.info(
      `[CodeKG] Workspace scan complete: ${files.length} files, ${entityCount} entities, ${relCount} relationships (${duration}ms)`,
    );

    return {
      files: files.length,
      entities: entityCount,
      relationships: relCount,
      duration,
    };
  }

  /**
   * Scan a single file for entities and relationships
   * @param {string} filePath - Absolute file path
   * @param {string} rootDir - Workspace root (for relative paths)
   * @returns {Object} { entities, relationships }
   */
  async scanFile(filePath, rootDir = "") {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      return { entities: 0, relationships: 0 };
    }

    const ext = path.extname(filePath);
    const language = this._extToLanguage(ext);
    const relativePath = rootDir
      ? path.relative(rootDir, filePath).replace(/\\/g, "/")
      : filePath;
    const lines = content.split("\n");

    let entityCount = 0;
    let relCount = 0;

    // Create module entity for the file itself
    const moduleEntity = this._addEntity({
      name: path.basename(filePath, ext),
      type: ENTITY_TYPES.MODULE,
      filePath: relativePath,
      lineStart: 1,
      lineEnd: lines.length,
      language,
    });
    entityCount++;

    // Extract entities
    const extracted = this._extractEntities(content, relativePath, language);
    for (const ent of extracted) {
      const entity = this._addEntity(ent);
      entityCount++;

      // contains relationship
      const rel = this._addRelationship({
        sourceId: moduleEntity.id,
        targetId: entity.id,
        type: RELATIONSHIP_TYPES.CONTAINS,
      });
      if (rel) {
        relCount++;
      }
    }

    // Extract import relationships
    const imports = this._extractImports(content, relativePath);
    for (const imp of imports) {
      const rel = this._addRelationship({
        sourceId: moduleEntity.id,
        targetId: null, // resolved in cross-file pass
        type: RELATIONSHIP_TYPES.IMPORTS,
        metadata: { importPath: imp.path, names: imp.names },
      });
      if (rel) {
        relCount++;
      }
    }

    // Extract extends/implements
    const inheritances = this._extractInheritance(content);
    for (const inh of inheritances) {
      relCount += this._linkInheritance(moduleEntity.id, inh);
    }

    return { entities: entityCount, relationships: relCount };
  }

  /**
   * Incremental update — rescan a single file and update the graph
   * @param {string} filePath - File that changed
   * @param {string} rootDir - Workspace root
   */
  async incrementalUpdate(filePath, rootDir = "") {
    const relativePath = rootDir
      ? path.relative(rootDir, filePath).replace(/\\/g, "/")
      : filePath;

    // Remove old entities for this file
    const oldIds = this._entityByPath.get(relativePath) || [];
    for (const id of oldIds) {
      this._removeEntity(id);
    }

    // Re-scan
    const result = await this.scanFile(filePath, rootDir);
    logger.info(
      `[CodeKG] Incremental update: ${relativePath} → ${result.entities} entities`,
    );
    return result;
  }

  // ============================================================
  // Entity extraction
  // ============================================================

  _extractEntities(content, filePath, language) {
    const entities = [];
    const lines = content.split("\n");

    // Classes
    let match;
    const classRe = new RegExp(PATTERNS.classDecl.source, "g");
    while ((match = classRe.exec(content)) !== null) {
      const line = this._offsetToLine(content, match.index);
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.CLASS,
        filePath,
        lineStart: line,
        lineEnd: this._findBlockEnd(lines, line),
        language,
      });
    }

    // Interfaces
    const ifaceRe = new RegExp(PATTERNS.interfaceDecl.source, "g");
    while ((match = ifaceRe.exec(content)) !== null) {
      const line = this._offsetToLine(content, match.index);
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.INTERFACE,
        filePath,
        lineStart: line,
        lineEnd: this._findBlockEnd(lines, line),
        language,
      });
    }

    // Types
    const typeRe = new RegExp(PATTERNS.typeDecl.source, "g");
    while ((match = typeRe.exec(content)) !== null) {
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.TYPE,
        filePath,
        lineStart: this._offsetToLine(content, match.index),
        lineEnd: this._offsetToLine(content, match.index),
        language,
      });
    }

    // Enums
    const enumRe = new RegExp(PATTERNS.enumDecl.source, "g");
    while ((match = enumRe.exec(content)) !== null) {
      const line = this._offsetToLine(content, match.index);
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.ENUM,
        filePath,
        lineStart: line,
        lineEnd: this._findBlockEnd(lines, line),
        language,
      });
    }

    // Functions
    const funcRe = new RegExp(PATTERNS.functionDecl.source, "g");
    while ((match = funcRe.exec(content)) !== null) {
      const line = this._offsetToLine(content, match.index);
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.FUNCTION,
        filePath,
        lineStart: line,
        lineEnd: this._findBlockEnd(lines, line),
        language,
      });
    }

    // Arrow functions (top-level only)
    const arrowRe = new RegExp(PATTERNS.arrowFunction.source, "g");
    while ((match = arrowRe.exec(content)) !== null) {
      entities.push({
        name: match[1],
        type: ENTITY_TYPES.FUNCTION,
        filePath,
        lineStart: this._offsetToLine(content, match.index),
        lineEnd: this._offsetToLine(content, match.index),
        language,
      });
    }

    // Vue components
    if (filePath.endsWith(".vue")) {
      const compRe = new RegExp(PATTERNS.vueComponent.source, "g");
      while ((match = compRe.exec(content)) !== null) {
        entities.push({
          name: match[1] || match[2],
          type: ENTITY_TYPES.COMPONENT,
          filePath,
          lineStart: 1,
          lineEnd: content.split("\n").length,
          language: "vue",
        });
      }
    }

    return entities;
  }

  _extractImports(content, _filePath) {
    const imports = [];
    let match;

    // ES imports
    const esRe = new RegExp(PATTERNS.esImport.source, "g");
    while ((match = esRe.exec(content)) !== null) {
      const names = [];
      if (match[1]) {
        names.push(
          ...match[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      if (match[2]) {
        names.push(match[2]);
      }
      if (match[3]) {
        names.push(
          ...match[3]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      if (match[4]) {
        names.push(match[4]);
      }
      imports.push({ path: match[5], names });
    }

    // Require imports
    const reqRe = new RegExp(PATTERNS.requireImport.source, "g");
    while ((match = reqRe.exec(content)) !== null) {
      const names = [];
      if (match[1]) {
        names.push(
          ...match[1]
            .replace(/[{}]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      if (match[2]) {
        names.push(match[2]);
      }
      imports.push({ path: match[3], names });
    }

    return imports;
  }

  _extractInheritance(content) {
    const results = [];
    let match;

    const classRe = new RegExp(PATTERNS.classDecl.source, "g");
    while ((match = classRe.exec(content)) !== null) {
      if (match[2]) {
        results.push({
          child: match[1],
          parent: match[2],
          type: RELATIONSHIP_TYPES.EXTENDS,
        });
      }
      if (match[3]) {
        const ifaces = match[3].split(",").map((s) => s.trim());
        for (const iface of ifaces) {
          results.push({
            child: match[1],
            parent: iface,
            type: RELATIONSHIP_TYPES.IMPLEMENTS,
          });
        }
      }
    }

    return results;
  }

  _linkInheritance(moduleId, inheritance) {
    let count = 0;
    const childEntities = this._entityByName.get(inheritance.child) || [];
    const parentEntities = this._entityByName.get(inheritance.parent) || [];

    if (childEntities.length > 0 && parentEntities.length > 0) {
      const rel = this._addRelationship({
        sourceId: childEntities[0],
        targetId: parentEntities[0],
        type: inheritance.type,
      });
      if (rel) {
        count++;
      }
    }
    return count;
  }

  _resolveCrossFileRelationships() {
    let count = 0;
    for (const rel of this._relationships.values()) {
      if (
        rel.type === RELATIONSHIP_TYPES.IMPORTS &&
        !rel.targetId &&
        rel.metadata?.importPath
      ) {
        // Try to find the target module by import path
        const importName = path.basename(
          rel.metadata.importPath,
          path.extname(rel.metadata.importPath),
        );
        const targets = this._entityByName.get(importName) || [];
        const moduleTarget = targets.find(
          (id) => this._entities.get(id)?.type === ENTITY_TYPES.MODULE,
        );
        if (moduleTarget) {
          rel.targetId = moduleTarget;
          count++;
        }
      }
    }
    return count;
  }

  // ============================================================
  // Query
  // ============================================================

  /**
   * Query entities by name, type, or file path
   * @param {Object} query - { name, type, filePath, limit }
   * @returns {Array} Matching entities
   */
  queryEntity(query = {}) {
    let results = Array.from(this._entities.values());

    if (query.name) {
      const nameLower = query.name.toLowerCase();
      results = results.filter((e) => e.name.toLowerCase().includes(nameLower));
    }
    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query.filePath) {
      results = results.filter(
        (e) => e.filePath && e.filePath.includes(query.filePath),
      );
    }

    const limit = query.limit || 50;
    return results.slice(0, limit);
  }

  /**
   * Get the dependency tree for a module
   * @param {string} entityId - Entity ID
   * @param {number} depth - Max traversal depth
   * @returns {Object} Tree structure
   */
  getModuleDependencyTree(entityId, depth = 3) {
    const visited = new Set();
    return this._buildDepTree(entityId, depth, visited);
  }

  _buildDepTree(entityId, depth, visited) {
    if (depth <= 0 || visited.has(entityId)) {
      return null;
    }
    visited.add(entityId);

    const entity = this._entities.get(entityId);
    if (!entity) {
      return null;
    }

    const deps = [];
    for (const rel of this._relationships.values()) {
      if (
        rel.sourceId === entityId &&
        (rel.type === RELATIONSHIP_TYPES.IMPORTS ||
          rel.type === RELATIONSHIP_TYPES.DEPENDS_ON)
      ) {
        if (rel.targetId) {
          const child = this._buildDepTree(rel.targetId, depth - 1, visited);
          if (child) {
            deps.push(child);
          }
        }
      }
    }

    return { entity, dependencies: deps };
  }

  // ============================================================
  // Analysis
  // ============================================================

  /**
   * Compute degree centrality for all entities
   * @returns {Array} Sorted by centrality descending
   */
  computeCentrality() {
    const inDegree = new Map();
    const outDegree = new Map();

    for (const rel of this._relationships.values()) {
      if (rel.sourceId) {
        outDegree.set(rel.sourceId, (outDegree.get(rel.sourceId) || 0) + 1);
      }
      if (rel.targetId) {
        inDegree.set(rel.targetId, (inDegree.get(rel.targetId) || 0) + 1);
      }
    }

    const results = [];
    for (const entity of this._entities.values()) {
      const inD = inDegree.get(entity.id) || 0;
      const outD = outDegree.get(entity.id) || 0;
      results.push({
        entity,
        inDegree: inD,
        outDegree: outD,
        totalDegree: inD + outD,
      });
    }

    results.sort((a, b) => b.totalDegree - a.totalDegree);
    return results;
  }

  /**
   * Find hotspot modules (high fan-in + high fan-out)
   * @param {number} threshold - Minimum total degree
   * @returns {Array} Hotspot entities
   */
  findHotspots(threshold = 5) {
    return this.computeCentrality().filter((c) => c.totalDegree >= threshold);
  }

  /**
   * Detect circular dependencies using DFS
   * @returns {Array} List of cycles (each cycle is an array of entity IDs)
   */
  findCircularDependencies() {
    const adjacency = new Map();
    for (const rel of this._relationships.values()) {
      if (
        rel.sourceId &&
        rel.targetId &&
        (rel.type === RELATIONSHIP_TYPES.IMPORTS ||
          rel.type === RELATIONSHIP_TYPES.DEPENDS_ON)
      ) {
        if (!adjacency.has(rel.sourceId)) {
          adjacency.set(rel.sourceId, []);
        }
        adjacency.get(rel.sourceId).push(rel.targetId);
      }
    }

    const visited = new Set();
    const recStack = new Set();
    const cycles = [];

    const dfs = (nodeId, pathStack) => {
      visited.add(nodeId);
      recStack.add(nodeId);
      pathStack.push(nodeId);

      const neighbors = adjacency.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, pathStack);
        } else if (recStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = pathStack.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push(pathStack.slice(cycleStart));
          }
        }
      }

      pathStack.pop();
      recStack.delete(nodeId);
    };

    for (const entityId of this._entities.keys()) {
      if (!visited.has(entityId)) {
        dfs(entityId, []);
      }
    }

    return cycles;
  }

  /**
   * Recommend architectural patterns based on graph analysis
   * @returns {Array} List of recommendations
   */
  recommendPatterns() {
    const recommendations = [];
    const centrality = this.computeCentrality();
    const cycles = this.findCircularDependencies();

    // High fan-out modules (God modules)
    const highFanOut = centrality.filter(
      (c) => c.outDegree > 10 && c.entity.type === ENTITY_TYPES.MODULE,
    );
    if (highFanOut.length > 0) {
      recommendations.push({
        type: "high-fan-out",
        severity: "warning",
        message: `${highFanOut.length} module(s) have high fan-out (>10 dependencies). Consider splitting.`,
        entities: highFanOut.slice(0, 5).map((c) => ({
          name: c.entity.name,
          filePath: c.entity.filePath,
          outDegree: c.outDegree,
        })),
      });
    }

    // High fan-in modules (bottlenecks)
    const highFanIn = centrality.filter(
      (c) => c.inDegree > 10 && c.entity.type === ENTITY_TYPES.MODULE,
    );
    if (highFanIn.length > 0) {
      recommendations.push({
        type: "high-fan-in",
        severity: "info",
        message: `${highFanIn.length} module(s) are heavily depended upon. Consider interface extraction.`,
        entities: highFanIn.slice(0, 5).map((c) => ({
          name: c.entity.name,
          filePath: c.entity.filePath,
          inDegree: c.inDegree,
        })),
      });
    }

    // Circular dependencies
    if (cycles.length > 0) {
      recommendations.push({
        type: "circular-dependency",
        severity: "error",
        message: `${cycles.length} circular dependency chain(s) detected. Refactor to break cycles.`,
        cycles: cycles.slice(0, 5).map((cycle) =>
          cycle.map((id) => {
            const e = this._entities.get(id);
            return e ? e.name : id;
          }),
        ),
      });
    }

    // Isolated modules (no relationships)
    const isolated = centrality.filter(
      (c) => c.totalDegree === 0 && c.entity.type === ENTITY_TYPES.MODULE,
    );
    if (isolated.length > 3) {
      recommendations.push({
        type: "isolated-modules",
        severity: "info",
        message: `${isolated.length} module(s) have no detected relationships. May be dead code or need integration.`,
        entities: isolated.slice(0, 5).map((c) => ({
          name: c.entity.name,
          filePath: c.entity.filePath,
        })),
      });
    }

    return recommendations;
  }

  /**
   * Build a recommendation context string for LLM injection
   * @returns {string} Formatted recommendations
   */
  buildKGContext() {
    const recommendations = this.recommendPatterns();
    if (recommendations.length === 0) {
      return "";
    }

    const lines = [
      "## Code Knowledge Graph Insights",
      `Graph contains ${this._entities.size} entities and ${this._relationships.size} relationships.`,
      "",
    ];

    for (const rec of recommendations.slice(0, 3)) {
      lines.push(`- [${rec.severity.toUpperCase()}] ${rec.message}`);
    }

    return lines.join("\n");
  }

  // ============================================================
  // Export
  // ============================================================

  /**
   * Export the graph as JSON
   * @returns {Object} Graph data
   */
  exportGraph() {
    return {
      version: "2.1.0",
      exportedAt: new Date().toISOString(),
      entities: Array.from(this._entities.values()),
      relationships: Array.from(this._relationships.values()),
      stats: this.getStats(),
    };
  }

  /**
   * Get graph statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const byType = {};
    for (const entity of this._entities.values()) {
      byType[entity.type] = (byType[entity.type] || 0) + 1;
    }

    const relByType = {};
    for (const rel of this._relationships.values()) {
      relByType[rel.type] = (relByType[rel.type] || 0) + 1;
    }

    return {
      totalEntities: this._entities.size,
      totalRelationships: this._relationships.size,
      entitiesByType: byType,
      relationshipsByType: relByType,
      filesIndexed: this._entityByPath.size,
    };
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  _addEntity(data) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const entity = {
      id,
      name: data.name,
      type: data.type,
      filePath: data.filePath || null,
      lineStart: data.lineStart || null,
      lineEnd: data.lineEnd || null,
      language: data.language || null,
      metadata: data.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    this._entities.set(id, entity);
    this._indexEntity(entity);

    // Persist
    try {
      this.db.run(
        `INSERT OR REPLACE INTO code_kg_entities (id, name, type, file_path, line_start, line_end, language, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          entity.name,
          entity.type,
          entity.filePath,
          entity.lineStart,
          entity.lineEnd,
          entity.language,
          JSON.stringify(entity.metadata),
          now,
          now,
        ],
      );
    } catch (e) {
      logger.warn("[CodeKG] Entity persist error:", e.message);
    }

    return entity;
  }

  _addRelationship(data) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const rel = {
      id,
      sourceId: data.sourceId,
      targetId: data.targetId,
      type: data.type,
      weight: data.weight || 1.0,
      metadata: data.metadata || {},
      createdAt: now,
    };

    this._relationships.set(id, rel);

    // Persist (only if both endpoints exist)
    if (rel.sourceId && rel.targetId) {
      try {
        this.db.run(
          `INSERT OR REPLACE INTO code_kg_relationships (id, source_id, target_id, type, weight, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            rel.sourceId,
            rel.targetId,
            rel.type,
            rel.weight,
            JSON.stringify(rel.metadata),
            now,
          ],
        );
      } catch (e) {
        logger.warn("[CodeKG] Relationship persist error:", e.message);
      }
    }

    return rel;
  }

  _removeEntity(entityId) {
    const entity = this._entities.get(entityId);
    if (!entity) {
      return;
    }

    // Remove relationships
    for (const [relId, rel] of this._relationships.entries()) {
      if (rel.sourceId === entityId || rel.targetId === entityId) {
        this._relationships.delete(relId);
      }
    }

    // Remove from indexes
    if (entity.filePath) {
      const pathIds = this._entityByPath.get(entity.filePath) || [];
      this._entityByPath.set(
        entity.filePath,
        pathIds.filter((id) => id !== entityId),
      );
    }
    const nameIds = this._entityByName.get(entity.name) || [];
    this._entityByName.set(
      entity.name,
      nameIds.filter((id) => id !== entityId),
    );

    this._entities.delete(entityId);

    // Persist
    try {
      this.db.run("DELETE FROM code_kg_entities WHERE id = ?", [entityId]);
      this.db.run(
        "DELETE FROM code_kg_relationships WHERE source_id = ? OR target_id = ?",
        [entityId, entityId],
      );
    } catch (e) {
      logger.warn("[CodeKG] Remove entity error:", e.message);
    }
  }

  _indexEntity(entity) {
    if (entity.filePath) {
      if (!this._entityByPath.has(entity.filePath)) {
        this._entityByPath.set(entity.filePath, []);
      }
      this._entityByPath.get(entity.filePath).push(entity.id);
    }
    if (!this._entityByName.has(entity.name)) {
      this._entityByName.set(entity.name, []);
    }
    this._entityByName.get(entity.name).push(entity.id);
  }

  _clearAll() {
    this._entities.clear();
    this._relationships.clear();
    this._entityByPath.clear();
    this._entityByName.clear();

    try {
      this.db.run("DELETE FROM code_kg_relationships");
      this.db.run("DELETE FROM code_kg_entities");
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.warn("[CodeKG] Clear all error:", e.message);
    }
  }

  _collectFiles(dir, extensions, ignoreDirs) {
    const files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") && ignoreDirs.has(entry.name)) {
          continue;
        }
        if (ignoreDirs.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this._collectFiles(fullPath, extensions, ignoreDirs));
        } else if (extensions.has(path.extname(entry.name))) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // Permission errors, etc.
    }
    return files;
  }

  _offsetToLine(content, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") {
        line++;
      }
    }
    return line;
  }

  _findBlockEnd(lines, startLine) {
    let braceCount = 0;
    let found = false;
    for (let i = startLine - 1; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") {
          braceCount++;
          found = true;
        }
        if (ch === "}") {
          braceCount--;
        }
        if (found && braceCount === 0) {
          return i + 1;
        }
      }
    }
    return startLine;
  }

  _extToLanguage(ext) {
    const map = {
      ".js": "javascript",
      ".ts": "typescript",
      ".jsx": "javascript",
      ".tsx": "typescript",
      ".vue": "vue",
      ".mjs": "javascript",
      ".cjs": "javascript",
    };
    return map[ext] || "unknown";
  }

  _rowToEntity(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      filePath: row.file_path,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      language: row.language,
      metadata: safeParseJSON(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _rowToRelationship(row) {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      weight: row.weight,
      metadata: safeParseJSON(row.metadata),
      createdAt: row.created_at,
    };
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return {};
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// Singleton
let instance = null;

function getCodeKnowledgeGraph() {
  if (!instance) {
    instance = new CodeKnowledgeGraph();
  }
  return instance;
}

module.exports = {
  CodeKnowledgeGraph,
  getCodeKnowledgeGraph,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
};
