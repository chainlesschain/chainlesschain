/**
 * Project Style Analyzer — Convention Extraction (v3.1)
 *
 * Analyzes project structure to extract coding conventions:
 * - Naming patterns (files, components, variables)
 * - Architecture patterns (directory structure, module organization)
 * - Testing patterns (framework, location, naming)
 * - Style rules (formatting, linting config)
 * - Integrates CKG for structural analysis
 * - Integrates Instinct for behavioral pattern extraction
 *
 * @module ai-engine/cowork/project-style-analyzer
 */

const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const CONVENTION_CATEGORIES = {
  NAMING: "naming",
  ARCHITECTURE: "architecture",
  TESTING: "testing",
  STYLE: "style",
  IMPORTS: "imports",
  COMPONENTS: "components",
};

const DEFAULT_CONFIG = {
  maxScanDepth: 5,
  maxFilesToScan: 500,
  includePatterns: ["*.js", "*.ts", "*.vue", "*.jsx", "*.tsx"],
  excludePatterns: ["node_modules", "dist", "build", ".git", "coverage"],
  cacheExpireMs: 600000,
  enableCKG: true,
  enableInstinct: true,
};

// ============================================================
// ProjectStyleAnalyzer Class
// ============================================================

class ProjectStyleAnalyzer extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.ckg = null;
    this.instinctManager = null;
    this.config = { ...DEFAULT_CONFIG };
    this.conventionCache = new Map();
    this.stats = {
      totalAnalyses: 0,
      cacheHits: 0,
      averageAnalysisTimeMs: 0,
    };
    this._analysisTimes = [];
  }

  /**
   * Initialize
   * @param {Object} db - Database instance
   * @param {Object} deps
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.ckg = deps.ckg || null;
    this.instinctManager = deps.instinctManager || null;
    logger.info("[ProjectStyleAnalyzer] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Analyze a project directory for conventions
   * @param {string} directory - Project directory path
   * @param {Object} [options]
   * @returns {Object} Extracted conventions
   */
  async analyze(directory, options = {}) {
    if (!this.initialized) {
      throw new Error("ProjectStyleAnalyzer not initialized");
    }

    if (!directory) {
      throw new Error("directory is required");
    }

    // Check cache
    const cached = this._getCachedConventions(directory);
    if (cached && !options.forceRefresh) {
      this.stats.cacheHits++;
      return cached;
    }

    // Collect stream into result
    let finalResult = null;
    for await (const ev of this.analyzeStream(directory, options)) {
      if (ev.type === "end" && ev.result) {
        finalResult = ev.result;
      }
    }

    if (!finalResult) {
      throw new Error("Stream ended without result");
    }
    return finalResult;
  }

  /**
   * Stream variant of analyze — yields StreamRouter-compatible events.
   *
   * Events yielded:
   *   { type: "start", directory, ts }
   *   { type: "message", content, phase }  — per analysis phase (naming, architecture, testing, style)
   *   { type: "error", error }             — on failure
   *   { type: "end", result, ts }
   *
   * @param {string} directory - Project directory path
   * @param {Object} [options]
   * @yields {Object} StreamEvent-compatible events
   */
  async *analyzeStream(directory, options = {}) {
    const startTime = Date.now();
    this.stats.totalAnalyses++;

    yield { type: "start", directory, ts: Date.now() };

    try {
      const conventions = {
        projectPath: directory,
        naming: null,
        architecture: null,
        testing: null,
        style: null,
        imports: null,
        components: null,
        ckgInsights: null,
        instinctPatterns: null,
        confidence: 0,
        analyzedAt: new Date().toISOString(),
      };

      conventions.naming = await this._analyzeNaming(directory);
      yield {
        type: "message",
        content: `Naming: files=${conventions.naming.files}, components=${conventions.naming.components}`,
        phase: "naming",
      };

      conventions.architecture = await this._analyzeArchitecture(directory);
      yield {
        type: "message",
        content: `Architecture: ${conventions.architecture.structure}, state=${conventions.architecture.stateManagement}`,
        phase: "architecture",
      };

      conventions.testing = await this._analyzeTesting(directory);
      yield {
        type: "message",
        content: `Testing: ${conventions.testing.framework}, location=${conventions.testing.location}`,
        phase: "testing",
      };

      conventions.style = await this._analyzeStyle(directory);
      yield {
        type: "message",
        content: `Style: ${conventions.style.formatter}, linter=${conventions.style.linter}`,
        phase: "style",
      };

      conventions.imports = this._analyzeImports(directory);
      conventions.components = this._analyzeComponents(directory);

      // CKG enrichment
      if (this.config.enableCKG && this.ckg?.initialized) {
        conventions.ckgInsights = this._extractCKGInsights();
      }

      // Instinct enrichment
      if (this.config.enableInstinct && this.instinctManager?.initialized) {
        conventions.instinctPatterns = this._extractInstinctPatterns();
      }

      // Compute confidence
      conventions.confidence = this._computeConfidence(conventions);

      // Cache and persist
      this._cacheConventions(directory, conventions);
      this._persistConventions(directory, conventions);

      const elapsed = Date.now() - startTime;
      this._analysisTimes.push(elapsed);
      if (this._analysisTimes.length > 50) {
        this._analysisTimes.shift();
      }
      this.stats.averageAnalysisTimeMs = Math.round(
        this._analysisTimes.reduce((a, b) => a + b, 0) /
          this._analysisTimes.length,
      );

      this.emit("analysis:completed", {
        directory,
        confidence: conventions.confidence,
        elapsed,
      });
      logger.info(
        `[ProjectStyleAnalyzer] Analyzed ${directory} (confidence=${conventions.confidence.toFixed(2)}, ${elapsed}ms)`,
      );

      yield { type: "end", result: conventions, ts: Date.now() };
    } catch (error) {
      logger.error(`[ProjectStyleAnalyzer] Analysis error: ${error.message}`);
      yield { type: "error", error: error.message };
      yield { type: "end", result: null, ts: Date.now() };
      throw error;
    }
  }

  /**
   * Get cached conventions for a directory
   */
  getConventions(projectPath) {
    const cached = this._getCachedConventions(projectPath);
    if (cached) {
      return cached;
    }

    // Try DB
    if (!this.db) {
      return null;
    }
    try {
      const row = this.db
        .prepare(
          "SELECT * FROM nl_program_conventions WHERE project_path = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(projectPath);
      if (!row) {
        return null;
      }
      return {
        projectPath: row.project_path,
        naming: JSON.parse(row.naming_conventions || "{}"),
        architecture: JSON.parse(row.architecture_patterns || "{}"),
        testing: JSON.parse(row.testing_patterns || "{}"),
        style: JSON.parse(row.style_rules || "{}"),
        source: row.source,
        confidence: row.confidence,
        analyzedAt: row.scanned_at,
      };
    } catch {
      return null;
    }
  }

  getStats() {
    return { ...this.stats };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Analysis Methods
  // ============================================================

  async _analyzeNaming(directory) {
    const result = {
      files: "unknown",
      components: "unknown",
      functions: "camelCase",
      variables: "camelCase",
      constants: "UPPER_SNAKE_CASE",
      cssClasses: "unknown",
    };

    try {
      const files = this._scanDirectory(directory, 2);

      // Detect file naming
      const jsFiles = files.filter((f) => /\.(js|ts)$/.test(f));
      const vueFiles = files.filter((f) => /\.vue$/.test(f));

      if (vueFiles.length > 0) {
        const vueNames = vueFiles.map((f) => path.basename(f, ".vue"));
        const pascalCount = vueNames.filter((n) =>
          /^[A-Z][a-z]+([A-Z][a-z]+)*$/.test(n),
        ).length;
        const kebabCount = vueNames.filter((n) =>
          /^[a-z]+(-[a-z]+)*$/.test(n),
        ).length;
        result.components =
          pascalCount >= kebabCount ? "PascalCase" : "kebab-case";
      }

      if (jsFiles.length > 0) {
        const jsNames = jsFiles.map((f) =>
          path.basename(f).replace(/\.(js|ts)$/, ""),
        );
        const camelCount = jsNames.filter((n) =>
          /^[a-z][a-zA-Z]*$/.test(n),
        ).length;
        const kebabCount = jsNames.filter((n) =>
          /^[a-z]+(-[a-z]+)+$/.test(n),
        ).length;
        result.files = camelCount >= kebabCount ? "camelCase" : "kebab-case";
      }
    } catch {
      // Keep defaults
    }

    return result;
  }

  async _analyzeArchitecture(directory) {
    const result = {
      structure: "unknown",
      stateManagement: "unknown",
      uiLibrary: "unknown",
      moduleSystem: "unknown",
      layers: [],
    };

    try {
      // Check for common directory patterns
      const dirs = this._getSubdirectories(directory, 1);
      const dirNames = dirs.map((d) => path.basename(d).toLowerCase());

      if (dirNames.includes("components") && dirNames.includes("pages")) {
        result.structure = "feature-based";
      }
      if (dirNames.includes("stores")) {
        result.stateManagement = "pinia";
      }
      if (dirNames.includes("redux") || dirNames.includes("slices")) {
        result.stateManagement = "redux";
      }

      // Check package.json for libraries
      const pkgPath = path.join(directory, "..", "..", "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (allDeps["ant-design-vue"]) {
            result.uiLibrary = "ant-design-vue";
          } else if (allDeps["element-plus"]) {
            result.uiLibrary = "element-plus";
          } else if (allDeps["@mui/material"]) {
            result.uiLibrary = "material-ui";
          }
          if (allDeps.pinia) {
            result.stateManagement = "pinia";
          }
          if (allDeps.typescript) {
            result.moduleSystem = "typescript";
          } else {
            result.moduleSystem = "javascript";
          }
        } catch {
          /* skip */
        }
      }

      result.layers = dirNames.filter((d) =>
        [
          "components",
          "pages",
          "stores",
          "utils",
          "services",
          "hooks",
          "composables",
        ].includes(d),
      );
    } catch {
      // Keep defaults
    }

    return result;
  }

  async _analyzeTesting(directory) {
    const result = {
      framework: "unknown",
      location: "unknown",
      naming: "unknown",
      coverage: false,
    };

    try {
      // Search for test files
      const files = this._scanDirectory(directory, 3);
      const testFiles = files.filter((f) =>
        /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(f),
      );

      if (testFiles.length > 0) {
        // Determine location pattern
        const hasTestDir = testFiles.some((f) => f.includes("__tests__"));
        const hasColocated = testFiles.some((f) => !f.includes("__tests__"));
        result.location = hasTestDir ? "__tests__/" : "colocated";

        // Determine naming
        const specCount = testFiles.filter((f) => f.includes(".spec.")).length;
        const testCount = testFiles.filter((f) => f.includes(".test.")).length;
        result.naming = specCount >= testCount ? "*.spec.*" : "*.test.*";
      }

      // Check for test framework in package.json
      const pkgPath = path.join(directory, "..", "..", "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const devDeps = pkg.devDependencies || {};
          if (devDeps.vitest) {
            result.framework = "vitest";
          } else if (devDeps.jest) {
            result.framework = "jest";
          } else if (devDeps.mocha) {
            result.framework = "mocha";
          }
          if (devDeps["@vitest/coverage-v8"] || devDeps["jest-coverage"]) {
            result.coverage = true;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      // Keep defaults
    }

    return result;
  }

  async _analyzeStyle(directory) {
    const result = {
      formatter: "unknown",
      linter: "unknown",
      semicolons: true,
      quotes: "double",
      indentation: "spaces",
      indentSize: 2,
    };

    try {
      // Check for config files in project root
      const rootDir = path.resolve(directory, "..", "..");
      const configFiles = fs.existsSync(rootDir) ? fs.readdirSync(rootDir) : [];

      if (
        configFiles.includes(".prettierrc") ||
        configFiles.includes(".prettierrc.js")
      ) {
        result.formatter = "prettier";
      }
      if (
        configFiles.includes(".eslintrc.js") ||
        configFiles.includes("eslint.config.js")
      ) {
        result.linter = "eslint";
      }
      if (configFiles.includes("biome.json")) {
        result.formatter = "biome";
        result.linter = "biome";
      }

      // Quick sample check on actual files
      const files = this._scanDirectory(directory, 1);
      const jsFiles = files.filter((f) => /\.(js|ts)$/.test(f)).slice(0, 5);

      for (const file of jsFiles) {
        try {
          const content = fs.readFileSync(file, "utf-8").slice(0, 2000);
          const singleQuotes = (content.match(/'/g) || []).length;
          const doubleQuotes = (content.match(/"/g) || []).length;
          if (singleQuotes > doubleQuotes * 1.5) {
            result.quotes = "single";
          }

          if (content.includes("\t")) {
            result.indentation = "tabs";
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      // Keep defaults
    }

    return result;
  }

  _analyzeImports(directory) {
    return {
      style: "require",
      grouping: "external-first",
      aliasPrefix: null,
    };
  }

  _analyzeComponents(directory) {
    return {
      compositionApi: true,
      scriptSetup: false,
      styleScoped: true,
    };
  }

  // ============================================================
  // CKG / Instinct Integration
  // ============================================================

  _extractCKGInsights() {
    try {
      if (!this.ckg?.initialized) {
        return null;
      }

      const insights = {
        moduleCount: 0,
        hotspots: [],
        patterns: [],
      };

      if (this.ckg.getStats) {
        const stats = this.ckg.getStats();
        insights.moduleCount = stats.entityCount || 0;
      }
      if (this.ckg.getHotspots) {
        insights.hotspots = this.ckg.getHotspots(5).map((h) => ({
          name: h.name,
          centrality: h.centrality,
        }));
      }

      return insights;
    } catch {
      return null;
    }
  }

  _extractInstinctPatterns() {
    try {
      if (!this.instinctManager?.initialized) {
        return null;
      }

      const relevant = [];
      const categories = ["CODING_PATTERN", "STYLE", "ARCHITECTURE"];

      for (const cat of categories) {
        const instincts = this.instinctManager.getByCategory
          ? this.instinctManager.getByCategory(cat, { limit: 3 })
          : [];
        for (const inst of instincts) {
          if (inst.confidence > 0.4) {
            relevant.push({
              category: cat,
              pattern: inst.pattern,
              confidence: inst.confidence,
            });
          }
        }
      }

      return relevant.length > 0 ? relevant : null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  _scanDirectory(dir, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth || !fs.existsSync(dir)) {
      return [];
    }

    const results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (this.config.excludePatterns.some((p) => entry.name === p)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          results.push(fullPath);
        } else if (entry.isDirectory() && currentDepth < maxDepth - 1) {
          results.push(
            ...this._scanDirectory(fullPath, maxDepth, currentDepth + 1),
          );
        }

        if (results.length >= this.config.maxFilesToScan) {
          break;
        }
      }
    } catch {
      /* ignore */
    }

    return results;
  }

  _getSubdirectories(dir, maxDepth) {
    if (!fs.existsSync(dir)) {
      return [];
    }
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() && !this.config.excludePatterns.includes(e.name),
        )
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  }

  _computeConfidence(conventions) {
    let score = 0;
    let total = 0;

    const check = (val, weight = 1) => {
      total += weight;
      if (val && val !== "unknown") {
        score += weight;
      }
    };

    check(conventions.naming?.files);
    check(conventions.naming?.components);
    check(conventions.architecture?.structure);
    check(conventions.architecture?.stateManagement);
    check(conventions.architecture?.uiLibrary);
    check(conventions.testing?.framework);
    check(conventions.testing?.location);
    check(conventions.style?.formatter);
    check(conventions.style?.linter);
    check(conventions.ckgInsights, 0.5);
    check(conventions.instinctPatterns, 0.5);

    return total > 0 ? Math.round((score / total) * 100) / 100 : 0;
  }

  _getCachedConventions(directory) {
    const entry = this.conventionCache.get(directory);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.timestamp > this.config.cacheExpireMs) {
      this.conventionCache.delete(directory);
      return null;
    }
    return entry.conventions;
  }

  _cacheConventions(directory, conventions) {
    this.conventionCache.set(directory, { conventions, timestamp: Date.now() });
  }

  _persistConventions(directory, conventions) {
    if (!this.db) {
      return;
    }
    try {
      const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.db
        .prepare(
          `INSERT OR REPLACE INTO nl_program_conventions
           (id, project_path, naming_conventions, architecture_patterns, testing_patterns, style_rules, source, confidence, scanned_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, datetime('now'), datetime('now'))`,
        )
        .run(
          id,
          directory,
          JSON.stringify(conventions.naming || {}),
          JSON.stringify(conventions.architecture || {}),
          JSON.stringify(conventions.testing || {}),
          JSON.stringify(conventions.style || {}),
          conventions.confidence,
        );
    } catch (error) {
      logger.warn(`[ProjectStyleAnalyzer] Persist error: ${error.message}`);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getProjectStyleAnalyzer() {
  if (!instance) {
    instance = new ProjectStyleAnalyzer();
  }
  return instance;
}

module.exports = {
  ProjectStyleAnalyzer,
  getProjectStyleAnalyzer,
  CONVENTION_CATEGORIES,
  ANALYZE_STREAM_EVENTS: Object.freeze(["start", "message", "error", "end"]),
};
