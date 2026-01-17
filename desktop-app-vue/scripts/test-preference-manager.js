#!/usr/bin/env node

/**
 * PreferenceManager 测试脚本
 *
 * 测试内容：
 * 1. 初始化
 * 2. 偏好设置 CRUD
 * 3. 分类操作
 * 4. 使用历史记录
 * 5. 搜索历史
 * 6. 备份和恢复
 * 7. 统计信息
 * 8. 清理功能
 *
 * 运行方式: node scripts/test-preference-manager.js
 */

const path = require("path");
const fs = require("fs");

// 设置测试环境
process.env.NODE_ENV = "test";

async function runTests() {
  console.log("=".repeat(70));
  console.log("PreferenceManager 功能测试");
  console.log("=".repeat(70));
  console.log("");

  let testDbPath, testPrefsDir, db, preferenceManager;
  let passed = 0;
  let failed = 0;

  try {
    // 1. 初始化数据库
    console.log("[1/8] 初始化测试数据库...");
    const DatabaseManager = require("../src/main/database");
    testDbPath = path.join(__dirname, "..", "test-preference.db");
    testPrefsDir = path.join(__dirname, "..", "test-preferences");

    // 删除旧的测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除旧的测试数据库");
    }

    // 删除旧的测试目录
    if (fs.existsSync(testPrefsDir)) {
      fs.rmSync(testPrefsDir, { recursive: true });
      console.log("  ✓ 已删除旧的测试目录");
    }

    db = new DatabaseManager(testDbPath);
    await db.initialize();
    console.log("  ✓ 数据库初始化成功");
    passed++;
    console.log("");

    // 2. 初始化 PreferenceManager
    console.log("[2/8] 初始化 PreferenceManager...");
    const {
      PreferenceManager,
    } = require("../src/main/memory/preference-manager");

    preferenceManager = new PreferenceManager({
      database: db,
      preferencesDir: testPrefsDir,
    });

    await preferenceManager.initialize();
    console.log("  ✓ PreferenceManager 初始化成功");
    passed++;
    console.log("");

    // 3. 测试偏好设置 CRUD
    console.log("[3/8] 测试偏好设置 CRUD...");

    // Set
    await preferenceManager.set("ui", "theme", "dark");
    await preferenceManager.set("ui", "fontSize", 14);
    await preferenceManager.set("feature", "autoSave", true);
    await preferenceManager.set("llm", "model", "qwen2:7b");
    console.log("  ✓ 设置偏好成功");

    // Get
    const theme = await preferenceManager.get("ui", "theme");
    if (theme !== "dark") {
      throw new Error(`Expected 'dark', got '${theme}'`);
    }
    console.log("  ✓ 获取偏好成功: theme =", theme);

    const fontSize = await preferenceManager.get("ui", "fontSize");
    if (fontSize !== 14) {
      throw new Error(`Expected 14, got ${fontSize}`);
    }
    console.log("  ✓ 获取偏好成功: fontSize =", fontSize);

    // Default value
    const unknown = await preferenceManager.get("ui", "unknown", "default");
    if (unknown !== "default") {
      throw new Error(`Expected 'default', got '${unknown}'`);
    }
    console.log("  ✓ 默认值测试成功");

    // Delete
    await preferenceManager.delete("feature", "autoSave");
    const deleted = await preferenceManager.get("feature", "autoSave");
    if (deleted !== null) {
      throw new Error(`Expected null after delete, got '${deleted}'`);
    }
    console.log("  ✓ 删除偏好成功");

    passed++;
    console.log("");

    // 4. 测试分类操作
    console.log("[4/8] 测试分类操作...");

    // Get category
    const uiPrefs = await preferenceManager.getCategory("ui");
    console.log("  UI 偏好:", uiPrefs);
    if (!uiPrefs.theme || !uiPrefs.fontSize) {
      throw new Error("分类获取失败");
    }
    console.log("  ✓ 获取分类成功");

    // Set category
    await preferenceManager.setCategory("search", {
      fuzzyMatch: true,
      maxHistory: 100,
      includeContent: true,
    });
    const searchPrefs = await preferenceManager.getCategory("search");
    if (!searchPrefs.fuzzyMatch || searchPrefs.maxHistory !== 100) {
      throw new Error("批量设置分类失败");
    }
    console.log("  ✓ 批量设置分类成功");

    // Get all
    const allPrefs = await preferenceManager.getAll();
    console.log("  所有偏好分类:", Object.keys(allPrefs));
    if (!allPrefs.ui || !allPrefs.search) {
      throw new Error("获取所有偏好失败");
    }
    console.log("  ✓ 获取所有偏好成功");

    passed++;
    console.log("");

    // 5. 测试使用历史记录
    console.log("[5/8] 测试使用历史记录...");

    // Record usage
    await preferenceManager.recordUsage("knowledge-base", {
      action: "create",
      metadata: { title: "测试笔记" },
      durationMs: 150,
      success: true,
    });
    await preferenceManager.recordUsage("ai-chat", {
      action: "query",
      durationMs: 500,
    });
    await preferenceManager.recordUsage("knowledge-base", {
      action: "search",
      durationMs: 50,
    });
    console.log("  ✓ 记录使用历史成功");

    // Get history
    const history = await preferenceManager.getRecentHistory({ limit: 10 });
    if (history.length < 3) {
      throw new Error(`Expected at least 3 records, got ${history.length}`);
    }
    console.log("  ✓ 获取历史记录成功: 共", history.length, "条");

    // Get usage stats
    const stats = await preferenceManager.getUsageStats({ days: 7 });
    console.log("  使用统计:", stats.features.length, "个功能");
    console.log("  ✓ 获取使用统计成功");

    passed++;
    console.log("");

    // 6. 测试搜索历史
    console.log("[6/8] 测试搜索历史...");

    // Add search history
    await preferenceManager.addSearchHistory("数据库优化", {
      context: "knowledge-base",
      resultCount: 5,
      selectedResult: "如何优化SQLite查询",
      selectedPosition: 1,
    });
    await preferenceManager.addSearchHistory("React hooks", {
      context: "knowledge-base",
      resultCount: 10,
    });
    await preferenceManager.addSearchHistory("数据库索引", {
      context: "knowledge-base",
      resultCount: 3,
    });
    console.log("  ✓ 添加搜索历史成功");

    // Get search history
    const searchHistory = await preferenceManager.getSearchHistory({
      limit: 10,
    });
    if (searchHistory.length < 3) {
      throw new Error(
        `Expected at least 3 searches, got ${searchHistory.length}`,
      );
    }
    console.log("  ✓ 获取搜索历史成功: 共", searchHistory.length, "条");

    // Get suggestions
    const suggestions = await preferenceManager.getSearchSuggestions("数据库");
    console.log(
      "  搜索建议:",
      suggestions.map((s) => s.query),
    );
    if (suggestions.length < 2) {
      throw new Error(
        `Expected at least 2 suggestions, got ${suggestions.length}`,
      );
    }
    console.log("  ✓ 获取搜索建议成功");

    passed++;
    console.log("");

    // 7. 测试备份和恢复
    console.log("[7/8] 测试备份和恢复...");

    // Backup
    const backupResult = await preferenceManager.backupAll();
    if (!backupResult.success) {
      throw new Error("备份失败");
    }
    console.log("  ✓ 备份成功:", Object.keys(backupResult.categories));

    // Check files exist
    const uiBackup = path.join(testPrefsDir, "ui.json");
    if (!fs.existsSync(uiBackup)) {
      throw new Error("备份文件不存在");
    }
    console.log("  ✓ 备份文件已创建");

    // Restore (without overwrite)
    const restoreResult = await preferenceManager.restoreFromBackup({
      overwrite: false,
    });
    if (!restoreResult.success) {
      throw new Error("恢复失败");
    }
    console.log("  ✓ 恢复功能测试成功");

    passed++;
    console.log("");

    // 8. 测试统计和清理
    console.log("[8/8] 测试统计和清理...");

    // Get stats
    const prefStats = await preferenceManager.getStats();
    console.log("  统计信息:");
    console.log("    偏好总数:", prefStats.preferences?.total);
    console.log("    使用历史:", prefStats.usageHistory);
    console.log("    搜索历史:", prefStats.searchHistory);
    console.log("    缓存大小:", prefStats.cacheSize);
    console.log("  ✓ 获取统计成功");

    // Cleanup
    const cleanupResult = await preferenceManager.cleanup({
      usageHistoryDays: 90,
      searchHistoryDays: 30,
    });
    console.log("  ✓ 清理功能测试成功");

    // Clear cache
    preferenceManager.clearCache();
    console.log("  ✓ 缓存清理成功");

    passed++;
    console.log("");

    // 测试总结
    console.log("=".repeat(70));
    console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
    console.log("=".repeat(70));
  } catch (error) {
    failed++;
    console.error("");
    console.error("❌ 测试失败:", error.message);
    console.error(error.stack);
    console.log("");
    console.log("=".repeat(70));
    console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
    console.log("=".repeat(70));
    process.exit(1);
  } finally {
    // 清理测试文件
    console.log("");
    console.log("清理测试文件...");
    try {
      if (db) {
        db.close();
      }
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
        console.log("  ✓ 已删除测试数据库");
      }
      if (fs.existsSync(testPrefsDir)) {
        fs.rmSync(testPrefsDir, { recursive: true });
        console.log("  ✓ 已删除测试目录");
      }
    } catch (e) {
      console.error("  清理失败:", e.message);
    }
  }
}

// 运行测试
runTests().catch((error) => {
  console.error("测试脚本执行失败:", error);
  process.exit(1);
});
