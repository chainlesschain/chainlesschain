/**
 * MemoryFileWatcher 测试脚本
 *
 * 测试文件监听和自动索引功能 (Phase 5)
 *
 * 运行方式:
 * cd desktop-app-vue
 * node scripts/test-memory-file-watcher.js
 */

const path = require("path");
const fs = require("fs").promises;

// 设置环境变量
process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB = "1";

const { MemoryFileWatcher } = require("../src/main/llm/memory-file-watcher.js");
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

function logSection(message) {
  log(`\n${"=".repeat(60)}`, "blue");
  log(message, "blue");
  log("=".repeat(60), "blue");
}

// 延迟函数
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  let db = null;
  let watcher = null;

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

  const testMemoryDir = path.join(__dirname, "../data/test-memory-watcher");

  try {
    logSection("MemoryFileWatcher 测试 (Phase 5)");

    // ============================================
    // 1. 初始化测试环境
    // ============================================
    logSection("1. 初始化测试环境");

    const testDbPath = path.join(__dirname, "../data/test-memory-watcher.db");

    // 删除旧测试数据
    try {
      await fs.unlink(testDbPath);
      logInfo("已删除旧测试数据库");
    } catch (err) {
      // 忽略
    }

    try {
      await fs.rm(testMemoryDir, { recursive: true, force: true });
      logInfo("已清理旧测试目录");
    } catch (err) {
      // 忽略
    }

    // 创建测试目录
    await fs.mkdir(testMemoryDir, { recursive: true });
    await fs.mkdir(path.join(testMemoryDir, "daily"), { recursive: true });

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

    // 创建初始测试文件
    await fs.writeFile(
      path.join(testMemoryDir, "MEMORY.md"),
      "# 测试长期记忆\n\n初始内容。",
      "utf-8",
    );

    await fs.writeFile(
      path.join(testMemoryDir, "daily", "2026-02-01.md"),
      "# 2026-02-01 运行日志\n\n初始内容。",
      "utf-8",
    );

    logSuccess("测试文件创建完成");

    recordTest("初始化测试环境", true);

    // ============================================
    // 2. 创建并启动文件监听器
    // ============================================
    logSection("2. 创建并启动文件监听器");

    let changeEvents = [];
    let indexNeededEvents = [];

    watcher = new MemoryFileWatcher({
      memoryDir: testMemoryDir,
      database: db.db,
      debounceMs: 500, // 测试时使用更短的防抖
      ignoreInitial: true,
      onChangeCallback: async (event, filePath, relativePath) => {
        changeEvents.push({ event, relativePath, timestamp: Date.now() });
        logInfo(`  收到变更事件: ${event} - ${relativePath}`);
      },
    });

    watcher.on("index-needed", (data) => {
      indexNeededEvents.push(data);
      logInfo(`  收到索引需求: ${data.relativePath}`);
    });

    watcher.on("ready", () => {
      logInfo("  监听器就绪事件已触发");
    });

    await watcher.start();
    await delay(500); // 等待监听器就绪

    recordTest("启动文件监听器", watcher.isWatching, "监听器已启动");

    // ============================================
    // 3. 测试文件创建检测
    // ============================================
    logSection("3. 测试文件创建检测");

    changeEvents = [];
    indexNeededEvents = [];

    const newFilePath = path.join(testMemoryDir, "daily", "2026-02-02.md");
    await fs.writeFile(
      newFilePath,
      "# 2026-02-02 运行日志\n\n新建的日志文件。",
      "utf-8",
    );

    // 等待防抖和处理
    await delay(1000);

    const createDetected = changeEvents.some(
      (e) => e.event === "add" && e.relativePath.includes("2026-02-02"),
    );
    recordTest(
      "检测文件创建",
      createDetected,
      createDetected ? "检测到文件创建" : "未检测到文件创建",
    );

    // ============================================
    // 4. 测试文件修改检测
    // ============================================
    logSection("4. 测试文件修改检测");

    changeEvents = [];
    indexNeededEvents = [];

    const modifyFilePath = path.join(testMemoryDir, "MEMORY.md");
    const originalContent = await fs.readFile(modifyFilePath, "utf-8");
    await fs.writeFile(
      modifyFilePath,
      originalContent + "\n\n## 新添加的内容\n\n这是修改后的内容。",
      "utf-8",
    );

    // 等待防抖和处理
    await delay(1000);

    const modifyDetected = changeEvents.some(
      (e) => e.event === "change" && e.relativePath === "MEMORY.md",
    );
    recordTest(
      "检测文件修改",
      modifyDetected,
      modifyDetected ? "检测到文件修改" : "未检测到文件修改",
    );

    // ============================================
    // 5. 测试文件删除检测
    // ============================================
    logSection("5. 测试文件删除检测");

    changeEvents = [];

    // 创建一个临时文件然后删除
    const tempFilePath = path.join(testMemoryDir, "temp.md");
    await fs.writeFile(tempFilePath, "临时文件", "utf-8");
    await delay(1000);

    changeEvents = [];
    await fs.unlink(tempFilePath);
    await delay(1000);

    const deleteDetected = changeEvents.some((e) => e.event === "unlink");
    recordTest(
      "检测文件删除",
      deleteDetected,
      deleteDetected ? "检测到文件删除" : "未检测到文件删除",
    );

    // ============================================
    // 6. 测试目录扫描
    // ============================================
    logSection("6. 测试目录扫描");

    const scanResult = await watcher.scanDirectory();
    logInfo(`  扫描到 ${scanResult.length} 个需要索引的文件`);

    scanResult.forEach((file) => {
      logInfo(`    - ${file.relativePath} (${file.fileSize} bytes)`);
    });

    recordTest(
      "目录扫描",
      scanResult.length > 0,
      `扫描到 ${scanResult.length} 个文件`,
    );

    // ============================================
    // 7. 测试统计信息
    // ============================================
    logSection("7. 测试统计信息");

    const stats = watcher.getStats();
    logInfo(`  监听状态: ${stats.isWatching ? "运行中" : "已停止"}`);
    logInfo(`  监听目录: ${stats.memoryDir}`);
    logInfo(`  检测到变更: ${stats.changesDetected} 次`);
    logInfo(`  错误次数: ${stats.errors}`);
    logInfo(`  运行时间: ${stats.runningTime}`);

    recordTest("统计信息", stats.isWatching === true, "统计信息正确");

    // ============================================
    // 8. 测试索引状态更新
    // ============================================
    logSection("8. 测试索引状态更新");

    watcher.updateIndexStatus("MEMORY.md", "indexed", 3);
    watcher.updateIndexStatus("daily/2026-02-01.md", "indexed", 2);

    const indexedFiles = watcher.getIndexedFiles();
    logInfo(`  已索引文件数: ${indexedFiles.length}`);

    recordTest(
      "索引状态更新",
      indexedFiles.length >= 2,
      `${indexedFiles.length} 个文件已索引`,
    );

    // ============================================
    // 9. 测试忽略非 Markdown 文件
    // ============================================
    logSection("9. 测试忽略非 Markdown 文件");

    changeEvents = [];

    // 创建非 Markdown 文件
    await fs.writeFile(
      path.join(testMemoryDir, "test.json"),
      '{"test": true}',
      "utf-8",
    );

    await delay(1000);

    // 应该没有检测到变更（因为不是 Markdown）
    const nonMdDetected = changeEvents.some((e) =>
      e.relativePath.includes(".json"),
    );
    recordTest(
      "忽略非 Markdown 文件",
      !nonMdDetected,
      "非 Markdown 文件被忽略",
    );

    // 清理
    await fs.unlink(path.join(testMemoryDir, "test.json"));

    // ============================================
    // 10. 测试停止监听
    // ============================================
    logSection("10. 测试停止监听");

    await watcher.stop();
    recordTest("停止文件监听", watcher.isWatching === false, "监听器已停止");

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
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    // 清理
    if (watcher) {
      await watcher.destroy();
    }
    if (db) {
      db.close();
    }

    // 清理测试目录
    try {
      await fs.rm(testMemoryDir, { recursive: true, force: true });
    } catch (err) {
      // 忽略
    }
  }
}

// 运行测试
runTests();
