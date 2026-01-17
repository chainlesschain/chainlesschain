#!/usr/bin/env node

/**
 * LearnedPatternManager 测试脚本
 *
 * 测试内容：
 * 1. 初始化
 * 2. 提示词模式
 * 3. 错误修复模式
 * 4. 代码片段
 * 5. 工作流模式
 * 6. 统计和备份
 *
 * 运行方式: node scripts/test-learned-pattern-manager.js
 */

const path = require("path");
const fs = require("fs");

// 设置测试环境
process.env.NODE_ENV = "test";

async function runTests() {
  console.log("=".repeat(70));
  console.log("LearnedPatternManager 功能测试");
  console.log("=".repeat(70));
  console.log("");

  let testDbPath, testPatternsDir, db, learnedPatternManager;
  let passed = 0;
  let failed = 0;

  try {
    // 1. 初始化数据库
    console.log("[1/6] 初始化测试数据库...");
    const DatabaseManager = require("../src/main/database");
    testDbPath = path.join(__dirname, "..", "test-patterns.db");
    testPatternsDir = path.join(__dirname, "..", "test-learned-patterns");

    // 删除旧的测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除旧的测试数据库");
    }

    // 删除旧的测试目录
    if (fs.existsSync(testPatternsDir)) {
      fs.rmSync(testPatternsDir, { recursive: true });
      console.log("  ✓ 已删除旧的测试目录");
    }

    db = new DatabaseManager(testDbPath);
    await db.initialize();
    console.log("  ✓ 数据库初始化成功");
    passed++;
    console.log("");

    // 2. 初始化 LearnedPatternManager
    console.log("[2/6] 初始化 LearnedPatternManager...");
    const {
      LearnedPatternManager,
    } = require("../src/main/memory/learned-pattern-manager");

    learnedPatternManager = new LearnedPatternManager({
      database: db,
      patternsDir: testPatternsDir,
      llmManager: null, // 测试时不需要真实的 LLM Manager
      errorMonitor: null,
    });

    await learnedPatternManager.initialize();
    console.log("  ✓ LearnedPatternManager 初始化成功");
    passed++;
    console.log("");

    // 3. 测试提示词模式
    console.log("[3/6] 测试提示词模式...");

    // Record prompt pattern
    const prompt1 = await learnedPatternManager.recordPromptPattern({
      template: "请用简洁的语言解释 {{concept}}",
      category: "coding",
      tags: ["解释", "简洁"],
      preferredModel: "qwen2:7b",
      exampleInput: "什么是闭包？",
      exampleOutput: "闭包是一个函数和它引用的外部变量的组合...",
    });
    console.log("  ✓ 创建提示词模式成功: ID =", prompt1.id);

    const prompt2 = await learnedPatternManager.recordPromptPattern({
      template: "分析以下代码的性能问题:\n```\n{{code}}\n```",
      category: "coding",
      tags: ["代码分析", "性能"],
    });
    console.log("  ✓ 创建第二个提示词模式成功");

    // Update usage
    await learnedPatternManager.updatePromptPatternUsage(prompt1.id, {
      success: true,
      quality: 0.9,
    });
    console.log("  ✓ 更新使用统计成功");

    // Get suggestions
    const promptSuggestions = await learnedPatternManager.getPromptSuggestions({
      category: "coding",
      limit: 5,
    });
    console.log("  提示词建议:", promptSuggestions.length, "个");
    if (promptSuggestions.length < 2) {
      throw new Error(
        `Expected at least 2 prompts, got ${promptSuggestions.length}`,
      );
    }
    console.log("  ✓ 获取提示词建议成功");

    // Search
    const searchResults =
      await learnedPatternManager.searchPromptPatterns("解释");
    console.log("  搜索结果:", searchResults.length, "个");
    console.log("  ✓ 搜索提示词成功");

    passed++;
    console.log("");

    // 4. 测试错误修复模式
    console.log("[4/6] 测试错误修复模式...");

    // Record error fix
    const errorFix1 = await learnedPatternManager.recordErrorFix({
      errorPattern: "SQLITE_BUSY",
      errorClassification: "DATABASE",
      errorMessageSample: "SQLITE_BUSY: database is locked",
      fixStrategy: "retry",
      fixSteps: ["等待 100ms", "重试操作", "最多重试 3 次"],
      success: true,
      source: "user",
    });
    console.log("  ✓ 创建错误修复模式成功: ID =", errorFix1.id);

    const errorFix2 = await learnedPatternManager.recordErrorFix({
      errorPattern: "ECONNREFUSED",
      errorClassification: "NETWORK",
      fixStrategy: "fallback",
      fixSteps: ["检查网络连接", "使用本地缓存", "通知用户"],
      success: true,
    });
    console.log("  ✓ 创建第二个错误修复模式成功");

    // Record same pattern again (should update existing)
    const updated = await learnedPatternManager.recordErrorFix({
      errorPattern: "SQLITE_BUSY",
      fixStrategy: "retry",
      success: true,
    });
    if (updated.updated) {
      console.log("  ✓ 更新已存在的模式成功");
    }

    // Get suggestions
    const errorSuggestions = await learnedPatternManager.getErrorFixSuggestions(
      {
        classification: "DATABASE",
        message: "SQLITE_BUSY error occurred",
      },
    );
    console.log("  错误修复建议:", errorSuggestions.length, "个");
    console.log("  ✓ 获取错误修复建议成功");

    passed++;
    console.log("");

    // 5. 测试代码片段
    console.log("[5/6] 测试代码片段...");

    // Save snippet
    const snippet1 = await learnedPatternManager.saveCodeSnippet({
      title: "Vue3 组合式 API 模板",
      description: "一个标准的 Vue3 组合式 API 组件模板",
      language: "vue",
      code: `<script setup>
import { ref, computed, onMounted } from 'vue';

const count = ref(0);
const doubleCount = computed(() => count.value * 2);

onMounted(() => {
  console.log('Component mounted');
});
</script>

<template>
  <div>{{ count }} x 2 = {{ doubleCount }}</div>
</template>`,
      tags: ["vue3", "composition-api", "template"],
      source: "manual",
    });
    console.log("  ✓ 保存代码片段成功: ID =", snippet1.id);

    const snippet2 = await learnedPatternManager.saveCodeSnippet({
      title: "Node.js 错误处理中间件",
      language: "javascript",
      code: `app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});`,
      tags: ["nodejs", "express", "error-handling"],
    });
    console.log("  ✓ 保存第二个代码片段成功");

    // Use snippet
    await learnedPatternManager.useCodeSnippet(snippet1.id);
    console.log("  ✓ 记录使用成功");

    // Toggle favorite
    const isFavorite = await learnedPatternManager.toggleSnippetFavorite(
      snippet1.id,
    );
    console.log("  ✓ 切换收藏状态:", isFavorite);

    // Get snippets
    const snippets = await learnedPatternManager.getCodeSnippets({
      language: "vue",
    });
    console.log("  Vue 代码片段:", snippets.length, "个");
    console.log("  ✓ 获取代码片段成功");

    // Get favorites
    const favorites = await learnedPatternManager.getCodeSnippets({
      favoritesOnly: true,
    });
    console.log("  收藏的片段:", favorites.length, "个");
    console.log("  ✓ 获取收藏成功");

    passed++;
    console.log("");

    // 6. 测试工作流模式和统计
    console.log("[6/6] 测试工作流模式和统计...");

    // Record workflow
    const workflow1 = await learnedPatternManager.recordWorkflow({
      name: "创建新功能",
      description: "标准的功能开发流程",
      category: "development",
      steps: [
        { name: "需求分析", description: "理解功能需求" },
        { name: "设计", description: "设计技术方案" },
        { name: "编码", description: "实现功能" },
        { name: "测试", description: "编写和运行测试" },
        { name: "代码审查", description: "提交代码审查" },
      ],
      triggerContext: {
        keywords: ["新功能", "feature", "实现"],
      },
    });
    console.log("  ✓ 创建工作流模式成功: ID =", workflow1.id);

    // Update workflow usage
    await learnedPatternManager.updateWorkflowUsage(workflow1.id, {
      completed: true,
      durationMs: 3600000, // 1 hour
    });
    console.log("  ✓ 更新工作流使用成功");

    // Get workflow suggestions
    const workflowSuggestions =
      await learnedPatternManager.getWorkflowSuggestions({
        category: "development",
      });
    console.log("  工作流建议:", workflowSuggestions.length, "个");
    console.log("  ✓ 获取工作流建议成功");

    // Get statistics
    const stats = await learnedPatternManager.getStats();
    console.log("  统计信息:");
    console.log("    提示词模式:", stats.promptPatterns?.count);
    console.log("    错误修复模式:", stats.errorFixPatterns?.count);
    console.log("    代码片段:", stats.codeSnippets?.count);
    console.log("    工作流模式:", stats.workflowPatterns?.count);
    console.log("  ✓ 获取统计成功");

    // Backup
    const backupResult = await learnedPatternManager.backupToFiles();
    if (!backupResult.success) {
      throw new Error("备份失败");
    }
    console.log("  ✓ 备份成功");

    // Cleanup
    const cleanupResult = await learnedPatternManager.cleanup({
      minUseCount: 0,
      olderThanDays: 365,
    });
    console.log("  ✓ 清理功能测试成功");

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
      if (fs.existsSync(testPatternsDir)) {
        fs.rmSync(testPatternsDir, { recursive: true });
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
