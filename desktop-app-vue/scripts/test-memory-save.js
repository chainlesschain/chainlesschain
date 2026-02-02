/**
 * 测试脚本: memory:save-to-memory 和 memory:extract-from-conversation
 *
 * 用法: node scripts/test-memory-save.js
 */

const path = require("path");
const fs = require("fs");

// Mock dependencies
const mockDatabase = {
  prepare: (sql) => ({
    run: (...args) => {},
    get: (...args) => ({ count: 0 }),
    all: (...args) => [],
  }),
};

const mockLogger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

// Override require for testing
const originalRequire = require;
require = function (modulePath) {
  if (modulePath.includes("logger")) {
    return { logger: mockLogger };
  }
  if (modulePath.includes("hybrid-search-engine")) {
    return { HybridSearchEngine: class {} };
  }
  if (modulePath.includes("memory-file-watcher")) {
    return { MemoryFileWatcher: class {} };
  }
  if (modulePath.includes("embedding-cache")) {
    return { EmbeddingCache: class {} };
  }
  return originalRequire(modulePath);
};

// Test setup
const testDir = path.join(__dirname, "../test-memory-save-temp");

async function runTests() {
  console.log("=".repeat(60));
  console.log("测试: memory:save-to-memory 和 memory:extract-from-conversation");
  console.log("=".repeat(60));

  // Clean up test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
  fs.mkdirSync(path.join(testDir, "daily"), { recursive: true });

  // Load the manager
  const {
    PermanentMemoryManager,
  } = require("../src/main/llm/permanent-memory-manager");

  // Create instance
  const manager = new PermanentMemoryManager({
    memoryDir: testDir,
    database: mockDatabase,
    enableAutoIndexing: false,
    enableEmbeddingCache: false,
  });

  // Initialize
  await manager.initialize();

  let passed = 0;
  let failed = 0;

  // Test 1: saveToMemory - Daily Notes
  console.log("\n--- Test 1: saveToMemory (daily) ---");
  try {
    const result = await manager.saveToMemory("这是一条测试消息", {
      type: "daily",
    });
    console.log("结果:", result);
    if (result.savedTo === "daily_notes") {
      console.log("✅ PASS: 成功保存到 Daily Notes");
      passed++;
    } else {
      console.log("❌ FAIL: 保存位置错误");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Test 2: saveToMemory - Discovery (MEMORY.md)
  console.log("\n--- Test 2: saveToMemory (discovery) ---");
  try {
    const result = await manager.saveToMemory("发现了一个重要的技术点", {
      type: "discovery",
    });
    console.log("结果:", result);
    if (result.savedTo === "memory_md" && result.section.includes("技术发现")) {
      console.log("✅ PASS: 成功保存到 MEMORY.md");
      passed++;
    } else {
      console.log("❌ FAIL: 保存位置或章节错误");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Test 3: extractFromConversation
  console.log("\n--- Test 3: extractFromConversation ---");
  try {
    const messages = [
      { role: "user", content: "请帮我解释一下 JavaScript 的闭包" },
      {
        role: "assistant",
        content:
          "闭包是指函数能够记住并访问其词法作用域，即使函数在其词法作用域之外执行。",
      },
      { role: "user", content: "能给个例子吗？" },
      {
        role: "assistant",
        content: "```javascript\nfunction outer() {\n  let count = 0;\n  return function inner() {\n    return ++count;\n  };\n}\nconst counter = outer();\nconsole.log(counter()); // 1\nconsole.log(counter()); // 2\n```",
      },
    ];

    const result = await manager.extractFromConversation(
      messages,
      "JavaScript 闭包讨论"
    );
    console.log("结果:", result);
    if (result.savedTo === "daily_notes" && result.messageCount === 4) {
      console.log("✅ PASS: 成功提取对话并保存");
      passed++;
    } else {
      console.log("❌ FAIL: 提取结果不正确");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Test 4: getMemorySections
  console.log("\n--- Test 4: getMemorySections ---");
  try {
    const sections = await manager.getMemorySections();
    console.log("章节数:", sections.length);
    console.log("章节列表:", sections.map((s) => s.title));
    if (sections.length >= 5) {
      console.log("✅ PASS: 成功获取章节列表");
      passed++;
    } else {
      console.log("❌ FAIL: 章节数量不足");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Test 5: Verify Daily Note content
  console.log("\n--- Test 5: 验证 Daily Note 内容 ---");
  try {
    const today = manager.getTodayDate();
    const content = await manager.readDailyNote(today);
    console.log("Daily Note 长度:", content?.length || 0);
    if (content && content.includes("测试消息") && content.includes("闭包")) {
      console.log("✅ PASS: Daily Note 内容正确");
      passed++;
    } else {
      console.log("❌ FAIL: Daily Note 内容不完整");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Test 6: Verify MEMORY.md content
  console.log("\n--- Test 6: 验证 MEMORY.md 内容 ---");
  try {
    const content = await manager.readMemory();
    console.log("MEMORY.md 长度:", content?.length || 0);
    if (content && content.includes("技术点")) {
      console.log("✅ PASS: MEMORY.md 内容正确");
      passed++;
    } else {
      console.log("❌ FAIL: MEMORY.md 内容不完整");
      failed++;
    }
  } catch (error) {
    console.log("❌ FAIL:", error.message);
    failed++;
  }

  // Cleanup
  console.log("\n--- 清理测试目录 ---");
  try {
    fs.rmSync(testDir, { recursive: true });
    console.log("测试目录已清理");
  } catch (error) {
    console.log("清理失败:", error.message);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error("测试运行失败:", error);
  process.exit(1);
});
