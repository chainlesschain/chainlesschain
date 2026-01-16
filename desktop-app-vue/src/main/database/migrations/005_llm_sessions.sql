-- 迁移005: LLM会话管理和Token追踪系统
-- 创建日期: 2026-01-16
-- 基于 OpenClaude 最佳实践

-- =====================================================
-- 1. LLM 会话表 (llm_sessions)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  messages TEXT NOT NULL,  -- JSON 数组，存储完整消息历史
  compressed_history TEXT,  -- JSON 对象，存储压缩信息
  metadata TEXT,  -- JSON 对象，存储元数据（创建时间、消息数、Token数等）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_llm_sessions_conversation ON llm_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_sessions_updated_at ON llm_sessions(updated_at);

-- =====================================================
-- 2. LLM 使用日志表 (llm_usage_log)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_usage_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id TEXT,
  provider TEXT NOT NULL,  -- ollama, openai, anthropic, deepseek, volcengine
  model TEXT NOT NULL,

  -- Token 统计
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,  -- Anthropic Prompt Caching

  -- 成本
  cost_usd REAL DEFAULT 0,
  cost_cny REAL DEFAULT 0,

  -- 优化标记
  was_cached INTEGER DEFAULT 0,  -- 是否来自响应缓存
  was_compressed INTEGER DEFAULT 0,  -- 是否使用了 Prompt 压缩
  compression_ratio REAL DEFAULT 1.0,  -- 压缩率

  -- 性能指标
  latency_ms INTEGER,
  response_time INTEGER,

  -- 其他信息
  endpoint TEXT,
  user_id TEXT DEFAULT 'default',
  session_id TEXT,

  created_at INTEGER NOT NULL,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_conversation ON llm_usage_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON llm_usage_log(provider);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_id ON llm_usage_log(user_id);

-- =====================================================
-- 3. LLM 预算配置表 (llm_budget_config)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_budget_config (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,

  -- 预算限额 (USD)
  daily_limit_usd REAL DEFAULT 5.0,
  weekly_limit_usd REAL DEFAULT 20.0,
  monthly_limit_usd REAL DEFAULT 50.0,

  -- 当前支出 (USD)
  current_daily_spend REAL DEFAULT 0,
  current_weekly_spend REAL DEFAULT 0,
  current_monthly_spend REAL DEFAULT 0,

  -- 重置时间戳
  daily_reset_at INTEGER,
  weekly_reset_at INTEGER,
  monthly_reset_at INTEGER,

  -- 告警阈值 (百分比, 0-1)
  warning_threshold REAL DEFAULT 0.8,  -- 80%
  critical_threshold REAL DEFAULT 0.95,  -- 95%

  -- 告警设置
  desktop_alerts INTEGER DEFAULT 1,  -- 桌面通知
  auto_pause_on_limit INTEGER DEFAULT 0,  -- 超限自动暂停
  auto_switch_to_cheaper_model INTEGER DEFAULT 1,  -- 自动切换到便宜模型

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_budget_user ON llm_budget_config(user_id);

-- =====================================================
-- 4. LLM 响应缓存表 (llm_cache)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,  -- SHA-256 hash of (provider, model, messages)
  provider TEXT NOT NULL,
  model TEXT NOT NULL,

  -- 缓存内容
  request_messages TEXT NOT NULL,  -- JSON 数组
  response_content TEXT NOT NULL,  -- JSON 对象
  response_tokens INTEGER DEFAULT 0,

  -- 缓存统计
  hit_count INTEGER DEFAULT 0,
  tokens_saved INTEGER DEFAULT 0,

  -- 过期管理
  expires_at INTEGER NOT NULL,

  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_key ON llm_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_llm_cache_expires_at ON llm_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_llm_cache_provider_model ON llm_cache(provider, model);

-- =====================================================
-- 5. 更新 conversations 表（添加Token统计字段）
-- =====================================================
-- 注意：SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS
-- 需要在迁移代码中检查字段是否存在

-- ALTER TABLE conversations ADD COLUMN total_input_tokens INTEGER DEFAULT 0;
-- ALTER TABLE conversations ADD COLUMN total_output_tokens INTEGER DEFAULT 0;
-- ALTER TABLE conversations ADD COLUMN total_cost_usd REAL DEFAULT 0;
-- ALTER TABLE conversations ADD COLUMN total_cost_cny REAL DEFAULT 0;

-- =====================================================
-- 6. 插入默认预算配置
-- =====================================================
INSERT OR IGNORE INTO llm_budget_config (
  id, user_id,
  daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
  current_daily_spend, current_weekly_spend, current_monthly_spend,
  daily_reset_at, weekly_reset_at, monthly_reset_at,
  warning_threshold, critical_threshold,
  desktop_alerts, auto_pause_on_limit, auto_switch_to_cheaper_model,
  created_at, updated_at
) VALUES (
  'default',
  'default',
  5.0,
  20.0,
  50.0,
  0, 0, 0,
  strftime('%s', 'now') * 1000 + 86400000,  -- +24小时
  strftime('%s', 'now') * 1000 + 604800000,  -- +7天
  strftime('%s', 'now') * 1000 + 2592000000,  -- +30天
  0.8,
  0.95,
  1, 0, 1,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
