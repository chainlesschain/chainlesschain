/**
 * Test Script for Memory System Enhancements
 *
 * Tests the memory modules:
 * Phase 7 (New):
 * 1. SemanticChunker - Semantic document chunking
 * 2. AdvancedMemorySearch - Advanced search with tiers/facets
 * 3. MemoryAnalytics - Memory analytics and health score
 *
 * Existing modules:
 * 4. AutoBackupManager - Automatic backup management
 * 5. UsageReportGenerator - Usage analytics and reports
 * 6. BehaviorTracker - User behavior learning
 * 7. ContextAssociator - Cross-session knowledge association
 *
 * Usage: node scripts/test-memory-enhancements.js [module]
 *   Modules: chunker, search, analytics, backup, report, behavior, context, all (default)
 */

const path = require("path");

// Mock database for testing
class MockDatabase {
  constructor() {
    this.tables = {};
    this.data = {};
  }

  prepare(sql) {
    return {
      run: (..._params) => {
        // Mock run implementation
        const tableName = this._extractTableName(sql, "INSERT");
        if (tableName && sql.includes("INSERT")) {
          if (!this.data[tableName]) {
            this.data[tableName] = [];
          }
          this.data[tableName].push({ sql, params: _params });
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: (..._params) => {
        // Mock get implementation
        this._extractTableName(sql, "SELECT");
        if (sql.includes("sqlite_master") && sql.includes("backup_history")) {
          return null; // Tables don't exist yet
        }
        if (sql.includes("sqlite_master") && sql.includes("usage_reports")) {
          return null;
        }
        if (sql.includes("sqlite_master") && sql.includes("behavior_events")) {
          return null;
        }
        if (
          sql.includes("sqlite_master") &&
          sql.includes("session_knowledge")
        ) {
          return null;
        }
        return null;
      },
      all: (..._params) => {
        return [];
      },
    };
  }

  _extractTableName(sql, operation) {
    if (operation === "INSERT") {
      const match = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/i);
      return match ? match[1] : null;
    }
    if (operation === "SELECT") {
      const match = sql.match(/FROM\s+(\w+)/i);
      return match ? match[1] : null;
    }
    return null;
  }
}

// Helper function to log results
function logResult(testName, success, details = "") {
  const status = success ? "✅ PASS" : "❌ FAIL";
  console.log(`  ${status}: ${testName}`);
  if (details) {
    console.log(`         ${details}`);
  }
}

// ============================================================
// Phase 7 New Tests
// ============================================================

// Test SemanticChunker
async function testSemanticChunker() {
  console.log("\n📄 Testing SemanticChunker\n");

  try {
    const { SemanticChunker } = require("../src/main/rag/semantic-chunker");

    // Test 1: Initialization
    const chunker = new SemanticChunker();
    logResult("Initialization", chunker !== null);
    logResult("Default target chunk size", chunker.config.targetChunkSize === 500);

    // Test 2: Custom config
    const customChunker = new SemanticChunker({
      targetChunkSize: 300,
      overlapSize: 30,
    });
    logResult("Custom config", customChunker.config.targetChunkSize === 300);

    // Test 3: Chunk simple text
    const simpleChunker = new SemanticChunker({ targetChunkSize: 100, minChunkSize: 20 });
    let text = "";
    for (let i = 0; i < 20; i++) text += "This is a simple test. ";
    const chunks = simpleChunker.chunk(text, { id: "test-doc" });
    logResult("Chunk simple text", Array.isArray(chunks) && chunks.length > 0);

    // Test 4: Chunk Markdown
    const mdChunker = new SemanticChunker({ targetChunkSize: 200, minChunkSize: 50 });
    const markdown = `# Title

## Section 1
This is content for section 1. It has some text.

## Section 2
This is content for section 2. It also has some text.

### Subsection 2.1
More detailed content here.
`;
    const mdChunks = mdChunker.chunk(markdown, { id: "markdown-doc" });
    logResult("Chunk Markdown", Array.isArray(mdChunks) && mdChunks.length >= 1);
    logResult("Chunk metadata", mdChunks[0] && mdChunks[0].metadata.chunkIndex !== undefined);

    // Test 5: Empty text
    const emptyChunks = chunker.chunk("", {});
    logResult("Empty text returns empty array", emptyChunks.length === 0);

    // Test 6: Batch chunking
    const batchChunker = new SemanticChunker({ targetChunkSize: 100, minChunkSize: 20 });
    let content1 = "", content2 = "";
    for (let i = 0; i < 5; i++) { content1 += "First document. "; content2 += "Second document. "; }
    const allChunks = batchChunker.chunkDocuments([
      { id: "doc1", content: content1, metadata: {} },
      { id: "doc2", content: content2, metadata: {} },
    ]);
    logResult("Batch chunking", Array.isArray(allChunks) && allChunks.length > 0);

    // Test 7: Word count
    const wcChunker = new SemanticChunker({ targetChunkSize: 500, minChunkSize: 10 });
    const wcChunks = wcChunker.chunk("Hello world 你好世界", { id: "word-test" });
    logResult("Word count metadata", wcChunks.length > 0 && wcChunks[0].metadata.wordCount > 0);

    // Test 8: Update config
    chunker.updateConfig({ targetChunkSize: 800 });
    logResult("Update config", chunker.config.targetChunkSize === 800);

    console.log("\n  SemanticChunker tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ SemanticChunker test failed:", error.message);
    return false;
  }
}

// Test AdvancedMemorySearch
async function testAdvancedMemorySearch() {
  console.log("\n🔍 Testing AdvancedMemorySearch\n");

  try {
    const { AdvancedMemorySearch, MEMORY_TIERS, MEMORY_TYPES, IMPORTANCE_LEVELS } =
      require("../src/main/rag/advanced-memory-search");

    // Mock database
    const mockDb = {
      prepare: (sql) => ({
        run: () => {},
        get: () => ({ count: 5 }),
        all: () => [],
      }),
    };

    // Test 1: Initialization
    const search = new AdvancedMemorySearch({ database: mockDb });
    logResult("Initialization", search !== null);

    // Test 2: Require database
    let threw = false;
    try { new AdvancedMemorySearch({}); } catch (e) { threw = true; }
    logResult("Require database parameter", threw);

    // Test 3: Constants exported
    logResult("MEMORY_TIERS.WORKING", MEMORY_TIERS.WORKING === "working");
    logResult("MEMORY_TIERS.RECALL", MEMORY_TIERS.RECALL === "recall");
    logResult("MEMORY_TIERS.ARCHIVAL", MEMORY_TIERS.ARCHIVAL === "archival");
    logResult("MEMORY_TYPES.DAILY_NOTE", MEMORY_TYPES.DAILY_NOTE === "daily_note");
    logResult("IMPORTANCE_LEVELS.CRITICAL", IMPORTANCE_LEVELS.CRITICAL === 5);

    // Test 4: Search method
    const results = await search.search("test query", { limit: 10 });
    logResult("Execute search", results !== null && results.results !== undefined);
    logResult("Search pagination", results.pagination !== undefined);

    // Test 5: Search by tier
    const tierResults = await search.searchByTier("test", MEMORY_TIERS.WORKING);
    logResult("Search by tier", tierResults !== null);

    // Test 6: Search by date range
    const dateResults = await search.searchByDateRange("test", "2026-01-01", "2026-02-02");
    logResult("Search by date range", dateResults !== null);

    // Test 7: Get important memories
    const important = await search.getImportantMemories({ minImportance: 4 });
    logResult("Get important memories", Array.isArray(important));

    // Test 8: Get recent memories
    const recent = await search.getRecentMemories({ days: 7 });
    logResult("Get recent memories", Array.isArray(recent));

    // Test 9: Clear cache
    search.clearCache();
    logResult("Clear cache", search.searchCache.size === 0);

    console.log("\n  AdvancedMemorySearch tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ AdvancedMemorySearch test failed:", error.message);
    return false;
  }
}

// Test MemoryAnalytics
async function testMemoryAnalytics() {
  console.log("\n📊 Testing MemoryAnalytics\n");

  try {
    const { MemoryAnalytics } = require("../src/main/rag/memory-analytics");

    // Mock database
    const mockDb = {
      prepare: (sql) => ({
        run: () => {},
        get: () => {
          if (sql.includes("daily_notes_metadata") && sql.includes("SELECT")) {
            return { totalNotes: 10, totalWords: 5000, avgWordsPerNote: 500, count: 7 };
          }
          if (sql.includes("memory_sections") && sql.includes("SELECT")) {
            return { totalSections: 5, avgImportance: 3.5, count: 3 };
          }
          if (sql.includes("embedding_cache")) {
            return { totalEmbeddings: 100, totalAccesses: 500 };
          }
          if (sql.includes("memory_file_hashes")) {
            return { totalFiles: 20, indexedFiles: 18, failedFiles: 2 };
          }
          if (sql.includes("memory_stats") && sql.includes("SELECT")) {
            return { hybrid_search_count: 50, cache_hits: 40, cache_misses: 10, avg_search_latency: 15 };
          }
          return {};
        },
        all: () => [],
      }),
    };

    // Test 1: Initialization
    const analytics = new MemoryAnalytics({ database: mockDb });
    logResult("Initialization", analytics !== null);

    // Test 2: Require database
    let threw = false;
    try { new MemoryAnalytics({}); } catch (e) { threw = true; }
    logResult("Require database parameter", threw);

    // Test 3: Get overview
    const overview = await analytics.getOverview();
    logResult("Get overview", overview !== null && overview.dailyNotes !== undefined);
    logResult("Overview has all sections", overview.memorySections !== undefined && overview.index !== undefined);

    // Test 4: Get trends
    const trends = await analytics.getTrends(30);
    logResult("Get trends", trends !== null && trends.daily !== undefined);
    logResult("Trends has weekly data", trends.weekly !== undefined);

    // Test 5: Get top keywords
    const keywords = await analytics.getTopKeywords(10);
    logResult("Get top keywords", Array.isArray(keywords));

    // Test 6: Get search statistics
    const stats = await analytics.getSearchStatistics();
    logResult("Get search statistics", stats !== null && stats.today !== undefined);

    // Test 7: Calculate health score
    const health = await analytics.calculateHealthScore();
    logResult("Calculate health score", health !== null && health.totalScore !== undefined);
    logResult("Health score has grade", health.grade !== undefined);
    logResult("Health score max is 100", health.maxScore === 100);
    logResult("Health score has suggestions", Array.isArray(health.suggestions));

    // Test 8: Get dashboard data
    const dashboard = await analytics.getDashboardData();
    logResult("Get dashboard data", dashboard !== null && dashboard.overview !== undefined);
    logResult("Dashboard has timestamp", dashboard.generatedAt !== undefined);

    // Test 9: Record search event
    await analytics.recordSearchEvent("hybrid", 15, false);
    logResult("Record search event", true);

    console.log("\n  MemoryAnalytics tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ MemoryAnalytics test failed:", error.message);
    return false;
  }
}

// ============================================================
// Existing Tests
// ============================================================

// Test AutoBackupManager
async function testAutoBackupManager() {
  console.log("\n📦 Testing AutoBackupManager\n");

  try {
    const {
      AutoBackupManager,
    } = require("../src/main/memory/auto-backup-manager");

    const db = new MockDatabase();
    const testDir = path.join(
      process.cwd(),
      ".chainlesschain",
      "memory",
      "backups",
    );

    const manager = new AutoBackupManager({
      database: db,
      backupsDir: testDir,
    });

    // Test initialization
    await manager.initialize();
    logResult("Initialization", true);

    // Test schedule configuration
    const schedule = await manager.configureSchedule({
      name: "Test Daily Backup",
      scope: "patterns",
      frequency: "daily",
      hour: 3,
      retentionCount: 5,
    });
    logResult(
      "Configure schedule",
      !!schedule.id,
      `Schedule ID: ${schedule.id}`,
    );

    // Test get schedules
    const schedules = await manager.getSchedules();
    logResult("Get schedules", Array.isArray(schedules));

    // Test get stats
    const stats = await manager.getStats();
    logResult("Get stats", typeof stats === "object");

    // Stop schedule checker
    manager.stopScheduleChecker();
    logResult("Stop schedule checker", true);

    console.log("\n  AutoBackupManager tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ AutoBackupManager test failed:", error.message);
    return false;
  }
}

// Test UsageReportGenerator
async function testUsageReportGenerator() {
  console.log("\n📊 Testing UsageReportGenerator\n");

  try {
    const {
      UsageReportGenerator,
    } = require("../src/main/memory/usage-report-generator");

    const db = new MockDatabase();
    const testDir = path.join(
      process.cwd(),
      ".chainlesschain",
      "memory",
      "reports",
    );

    const generator = new UsageReportGenerator({
      database: db,
      reportsDir: testDir,
    });

    // Test initialization
    await generator.initialize();
    logResult("Initialization", true);

    // Test subscription configuration
    const subscription = await generator.configureSubscription({
      name: "Weekly Report Subscription",
      reportType: "weekly",
      scope: "full",
      frequency: "weekly",
    });
    logResult(
      "Configure subscription",
      !!subscription.id,
      `Subscription ID: ${subscription.id}`,
    );

    // Test get subscriptions
    const subscriptions = await generator.getSubscriptions();
    logResult("Get subscriptions", Array.isArray(subscriptions));

    // Test list reports
    const reports = await generator.listReports();
    logResult("List reports", Array.isArray(reports));

    // Stop schedule checker
    generator.stopScheduleChecker();
    logResult("Stop schedule checker", true);

    console.log("\n  UsageReportGenerator tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ UsageReportGenerator test failed:", error.message);
    return false;
  }
}

// Test BehaviorTracker
async function testBehaviorTracker() {
  console.log("\n🧠 Testing BehaviorTracker\n");

  try {
    const { BehaviorTracker } = require("../src/main/memory/behavior-tracker");

    const db = new MockDatabase();
    const testDir = path.join(
      process.cwd(),
      ".chainlesschain",
      "memory",
      "learned-patterns",
    );

    const tracker = new BehaviorTracker({
      database: db,
      patternsDir: testDir,
    });

    // Test initialization
    await tracker.initialize();
    logResult("Initialization", true);

    // Test page visit tracking
    const pageEvent = await tracker.trackPageVisit("test-page", {
      duration: 5000,
    });
    logResult("Track page visit", !!pageEvent.id, `Event ID: ${pageEvent.id}`);

    // Test feature use tracking
    const featureEvent = await tracker.trackFeatureUse(
      "knowledge-base",
      "create",
      {
        success: true,
      },
    );
    logResult(
      "Track feature use",
      !!featureEvent.id,
      `Event ID: ${featureEvent.id}`,
    );

    // Test LLM interaction tracking
    const llmEvent = await tracker.trackLLMInteraction({
      provider: "ollama",
      model: "qwen2:7b",
      queryType: "question",
      duration: 2000,
    });
    logResult(
      "Track LLM interaction",
      !!llmEvent.id,
      `Event ID: ${llmEvent.id}`,
    );

    // Test get recommendations
    const recommendations = await tracker.getRecommendations();
    logResult("Get recommendations", Array.isArray(recommendations));

    // Test get stats
    const stats = await tracker.getStats();
    logResult("Get stats", typeof stats === "object");

    // Test start new session
    const newSessionId = tracker.startNewSession();
    logResult(
      "Start new session",
      typeof newSessionId === "string",
      `Session ID: ${newSessionId.substring(0, 8)}...`,
    );

    // Stop periodic analysis
    tracker.stopPeriodicAnalysis();
    logResult("Stop periodic analysis", true);

    console.log("\n  BehaviorTracker tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ BehaviorTracker test failed:", error.message);
    return false;
  }
}

// Test ContextAssociator
async function testContextAssociator() {
  console.log("\n🔗 Testing ContextAssociator\n");

  try {
    const {
      ContextAssociator,
    } = require("../src/main/memory/context-associator");

    const db = new MockDatabase();

    const associator = new ContextAssociator({
      database: db,
    });

    // Test initialization
    await associator.initialize();
    logResult("Initialization", true);

    // Test get or create topic
    const topic = await associator.getOrCreateTopic("machine-learning", {
      description: "Machine learning related discussions",
    });
    logResult("Get/create topic", !!topic.id, `Topic ID: ${topic.id}`);

    // Test get popular topics
    const popularTopics = await associator.getPopularTopics();
    logResult("Get popular topics", Array.isArray(popularTopics));

    // Test search knowledge
    const knowledge = await associator.searchKnowledge("test");
    logResult("Search knowledge", Array.isArray(knowledge));

    // Test get stats
    const stats = await associator.getStats();
    logResult("Get stats", typeof stats === "object");

    console.log("\n  ContextAssociator tests completed.\n");
    return true;
  } catch (error) {
    console.error("  ❌ ContextAssociator test failed:", error.message);
    return false;
  }
}

// Test memory/index.js exports
async function testMemoryIndex() {
  console.log("\n📁 Testing Memory Index Exports\n");

  try {
    const memory = require("../src/main/memory");

    // Check all exports exist
    const requiredExports = [
      "PreferenceManager",
      "LearnedPatternManager",
      "AutoBackupManager",
      "UsageReportGenerator",
      "BehaviorTracker",
      "ContextAssociator",
      "registerPreferenceManagerIPC",
      "registerLearnedPatternManagerIPC",
      "registerAutoBackupManagerIPC",
      "registerUsageReportGeneratorIPC",
      "registerBehaviorTrackerIPC",
      "registerContextAssociatorIPC",
      "registerMemorySystemIPC",
      "initializeMemorySystem",
      "stopMemorySystem",
    ];

    let allExportsPresent = true;
    for (const exportName of requiredExports) {
      if (!memory[exportName]) {
        logResult(`Export: ${exportName}`, false, "Missing");
        allExportsPresent = false;
      } else {
        logResult(`Export: ${exportName}`, true);
      }
    }

    console.log("\n  Memory Index tests completed.\n");
    return allExportsPresent;
  } catch (error) {
    console.error("  ❌ Memory Index test failed:", error.message);
    return false;
  }
}

// Main test runner
async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log(
    "║         Memory System Enhancement Tests                      ║",
  );
  console.log("╚════════════════════════════════════════════════════════════╝");

  const args = process.argv.slice(2);
  const moduleToTest = args[0] || "all";

  const results = {};

  try {
    // Phase 7 new modules
    if (moduleToTest === "all" || moduleToTest === "chunker") {
      results.chunker = await testSemanticChunker();
    }

    if (moduleToTest === "all" || moduleToTest === "search") {
      results.search = await testAdvancedMemorySearch();
    }

    if (moduleToTest === "all" || moduleToTest === "analytics") {
      results.analytics = await testMemoryAnalytics();
    }

    // Existing modules
    if (moduleToTest === "all" || moduleToTest === "backup") {
      results.backup = await testAutoBackupManager();
    }

    if (moduleToTest === "all" || moduleToTest === "report") {
      results.report = await testUsageReportGenerator();
    }

    if (moduleToTest === "all" || moduleToTest === "behavior") {
      results.behavior = await testBehaviorTracker();
    }

    if (moduleToTest === "all" || moduleToTest === "context") {
      results.context = await testContextAssociator();
    }

    if (moduleToTest === "all" || moduleToTest === "index") {
      results.index = await testMemoryIndex();
    }
  } catch (error) {
    console.error("\n❌ Test runner error:", error);
  }

  // Summary
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("                        SUMMARY");
  console.log("════════════════════════════════════════════════════════════\n");

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [module, passed] of Object.entries(results)) {
    console.log(
      `  ${passed ? "✅" : "❌"} ${module}: ${passed ? "PASSED" : "FAILED"}`,
    );
    if (passed) totalPassed++;
    else totalFailed++;
  }

  console.log(`\n  Total: ${totalPassed} passed, ${totalFailed} failed\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(console.error);
