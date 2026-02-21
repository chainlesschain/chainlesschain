/**
 * CICDOptimizer - CI/CD Deep Optimization
 *
 * Intelligent test selection with caching and dependency analysis,
 * plus incremental build orchestration for the Cowork system.
 *
 * Core capabilities:
 * 1. Test Cache Layer (SHA256 hash → cached test selection)
 * 2. Dependency Graph (require/import transitive analysis)
 * 3. Flakiness Scoring (pass/fail history tracking)
 * 4. Coverage Mapping (source→test bidirectional)
 * 5. Incremental Build (file hash tracking, DAG execution)
 *
 * @module ai-engine/cowork/cicd-optimizer
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");

/**
 * Default CI/CD optimizer configuration
 */
const DEFAULT_CONFIG = {
  testFilePatterns: [
    "**/*.test.js",
    "**/*.spec.js",
    "**/*.test.ts",
    "**/*.spec.ts",
  ],
  sourceFilePatterns: ["**/*.js", "**/*.ts", "**/*.vue"],
  excludePatterns: ["node_modules/**", "dist/**", ".git/**", "coverage/**"],
  cacheMaxAge: 7 * 24 * 3600 * 1000, // 7 days
  flakynessWindow: 20, // Last N runs for flakiness
  maxCacheEntries: 500,
  buildStepTimeout: 300000, // 5 min per build step
};

class CICDOptimizer extends EventEmitter {
  /**
   * @param {Object} [db] - Database instance
   * @param {string} [workspacePath] - Workspace root path
   * @param {Object} [config] - Configuration overrides
   */
  constructor(db = null, workspacePath = process.cwd(), config = {}) {
    super();

    this.db = db;
    this.workspacePath = workspacePath;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // In-memory dependency graph: file -> Set<dependencies>
    this._depGraph = new Map();

    // Reverse dependency graph: file -> Set<dependents>
    this._reverseDeps = new Map();

    // Source-to-test mapping cache
    this._sourceToTests = new Map();

    // Cache stats
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._totalSelections = 0;

    this.initialized = false;

    logger.info("[CICDOptimizer] Created", { workspacePath });
  }

  /**
   * Initialize: create tables and build initial dependency graph
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    this._ensureTables();
    await this._buildDependencyGraph();
    this.initialized = true;

    logger.info("[CICDOptimizer] Initialized", {
      depGraphSize: this._depGraph.size,
      sourceToTestMappings: this._sourceToTests.size,
    });
    this.emit("initialized");
  }

  /**
   * Ensure CI/CD tables exist
   */
  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS cicd_test_cache (
          id TEXT PRIMARY KEY,
          file_hash TEXT NOT NULL,
          selected_tests TEXT,
          execution_time_ms INTEGER,
          pass_count INTEGER,
          fail_count INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          last_hit_at TEXT
        )
      `);
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_cicd_cache_hash ON cicd_test_cache(file_hash)",
      );

      this.db.run(`
        CREATE TABLE IF NOT EXISTS cicd_test_history (
          id TEXT PRIMARY KEY,
          test_path TEXT NOT NULL,
          passed INTEGER DEFAULT 1,
          duration_ms INTEGER,
          flakiness_score REAL DEFAULT 0,
          run_count INTEGER DEFAULT 0,
          fail_count INTEGER DEFAULT 0,
          last_run_at TEXT DEFAULT (datetime('now'))
        )
      `);
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_cicd_history_path ON cicd_test_history(test_path)",
      );

      this.db.run(`
        CREATE TABLE IF NOT EXISTS cicd_build_cache (
          id TEXT PRIMARY KEY,
          step_name TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          output_path TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_cicd_build_hash ON cicd_build_cache(input_hash)",
      );
    } catch (error) {
      logger.warn("[CICDOptimizer] Table creation warning:", error.message);
    }
  }

  /**
   * Build dependency graph by scanning test files for imports/requires
   */
  async _buildDependencyGraph() {
    try {
      const testFiles = this._findFiles(this.config.testFilePatterns);

      for (const testFile of testFiles) {
        const deps = this._extractDependencies(testFile);
        this._depGraph.set(testFile, deps);

        // Build reverse mapping
        for (const dep of deps) {
          if (!this._reverseDeps.has(dep)) {
            this._reverseDeps.set(dep, new Set());
          }
          this._reverseDeps.get(dep).add(testFile);

          // Source-to-test mapping
          if (!this._sourceToTests.has(dep)) {
            this._sourceToTests.set(dep, new Set());
          }
          this._sourceToTests.get(dep).add(testFile);
        }
      }

      logger.info("[CICDOptimizer] Dependency graph built", {
        testFiles: testFiles.length,
        dependencies: this._depGraph.size,
      });
    } catch (error) {
      logger.warn(
        "[CICDOptimizer] Dependency graph build failed:",
        error.message,
      );
    }
  }

  /**
   * Find files matching patterns relative to workspace
   * @param {string[]} patterns - Glob patterns
   * @returns {string[]} Relative file paths
   */
  _findFiles(patterns) {
    const results = [];
    try {
      // Simple recursive file discovery (no glob dependency)
      this._walkDir(this.workspacePath, (filePath) => {
        const relative = path.relative(this.workspacePath, filePath);
        const normalized = relative.replace(/\\/g, "/");

        // Check exclude patterns
        for (const exclude of this.config.excludePatterns) {
          const excludeBase = exclude.replace(/\*\*/g, "").replace(/\*/g, "");
          if (normalized.startsWith(excludeBase.replace(/\//g, ""))) {
            return;
          }
        }

        // Check include patterns
        for (const pattern of patterns) {
          const ext = pattern.split(".").pop();
          if (normalized.endsWith(`.${ext}`)) {
            // For test patterns, also check for .test. or .spec.
            if (pattern.includes(".test.") || pattern.includes(".spec.")) {
              if (
                normalized.includes(".test.") ||
                normalized.includes(".spec.")
              ) {
                results.push(normalized);
              }
            } else {
              results.push(normalized);
            }
            break;
          }
        }
      });
    } catch (error) {
      logger.warn("[CICDOptimizer] File discovery error:", error.message);
    }
    return results;
  }

  /**
   * Walk directory recursively
   * @param {string} dir - Directory to walk
   * @param {Function} callback - Called with each file path
   * @param {number} [depth=0] - Current depth
   */
  _walkDir(dir, callback, depth = 0) {
    if (depth > 10) {
      return;
    } // Prevent infinite recursion
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip excluded directories
          if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "dist" ||
            entry.name === "coverage"
          ) {
            continue;
          }
          this._walkDir(fullPath, callback, depth + 1);
        } else if (entry.isFile()) {
          callback(fullPath);
        }
      }
    } catch (_error) {
      // Skip unreadable directories
    }
  }

  /**
   * Extract require/import dependencies from a file
   * @param {string} relativePath - Relative file path
   * @returns {Set<string>} Set of dependency paths
   */
  _extractDependencies(relativePath) {
    const deps = new Set();
    const fullPath = path.join(this.workspacePath, relativePath);

    try {
      const content = fs.readFileSync(fullPath, "utf-8");

      // Match require() calls
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = requireRegex.exec(content)) !== null) {
        const resolved = this._resolveDep(relativePath, match[1]);
        if (resolved) {
          deps.add(resolved);
        }
      }

      // Match import statements
      const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
      while ((match = importRegex.exec(content)) !== null) {
        const resolved = this._resolveDep(relativePath, match[1]);
        if (resolved) {
          deps.add(resolved);
        }
      }

      // Match dynamic import()
      const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        const resolved = this._resolveDep(relativePath, match[1]);
        if (resolved) {
          deps.add(resolved);
        }
      }
    } catch (_error) {
      // Skip unreadable files
    }

    return deps;
  }

  /**
   * Resolve a dependency path relative to the importing file
   * @param {string} fromFile - Importing file path
   * @param {string} depPath - Dependency specifier
   * @returns {string|null} Resolved relative path
   */
  _resolveDep(fromFile, depPath) {
    // Skip node_modules and built-in modules
    if (!depPath.startsWith(".") && !depPath.startsWith("/")) {
      return null;
    }

    const dir = path.dirname(fromFile);
    const resolved = path.posix.join(dir, depPath).replace(/\\/g, "/");

    // Try with common extensions
    const extensions = [".js", ".ts", ".vue", "/index.js", "/index.ts"];

    // Check if it already has an extension
    if (path.extname(resolved)) {
      return resolved;
    }

    for (const ext of extensions) {
      const candidate = resolved + ext;
      const fullPath = path.join(this.workspacePath, candidate);
      try {
        if (fs.existsSync(fullPath)) {
          return candidate;
        }
      } catch (_e) {
        // Continue
      }
    }

    return resolved + ".js"; // Default assumption
  }

  /**
   * Select tests intelligently for given changed files
   * @param {string[]} changedFiles - List of changed file paths (relative)
   * @returns {Object} { tests, cached, hitRate, estimatedSavings }
   */
  selectTests(changedFiles) {
    this._totalSelections++;

    if (!changedFiles || changedFiles.length === 0) {
      return {
        tests: [],
        cached: false,
        hitRate: this._getCacheHitRate(),
        estimatedSavings: "100%",
        reason: "No changed files",
      };
    }

    // Normalize paths
    const normalized = changedFiles.map((f) => f.replace(/\\/g, "/")).sort();

    // Calculate cache key
    const fileHash = this._hashFiles(normalized);

    // Check cache
    const cached = this._checkCache(fileHash);
    if (cached) {
      this._cacheHits++;
      this.emit("cache-hit", { fileHash, tests: cached.tests });
      return {
        tests: JSON.parse(cached.selected_tests || "[]"),
        cached: true,
        hitRate: this._getCacheHitRate(),
        cacheAge: cached.created_at,
        estimatedSavings: this._estimateSavings(
          JSON.parse(cached.selected_tests || "[]"),
        ),
      };
    }

    this._cacheMisses++;

    // Find affected tests through dependency graph
    const affectedTests = new Set();

    for (const file of normalized) {
      // Direct test file changed
      if (file.includes(".test.") || file.includes(".spec.")) {
        affectedTests.add(file);
        continue;
      }

      // Find tests that depend on this file (directly or transitively)
      const transitiveTests = this._findTransitiveDepTests(file);
      for (const test of transitiveTests) {
        affectedTests.add(test);
      }
    }

    const tests = Array.from(affectedTests);

    // Sort by flakiness (least flaky first for reliability)
    tests.sort((a, b) => {
      const flakyA = this._getFlakiness(a);
      const flakyB = this._getFlakiness(b);
      return flakyA - flakyB;
    });

    // Store in cache
    this._storeCache(fileHash, tests);

    this.emit("tests-selected", {
      changedFiles: normalized.length,
      selectedTests: tests.length,
      cached: false,
    });

    return {
      tests,
      cached: false,
      hitRate: this._getCacheHitRate(),
      changedFiles: normalized,
      estimatedSavings: this._estimateSavings(tests),
    };
  }

  /**
   * Find all tests that transitively depend on a file
   * @param {string} file - Source file path
   * @returns {Set<string>} Affected test files
   */
  _findTransitiveDepTests(file) {
    const tests = new Set();
    const visited = new Set();
    const queue = [file];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      // Check if current is a test file
      if (current.includes(".test.") || current.includes(".spec.")) {
        tests.add(current);
      }

      // Check reverse deps (files that import this file)
      const dependents = this._reverseDeps.get(current);
      if (dependents) {
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }

      // Also check source-to-test mapping
      const mappedTests = this._sourceToTests.get(current);
      if (mappedTests) {
        for (const test of mappedTests) {
          tests.add(test);
        }
      }
    }

    return tests;
  }

  /**
   * Get dependency graph for visualization
   * @param {string} [testDir] - Limit to specific test directory
   * @returns {Object} Graph data { nodes, edges }
   */
  getDependencyGraph(testDir = null) {
    const nodes = [];
    const edges = [];
    const nodeSet = new Set();

    for (const [file, deps] of this._depGraph) {
      if (testDir && !file.startsWith(testDir)) {
        continue;
      }

      if (!nodeSet.has(file)) {
        nodeSet.add(file);
        nodes.push({
          id: file,
          type:
            file.includes(".test.") || file.includes(".spec.")
              ? "test"
              : "source",
        });
      }

      for (const dep of deps) {
        if (!nodeSet.has(dep)) {
          nodeSet.add(dep);
          nodes.push({ id: dep, type: "source" });
        }
        edges.push({ from: file, to: dep });
      }
    }

    return { nodes, edges, totalFiles: nodes.length, totalEdges: edges.length };
  }

  /**
   * Record a test result for history and flakiness tracking
   * @param {string} testPath - Test file path
   * @param {boolean} passed - Whether the test passed
   * @param {number} durationMs - Test execution duration
   */
  recordTestResult(testPath, passed, durationMs) {
    if (!this.db) {
      return;
    }

    try {
      const existing = this.db.get(
        "SELECT * FROM cicd_test_history WHERE test_path = ?",
        [testPath],
      );

      if (existing) {
        const runCount = (existing.run_count || 0) + 1;
        const failCount = (existing.fail_count || 0) + (passed ? 0 : 1);
        const flakiness =
          runCount >= 3 ? Math.round((failCount / runCount) * 1000) / 1000 : 0;

        this.db.run(
          `UPDATE cicd_test_history
           SET passed = ?, duration_ms = ?, flakiness_score = ?,
               run_count = ?, fail_count = ?, last_run_at = datetime('now')
           WHERE test_path = ?`,
          [
            passed ? 1 : 0,
            durationMs,
            flakiness,
            runCount,
            failCount,
            testPath,
          ],
        );
      } else {
        this.db.run(
          `INSERT INTO cicd_test_history
           (id, test_path, passed, duration_ms, flakiness_score, run_count, fail_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            testPath,
            passed ? 1 : 0,
            durationMs,
            0,
            1,
            passed ? 0 : 1,
          ],
        );
      }
    } catch (error) {
      logger.warn("[CICDOptimizer] Record test result error:", error.message);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} { hitRate, entries, avgAge, totalSelections }
   */
  getCacheStats() {
    let entries = 0;
    let avgAge = 0;

    if (this.db) {
      try {
        const row = this.db.get(
          "SELECT COUNT(*) as count, AVG(julianday('now') - julianday(created_at)) as avgAgeDays FROM cicd_test_cache",
        );
        entries = row?.count || 0;
        avgAge = row?.avgAgeDays
          ? `${Math.round(row.avgAgeDays * 24)}h`
          : "N/A";
      } catch (_e) {
        // Ignore
      }
    }

    return {
      hitRate: this._getCacheHitRate(),
      entries,
      avgAge,
      totalSelections: this._totalSelections,
      hits: this._cacheHits,
      misses: this._cacheMisses,
    };
  }

  /**
   * Clear the test cache
   * @returns {Object} Result
   */
  clearCache() {
    if (!this.db) {
      return { success: false, error: "No database" };
    }

    try {
      this.db.run("DELETE FROM cicd_test_cache");
      this._cacheHits = 0;
      this._cacheMisses = 0;
      logger.info("[CICDOptimizer] Cache cleared");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get test history with flakiness data
   * @param {number} [limit=50] - Max results
   * @returns {Array} Test history records
   */
  getTestHistory(limit = 50) {
    if (!this.db) {
      return [];
    }
    try {
      return this.db.all(
        `SELECT test_path, passed, duration_ms, flakiness_score,
                run_count, fail_count, last_run_at
         FROM cicd_test_history
         ORDER BY flakiness_score DESC, last_run_at DESC
         LIMIT ?`,
        [limit],
      );
    } catch (error) {
      logger.warn("[CICDOptimizer] Get test history error:", error.message);
      return [];
    }
  }

  /**
   * Plan an incremental build based on changed files
   * @param {string[]} changedFiles - Changed file paths
   * @returns {Object} { steps, estimatedTime, savedTime }
   */
  planIncrementalBuild(changedFiles) {
    const steps = [];
    const changedSet = new Set(
      (changedFiles || []).map((f) => f.replace(/\\/g, "/")),
    );

    // Categorize changed files
    const categories = {
      main: [], // Main process files
      renderer: [], // Renderer process files
      styles: [], // CSS/SCSS files
      tests: [], // Test files
      config: [], // Config files
      other: [],
    };

    for (const file of changedSet) {
      if (file.includes("/main/")) {
        categories.main.push(file);
      } else if (file.includes("/renderer/")) {
        categories.renderer.push(file);
      } else if (file.match(/\.(css|scss|less)$/)) {
        categories.styles.push(file);
      } else if (file.includes(".test.") || file.includes(".spec.")) {
        categories.tests.push(file);
      } else if (file.match(/\.(json|yml|yaml)$/)) {
        categories.config.push(file);
      } else {
        categories.other.push(file);
      }
    }

    let stepOrder = 0;

    // Build step 1: Compile main process (if main files changed)
    if (categories.main.length > 0 || categories.config.length > 0) {
      const inputHash = this._hashFiles(
        [...categories.main, ...categories.config].sort(),
      );
      const cached = this._checkBuildCache("build:main", inputHash);

      steps.push({
        order: stepOrder++,
        name: "build:main",
        description: "Compile main process",
        command: "npm run build:main",
        changedFiles: categories.main,
        cached: !!cached,
        inputHash,
        estimatedMs: cached ? 0 : 15000,
        parallel: false,
      });
    }

    // Build step 2: Compile renderer (if renderer files changed)
    if (categories.renderer.length > 0 || categories.styles.length > 0) {
      const inputHash = this._hashFiles(
        [...categories.renderer, ...categories.styles].sort(),
      );
      const cached = this._checkBuildCache("build:renderer", inputHash);

      steps.push({
        order: stepOrder++,
        name: "build:renderer",
        description: "Compile renderer process",
        command: "npm run build:renderer",
        changedFiles: categories.renderer,
        cached: !!cached,
        inputHash,
        estimatedMs: cached ? 0 : 20000,
        parallel: true, // Can run in parallel with main
      });
    }

    // Build step 3: Run affected tests
    if (categories.tests.length > 0 || changedSet.size > 0) {
      const selectedTests = this.selectTests(Array.from(changedSet));
      steps.push({
        order: stepOrder++,
        name: "test:selected",
        description: `Run ${selectedTests.tests.length} affected tests`,
        command: `npx vitest run ${selectedTests.tests.join(" ")}`,
        changedFiles: categories.tests,
        cached: selectedTests.cached,
        testCount: selectedTests.tests.length,
        estimatedMs: selectedTests.tests.length * 2000,
        parallel: false, // After build
      });
    }

    // Build step 4: Lint changed files
    const lintableFiles = [
      ...categories.main,
      ...categories.renderer,
      ...categories.other,
    ].filter((f) => f.match(/\.(js|ts|vue)$/));
    if (lintableFiles.length > 0) {
      steps.push({
        order: stepOrder++,
        name: "lint:changed",
        description: `Lint ${lintableFiles.length} changed files`,
        command: `npx eslint ${lintableFiles.join(" ")}`,
        changedFiles: lintableFiles,
        cached: false,
        estimatedMs: lintableFiles.length * 500,
        parallel: true, // Can run in parallel with tests
      });
    }

    // Calculate savings
    const totalEstimatedMs = steps.reduce(
      (sum, s) => sum + (s.cached ? 0 : s.estimatedMs),
      0,
    );
    const fullBuildMs = 120000; // 2 min full build estimate
    const savedMs = Math.max(0, fullBuildMs - totalEstimatedMs);

    return {
      steps,
      totalSteps: steps.length,
      cachedSteps: steps.filter((s) => s.cached).length,
      estimatedTimeMs: totalEstimatedMs,
      estimatedTimeHuman: this._humanDuration(totalEstimatedMs),
      fullBuildTimeMs: fullBuildMs,
      savedTimeMs: savedMs,
      savedTimeHuman: this._humanDuration(savedMs),
      savingsPercent: `${Math.round((savedMs / fullBuildMs) * 100)}%`,
    };
  }

  /**
   * Get the flakiest tests
   * @param {number} [limit=10] - Max results
   * @returns {Array} Flaky test records
   */
  getFlakiestTests(limit = 10) {
    if (!this.db) {
      return [];
    }
    try {
      return this.db.all(
        `SELECT test_path, flakiness_score, fail_count, run_count,
                ROUND(CAST(fail_count AS REAL) / NULLIF(run_count, 0) * 100, 1) as fail_rate_percent,
                duration_ms, last_run_at
         FROM cicd_test_history
         WHERE run_count >= 3
         ORDER BY flakiness_score DESC
         LIMIT ?`,
        [limit],
      );
    } catch (error) {
      logger.warn("[CICDOptimizer] Get flakiest tests error:", error.message);
      return [];
    }
  }

  /**
   * Get source→test coverage mapping
   * @returns {Object} Coverage data
   */
  analyzeCoverage() {
    const coverage = {};
    let coveredFiles = 0;
    let uncoveredFiles = 0;

    for (const [source, tests] of this._sourceToTests) {
      if (tests.size > 0) {
        coveredFiles++;
        coverage[source] = {
          testCount: tests.size,
          tests: Array.from(tests),
        };
      }
    }

    // Find uncovered source files
    const allSourceFiles = this._findFiles(this.config.sourceFilePatterns);
    for (const file of allSourceFiles) {
      if (
        !file.includes(".test.") &&
        !file.includes(".spec.") &&
        !this._sourceToTests.has(file)
      ) {
        uncoveredFiles++;
        coverage[file] = { testCount: 0, tests: [] };
      }
    }

    return {
      coveredFiles,
      uncoveredFiles,
      totalFiles: coveredFiles + uncoveredFiles,
      coveragePercent:
        coveredFiles + uncoveredFiles > 0
          ? `${Math.round((coveredFiles / (coveredFiles + uncoveredFiles)) * 100)}%`
          : "N/A",
      details: coverage,
    };
  }

  /**
   * Get build cache stats
   * @returns {Object} Cache stats
   */
  getBuildCacheStats() {
    if (!this.db) {
      return { entries: 0, hitRate: "N/A" };
    }
    try {
      const row = this.db.get("SELECT COUNT(*) as count FROM cicd_build_cache");
      return { entries: row?.count || 0 };
    } catch (_e) {
      return { entries: 0 };
    }
  }

  /**
   * Get current configuration
   * @returns {Object} Config
   */
  getConfig() {
    return { ...this.config };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * SHA256 hash of sorted file list
   * @param {string[]} files - File paths
   * @returns {string} Hash string
   */
  _hashFiles(files) {
    return crypto
      .createHash("sha256")
      .update(files.join("\n"))
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * Check test cache for a file hash
   * @param {string} fileHash - Hash to look up
   * @returns {Object|null} Cached result
   */
  _checkCache(fileHash) {
    if (!this.db) {
      return null;
    }
    try {
      const row = this.db.get(
        "SELECT * FROM cicd_test_cache WHERE file_hash = ?",
        [fileHash],
      );
      if (row) {
        // Update last hit time
        this.db.run(
          "UPDATE cicd_test_cache SET last_hit_at = datetime('now') WHERE id = ?",
          [row.id],
        );
      }
      return row || null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Store test selection in cache
   * @param {string} fileHash - Cache key
   * @param {string[]} tests - Selected tests
   */
  _storeCache(fileHash, tests) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `INSERT OR REPLACE INTO cicd_test_cache
         (id, file_hash, selected_tests, last_hit_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [uuidv4(), fileHash, JSON.stringify(tests)],
      );

      // Cleanup old entries
      this.db.run(
        `DELETE FROM cicd_test_cache
         WHERE created_at < datetime('now', '-7 days')`,
      );
    } catch (error) {
      logger.warn("[CICDOptimizer] Cache store error:", error.message);
    }
  }

  /**
   * Check build cache
   * @param {string} stepName - Build step name
   * @param {string} inputHash - Input hash
   * @returns {Object|null} Cached build result
   */
  _checkBuildCache(stepName, inputHash) {
    if (!this.db) {
      return null;
    }
    try {
      return this.db.get(
        "SELECT * FROM cicd_build_cache WHERE step_name = ? AND input_hash = ?",
        [stepName, inputHash],
      );
    } catch (_e) {
      return null;
    }
  }

  /**
   * Get flakiness score for a test
   * @param {string} testPath - Test file path
   * @returns {number} Flakiness score (0-1)
   */
  _getFlakiness(testPath) {
    if (!this.db) {
      return 0;
    }
    try {
      const row = this.db.get(
        "SELECT flakiness_score FROM cicd_test_history WHERE test_path = ?",
        [testPath],
      );
      return row?.flakiness_score || 0;
    } catch (_e) {
      return 0;
    }
  }

  /**
   * Get cache hit rate as a formatted string
   * @returns {string} Hit rate
   */
  _getCacheHitRate() {
    const total = this._cacheHits + this._cacheMisses;
    if (total === 0) {
      return "N/A";
    }
    return `${Math.round((this._cacheHits / total) * 100)}%`;
  }

  /**
   * Estimate time savings from running only selected tests
   * @param {string[]} selectedTests - Tests that will run
   * @returns {string} Estimated savings percentage
   */
  _estimateSavings(selectedTests) {
    const totalTests = this._depGraph.size;
    if (totalTests === 0) {
      return "N/A";
    }
    const skipped = Math.max(0, totalTests - selectedTests.length);
    return `${Math.round((skipped / totalTests) * 100)}%`;
  }

  /**
   * Convert ms to human-readable duration
   * @param {number} ms - Milliseconds
   * @returns {string} Human-readable string
   */
  _humanDuration(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }
    if (ms < 3600000) {
      return `${Math.round(ms / 60000)}m`;
    }
    return `${Math.round((ms / 3600000) * 10) / 10}h`;
  }

  /**
   * Shutdown optimizer
   */
  shutdown() {
    this._depGraph.clear();
    this._reverseDeps.clear();
    this._sourceToTests.clear();
    this.removeAllListeners();
    logger.info("[CICDOptimizer] Shutdown");
  }
}

module.exports = { CICDOptimizer, DEFAULT_CONFIG };
