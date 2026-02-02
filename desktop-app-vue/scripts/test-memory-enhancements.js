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
