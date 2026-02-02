/**
 * EmbeddingCache 测试脚本
 *
 * 测试持久化 Embedding 缓存功能 (Phase 4)
 *
 * 运行方式:
 * cd desktop-app-vue
 * node scripts/test-embedding-cache.js
 */

const path = require("path");
const fs = require("fs").promises;

// 设置环境变量
process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB = "1";

const { EmbeddingCache } = require("../src/main/rag/embedding-cache.js");
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

// 生成模拟 Embedding
function generateMockEmbedding(dimension = 384) {
  const embedding = [];
  for (let i = 0; i < dimension; i++) {
    embedding.push(Math.random() * 2 - 1); // -1 到 1 之间的随机数
  }
  return embedding;
}

async function runTests() {
  let db = null;
  let cache = null;

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
    logSection("EmbeddingCache 测试 (Phase 4)");

    // ============================================
    // 1. 初始化测试环境
    // ============================================
    logSection("1. 初始化测试环境");

    const testDbPath = path.join(__dirname, "../data/test-embedding-cache.db");

    // 删除旧测试数据库
    try {
      await fs.unlink(testDbPath);
      logInfo("已删除旧测试数据库");
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

    // 初始化 EmbeddingCache
    cache = new EmbeddingCache({
      database: db.db,
      maxCacheSize: 1000,
      cacheExpiration: 24 * 60 * 60 * 1000, // 1天（测试用）
      enableAutoCleanup: false, // 测试时禁用自动清理
      storeOriginalContent: true, // 测试时存储原始内容
    });
    logSuccess("EmbeddingCache 初始化完成");

    recordTest("初始化测试环境", true);

    // ============================================
    // 2. 测试序列化/反序列化
    // ============================================
    logSection("2. 测试序列化/反序列化");

    const testEmbedding = generateMockEmbedding(384);
    const serialized = cache.serializeEmbedding(testEmbedding);
    const deserialized = cache.deserializeEmbedding(serialized);

    // 验证维度
    const dimensionMatch = deserialized.length === testEmbedding.length;

    // 验证值（允许浮点误差）
    let valuesMatch = true;
    for (let i = 0; i < testEmbedding.length; i++) {
      if (Math.abs(deserialized[i] - testEmbedding[i]) > 1e-6) {
        valuesMatch = false;
        break;
      }
    }

    recordTest(
      "序列化/反序列化",
      dimensionMatch && valuesMatch,
      `维度: ${deserialized.length}, Buffer大小: ${serialized.length} bytes`,
    );

    // ============================================
    // 3. 测试 set 和 get
    // ============================================
    logSection("3. 测试 set 和 get");

    const testContent1 = "这是测试文本1，用于验证 EmbeddingCache 功能。";
    const testContent2 = "这是测试文本2，另一段不同的内容。";
    const embedding1 = generateMockEmbedding(384);
    const embedding2 = generateMockEmbedding(768);

    // 设置缓存
    const setResult1 = cache.set(testContent1, embedding1, "qwen2:7b");
    const setResult2 = cache.set(
      testContent2,
      embedding2,
      "text-embedding-ada-002",
    );

    recordTest("set 操作", setResult1 && setResult2, "两条缓存设置成功");

    // 获取缓存
    const retrieved1 = cache.get(testContent1, "qwen2:7b");
    const retrieved2 = cache.get(testContent2, "text-embedding-ada-002");

    const getResult1 = retrieved1 && retrieved1.length === embedding1.length;
    const getResult2 = retrieved2 && retrieved2.length === embedding2.length;

    recordTest(
      "get 操作",
      getResult1 && getResult2,
      `缓存1: ${retrieved1?.length || 0}维, 缓存2: ${retrieved2?.length || 0}维`,
    );

    // ============================================
    // 4. 测试缓存未命中
    // ============================================
    logSection("4. 测试缓存未命中");

    const nonExistent = cache.get("不存在的内容", "any-model");
    recordTest("缓存未命中", nonExistent === null, "返回 null");

    // 测试错误的模型
    const wrongModel = cache.get(testContent1, "wrong-model");
    recordTest("错误模型未命中", wrongModel === null, "返回 null");

    // ============================================
    // 5. 测试 has 方法
    // ============================================
    logSection("5. 测试 has 方法");

    const hasExisting = cache.has(testContent1, "qwen2:7b");
    const hasNonExisting = cache.has("不存在", "any-model");

    recordTest(
      "has 方法",
      hasExisting === true && hasNonExisting === false,
      `存在: ${hasExisting}, 不存在: ${hasNonExisting}`,
    );

    // ============================================
    // 6. 测试批量操作
    // ============================================
    logSection("6. 测试批量操作");

    const batchItems = [];
    for (let i = 0; i < 10; i++) {
      batchItems.push({
        content: `批量测试内容 ${i}`,
        embedding: generateMockEmbedding(384),
        model: "batch-model",
      });
    }

    const batchSetCount = cache.setMultiple(batchItems);
    recordTest(
      "批量 set",
      batchSetCount === 10,
      `成功设置 ${batchSetCount} 条`,
    );

    // 批量获取
    const batchGetItems = batchItems.map((item) => ({
      content: item.content,
      model: "batch-model",
    }));
    const batchGetResults = cache.getMultiple(batchGetItems);
    recordTest(
      "批量 get",
      batchGetResults.size === 10,
      `成功获取 ${batchGetResults.size} 条`,
    );

    // ============================================
    // 7. 测试统计信息
    // ============================================
    logSection("7. 测试统计信息");

    const stats = cache.getStats();
    logInfo(`  缓存条目数: ${stats.count}`);
    logInfo(`  总大小: ${stats.totalSizeMB} MB`);
    logInfo(`  命中次数: ${stats.hits}`);
    logInfo(`  未命中次数: ${stats.misses}`);
    logInfo(`  命中率: ${stats.hitRate}`);
    logInfo(`  按模型统计:`);
    stats.byModel.forEach((m) => {
      logInfo(`    - ${m.model}: ${m.count} 条, ${m.sizeMB} MB`);
    });

    recordTest("统计信息", stats.count > 0, `共 ${stats.count} 条缓存`);

    // ============================================
    // 8. 测试 LRU 驱逐
    // ============================================
    logSection("8. 测试 LRU 驱逐");

    const countBefore = cache.getCount();
    const evicted = cache.evictLRU(5);
    const countAfter = cache.getCount();

    recordTest(
      "LRU 驱逐",
      evicted > 0 && countAfter < countBefore,
      `驱逐 ${evicted} 条, 剩余 ${countAfter} 条`,
    );

    // ============================================
    // 9. 测试删除
    // ============================================
    logSection("9. 测试删除");

    const deleteResult = cache.delete(testContent1);
    const afterDelete = cache.get(testContent1, "qwen2:7b");

    recordTest(
      "删除缓存",
      deleteResult === true && afterDelete === null,
      "删除成功，获取返回 null",
    );

    // ============================================
    // 10. 测试 content hash
    // ============================================
    logSection("10. 测试 content hash");

    const hash1 = cache.hashContent("相同的内容");
    const hash2 = cache.hashContent("相同的内容");
    const hash3 = cache.hashContent("不同的内容");

    const hashConsistent = hash1 === hash2;
    const hashUnique = hash1 !== hash3;

    recordTest(
      "Content Hash",
      hashConsistent && hashUnique,
      `一致性: ${hashConsistent}, 唯一性: ${hashUnique}`,
    );

    logInfo(`  Hash 1: ${hash1.substring(0, 16)}...`);
    logInfo(`  Hash 2: ${hash2.substring(0, 16)}...`);
    logInfo(`  Hash 3: ${hash3.substring(0, 16)}...`);

    // ============================================
    // 11. 测试清空缓存
    // ============================================
    logSection("11. 测试清空缓存");

    const countBeforeClear = cache.getCount();
    const cleared = cache.clear();
    const countAfterClear = cache.getCount();

    recordTest(
      "清空缓存",
      countAfterClear === 0,
      `清除 ${cleared} 条, 剩余 ${countAfterClear} 条`,
    );

    // ============================================
    // 12. 性能测试
    // ============================================
    logSection("12. 性能测试");

    // 批量插入性能
    const perfItems = [];
    for (let i = 0; i < 100; i++) {
      perfItems.push({
        content: `性能测试内容 ${i} - ${Date.now()}`,
        embedding: generateMockEmbedding(384),
        model: "perf-test",
      });
    }

    const insertStart = Date.now();
    cache.setMultiple(perfItems);
    const insertTime = Date.now() - insertStart;

    logInfo(`  批量插入 100 条: ${insertTime}ms`);

    // 批量查询性能
    const queryStart = Date.now();
    for (let i = 0; i < 100; i++) {
      cache.get(perfItems[i].content, "perf-test");
    }
    const queryTime = Date.now() - queryStart;

    logInfo(`  批量查询 100 次: ${queryTime}ms`);
    logInfo(`  平均查询延迟: ${(queryTime / 100).toFixed(2)}ms`);

    recordTest(
      "性能测试",
      insertTime < 5000 && queryTime < 1000,
      `插入: ${insertTime}ms, 查询: ${queryTime}ms`,
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
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    // 清理
    if (cache) {
      cache.destroy();
    }
    if (db) {
      db.close();
    }
  }
}

// 运行测试
runTests();
