-- ============================================
-- P2优化数据库迁移脚本
-- 版本: v0.18.0
-- 创建日期: 2026-01-01
-- 依赖: 003_add_p1_optimization_tables.sql
-- ============================================
--
-- P2优化包含3个核心模块：
-- 1. 意图融合 (Intent Fusion)
-- 2. 知识蒸馏 (Knowledge Distillation)
-- 3. 流式响应 (Streaming Response)
--
-- 本迁移脚本创建：
-- - 3个新表
-- - 3个统计视图
-- - 3个自动清理触发器
-- ============================================

-- ============================================
-- 表1: intent_fusion_history
-- 意图融合历史记录
-- ============================================

CREATE TABLE IF NOT EXISTS intent_fusion_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 会话信息
  session_id TEXT NOT NULL,
  user_id TEXT,

  -- 融合信息
  original_intents TEXT NOT NULL,      -- JSON数组，原始意图列表
  fused_intents TEXT NOT NULL,         -- JSON数组，融合后意图列表
  fusion_strategy TEXT NOT NULL,       -- 融合策略: rule/llm
  fusion_rules_applied TEXT,           -- JSON数组，应用的规则列表

  -- 融合效果
  original_count INTEGER NOT NULL,     -- 原始意图数量
  fused_count INTEGER NOT NULL,        -- 融合后意图数量
  reduction_rate REAL NOT NULL,        -- 减少率: (original - fused) / original
  llm_calls_saved INTEGER DEFAULT 0,   -- 节省的LLM调用次数

  -- 性能指标
  fusion_time_ms INTEGER,              -- 融合耗时（毫秒）
  execution_time_ms INTEGER,           -- 执行耗时（毫秒）
  execution_success INTEGER DEFAULT 1, -- 执行是否成功 (0/1)

  -- 上下文信息
  context TEXT,                        -- JSON，上下文数据
  error_message TEXT,                  -- 错误信息（如果失败）

  -- 时间戳
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- 约束
  CHECK (original_count > 0),
  CHECK (fused_count > 0),
  CHECK (fused_count <= original_count),
  CHECK (reduction_rate >= 0 AND reduction_rate <= 1),
  CHECK (fusion_strategy IN ('rule', 'llm'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_fusion_session ON intent_fusion_history(session_id);
CREATE INDEX IF NOT EXISTS idx_fusion_user ON intent_fusion_history(user_id);
CREATE INDEX IF NOT EXISTS idx_fusion_strategy ON intent_fusion_history(fusion_strategy);
CREATE INDEX IF NOT EXISTS idx_fusion_created ON intent_fusion_history(created_at);
CREATE INDEX IF NOT EXISTS idx_fusion_success ON intent_fusion_history(execution_success);

-- ============================================
-- 表2: distillation_routing_log
-- 知识蒸馏路由日志
-- ============================================

CREATE TABLE IF NOT EXISTS distillation_routing_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 会话信息
  session_id TEXT NOT NULL,
  user_id TEXT,

  -- 任务信息
  intent_type TEXT NOT NULL,
  user_input TEXT,

  -- 路由决策
  complexity_score REAL NOT NULL,      -- 任务复杂度 (0-1)
  routed_model TEXT NOT NULL,          -- student/teacher
  model_name TEXT NOT NULL,            -- 具体模型名称，如 qwen2:1.5b
  routing_reason TEXT NOT NULL,        -- 路由原因

  -- 历史数据
  student_accuracy REAL,               -- 小模型历史准确率
  student_coverage REAL,               -- 小模型覆盖率
  teacher_fallback_rate REAL,          -- 大模型回退率

  -- 性能指标
  inference_time_ms INTEGER,           -- 推理耗时（毫秒）
  output_confidence REAL,              -- 输出置信度 (0-1)
  output_quality_score REAL,           -- 输出质量分数 (0-1)

  -- 回退信息
  fallback_occurred INTEGER DEFAULT 0, -- 是否回退到大模型 (0/1)
  fallback_reason TEXT,                -- 回退原因

  -- 结果
  execution_success INTEGER DEFAULT 1, -- 执行是否成功 (0/1)
  error_message TEXT,                  -- 错误信息（如果失败）

  -- 时间戳
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- 约束
  CHECK (complexity_score >= 0 AND complexity_score <= 1),
  CHECK (routed_model IN ('student', 'teacher')),
  CHECK (output_confidence IS NULL OR (output_confidence >= 0 AND output_confidence <= 1)),
  CHECK (fallback_occurred IN (0, 1))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_distill_session ON distillation_routing_log(session_id);
CREATE INDEX IF NOT EXISTS idx_distill_user ON distillation_routing_log(user_id);
CREATE INDEX IF NOT EXISTS idx_distill_model ON distillation_routing_log(routed_model);
CREATE INDEX IF NOT EXISTS idx_distill_intent ON distillation_routing_log(intent_type);
CREATE INDEX IF NOT EXISTS idx_distill_created ON distillation_routing_log(created_at);
CREATE INDEX IF NOT EXISTS idx_distill_fallback ON distillation_routing_log(fallback_occurred);

-- ============================================
-- 表3: streaming_execution_log
-- 流式执行日志
-- ============================================

CREATE TABLE IF NOT EXISTS streaming_execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 会话信息
  session_id TEXT NOT NULL,
  user_id TEXT,

  -- 事件信息
  event_type TEXT NOT NULL,            -- start/step_start/step_partial/step_complete/step_error/complete/cancel
  event_sequence INTEGER NOT NULL,     -- 事件序号（同一session内递增）

  -- 步骤信息
  step_name TEXT,
  step_index INTEGER,
  total_steps INTEGER,

  -- 进度信息
  progress REAL,                       -- 进度 (0-100)
  progress_message TEXT,               -- 进度消息

  -- 结果数据
  partial_result TEXT,                 -- JSON，部分结果
  final_result TEXT,                   -- JSON，最终结果

  -- 性能指标
  step_duration_ms INTEGER,            -- 步骤耗时（毫秒）
  total_duration_ms INTEGER,           -- 总耗时（毫秒）

  -- 错误信息
  error_message TEXT,                  -- 错误信息
  error_stack TEXT,                    -- 错误堆栈

  -- 时间戳
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- 约束
  CHECK (event_type IN ('start', 'step_start', 'step_partial', 'step_complete', 'step_error', 'complete', 'cancel')),
  CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_stream_session ON streaming_execution_log(session_id);
CREATE INDEX IF NOT EXISTS idx_stream_user ON streaming_execution_log(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_event ON streaming_execution_log(event_type);
CREATE INDEX IF NOT EXISTS idx_stream_timestamp ON streaming_execution_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_stream_sequence ON streaming_execution_log(session_id, event_sequence);

-- ============================================
-- 统计视图
-- ============================================

-- 视图1: 意图融合统计
CREATE VIEW IF NOT EXISTS v_intent_fusion_stats AS
SELECT
  COUNT(*) as total_fusions,
  AVG(reduction_rate) as avg_reduction_rate,
  SUM(llm_calls_saved) as total_llm_calls_saved,
  SUM(CASE WHEN fusion_strategy = 'rule' THEN 1 ELSE 0 END) as rule_fusions,
  SUM(CASE WHEN fusion_strategy = 'llm' THEN 1 ELSE 0 END) as llm_fusions,
  AVG(fusion_time_ms) as avg_fusion_time_ms,
  AVG(execution_time_ms) as avg_execution_time_ms,
  SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) as successful_fusions,
  CAST(SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100 as success_rate
FROM intent_fusion_history
WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000;

-- 视图2: 知识蒸馏性能
CREATE VIEW IF NOT EXISTS v_distillation_performance AS
SELECT
  routed_model,
  COUNT(*) as total_calls,
  AVG(complexity_score) as avg_complexity,
  AVG(inference_time_ms) as avg_inference_time,
  AVG(output_confidence) as avg_confidence,
  AVG(output_quality_score) as avg_quality,
  SUM(fallback_occurred) as total_fallbacks,
  CAST(SUM(fallback_occurred) AS REAL) / COUNT(*) * 100 as fallback_rate,
  SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) as successful_calls,
  CAST(SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100 as success_rate
FROM distillation_routing_log
WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000
GROUP BY routed_model;

-- 视图3: 流式响应指标
CREATE VIEW IF NOT EXISTS v_streaming_metrics AS
SELECT
  session_id,
  MIN(CASE WHEN event_type = 'start' THEN timestamp END) as start_time,
  MIN(CASE WHEN event_type != 'start' THEN timestamp END) as first_response_time,
  MAX(CASE WHEN event_type = 'complete' THEN timestamp END) as complete_time,
  MAX(CASE WHEN event_type = 'cancel' THEN timestamp END) as cancel_time,
  MAX(progress) as max_progress,
  COUNT(DISTINCT step_index) as total_steps,
  SUM(CASE WHEN event_type = 'step_error' THEN 1 ELSE 0 END) as error_count,
  -- 首次响应延迟（毫秒）
  (MIN(CASE WHEN event_type != 'start' THEN timestamp END) -
   MIN(CASE WHEN event_type = 'start' THEN timestamp END)) as first_response_latency,
  -- 总耗时（毫秒）
  (MAX(CASE WHEN event_type IN ('complete', 'cancel') THEN timestamp END) -
   MIN(CASE WHEN event_type = 'start' THEN timestamp END)) as total_duration,
  -- 是否取消
  CASE WHEN MAX(CASE WHEN event_type = 'cancel' THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END as was_cancelled
FROM streaming_execution_log
GROUP BY session_id;

-- 视图4: P2综合统计（7天）
CREATE VIEW IF NOT EXISTS v_p2_optimization_summary AS
SELECT
  'Intent Fusion' as optimization_type,
  (SELECT COUNT(*) FROM intent_fusion_history
   WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as total_operations,
  (SELECT AVG(reduction_rate) FROM intent_fusion_history
   WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as avg_improvement,
  (SELECT SUM(llm_calls_saved) FROM intent_fusion_history
   WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as resources_saved
UNION ALL
SELECT
  'Knowledge Distillation' as optimization_type,
  (SELECT COUNT(*) FROM distillation_routing_log
   WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as total_operations,
  (SELECT CAST(COUNT(*) AS REAL) / (SELECT COUNT(*) FROM distillation_routing_log
   WHERE created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000)
   FROM distillation_routing_log
   WHERE routed_model = 'student'
   AND created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as avg_improvement,
  (SELECT COUNT(*) FROM distillation_routing_log
   WHERE routed_model = 'student'
   AND created_at > (strftime('%s', 'now') - 7*24*60*60) * 1000) as resources_saved
UNION ALL
SELECT
  'Streaming Response' as optimization_type,
  (SELECT COUNT(DISTINCT session_id) FROM streaming_execution_log
   WHERE timestamp > (strftime('%s', 'now') - 7*24*60*60) * 1000) as total_operations,
  (SELECT AVG(first_response_latency) / 1000.0 FROM v_streaming_metrics
   WHERE start_time > (strftime('%s', 'now') - 7*24*60*60) * 1000) as avg_improvement,
  (SELECT COUNT(DISTINCT session_id) FROM streaming_execution_log
   WHERE event_type = 'step_partial'
   AND timestamp > (strftime('%s', 'now') - 7*24*60*60) * 1000) as resources_saved;

-- 视图5: 每日P2性能趋势
CREATE VIEW IF NOT EXISTS v_p2_daily_performance AS
SELECT
  date(created_at / 1000, 'unixepoch') as date,
  -- 意图融合
  COUNT(DISTINCT f.session_id) as fusion_sessions,
  AVG(f.reduction_rate) as avg_fusion_reduction,
  SUM(f.llm_calls_saved) as fusion_llm_saved,
  -- 知识蒸馏
  COUNT(DISTINCT d.session_id) as distillation_sessions,
  SUM(CASE WHEN d.routed_model = 'student' THEN 1 ELSE 0 END) as student_calls,
  AVG(d.inference_time_ms) as avg_inference_time,
  -- 流式响应
  COUNT(DISTINCT s.session_id) as streaming_sessions,
  AVG(CASE WHEN s.event_type = 'complete' THEN s.total_duration_ms END) as avg_total_duration
FROM intent_fusion_history f
FULL OUTER JOIN distillation_routing_log d ON date(f.created_at / 1000, 'unixepoch') = date(d.created_at / 1000, 'unixepoch')
FULL OUTER JOIN streaming_execution_log s ON date(f.created_at / 1000, 'unixepoch') = date(s.timestamp / 1000, 'unixepoch')
WHERE f.created_at > (strftime('%s', 'now') - 30*24*60*60) * 1000
   OR d.created_at > (strftime('%s', 'now') - 30*24*60*60) * 1000
   OR s.timestamp > (strftime('%s', 'now') - 30*24*60*60) * 1000
GROUP BY date
ORDER BY date DESC;

-- ============================================
-- 自动清理触发器
-- ============================================

-- 触发器1: 清理90天前的意图融合历史
CREATE TRIGGER IF NOT EXISTS cleanup_old_fusion_history
AFTER INSERT ON intent_fusion_history
BEGIN
  DELETE FROM intent_fusion_history
  WHERE created_at < (strftime('%s', 'now') - 90*24*60*60) * 1000;
END;

-- 触发器2: 清理90天前的蒸馏路由日志
CREATE TRIGGER IF NOT EXISTS cleanup_old_distillation_log
AFTER INSERT ON distillation_routing_log
BEGIN
  DELETE FROM distillation_routing_log
  WHERE created_at < (strftime('%s', 'now') - 90*24*60*60) * 1000;
END;

-- 触发器3: 清理90天前的流式执行日志
CREATE TRIGGER IF NOT EXISTS cleanup_old_streaming_log
AFTER INSERT ON streaming_execution_log
BEGIN
  DELETE FROM streaming_execution_log
  WHERE timestamp < (strftime('%s', 'now') - 90*24*60*60) * 1000;
END;

-- ============================================
-- 迁移完成标记
-- ============================================

-- 创建schema_migrations表（如果不存在）
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- 记录迁移信息
INSERT OR IGNORE INTO schema_migrations (version, description, applied_at)
VALUES (4, 'Add P2 optimization tables (Intent Fusion, Knowledge Distillation, Streaming Response)',
        strftime('%s', 'now') * 1000);

-- ============================================
-- 迁移脚本完成
-- ============================================
