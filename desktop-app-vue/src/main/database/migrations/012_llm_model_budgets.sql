-- 迁移012: 按模型预算限制系统
-- 创建日期: 2026-01-18
-- 用于LLM性能仪表板的按模型预算控制功能

-- =====================================================
-- 1. LLM 模型预算表 (llm_model_budgets)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_model_budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',

  -- 模型标识
  provider TEXT NOT NULL,  -- ollama, openai, anthropic, deepseek, etc.
  model TEXT NOT NULL,  -- gpt-4, claude-3-opus, etc.

  -- 预算限额 (USD)
  daily_limit_usd REAL DEFAULT 0,  -- 0 表示无限制
  weekly_limit_usd REAL DEFAULT 0,
  monthly_limit_usd REAL DEFAULT 0,

  -- 当前支出 (USD)
  current_daily_spend REAL DEFAULT 0,
  current_weekly_spend REAL DEFAULT 0,
  current_monthly_spend REAL DEFAULT 0,

  -- 使用统计
  total_calls INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,

  -- 重置时间戳
  daily_reset_at INTEGER,
  weekly_reset_at INTEGER,
  monthly_reset_at INTEGER,

  -- 配置
  enabled INTEGER DEFAULT 1,  -- 是否启用预算控制
  alert_on_limit INTEGER DEFAULT 1,  -- 达到限制时是否告警
  block_on_limit INTEGER DEFAULT 0,  -- 达到限制时是否阻止调用

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 唯一约束：每个用户每个模型只有一条记录
  UNIQUE(user_id, provider, model)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_llm_model_budgets_user ON llm_model_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_model_budgets_provider ON llm_model_budgets(provider);
CREATE INDEX IF NOT EXISTS idx_llm_model_budgets_model ON llm_model_budgets(model);
CREATE INDEX IF NOT EXISTS idx_llm_model_budgets_provider_model ON llm_model_budgets(provider, model);

-- =====================================================
-- 2. 模型预算使用视图
-- =====================================================
CREATE VIEW IF NOT EXISTS v_llm_model_budget_usage AS
SELECT
  user_id,
  provider,
  model,
  daily_limit_usd,
  current_daily_spend,
  CASE
    WHEN daily_limit_usd > 0
    THEN ROUND(current_daily_spend / daily_limit_usd * 100, 2)
    ELSE 0
  END as daily_usage_percent,
  weekly_limit_usd,
  current_weekly_spend,
  CASE
    WHEN weekly_limit_usd > 0
    THEN ROUND(current_weekly_spend / weekly_limit_usd * 100, 2)
    ELSE 0
  END as weekly_usage_percent,
  monthly_limit_usd,
  current_monthly_spend,
  CASE
    WHEN monthly_limit_usd > 0
    THEN ROUND(current_monthly_spend / monthly_limit_usd * 100, 2)
    ELSE 0
  END as monthly_usage_percent,
  total_calls,
  total_tokens,
  total_cost_usd,
  enabled,
  alert_on_limit,
  block_on_limit
FROM llm_model_budgets
WHERE enabled = 1;

-- =====================================================
-- 3. 模型成本排行视图 (Top 10)
-- =====================================================
CREATE VIEW IF NOT EXISTS v_llm_model_cost_ranking AS
SELECT
  provider,
  model,
  SUM(total_calls) as total_calls,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost_usd) as total_cost_usd,
  COUNT(DISTINCT user_id) as user_count
FROM llm_model_budgets
GROUP BY provider, model
ORDER BY total_cost_usd DESC
LIMIT 10;

-- =====================================================
-- 4. 数据保留设置表
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_data_retention_config (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,

  -- 保留时间 (天)
  usage_log_retention_days INTEGER DEFAULT 90,  -- 使用日志
  cache_retention_days INTEGER DEFAULT 7,  -- 响应缓存
  alert_history_retention_days INTEGER DEFAULT 30,  -- 告警历史

  -- 自动清理
  auto_cleanup_enabled INTEGER DEFAULT 1,
  last_cleanup_at INTEGER,

  -- 存储统计
  total_storage_mb REAL DEFAULT 0,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 插入默认数据保留配置
INSERT OR IGNORE INTO llm_data_retention_config (
  id, user_id,
  usage_log_retention_days, cache_retention_days, alert_history_retention_days,
  auto_cleanup_enabled, last_cleanup_at,
  total_storage_mb,
  created_at, updated_at
) VALUES (
  'default',
  'default',
  90, 7, 30,
  1, NULL,
  0,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
