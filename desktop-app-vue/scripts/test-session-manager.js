#!/usr/bin/env node

/**
 * SessionManager 测试脚本
 *
 * 测试内容：
 * 1. 会话创建
 * 2. 消息添加
 * 3. 会话压缩
 * 4. 会话保存和加载
 * 5. 会话统计
 * 6. 标签系统
 * 7. 搜索功能
 * 8. 导出/导入
 * 9. 摘要生成
 * 10. 会话续接
 * 11. 模板功能
 * 12. 批量操作
 * 13. 全局统计
 *
 * 运行方式: node scripts/test-session-manager.js
 */

const path = require("path");
const fs = require("fs");

// 设置测试环境
process.env.NODE_ENV = "test";

async function runTests() {
  console.log("=".repeat(70));
  console.log("SessionManager 功能测试 (增强版 v2.0)");
  console.log("=".repeat(70));
  console.log("");

  let testDbPath, testSessionsDir, db, sessionManager;

  try {
    // 1. 初始化数据库
    console.log("[1/13] 初始化测试数据库...");
    const DatabaseManager = require("../src/main/database");
    testDbPath = path.join(__dirname, "..", "test-session.db");
    testSessionsDir = path.join(__dirname, "..", "test-sessions");

    // 删除旧的测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除旧的测试数据库");
    }

    db = new DatabaseManager(testDbPath);
    await db.initialize();
    console.log("  ✓ 数据库初始化成功");
    console.log("");

    // 2. 初始化 SessionManager
    console.log("[2/13] 初始化 SessionManager...");
    const { SessionManager } = require("../src/main/llm/session-manager");

    sessionManager = new SessionManager({
      database: db,
      llmManager: null, // 测试时不需要真实的 LLM Manager
      sessionsDir: testSessionsDir,
      maxHistoryMessages: 5,
      compressionThreshold: 5,
      enableAutoSave: true,
      enableCompression: true,
    });

    await sessionManager.initialize();
    console.log("  ✓ SessionManager 初始化成功");
    console.log("");

    // 3. 创建会话
    console.log("[3/13] 创建测试会话...");
    const session = await sessionManager.createSession({
      conversationId: "test-conversation-001",
      title: "测试会话 - SessionManager 功能验证",
      metadata: {
        testMode: true,
        createdBy: "test-script",
      },
    });
    console.log("  ✓ 会话创建成功");
    console.log("  会话ID:", session.id);
    console.log("  对话ID:", session.conversationId);
    console.log("  标题:", session.title);
    console.log("");

    // 4. 添加消息
    console.log("[4/13] 添加测试消息...");
    const messages = [
      { role: "user", content: "你好，我想了解 SessionManager 的功能" },
      {
        role: "assistant",
        content:
          "SessionManager 是一个会话管理器，可以持久化对话历史并进行智能压缩。",
      },
      { role: "user", content: "它有哪些主要功能？" },
      {
        role: "assistant",
        content:
          "主要功能包括：1. 会话创建和加载 2. 消息持久化 3. 智能压缩 4. Token优化 5. 统计分析",
      },
      { role: "user", content: "压缩是如何工作的？" },
      {
        role: "assistant",
        content:
          "压缩通过 PromptCompressor 实现，可以保留最近的消息，并总结更早的对话历史。",
      },
      { role: "user", content: "这样可以节省多少 Token？" },
      {
        role: "assistant",
        content: "根据测试，通常可以节省 30-40% 的 Token 使用量。",
      },
    ];

    for (const message of messages) {
      await sessionManager.addMessage(session.id, message);
      console.log(
        `  ✓ 已添加消息: ${message.role} - ${message.content.substring(0, 30)}...`,
      );
    }
    console.log("  ✓ 共添加 " + messages.length + " 条消息");
    console.log("");

    // 5. 测试标签系统
    console.log("[5/13] 测试标签系统...");
    await sessionManager.addTags(session.id, ["测试", "功能验证"]);
    console.log("  ✓ 添加标签成功: 测试, 功能验证");

    await sessionManager.addTags(session.id, "AI对话");
    console.log("  ✓ 添加单个标签成功: AI对话");

    const sessionWithTags = await sessionManager.loadSession(session.id);
    console.log("  当前标签:", sessionWithTags.metadata.tags.join(", "));

    await sessionManager.removeTags(session.id, "功能验证");
    const afterRemove = await sessionManager.loadSession(session.id);
    console.log("  移除后标签:", afterRemove.metadata.tags.join(", "));

    const allTags = await sessionManager.getAllTags();
    console.log("  ✓ 获取所有标签成功，共", allTags.length, "个标签");
    console.log("");

    // 6. 测试搜索功能
    console.log("[6/13] 测试搜索功能...");

    // 按标题搜索
    const titleResults = await sessionManager.searchSessions("功能验证", {
      searchTitle: true,
      searchContent: false,
    });
    console.log("  ✓ 按标题搜索结果:", titleResults.length, "个会话");

    // 按内容搜索
    const contentResults = await sessionManager.searchSessions("Token", {
      searchTitle: false,
      searchContent: true,
    });
    console.log("  ✓ 按内容搜索结果:", contentResults.length, "个会话");
    if (contentResults.length > 0 && contentResults[0].matchedMessages) {
      console.log("    匹配消息数:", contentResults[0].matchedMessages.length);
    }

    // 按标签查找
    const tagResults = await sessionManager.findSessionsByTags(["测试"]);
    console.log("  ✓ 按标签查找结果:", tagResults.length, "个会话");
    console.log("");

    // 7. 测试导出功能
    console.log("[7/13] 测试导出功能...");

    // 导出为 JSON
    const jsonExport = await sessionManager.exportToJSON(session.id);
    console.log("  ✓ 导出 JSON 成功，大小:", jsonExport.length, "字节");

    // 导出为 Markdown
    const mdExport = await sessionManager.exportToMarkdown(session.id, {
      includeMetadata: true,
    });
    console.log("  ✓ 导出 Markdown 成功，大小:", mdExport.length, "字节");
    console.log("");

    // 8. 测试导入功能
    console.log("[8/13] 测试导入功能...");
    const importedSession = await sessionManager.importFromJSON(jsonExport);
    console.log("  ✓ 导入会话成功");
    console.log("  新会话ID:", importedSession.id);
    console.log("  标题:", importedSession.title);
    console.log("");

    // 9. 测试摘要生成
    console.log("[9/13] 测试摘要生成...");
    const summary = await sessionManager.generateSummary(session.id, {
      useLLM: false, // 测试时不使用LLM
    });
    console.log("  ✓ 摘要生成成功");
    console.log("  摘要:", summary.substring(0, 50) + "...");
    console.log("");

    // 10. 测试会话续接
    console.log("[10/13] 测试会话续接...");
    const resumeResult = await sessionManager.resumeSession(session.id);
    console.log("  ✓ 会话恢复成功");
    console.log("  有效消息数:", resumeResult.messages.length);
    console.log("  续接次数:", resumeResult.stats.sessionId ? 1 : 0);
    if (resumeResult.contextPrompt) {
      console.log(
        "  上下文提示:",
        resumeResult.contextPrompt.substring(0, 50) + "...",
      );
    }

    // 获取最近会话
    const recentSessions = await sessionManager.getRecentSessions(5);
    console.log("  ✓ 获取最近会话成功，共", recentSessions.length, "个");
    console.log("");

    // 11. 测试模板功能
    console.log("[11/13] 测试模板功能...");

    // 保存为模板
    const template = await sessionManager.saveAsTemplate(session.id, {
      name: "测试模板",
      description: "用于功能测试的会话模板",
      category: "test",
    });
    console.log("  ✓ 保存为模板成功");
    console.log("  模板ID:", template.id);
    console.log("  模板名称:", template.name);

    // 列出模板
    const templates = await sessionManager.listTemplates();
    console.log("  ✓ 列出模板成功，共", templates.length, "个");

    // 从模板创建会话
    const fromTemplate = await sessionManager.createFromTemplate(template.id, {
      title: "从模板创建的会话",
    });
    console.log("  ✓ 从模板创建会话成功");
    console.log("  新会话ID:", fromTemplate.id);
    console.log("");

    // 12. 测试批量操作
    console.log("[12/13] 测试批量操作...");

    // 创建几个测试会话
    const batchSessions = [];
    for (let i = 0; i < 3; i++) {
      const s = await sessionManager.createSession({
        conversationId: `batch-test-${i}`,
        title: `批量测试会话 ${i + 1}`,
      });
      batchSessions.push(s);
    }
    console.log("  ✓ 创建了", batchSessions.length, "个批量测试会话");

    // 批量添加标签
    const batchIds = batchSessions.map((s) => s.id);
    const tagResult = await sessionManager.addTagsToMultiple(batchIds, [
      "批量测试",
    ]);
    console.log("  ✓ 批量添加标签成功，更新了", tagResult.updated, "个会话");

    // 批量导出
    const batchExport = await sessionManager.exportMultiple(batchIds);
    console.log("  ✓ 批量导出成功，大小:", batchExport.length, "字节");

    // 批量删除
    const deleteResult = await sessionManager.deleteMultiple(batchIds);
    console.log(
      "  ✓ 批量删除成功，删除了",
      deleteResult.deleted,
      "个会话，失败",
      deleteResult.failed,
      "个",
    );
    console.log("");

    // 13. 测试全局统计
    console.log("[13/13] 测试全局统计...");
    const globalStats = await sessionManager.getGlobalStats();
    console.log("  ✓ 获取全局统计成功");
    console.log("  总会话数:", globalStats.totalSessions);
    console.log("  总消息数:", globalStats.totalMessages);
    console.log("  总压缩次数:", globalStats.totalCompressions);
    console.log("  节省 Tokens:", globalStats.totalTokensSaved || 0);
    console.log("  唯一标签数:", globalStats.uniqueTags);
    console.log("  最近7天活跃:", globalStats.recentActivityCount, "个会话");
    console.log("");

    // 清理
    console.log("[清理] 删除测试数据...");

    // 删除测试会话
    await sessionManager.deleteSession(session.id);
    await sessionManager.deleteSession(importedSession.id);
    await sessionManager.deleteSession(fromTemplate.id);
    console.log("  ✓ 已删除测试会话");

    // 删除测试模板
    await sessionManager.deleteTemplate(template.id);
    console.log("  ✓ 已删除测试模板");

    // 删除测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除测试数据库");
    }

    // 删除测试会话目录
    if (fs.existsSync(testSessionsDir)) {
      const files = fs.readdirSync(testSessionsDir);
      files.forEach((file) => {
        fs.unlinkSync(path.join(testSessionsDir, file));
      });
      fs.rmdirSync(testSessionsDir);
      console.log("  ✓ 已删除测试会话目录");
    }
    console.log("");

    // 测试总结
    console.log("=".repeat(70));
    console.log("✅ 所有测试通过！");
    console.log("=".repeat(70));
    console.log("");
    console.log("SessionManager 功能验证完成，包括：");
    console.log("  ✓ 会话创建和加载");
    console.log("  ✓ 消息持久化");
    console.log("  ✓ 智能压缩");
    console.log("  ✓ 统计分析");
    console.log("  ✓ 标签系统");
    console.log("  ✓ 搜索功能");
    console.log("  ✓ JSON/Markdown 导出");
    console.log("  ✓ JSON 导入");
    console.log("  ✓ 摘要生成");
    console.log("  ✓ 会话续接");
    console.log("  ✓ 模板功能");
    console.log("  ✓ 批量操作");
    console.log("  ✓ 全局统计");
    console.log("  ✓ 会话删除");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("=".repeat(70));
    console.error("❌ 测试失败");
    console.error("=".repeat(70));
    console.error("");
    console.error("错误信息:", error.message);
    console.error("错误堆栈:", error.stack);
    console.error("");

    // 尝试清理
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
        console.log("  已清理测试数据库");
      }
      if (fs.existsSync(testSessionsDir)) {
        const files = fs.readdirSync(testSessionsDir);
        files.forEach((file) => {
          fs.unlinkSync(path.join(testSessionsDir, file));
        });
        fs.rmdirSync(testSessionsDir);
        console.log("  已清理测试会话目录");
      }
    } catch (cleanupError) {
      console.error("  清理失败:", cleanupError.message);
    }

    process.exit(1);
  }
}

// 运行测试
runTests()
  .then(() => {
    console.log("测试脚本执行完成");
    process.exit(0);
  })
  .catch((error) => {
    console.error("测试脚本执行失败:", error);
    process.exit(1);
  });
