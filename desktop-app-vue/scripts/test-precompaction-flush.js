/**
 * Pre-Compaction Memory Flush 测试脚本
 *
 * 测试 SessionManager 的预压缩记忆刷新功能 (Phase 3)
 *
 * 运行方式:
 * cd desktop-app-vue
 * node scripts/test-precompaction-flush.js
 */

const path = require("path");
const fs = require("fs").promises;

// 设置环境变量
process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB = "1";

const { SessionManager } = require("../src/main/llm/session-manager.js");
const {
  PermanentMemoryManager,
} = require("../src/main/llm/permanent-memory-manager.js");
const DatabaseManager = require("../src/main/database.js");

// ANSI 颜色代码
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logInfo(message) {
  log(`ℹ ${message}`, "cyan");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function logSection(message) {
  log(`\n${"=".repeat(60)}`, "blue");
  log(message, "blue");
  log("=".repeat(60), "blue");
}

/**
 * Mock LLM Manager for testing
 */
class MockLLMManager {
  constructor() {
    this.callCount = 0;
  }

  async chat(options) {
    this.callCount++;
    logInfo(`  [MockLLM] 调用 chat(), 次数: ${this.callCount}`);

    // 模拟 LLM 响应
    const response = {
      dailyNotes: `## ${new Date().toLocaleTimeString()} - 用户对话记录

- 用户询问了关于数据库优化的问题
- 讨论了 SQLite WAL 模式的优势
- 确认了测试方案

### 完成任务
- [x] 创建测试脚本
- [x] 验证预压缩刷新功能`,
      longTermMemory: `### 数据库优化最佳实践

- 使用 WAL 模式提高并发性能
- 设置 busy_timeout 避免锁等待
- 定期执行 VACUUM 压缩数据库`,
      shouldSave: true,
    };

    return {
      content: "```json\n" + JSON.stringify(response, null, 2) + "\n```",
    };
  }

  async query(prompt, options) {
    this.callCount++;
    return {
      text: "这是一个关于数据库优化的对话。",
      content: "这是一个关于数据库优化的对话。",
    };
  }
}

async function runTests() {
  let db = null;
  let sessionManager = null;
  let permanentMemory = null;
  let mockLLM = null;

  const testResults = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function recordTest(name, passed, message = "") {
    testResults.tests.push({ name, passed, message });
    if (passed) {
      testResults.passed++;
      logSuccess(`${name}: ${message || "通过"}`);
    } else {
      testResults.failed++;
      logError(`${name}: ${message || "失败"}`);
    }
  }

  try {
    logSection("Pre-Compaction Memory Flush 测试 (Phase 3)");

    // ============================================
    // 1. 初始化测试环境
    // ============================================
    logSection("1. 初始化测试环境");

    const testDbPath = path.join(__dirname, "../data/test-precompaction.db");
    const testMemoryDir = path.join(
      __dirname,
      "../data/test-precompaction-memory",
    );
    const testSessionsDir = path.join(
      __dirname,
      "../data/test-precompaction-sessions",
    );

    // 清理旧测试数据
    try {
      await fs.unlink(testDbPath);
      logInfo("已删除旧测试数据库");
    } catch (err) {
      // 忽略
    }

    try {
      await fs.rm(testMemoryDir, { recursive: true, force: true });
      await fs.rm(testSessionsDir, { recursive: true, force: true });
      logInfo("已清理旧测试目录");
    } catch (err) {
      // 忽略
    }

    // 初始化数据库
    db = new DatabaseManager(testDbPath);
    await db.initialize();
    logSuccess("数据库初始化完成");

    // 运行迁移
    const migrationPath = path.join(
      __dirname,
      "../src/main/database/migrations/009_embedding_cache.sql",
    );
    const migrationSQL = await fs.readFile(migrationPath, "utf-8");
    const cleanedSQL = migrationSQL
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    db.db.exec(cleanedSQL);
    logSuccess("数据库迁移完成");

    // 初始化 Mock LLM
    mockLLM = new MockLLMManager();
    logSuccess("Mock LLM Manager 创建完成");

    // 初始化 PermanentMemoryManager
    permanentMemory = new PermanentMemoryManager({
      memoryDir: testMemoryDir,
      database: db.db,
      enableDailyNotes: true,
      enableLongTermMemory: true,
      enableAutoIndexing: false,
      maxDailyNotesRetention: 30,
    });
    await permanentMemory.initialize();
    logSuccess("PermanentMemoryManager 初始化完成");

    // 初始化 SessionManager
    sessionManager = new SessionManager({
      database: db.db,
      llmManager: mockLLM,
      permanentMemoryManager: permanentMemory,
      sessionsDir: testSessionsDir,
      maxHistoryMessages: 5,
      compressionThreshold: 8,
      enableAutoSave: true,
      enableCompression: true,
      enableMemoryFlush: true,
      enableAutoSummary: false,
      enableBackgroundSummary: false,
    });
    await sessionManager.initialize();
    logSuccess("SessionManager 初始化完成");

    recordTest("初始化测试环境", true);

    // ============================================
    // 2. 测试 buildMemoryExtractionPrompt
    // ============================================
    logSection("2. 测试 buildMemoryExtractionPrompt");

    const testMessages = [
      { role: "user", content: "如何优化 SQLite 数据库性能？" },
      {
        role: "assistant",
        content:
          "可以通过以下方式优化：1. 启用 WAL 模式 2. 添加索引 3. 使用参数化查询",
      },
      { role: "user", content: "什么是 WAL 模式？" },
      {
        role: "assistant",
        content:
          "WAL (Write-Ahead Logging) 是一种日志模式，可以提高并发性能，允许读写同时进行。",
      },
    ];

    const prompt = sessionManager.buildMemoryExtractionPrompt(testMessages);
    const hasUserMessages = prompt.includes("用户");
    const hasAIMessages = prompt.includes("AI");
    const hasPromptStructure = prompt.includes("请从以下对话中提取重要信息");

    recordTest(
      "buildMemoryExtractionPrompt",
      hasUserMessages && hasAIMessages && hasPromptStructure,
      hasUserMessages && hasAIMessages && hasPromptStructure
        ? "Prompt 结构正确"
        : "Prompt 结构不正确",
    );

    logInfo(`  生成的 Prompt 长度: ${prompt.length} 字符`);

    // ============================================
    // 3. 测试 parseMemoryExtraction
    // ============================================
    logSection("3. 测试 parseMemoryExtraction");

    // 测试 JSON 代码块格式
    const jsonResponse =
      '```json\n{"dailyNotes": "测试内容", "longTermMemory": "长期记忆", "shouldSave": true}\n```';
    const parsed1 = sessionManager.parseMemoryExtraction(jsonResponse);

    recordTest(
      "parseMemoryExtraction - JSON代码块",
      parsed1.dailyNotes === "测试内容" && parsed1.shouldSave === true,
      parsed1.dailyNotes === "测试内容" ? "解析正确" : "解析失败",
    );

    // 测试纯 JSON 格式
    const pureJsonResponse =
      '{"dailyNotes": "纯JSON", "longTermMemory": "", "shouldSave": false}';
    const parsed2 = sessionManager.parseMemoryExtraction(pureJsonResponse);

    recordTest(
      "parseMemoryExtraction - 纯JSON",
      parsed2.dailyNotes === "纯JSON" && parsed2.shouldSave === false,
      parsed2.dailyNotes === "纯JSON" ? "解析正确" : "解析失败",
    );

    // 测试无效格式回退
    const invalidResponse = "这不是有效的 JSON 格式";
    const parsed3 = sessionManager.parseMemoryExtraction(invalidResponse);

    recordTest(
      "parseMemoryExtraction - 无效格式回退",
      parsed3.shouldSave === true && parsed3.dailyNotes.length > 0,
      "回退处理正确",
    );

    // ============================================
    // 4. 测试 detectMemorySection
    // ============================================
    logSection("4. 测试 detectMemorySection");

    const testCases = [
      { content: "用户偏好使用中文", expected: "🧑 用户偏好" },
      { content: "架构决策使用微服务", expected: "🏗️ 架构决策" },
      { content: "解决了数据库锁问题", expected: "🐛 常见问题解决方案" },
      { content: "发现了新的优化技巧", expected: "📚 重要技术发现" },
      { content: "系统配置使用环境变量", expected: "🔧 系统配置" },
      { content: "其他内容", expected: "📚 重要技术发现" }, // 默认章节
    ];

    let sectionTestsPassed = 0;
    for (const tc of testCases) {
      const section = sessionManager.detectMemorySection(tc.content);
      if (section === tc.expected) {
        sectionTestsPassed++;
        logInfo(`  ✓ "${tc.content.substring(0, 20)}..." => "${section}"`);
      } else {
        logWarning(
          `  ✗ "${tc.content.substring(0, 20)}..." => "${section}" (期望: "${tc.expected}")`,
        );
      }
    }

    recordTest(
      "detectMemorySection",
      sectionTestsPassed === testCases.length,
      `${sectionTestsPassed}/${testCases.length} 测试通过`,
    );

    // ============================================
    // 5. 测试完整的 flushMemoryBeforeCompaction 流程
    // ============================================
    logSection("5. 测试 flushMemoryBeforeCompaction 完整流程");

    // 创建测试会话
    const session = await sessionManager.createSession({
      conversationId: "test-flush-conv-1",
      title: "测试预压缩刷新",
    });
    logSuccess(`会话已创建: ${session.id}`);

    // 添加测试消息
    for (const msg of testMessages) {
      await sessionManager.addMessage(session.id, msg);
    }
    logSuccess(`添加了 ${testMessages.length} 条消息`);

    // 执行预压缩记忆刷新
    const llmCallsBefore = mockLLM.callCount;
    await sessionManager.flushMemoryBeforeCompaction(session.id);
    const llmCallsAfter = mockLLM.callCount;

    recordTest(
      "flushMemoryBeforeCompaction - LLM调用",
      llmCallsAfter > llmCallsBefore,
      `LLM 调用次数: ${llmCallsAfter - llmCallsBefore}`,
    );

    // 验证 Daily Notes 是否更新
    const today = permanentMemory.getTodayDate();
    const dailyNote = await permanentMemory.readDailyNote(today);

    recordTest(
      "flushMemoryBeforeCompaction - Daily Notes更新",
      dailyNote !== null && dailyNote.length > 0,
      dailyNote ? `Daily Note 长度: ${dailyNote.length}` : "Daily Note 未创建",
    );

    // 验证 MEMORY.md 是否更新
    const memoryContent = await permanentMemory.readMemory();
    const hasNewContent =
      memoryContent.includes("数据库优化") || memoryContent.includes("WAL");

    recordTest(
      "flushMemoryBeforeCompaction - MEMORY.md更新",
      hasNewContent,
      hasNewContent ? "长期记忆已更新" : "长期记忆未更新",
    );

    // ============================================
    // 6. 测试压缩时自动触发记忆刷新
    // ============================================
    logSection("6. 测试压缩时自动触发记忆刷新");

    // 创建新会话并添加足够多的消息触发压缩
    const compressSession = await sessionManager.createSession({
      conversationId: "test-compress-conv-1",
      title: "测试压缩触发刷新",
    });

    // 添加超过压缩阈值的消息
    for (let i = 0; i < 10; i++) {
      await sessionManager.addMessage(compressSession.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `测试消息 ${i + 1}: 这是用于测试压缩的消息内容。`,
      });
    }

    const llmCallsBeforeCompress = mockLLM.callCount;

    // 手动触发压缩
    const compressResult = await sessionManager.compressSession(
      compressSession.id,
    );

    recordTest(
      "压缩触发记忆刷新",
      compressResult.compressed === true,
      compressResult.compressed
        ? `压缩率: ${compressResult.compressionRatio?.toFixed(2) || "N/A"}`
        : "压缩未执行",
    );

    const llmCallsAfterCompress = mockLLM.callCount;
    recordTest(
      "压缩时 LLM 调用",
      llmCallsAfterCompress > llmCallsBeforeCompress,
      `压缩过程中 LLM 调用次数: ${llmCallsAfterCompress - llmCallsBeforeCompress}`,
    );

    // ============================================
    // 7. 测试禁用记忆刷新
    // ============================================
    logSection("7. 测试禁用记忆刷新");

    // 创建禁用记忆刷新的 SessionManager
    const sessionManagerNoFlush = new SessionManager({
      database: db.db,
      llmManager: mockLLM,
      permanentMemoryManager: permanentMemory,
      sessionsDir: testSessionsDir,
      maxHistoryMessages: 5,
      compressionThreshold: 5,
      enableMemoryFlush: false, // 禁用
      enableAutoSummary: false,
      enableBackgroundSummary: false,
    });
    await sessionManagerNoFlush.initialize();

    const noFlushSession = await sessionManagerNoFlush.createSession({
      conversationId: "test-no-flush-conv-1",
      title: "测试禁用刷新",
    });

    for (let i = 0; i < 8; i++) {
      await sessionManagerNoFlush.addMessage(noFlushSession.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `消息 ${i + 1}`,
      });
    }

    const llmCallsBeforeNoFlush = mockLLM.callCount;
    await sessionManagerNoFlush.compressSession(noFlushSession.id);
    const llmCallsAfterNoFlush = mockLLM.callCount;

    // 禁用时应该没有额外的 LLM 调用（除了压缩本身可能的调用）
    recordTest(
      "禁用记忆刷新",
      llmCallsAfterNoFlush === llmCallsBeforeNoFlush ||
        llmCallsAfterNoFlush - llmCallsBeforeNoFlush <= 1,
      `LLM 调用增量: ${llmCallsAfterNoFlush - llmCallsBeforeNoFlush}`,
    );

    sessionManagerNoFlush.destroy();

    // ============================================
    // 8. 测试空消息处理
    // ============================================
    logSection("8. 测试空消息处理");

    const emptySession = await sessionManager.createSession({
      conversationId: "test-empty-conv-1",
      title: "空会话测试",
    });

    const llmCallsBeforeEmpty = mockLLM.callCount;
    await sessionManager.flushMemoryBeforeCompaction(emptySession.id);
    const llmCallsAfterEmpty = mockLLM.callCount;

    recordTest(
      "空消息处理",
      llmCallsAfterEmpty === llmCallsBeforeEmpty,
      "空会话不触发 LLM 调用",
    );

    // ============================================
    // 测试总结
    // ============================================
    logSection("测试总结");

    const totalTests = testResults.passed + testResults.failed;
    const passRate = ((testResults.passed / totalTests) * 100).toFixed(1);

    log(`\n总测试数: ${totalTests}`, "cyan");
    log(`通过: ${testResults.passed}`, "green");
    log(
      `失败: ${testResults.failed}`,
      testResults.failed > 0 ? "red" : "green",
    );
    log(`通过率: ${passRate}%`, passRate === "100.0" ? "green" : "yellow");

    if (testResults.failed === 0) {
      logSuccess("\n所有测试通过!");
    } else {
      logError("\n部分测试失败:");
      testResults.tests
        .filter((t) => !t.passed)
        .forEach((t) => logError(`  - ${t.name}: ${t.message}`));
    }

    logInfo("\n生成的测试文件:");
    logInfo(`  - 数据库: ${testDbPath}`);
    logInfo(`  - 记忆目录: ${testMemoryDir}`);
    logInfo(`  - 会话目录: ${testSessionsDir}`);
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    // 清理
    if (sessionManager) {
      sessionManager.destroy();
    }
    if (permanentMemory) {
      permanentMemory.destroy();
    }
    if (db) {
      db.close();
    }
  }
}

// 运行测试
runTests();
