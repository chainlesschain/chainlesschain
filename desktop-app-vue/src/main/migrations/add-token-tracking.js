const { logger, createLogger } = require('../utils/logger.js');

/**
 * 数据库迁移: 添加 Token 追踪和成本优化支持
 *
 * 新增表:
 * - llm_usage_log: Token 使用日志 (审计追踪)
 * - llm_cache: 响应缓存表
 * - llm_budget_config: 预算配置表
 *
 * 扩展表:
 * - conversations: 添加成本和 token 统计字段
 */

/**
 * 执行数据库迁移
 * @param {import('better-sqlite3').Database} db - SQLite 数据库实例
 */
async function migrate(db) {
  logger.info("[Migration] 开始执行 Token 追踪迁移...");

  try {
    // ========== 1. 创建 llm_usage_log 表 ==========
    logger.info("[Migration] 创建 llm_usage_log 表...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage_log (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        message_id TEXT,
        provider TEXT NOT NULL CHECK(provider IN ('ollama', 'openai', 'anthropic', 'deepseek', 'volcengine', 'custom')),
        model TEXT NOT NULL,

        -- Token 统计
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cached_tokens INTEGER DEFAULT 0,

        -- 成本
        cost_usd REAL DEFAULT 0,
        cost_cny REAL DEFAULT 0,

        -- 优化标记
        was_cached BOOLEAN DEFAULT 0,
        was_compressed BOOLEAN DEFAULT 0,
        compression_ratio REAL DEFAULT 1.0,

        -- 性能
        latency_ms INTEGER,
        response_time INTEGER NOT NULL,

        -- 元数据
        endpoint TEXT,
        user_id TEXT DEFAULT 'default',
        session_id TEXT,
        created_at INTEGER NOT NULL,

        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_conversation
        ON llm_usage_log(conversation_id);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_at
        ON llm_usage_log(created_at);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_provider_model
        ON llm_usage_log(provider, model);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_log_user_date
        ON llm_usage_log(user_id, created_at);
    `);
    logger.info("[Migration] ✓ llm_usage_log 表创建成功");

    // ========== 2. 创建 llm_cache 表 ==========
    // 注意: 此表结构应与 005_llm_sessions.sql 保持一致
    logger.info("[Migration] 创建 llm_cache 表...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,

        -- 请求上下文
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        request_messages TEXT NOT NULL,

        -- 缓存响应
        response_content TEXT NOT NULL,
        response_tokens INTEGER DEFAULT 0,

        -- 缓存统计
        hit_count INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0,

        -- 过期管理
        expires_at INTEGER NOT NULL,

        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_cache_key
        ON llm_cache(cache_key);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_cache_expires
        ON llm_cache(expires_at);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_llm_cache_provider_model
        ON llm_cache(provider, model);
    `);
    logger.info("[Migration] ✓ llm_cache 表创建成功");

    // ========== 3. 创建 llm_budget_config 表 ==========
    logger.info("[Migration] 创建 llm_budget_config 表...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_budget_config (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,

        -- 预算限制
        daily_limit_usd REAL,
        weekly_limit_usd REAL,
        monthly_limit_usd REAL,

        -- 当前支出
        current_daily_spend REAL DEFAULT 0,
        current_weekly_spend REAL DEFAULT 0,
        current_monthly_spend REAL DEFAULT 0,

        -- 重置时间戳
        daily_reset_at INTEGER,
        weekly_reset_at INTEGER,
        monthly_reset_at INTEGER,

        -- 告警阈值 (百分比)
        warning_threshold REAL DEFAULT 0.8,
        critical_threshold REAL DEFAULT 0.95,

        -- 通知设置
        email_alerts BOOLEAN DEFAULT 0,
        desktop_alerts BOOLEAN DEFAULT 1,

        -- 自动操作
        auto_pause_on_limit BOOLEAN DEFAULT 0,
        auto_switch_to_cheaper_model BOOLEAN DEFAULT 0,

        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    logger.info("[Migration] ✓ llm_budget_config 表创建成功");

    // ========== 4. 扩展 conversations 表 ==========
    logger.info("[Migration] 扩展 conversations 表...");

    // 检查列是否已存在 (避免重复迁移错误)
    const columns = db.prepare("PRAGMA table_info(conversations)").all();
    const existingColumns = columns.map((col) => col.name);

    const newColumns = [
      {
        name: "total_input_tokens",
        sql: "ALTER TABLE conversations ADD COLUMN total_input_tokens INTEGER DEFAULT 0",
      },
      {
        name: "total_output_tokens",
        sql: "ALTER TABLE conversations ADD COLUMN total_output_tokens INTEGER DEFAULT 0",
      },
      {
        name: "total_cost_usd",
        sql: "ALTER TABLE conversations ADD COLUMN total_cost_usd REAL DEFAULT 0",
      },
      {
        name: "total_cost_cny",
        sql: "ALTER TABLE conversations ADD COLUMN total_cost_cny REAL DEFAULT 0",
      },
      {
        name: "cached_tokens_saved",
        sql: "ALTER TABLE conversations ADD COLUMN cached_tokens_saved INTEGER DEFAULT 0",
      },
      {
        name: "provider",
        sql: "ALTER TABLE conversations ADD COLUMN provider TEXT",
      },
      { name: "model", sql: "ALTER TABLE conversations ADD COLUMN model TEXT" },
    ];

    for (const column of newColumns) {
      if (!existingColumns.includes(column.name)) {
        db.exec(column.sql);
        logger.info(`[Migration]   ✓ 添加列: ${column.name}`);
      } else {
        logger.info(`[Migration]   ⊘ 列已存在: ${column.name}`);
      }
    }

    // ========== 5. 插入默认预算配置 ==========
    logger.info("[Migration] 插入默认预算配置...");
    const existingBudget = db
      .prepare("SELECT COUNT(*) as count FROM llm_budget_config")
      .get();

    if (existingBudget.count === 0) {
      const now = Date.now();
      db.prepare(
        `
        INSERT INTO llm_budget_config (
          id, user_id,
          daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
          current_daily_spend, current_weekly_spend, current_monthly_spend,
          daily_reset_at, weekly_reset_at, monthly_reset_at,
          warning_threshold, critical_threshold,
          desktop_alerts, auto_pause_on_limit,
          created_at, updated_at
        ) VALUES (
          'default', 'default',
          1.0, 5.0, 20.0,
          0, 0, 0,
          ?, ?, ?,
          0.8, 0.95,
          1, 0,
          ?, ?
        )
      `,
      ).run(
        now + 24 * 60 * 60 * 1000, // daily_reset_at (明天)
        now + 7 * 24 * 60 * 60 * 1000, // weekly_reset_at (下周)
        now + 30 * 24 * 60 * 60 * 1000, // monthly_reset_at (下月)
        now,
        now,
      );
      logger.info(
        "[Migration]   ✓ 默认预算配置已创建 (每日$1, 每周$5, 每月$20)",
      );
    } else {
      logger.info("[Migration]   ⊘ 预算配置已存在，跳过");
    }

    logger.info("[Migration] ✅ Token 追踪迁移完成!");
    return { success: true };
  } catch (error) {
    logger.error("[Migration] ❌ 迁移失败:", error);
    throw error;
  }
}

/**
 * 回滚迁移 (可选, 用于测试)
 * @param {import('better-sqlite3').Database} db
 */
async function rollback(db) {
  logger.info("[Migration] 开始回滚 Token 追踪迁移...");

  try {
    // 删除新表
    db.exec("DROP TABLE IF EXISTS llm_usage_log;");
    db.exec("DROP TABLE IF EXISTS llm_cache;");
    db.exec("DROP TABLE IF EXISTS llm_budget_config;");

    // 注意: SQLite 不支持 DROP COLUMN, 需要重建表来删除列
    // 这里暂不实现 conversations 表的回滚
    logger.warn(
      "[Migration] ⚠️  conversations 表的新增列无法通过 SQLite 自动删除",
    );

    logger.info("[Migration] ✅ 回滚完成");
    return { success: true };
  } catch (error) {
    logger.error("[Migration] ❌ 回滚失败:", error);
    throw error;
  }
}

module.exports = {
  migrate,
  rollback,
  version: "20260116_add_token_tracking",
  description: "Add LLM token tracking and cost optimization support",
};
