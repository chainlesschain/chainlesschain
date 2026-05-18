-- 迁移011: LLM告警历史系统
-- 创建日期: 2026-01-18
-- 用于LLM性能仪表板的告警历史记录功能

-- =====================================================
-- 1. LLM 告警历史表 (llm_alert_history)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_alert_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',

  -- 告警类型
  type TEXT NOT NULL,  -- 'budget_warning', 'budget_critical', 'rate_limit', 'error'
  level TEXT NOT NULL,  -- 'warning', 'critical', 'info'

  -- 告警内容
  title TEXT NOT NULL,
  message TEXT NOT NULL,

  -- 详细信息 (JSON)
  details TEXT,  -- { budgetType, percentage, spent, limit, ... }

  -- 状态
  dismissed INTEGER DEFAULT 0,  -- 是否已处理
  dismissed_at INTEGER,  -- 处理时间
  dismissed_by TEXT,  -- 处理人

  -- 关联信息
  related_provider TEXT,  -- 相关的LLM提供商
  related_model TEXT,  -- 相关的模型

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_llm_alert_history_user ON llm_alert_history(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_alert_history_type ON llm_alert_history(type);
CREATE INDEX IF NOT EXISTS idx_llm_alert_history_level ON llm_alert_history(level);
CREATE INDEX IF NOT EXISTS idx_llm_alert_history_dismissed ON llm_alert_history(dismissed);
CREATE INDEX IF NOT EXISTS idx_llm_alert_history_created_at ON llm_alert_history(created_at);

-- =====================================================
-- 2. 告警统计视图
-- =====================================================
CREATE VIEW IF NOT EXISTS v_llm_alert_stats AS
SELECT
  user_id,
  level,
  COUNT(*) as total_count,
  SUM(CASE WHEN dismissed = 0 THEN 1 ELSE 0 END) as pending_count,
  SUM(CASE WHEN dismissed = 1 THEN 1 ELSE 0 END) as dismissed_count,
  MAX(created_at) as last_alert_at
FROM llm_alert_history
GROUP BY user_id, level;

-- =====================================================
-- 3. 最近告警视图 (最近30天)
-- =====================================================
CREATE VIEW IF NOT EXISTS v_llm_recent_alerts AS
SELECT *
FROM llm_alert_history
WHERE created_at >= (strftime('%s', 'now') * 1000 - 2592000000)  -- 30天
ORDER BY created_at DESC;
