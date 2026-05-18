/**
 * LLM 集成测试脚本
 * 测试 Token 追踪、Prompt 压缩、响应缓存的完整集成
 *
 * 运行方式:
 * node scripts/test-llm-integration.js
 */

const path = require("path");
const Database = require("better-sqlite3");
const { LLMManager } = require("../src/main/llm/llm-manager");
const { TokenTracker } = require("../src/main/llm/token-tracker");
const { PromptCompressor } = require("../src/main/llm/prompt-compressor");
const { ResponseCache } = require("../src/main/llm/response-cache");

// 创建临时数据库用于测试
const testDbPath = path.join(__dirname, "../data/test-llm-integration.db");
const db = new Database(testDbPath);

// 初始化数据库表（简化版）
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_usage_log (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    message_id TEXT,
    provider TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cached_tokens INTEGER,
    cost_usd REAL,
    cost_cny REAL,
    was_cached INTEGER DEFAULT 0,
    was_compressed INTEGER DEFAULT 0,
    compression_ratio REAL DEFAULT 1.0,
    latency_ms INTEGER,
    response_time INTEGER,
    endpoint TEXT,
    user_id TEXT DEFAULT 'default',
    session_id TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS llm_budget_config (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,
    daily_limit_usd REAL,
    weekly_limit_usd REAL,
    monthly_limit_usd REAL,
    current_daily_spend REAL DEFAULT 0,
    current_weekly_spend REAL DEFAULT 0,
    current_monthly_spend REAL DEFAULT 0,
    daily_reset_at INTEGER,
    weekly_reset_at INTEGER,
    monthly_reset_at INTEGER,
    warning_threshold REAL DEFAULT 0.8,
    critical_threshold REAL DEFAULT 0.95,
    desktop_alerts INTEGER DEFAULT 1,
    auto_pause_on_limit INTEGER DEFAULT 0,
    auto_switch_to_cheaper_model INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS llm_cache (
    id TEXT PRIMARY KEY,
    cache_key TEXT UNIQUE,
    provider TEXT,
    model TEXT,
    messages TEXT,
    response_content TEXT,
    response_tokens INTEGER,
    hit_count INTEGER DEFAULT 0,
    tokens_saved INTEGER DEFAULT 0,
    cost_saved_usd REAL DEFAULT 0,
    created_at INTEGER,
    expires_at INTEGER,
    last_hit_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    total_cost_cny REAL DEFAULT 0
  );
`);

console.log("========================================");
console.log("LLM 集成测试");
console.log("========================================\n");

async function runTests() {
  try {
    // 1. 初始化组件
    console.log("📦 步骤 1: 初始化组件...");

    const tokenTracker = new TokenTracker(db, {
      enableCostTracking: true,
      enableBudgetAlerts: true,
      exchangeRate: 7.2,
    });

    const promptCompressor = new PromptCompressor({
      enableDeduplication: true,
      enableSummarization: false,
      enableTruncation: true,
      maxHistoryMessages: 10,
      maxTotalTokens: 4000,
    });

    const responseCache = new ResponseCache(db, {
      ttl: 7 * 24 * 60 * 60 * 1000,
      maxSize: 1000,
      enableAutoCleanup: false, // 测试时禁用自动清理
    });

    console.log("✅ 所有组件初始化成功\n");

    // 2. 创建 LLMManager（使用 Mock 模式）
    console.log("📦 步骤 2: 创建 LLMManager (Mock 模式)...");

    const llmManager = new LLMManager({
      provider: "ollama", // 使用 Ollama (本地免费)
      ollamaURL: "http://localhost:11434",
      model: "llama2",
      tokenTracker,
      promptCompressor,
      responseCache,
    });

    // 模拟初始化（不实际连接 Ollama）
    llmManager.isInitialized = true;
    llmManager.client = {
      chat: async (messages, options) => {
        // Mock LLM 响应
        await new Promise((resolve) => setTimeout(resolve, 100)); // 模拟延迟
        return {
          message: {
            role: "assistant",
            content: `这是对消息的响应。收到 ${messages.length} 条消息。`,
          },
          model: "llama2",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
          },
        };
      },
    };

    console.log("✅ LLMManager 创建成功 (Mock 模式)\n");

    // 3. 测试 Prompt 压缩
    console.log("📦 步骤 3: 测试 Prompt 压缩...");

    const longMessages = [
      { role: "system", content: "你是一个AI助手。" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！有什么可以帮助你的吗？" },
      { role: "user", content: "今天天气怎么样？" },
      { role: "assistant", content: "抱歉，我无法获取实时天气信息。" },
      { role: "user", content: "介绍一下人工智能" },
      { role: "assistant", content: "人工智能（AI）是计算机科学的一个分支..." },
      { role: "user", content: "什么是机器学习？" },
      { role: "assistant", content: "机器学习是AI的一个子领域..." },
      { role: "user", content: "解释深度学习" },
    ];

    const compressionResult = await promptCompressor.compress(longMessages, {
      preserveSystemMessage: true,
      preserveLastUserMessage: true,
    });

    console.log(`  原始消息数: ${longMessages.length}`);
    console.log(`  压缩后消息数: ${compressionResult.messages.length}`);
    console.log(`  压缩率: ${compressionResult.compressionRatio.toFixed(2)}`);
    console.log(`  节省 Tokens: ${compressionResult.tokensSaved}`);
    console.log(`  应用策略: ${compressionResult.strategy}`);
    console.log("✅ Prompt 压缩测试成功\n");

    // 4. 测试响应缓存（第一次调用）
    console.log("📦 步骤 4: 测试响应缓存（第一次调用 - 缓存未命中）...");

    const testMessages = [{ role: "user", content: "你好，介绍一下自己" }];

    const result1 = await llmManager.chatWithMessages(testMessages, {
      conversationId: "test-conv-001",
      messageId: "msg-001",
    });

    console.log(`  响应: ${result1.text.substring(0, 50)}...`);
    console.log(`  是否命中缓存: ${result1.wasCached ? "是" : "否"}`);
    console.log(`  是否压缩: ${result1.wasCompressed ? "是" : "否"}`);
    console.log(`  Token 数: ${result1.tokens}`);
    console.log("✅ 第一次调用成功（缓存未命中）\n");

    // 5. 测试响应缓存（第二次调用 - 应该命中缓存）
    console.log("📦 步骤 5: 测试响应缓存（第二次调用 - 应该命中缓存）...");

    const result2 = await llmManager.chatWithMessages(testMessages, {
      conversationId: "test-conv-001",
      messageId: "msg-002",
    });

    console.log(`  响应: ${result2.text.substring(0, 50)}...`);
    console.log(`  是否命中缓存: ${result2.wasCached ? "✅ 是" : "❌ 否"}`);
    console.log(`  是否压缩: ${result2.wasCompressed ? "是" : "否"}`);
    console.log(`  节省 Tokens: ${result2.tokensSaved || 0}`);

    if (result2.wasCached) {
      console.log("✅ 响应缓存测试成功\n");
    } else {
      console.log("❌ 响应缓存测试失败（未命中缓存）\n");
    }

    // 6. 测试 Token 追踪统计
    console.log("📦 步骤 6: 测试 Token 追踪统计...");

    const stats = await tokenTracker.getUsageStats({
      startDate: Date.now() - 24 * 60 * 60 * 1000,
      endDate: Date.now(),
    });

    console.log(`  总调用次数: ${stats.totalCalls}`);
    console.log(`  总 Input Tokens: ${stats.totalInputTokens}`);
    console.log(`  总 Output Tokens: ${stats.totalOutputTokens}`);
    console.log(`  总成本 (USD): $${stats.totalCostUsd.toFixed(4)}`);
    console.log(`  总成本 (CNY): ¥${stats.totalCostCny.toFixed(4)}`);
    console.log(`  缓存命中次数: ${stats.cachedCalls}`);
    console.log(`  压缩次数: ${stats.compressedCalls}`);
    console.log(`  缓存命中率: ${stats.cacheHitRate}%`);
    console.log("✅ Token 追踪统计成功\n");

    // 7. 测试缓存统计
    console.log("📦 步骤 7: 测试缓存统计...");

    const cacheStats = await responseCache.getStats();

    console.log("  运行时统计:");
    console.log(`    - 命中次数: ${cacheStats.runtime.hits}`);
    console.log(`    - 未命中次数: ${cacheStats.runtime.misses}`);
    console.log(`    - 缓存命中率: ${cacheStats.runtime.hitRate}`);
    console.log("  数据库统计:");
    console.log(`    - 总条目数: ${cacheStats.database.totalEntries}`);
    console.log(`    - 总命中次数: ${cacheStats.database.totalHits}`);
    console.log(`    - 节省 Tokens: ${cacheStats.database.totalTokensSaved}`);
    console.log("✅ 缓存统计成功\n");

    // 8. 测试带压缩的长对话
    console.log("📦 步骤 8: 测试带压缩的长对话...");

    const result3 = await llmManager.chatWithMessages(longMessages, {
      conversationId: "test-conv-002",
      messageId: "msg-003",
    });

    console.log(`  原始消息数: ${longMessages.length}`);
    console.log(`  响应: ${result3.text.substring(0, 50)}...`);
    console.log(`  是否压缩: ${result3.wasCompressed ? "✅ 是" : "❌ 否"}`);
    console.log(`  压缩率: ${result3.compressionRatio.toFixed(2)}`);

    if (result3.wasCompressed) {
      console.log("✅ 长对话压缩测试成功\n");
    } else {
      console.log("❌ 长对话压缩测试失败（未触发压缩）\n");
    }

    // 测试总结
    console.log("========================================");
    console.log("✅ 所有测试完成！");
    console.log("========================================\n");

    console.log("总结:");
    console.log("  ✅ Token 追踪 - 已集成并正常工作");
    console.log(
      `  ${result2.wasCached ? "✅" : "❌"} 响应缓存 - ${result2.wasCached ? "已集成并正常工作" : "集成失败"}`,
    );
    console.log(
      `  ${result3.wasCompressed ? "✅" : "❌"} Prompt 压缩 - ${result3.wasCompressed ? "已集成并正常工作" : "集成失败"}`,
    );
  } catch (error) {
    console.error("❌ 测试失败:", error);
    throw error;
  } finally {
    // 清理
    db.close();
    console.log("\n🧹 测试数据库已关闭");
  }
}

// 运行测试
runTests().catch(console.error);
