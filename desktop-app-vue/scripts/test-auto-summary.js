/**
 * Test script for Session Auto-Summary Generation
 * Uses mock database for testing without native bindings
 *
 * Tests:
 * 1. Auto-summary configuration
 * 2. Auto-trigger on message threshold
 * 3. Background summary scheduler
 * 4. Bulk summary generation
 * 5. Statistics and coverage
 *
 * @since 2026-01-18
 */

const path = require("path");
const fs = require("fs").promises;

// Setup paths
const testDir = path.join(__dirname, "../test-data/auto-summary-test");
const sessionsDir = path.join(testDir, "sessions");

// Mock Database
class MockDatabase {
  constructor() {
    this.sessions = new Map();
    this.templates = new Map();
  }

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return {
      run(...params) {
        // INSERT session
        if (sql.includes("INSERT INTO llm_sessions")) {
          const [
            id,
            convId,
            title,
            messages,
            compressed,
            metadata,
            created,
            updated,
          ] = params;
          db.sessions.set(id, {
            id,
            conversation_id: convId,
            title,
            messages,
            compressed_history: compressed,
            metadata,
            created_at: created,
            updated_at: updated,
          });
        }
        // UPDATE session
        if (sql.includes("UPDATE llm_sessions")) {
          const [title, messages, compressed, metadata, updated, id] = params;
          const session = db.sessions.get(id);
          if (session) {
            session.title = title;
            session.messages = messages;
            session.compressed_history = compressed;
            session.metadata = metadata;
            session.updated_at = updated;
          }
        }
        // DELETE session
        if (sql.includes("DELETE FROM llm_sessions")) {
          db.sessions.delete(params[0]);
        }
      },
      get(...params) {
        // SELECT session by id
        if (sql.includes("FROM llm_sessions") && sql.includes("WHERE id")) {
          return db.sessions.get(params[0]);
        }
        // COUNT queries
        if (sql.includes("COUNT(*)")) {
          let count = 0;
          if (sql.includes("json_extract(metadata, '$.summary') IS NULL")) {
            // Count sessions without summary
            for (const session of db.sessions.values()) {
              const metadata = JSON.parse(session.metadata || "{}");
              if (!metadata.summary) {
                const msgCount = metadata.messageCount || 0;
                if (sql.includes("$.messageCount") && params[0]) {
                  if (msgCount >= params[0]) count++;
                } else {
                  count++;
                }
              }
            }
          } else if (sql.includes("$.autoSummaryGenerated")) {
            for (const session of db.sessions.values()) {
              const metadata = JSON.parse(session.metadata || "{}");
              if (metadata.autoSummaryGenerated) count++;
            }
          } else if (sql.includes("$.summary") && !sql.includes("IS NULL")) {
            for (const session of db.sessions.values()) {
              const metadata = JSON.parse(session.metadata || "{}");
              if (metadata.summary) count++;
            }
          } else if (sql.includes("$.messageCount")) {
            for (const session of db.sessions.values()) {
              const metadata = JSON.parse(session.metadata || "{}");
              if (metadata.messageCount >= params[0]) count++;
            }
          } else {
            count = db.sessions.size;
          }
          return { count };
        }
        return null;
      },
      all(...params) {
        const results = [];
        // SELECT sessions
        if (sql.includes("FROM llm_sessions")) {
          for (const session of db.sessions.values()) {
            // Filter by summary status
            if (sql.includes("json_extract(metadata, '$.summary') IS NULL")) {
              const metadata = JSON.parse(session.metadata || "{}");
              if (metadata.summary) continue;
              if (sql.includes("$.messageCount") && params[0]) {
                if ((metadata.messageCount || 0) < params[0]) continue;
              }
            }
            results.push(session);
            if (params.includes(results.length)) break; // LIMIT
          }
        }
        return results;
      },
    };
  }
}

// Mock LLM Manager for testing
class MockLLMManager {
  constructor() {
    this.callCount = 0;
  }

  async query(prompt, _options = {}) {
    this.callCount++;
    // Simulate LLM response with a summary
    const match = prompt.match(/总结以下对话/);
    if (match) {
      return {
        text: `这是一个关于测试的对话摘要 #${this.callCount}`,
        content: `这是一个关于测试的对话摘要 #${this.callCount}`,
      };
    }
    return { text: "Mock response", content: "Mock response" };
  }
}

// Test utilities
async function setupTestEnvironment() {
  // Clean up previous test data
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore if doesn't exist
  }

  // Create directories
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });

  return new MockDatabase();
}

async function runTests() {
  console.log("\n========================================");
  console.log("  Session Auto-Summary Generation Tests");
  console.log("========================================\n");

  let db;
  let sessionManager;
  let passed = 0;
  let failed = 0;

  try {
    // Setup
    console.log("[Setup] Creating test environment...");
    db = await setupTestEnvironment();

    // Import SessionManager
    const { SessionManager } = require("../src/main/llm/session-manager");

    const mockLLM = new MockLLMManager();

    // Create SessionManager with auto-summary enabled
    sessionManager = new SessionManager({
      database: db,
      llmManager: mockLLM,
      sessionsDir: sessionsDir,
      enableAutoSummary: true,
      autoSummaryThreshold: 3, // Lower threshold for testing
      autoSummaryInterval: 1000, // 1 second for testing
      enableBackgroundSummary: false, // Disable initially for controlled testing
    });

    await sessionManager.initialize();
    console.log("[Setup] SessionManager initialized\n");

    // ============================================================
    // Test 1: Auto-Summary Configuration
    // ============================================================
    console.log("Test 1: Auto-Summary Configuration");
    console.log("-".repeat(40));

    const config = sessionManager.getAutoSummaryConfig();
    console.log("  Config:", JSON.stringify(config, null, 2));

    if (
      config.enabled === true &&
      config.threshold === 3 &&
      config.backgroundEnabled === false
    ) {
      console.log("  [PASS] Configuration is correct\n");
      passed++;
    } else {
      console.log("  [FAIL] Configuration mismatch\n");
      failed++;
    }

    // ============================================================
    // Test 2: Update Configuration
    // ============================================================
    console.log("Test 2: Update Auto-Summary Configuration");
    console.log("-".repeat(40));

    const newConfig = sessionManager.updateAutoSummaryConfig({
      threshold: 5,
      enabled: true,
    });

    console.log("  Updated config:", JSON.stringify(newConfig, null, 2));

    if (newConfig.threshold === 5 && newConfig.enabled === true) {
      console.log("  [PASS] Configuration updated successfully\n");
      passed++;
    } else {
      console.log("  [FAIL] Configuration update failed\n");
      failed++;
    }

    // Reset threshold for subsequent tests
    sessionManager.updateAutoSummaryConfig({ threshold: 3 });

    // ============================================================
    // Test 3: Create Sessions and Test Auto-Trigger
    // ============================================================
    console.log("Test 3: Auto-Trigger on Message Threshold");
    console.log("-".repeat(40));

    // Create a session
    const session1 = await sessionManager.createSession({
      conversationId: "test-conv-1",
      title: "Test Session 1",
    });
    console.log("  Created session:", session1.id);

    // Add messages below threshold (should not trigger)
    await sessionManager.addMessage(session1.id, {
      role: "user",
      content: "Hello, this is message 1",
    });
    await sessionManager.addMessage(session1.id, {
      role: "assistant",
      content: "Hi there! How can I help?",
    });

    // Check queue (should be empty)
    const configAfter2 = sessionManager.getAutoSummaryConfig();
    console.log("  Queue length after 2 messages:", configAfter2.queueLength);

    // Add third message (should trigger auto-summary)
    await sessionManager.addMessage(session1.id, {
      role: "user",
      content: "Can you help me with testing?",
    });

    // Wait a moment for queue processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    const configAfter3 = sessionManager.getAutoSummaryConfig();
    console.log("  Queue length after 3 messages:", configAfter3.queueLength);

    // Wait for summary generation to complete
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if summary was generated
    const updatedSession = await sessionManager.loadSession(session1.id);
    console.log("  Summary generated:", !!updatedSession.metadata.summary);
    console.log("  Summary:", updatedSession.metadata.summary);

    if (updatedSession.metadata.summary) {
      console.log("  [PASS] Auto-summary triggered on threshold\n");
      passed++;
    } else {
      console.log("  [FAIL] Auto-summary not triggered\n");
      failed++;
    }

    // ============================================================
    // Test 4: Sessions Without Summary Detection
    // ============================================================
    console.log("Test 4: Sessions Without Summary Detection");
    console.log("-".repeat(40));

    // Create sessions without summary
    const session2 = await sessionManager.createSession({
      conversationId: "test-conv-2",
      title: "Test Session 2 - No Summary",
    });

    // Add enough messages but disable auto-summary temporarily
    sessionManager.enableAutoSummary = false;
    for (let i = 0; i < 5; i++) {
      await sessionManager.addMessage(session2.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i + 1} for session 2`,
      });
    }
    sessionManager.enableAutoSummary = true;

    const sessionsWithoutSummary =
      await sessionManager.getSessionsWithoutSummary({
        limit: 10,
        minMessages: 3,
      });

    console.log("  Sessions without summary:", sessionsWithoutSummary.length);
    console.log(
      "  Session IDs:",
      sessionsWithoutSummary.map((s) => s.id),
    );

    if (sessionsWithoutSummary.length >= 1) {
      console.log("  [PASS] Correctly identified sessions without summary\n");
      passed++;
    } else {
      console.log("  [FAIL] Failed to identify sessions without summary\n");
      failed++;
    }

    // ============================================================
    // Test 5: Bulk Summary Generation
    // ============================================================
    console.log("Test 5: Bulk Summary Generation");
    console.log("-".repeat(40));

    const beforeBulk = await sessionManager.getAutoSummaryStats();
    console.log("  Before bulk - Without summary:", beforeBulk.withoutSummary);

    const bulkResult = await sessionManager.triggerBulkSummaryGeneration({
      limit: 10,
      overwrite: false,
    });

    console.log("  Bulk result:", JSON.stringify(bulkResult, null, 2));

    // Wait for queue processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const afterBulk = await sessionManager.getAutoSummaryStats();
    console.log("  After bulk - Without summary:", afterBulk.withoutSummary);
    console.log("  Coverage:", afterBulk.coverage + "%");

    if (bulkResult.queued > 0) {
      console.log("  [PASS] Bulk summary generation queued sessions\n");
      passed++;
    } else {
      console.log(
        "  [FAIL] Bulk summary generation did not queue any sessions\n",
      );
      failed++;
    }

    // ============================================================
    // Test 6: Auto-Summary Statistics
    // ============================================================
    console.log("Test 6: Auto-Summary Statistics");
    console.log("-".repeat(40));

    const stats = await sessionManager.getAutoSummaryStats();
    console.log("  Statistics:", JSON.stringify(stats, null, 2));

    if (
      stats.totalSessions !== undefined &&
      stats.withSummary !== undefined &&
      stats.coverage !== undefined
    ) {
      console.log("  [PASS] Statistics returned correctly\n");
      passed++;
    } else {
      console.log("  [FAIL] Statistics incomplete\n");
      failed++;
    }

    // ============================================================
    // Test 7: Background Summary Scheduler
    // ============================================================
    console.log("Test 7: Background Summary Scheduler");
    console.log("-".repeat(40));

    // Create a session without summary for background processing
    const session3 = await sessionManager.createSession({
      conversationId: "test-conv-3",
      title: "Test Session 3 - For Background",
    });

    sessionManager.enableAutoSummary = false;
    for (let i = 0; i < 4; i++) {
      await sessionManager.addMessage(session3.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Background test message ${i + 1}`,
      });
    }
    sessionManager.enableAutoSummary = true;

    // Start background scheduler
    sessionManager.startBackgroundSummaryGenerator();
    const configWithBg = sessionManager.getAutoSummaryConfig();
    console.log("  Background scheduler running:", configWithBg.isRunning);

    // Wait for background processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Stop scheduler
    sessionManager.stopBackgroundSummaryGenerator();
    const configAfterStop = sessionManager.getAutoSummaryConfig();
    console.log("  Background scheduler stopped:", !configAfterStop.isRunning);

    // Check if session3 got a summary
    const session3Updated = await sessionManager.loadSession(session3.id);
    console.log("  Session 3 got summary:", !!session3Updated.metadata.summary);

    if (configWithBg.isRunning && !configAfterStop.isRunning) {
      console.log("  [PASS] Background scheduler start/stop works\n");
      passed++;
    } else {
      console.log("  [FAIL] Background scheduler control failed\n");
      failed++;
    }

    // ============================================================
    // Test 8: LLM Call Count
    // ============================================================
    console.log("Test 8: LLM Integration");
    console.log("-".repeat(40));

    console.log("  Total LLM calls made:", mockLLM.callCount);

    if (mockLLM.callCount > 0) {
      console.log("  [PASS] LLM was called for summary generation\n");
      passed++;
    } else {
      console.log("  [FAIL] LLM was never called\n");
      failed++;
    }

    // ============================================================
    // Test 9: Event Emission
    // ============================================================
    console.log("Test 9: Event Emission");
    console.log("-".repeat(40));

    let eventFired = false;
    sessionManager.on("auto-summary-generated", (data) => {
      eventFired = true;
      console.log("  Event data:", JSON.stringify(data, null, 2));
    });

    // Create and populate a new session to trigger event
    const session4 = await sessionManager.createSession({
      conversationId: "test-conv-4",
      title: "Test Session 4 - Event Test",
    });

    for (let i = 0; i < 4; i++) {
      await sessionManager.addMessage(session4.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Event test message ${i + 1}`,
      });
    }

    // Wait for event
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (eventFired) {
      console.log("  [PASS] Event was emitted\n");
      passed++;
    } else {
      console.log("  [FAIL] Event was not emitted\n");
      failed++;
    }

    // ============================================================
    // Test 10: Destroy cleanup
    // ============================================================
    console.log("Test 10: Destroy Cleanup");
    console.log("-".repeat(40));

    // Start background scheduler first
    sessionManager.startBackgroundSummaryGenerator();
    console.log(
      "  Scheduler running before destroy:",
      sessionManager.getAutoSummaryConfig().isRunning,
    );

    sessionManager.destroy();
    console.log(
      "  Scheduler running after destroy:",
      !!sessionManager._backgroundSummaryTimer,
    );

    if (!sessionManager._backgroundSummaryTimer) {
      console.log("  [PASS] Cleanup properly stopped scheduler\n");
      passed++;
    } else {
      console.log("  [FAIL] Cleanup did not stop scheduler\n");
      failed++;
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log("========================================");
    console.log("  Test Results");
    console.log("========================================");
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Total:  ${passed + failed}`);
    console.log("========================================\n");

    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      console.log("[Cleanup] Test directory removed\n");
    } catch (e) {
      console.warn("[Cleanup] Failed to remove test directory:", e.message);
    }

    return failed === 0;
  } catch (error) {
    console.error("\n[ERROR] Test execution failed:", error);
    console.error(error.stack);

    return false;
  }
}

// Run tests
runTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
