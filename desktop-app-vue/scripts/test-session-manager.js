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
 *
 * 运行方式: node scripts/test-session-manager.js
 */

const path = require("path");
const fs = require("fs");

// 设置测试环境
process.env.NODE_ENV = "test";

async function runTests() {
  console.log("=".repeat(60));
  console.log("SessionManager 功能测试");
  console.log("=".repeat(60));
  console.log("");

  try {
    // 1. 初始化数据库
    console.log("[1/6] 初始化测试数据库...");
    const DatabaseManager = require("../src/main/database");
    const testDbPath = path.join(__dirname, "..", "test-session.db");

    // 删除旧的测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除旧的测试数据库");
    }

    const db = new DatabaseManager(testDbPath);
    await db.initialize();
    console.log("  ✓ 数据库初始化成功");
    console.log("");

    // 2. 初始化 SessionManager
    console.log("[2/6] 初始化 SessionManager...");
    const { SessionManager } = require("../src/main/llm/session-manager");

    const sessionManager = new SessionManager({
      database: db,
      llmManager: null, // 测试时不需要真实的 LLM Manager
      sessionsDir: path.join(__dirname, "..", "test-sessions"),
      maxHistoryMessages: 5,
      compressionThreshold: 5,
      enableAutoSave: true,
      enableCompression: true,
    });

    await sessionManager.initialize();
    console.log("  ✓ SessionManager 初始化成功");
    console.log("");

    // 3. 创建会话
    console.log("[3/6] 创建测试会话...");
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
    console.log("[4/6] 添加测试消息...");
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

    // 5. 触发压缩
    console.log("[5/6] 测试会话压缩...");
    const loadedSession = await sessionManager.loadSession(session.id);
    console.log("  压缩前消息数:", loadedSession.messages.length);

    const compressionResult = await sessionManager.compressSession(session.id);
    if (compressionResult.compressed) {
      console.log("  ✓ 压缩成功");
      console.log("  压缩后消息数:", compressionResult.messages.length);
      console.log("  原始 Tokens:", compressionResult.originalTokens);
      console.log("  压缩后 Tokens:", compressionResult.compressedTokens);
      console.log(
        "  压缩率:",
        (compressionResult.compressionRatio * 100).toFixed(1) + "%",
      );
      console.log(
        "  节省 Tokens:",
        compressionResult.originalTokens - compressionResult.compressedTokens,
      );
    } else {
      console.log("  ℹ 未触发压缩（消息数未达阈值）");
    }
    console.log("");

    // 6. 获取会话统计
    console.log("[6/6] 获取会话统计...");
    const stats = await sessionManager.getSessionStats(session.id);
    console.log("  会话ID:", stats.sessionId);
    console.log("  消息数:", stats.messageCount);
    console.log("  压缩次数:", stats.compressionCount);
    console.log("  节省 Tokens:", stats.totalTokensSaved || 0);
    console.log("  创建时间:", new Date(stats.createdAt).toLocaleString());
    console.log("  更新时间:", new Date(stats.updatedAt).toLocaleString());

    if (stats.lastCompression) {
      console.log("  最后一次压缩:");
      console.log("    - 原始 Tokens:", stats.lastCompression.originalTokens);
      console.log(
        "    - 压缩后 Tokens:",
        stats.lastCompression.compressedTokens,
      );
      console.log(
        "    - 压缩率:",
        (stats.lastCompression.compressionRatio * 100).toFixed(1) + "%",
      );
    }
    console.log("");

    // 7. 测试会话列表
    console.log("[额外测试] 列出所有会话...");
    const sessions = await sessionManager.listSessions();
    console.log("  找到 " + sessions.length + " 个会话");
    sessions.forEach((s, index) => {
      console.log(
        `  ${index + 1}. ${s.title} (ID: ${s.id.substring(0, 8)}...)`,
      );
    });
    console.log("");

    // 8. 测试会话删除
    console.log("[额外测试] 删除测试会话...");
    await sessionManager.deleteSession(session.id);
    console.log("  ✓ 会话已删除");
    console.log("");

    // 清理
    console.log("[清理] 删除测试文件...");
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除测试数据库");
    }

    const testSessionsDir = path.join(__dirname, "..", "test-sessions");
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
    console.log("=".repeat(60));
    console.log("✅ 所有测试通过！");
    console.log("=".repeat(60));
    console.log("");
    console.log("SessionManager 功能验证完成，包括：");
    console.log("  ✓ 会话创建和加载");
    console.log("  ✓ 消息持久化");
    console.log("  ✓ 智能压缩");
    console.log("  ✓ 统计分析");
    console.log("  ✓ 会话列表");
    console.log("  ✓ 会话删除");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("=".repeat(60));
    console.error("❌ 测试失败");
    console.error("=".repeat(60));
    console.error("");
    console.error("错误信息:", error.message);
    console.error("错误堆栈:", error.stack);
    console.error("");
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
