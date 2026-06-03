-- P2优化 Phase 3: 知识蒸馏模块
-- 创建知识蒸馏历史表

CREATE TABLE IF NOT EXISTS knowledge_distillation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,

  -- 复杂度评估
  complexity_level TEXT NOT NULL CHECK(complexity_level IN ('simple', 'medium', 'complex')),
  complexity_score REAL NOT NULL,

  -- 模型选择
  planned_model TEXT NOT NULL CHECK(planned_model IN ('small', 'large')),
  actual_model TEXT NOT NULL CHECK(actual_model IN ('small', 'large')),
  used_fallback INTEGER NOT NULL DEFAULT 0,

  -- 任务数据
  task_intents TEXT NOT NULL,  -- JSON格式的意图列表
  context_data TEXT,            -- JSON格式的上下文

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_kd_task_id ON knowledge_distillation_history(task_id);
CREATE INDEX IF NOT EXISTS idx_kd_complexity_level ON knowledge_distillation_history(complexity_level);
CREATE INDEX IF NOT EXISTS idx_kd_fallback ON knowledge_distillation_history(used_fallback);
CREATE INDEX IF NOT EXISTS idx_kd_created_at ON knowledge_distillation_history(created_at);

-- 统计视图
CREATE VIEW IF NOT EXISTS v_knowledge_distillation_stats AS
SELECT
  COUNT(*) as total_distillations,
  SUM(CASE WHEN actual_model = 'small' THEN 1 ELSE 0 END) as small_model_count,
  SUM(CASE WHEN actual_model = 'large' THEN 1 ELSE 0 END) as large_model_count,
  SUM(CASE WHEN used_fallback = 1 THEN 1 ELSE 0 END) as fallback_count,
  ROUND(AVG(complexity_score), 3) as avg_complexity_score,
  ROUND(AVG(CASE WHEN complexity_level = 'simple' THEN 1.0 ELSE 0.0 END) * 100, 2) as simple_task_rate,
  ROUND(AVG(CASE WHEN complexity_level = 'medium' THEN 1.0 ELSE 0.0 END) * 100, 2) as medium_task_rate,
  ROUND(AVG(CASE WHEN complexity_level = 'complex' THEN 1.0 ELSE 0.0 END) * 100, 2) as complex_task_rate,
  ROUND(CAST(SUM(CASE WHEN actual_model = 'small' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) as small_model_usage_rate,
  ROUND(CAST(SUM(CASE WHEN used_fallback = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN planned_model = 'small' THEN 1 ELSE 0 END), 0) * 100, 2) as fallback_rate
FROM knowledge_distillation_history;
