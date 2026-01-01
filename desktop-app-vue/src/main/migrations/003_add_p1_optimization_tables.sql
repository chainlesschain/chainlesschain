/**
 * P1优化数据库迁移
 *
 * 新增表:
 * 1. multi_intent_history - 多意图识别历史
 * 2. checkpoint_validations - 检查点校验记录
 * 3. self_correction_history - 自我修正历史
 *
 * 注意: intent_recognition_history 已在P0迁移中创建
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01
 */

-- ========================================
-- 1. 多意图识别历史表
-- ========================================

CREATE TABLE IF NOT EXISTS multi_intent_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  user_input TEXT NOT NULL,

  -- 识别结果
  is_multi_intent INTEGER NOT NULL,  -- 是否包含多个意图 (0=否, 1=是)
  intent_count INTEGER NOT NULL,     -- 意图数量
  intents TEXT NOT NULL,             -- JSON数组，包含所有识别到的意图

  -- 性能指标
  recognition_duration REAL,         -- 识别耗时(毫秒)
  confidence REAL,                   -- 整体置信度

  -- 执行结果
  success INTEGER DEFAULT 1,         -- 是否成功 (0=失败, 1=成功)

  -- 时间戳
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_multi_intent_user
ON multi_intent_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_multi_intent_type
ON multi_intent_history(is_multi_intent, intent_count);

CREATE INDEX IF NOT EXISTS idx_multi_intent_success
ON multi_intent_history(user_id, success);

-- ========================================
-- 2. 检查点校验记录表
-- ========================================

CREATE TABLE IF NOT EXISTS checkpoint_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 步骤信息
  step_index INTEGER NOT NULL,
  step_title TEXT NOT NULL,

  -- 校验结果
  passed INTEGER NOT NULL,           -- 是否通过 (0=未通过, 1=通过)
  failed_count INTEGER DEFAULT 0,    -- 失败的校验项数量
  critical_failures INTEGER DEFAULT 0, -- 关键失败数量

  -- 详细信息
  validations TEXT,                  -- JSON数组，所有校验项的详细结果
  recommendation TEXT,               -- 推荐动作 (continue/retry/skip)

  -- 时间戳
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_checkpoint_step
ON checkpoint_validations(step_index, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkpoint_passed
ON checkpoint_validations(passed, critical_failures);

CREATE INDEX IF NOT EXISTS idx_checkpoint_time
ON checkpoint_validations(created_at DESC);

-- ========================================
-- 3. 自我修正历史表
-- ========================================

CREATE TABLE IF NOT EXISTS self_correction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 计划信息
  plan_description TEXT NOT NULL,

  -- 执行结果
  total_steps INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,

  -- 修正信息
  attempts INTEGER NOT NULL,         -- 尝试次数
  corrections TEXT,                  -- JSON数组，所有修正记录

  -- 最终结果
  final_success INTEGER NOT NULL,    -- 最终是否成功 (0=失败, 1=成功)

  -- 时间戳
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_correction_success
ON self_correction_history(final_success, attempts);

CREATE INDEX IF NOT EXISTS idx_correction_time
ON self_correction_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_correction_attempts
ON self_correction_history(attempts, final_success);

-- ========================================
-- 4. 分层任务规划历史表（可选）
-- ========================================

CREATE TABLE IF NOT EXISTS hierarchical_planning_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 输入信息
  user_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  intent_description TEXT NOT NULL,

  -- 规划配置
  granularity TEXT NOT NULL,         -- 粒度 (coarse/medium/fine/auto)

  -- 规划结果
  business_steps INTEGER NOT NULL,   -- 业务层步骤数
  technical_steps INTEGER NOT NULL,  -- 技术层步骤数
  execution_steps INTEGER NOT NULL,  -- 执行层步骤数
  total_steps INTEGER NOT NULL,      -- 总步骤数

  -- 性能指标
  planning_duration REAL,            -- 规划耗时(毫秒)
  estimated_duration REAL,           -- 估算执行时间(秒)

  -- 详细计划
  plan_details TEXT,                 -- JSON对象，完整的分层计划

  -- 执行结果（可选，可在执行后更新）
  execution_success INTEGER,         -- 执行是否成功
  actual_duration REAL,              -- 实际执行时间(秒)

  -- 时间戳
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_hierarchical_user
ON hierarchical_planning_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hierarchical_granularity
ON hierarchical_planning_history(granularity, total_steps);

CREATE INDEX IF NOT EXISTS idx_hierarchical_success
ON hierarchical_planning_history(execution_success, granularity);

-- ========================================
-- 5. 视图：P1优化效果统计
-- ========================================

-- 多意图识别统计视图
CREATE VIEW IF NOT EXISTS v_multi_intent_stats AS
SELECT
  DATE(created_at / 1000, 'unixepoch') as date,
  COUNT(*) as total_requests,
  SUM(CASE WHEN is_multi_intent = 1 THEN 1 ELSE 0 END) as multi_intent_count,
  AVG(intent_count) as avg_intent_count,
  AVG(recognition_duration) as avg_duration,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
  CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
FROM multi_intent_history
GROUP BY DATE(created_at / 1000, 'unixepoch');

-- 检查点校验统计视图
CREATE VIEW IF NOT EXISTS v_checkpoint_stats AS
SELECT
  DATE(created_at / 1000, 'unixepoch') as date,
  COUNT(*) as total_validations,
  SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count,
  SUM(failed_count) as total_failures,
  SUM(critical_failures) as total_critical_failures,
  CAST(SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as pass_rate
FROM checkpoint_validations
GROUP BY DATE(created_at / 1000, 'unixepoch');

-- 自我修正效果统计视图
CREATE VIEW IF NOT EXISTS v_correction_effectiveness AS
SELECT
  DATE(created_at / 1000, 'unixepoch') as date,
  COUNT(*) as total_executions,
  SUM(CASE WHEN final_success = 1 THEN 1 ELSE 0 END) as final_successes,
  AVG(attempts) as avg_attempts,
  SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) as corrected_count,
  CAST(SUM(CASE WHEN final_success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate,
  CAST(SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as correction_rate
FROM self_correction_history
GROUP BY DATE(created_at / 1000, 'unixepoch');

-- 分层规划效果统计视图
CREATE VIEW IF NOT EXISTS v_hierarchical_planning_stats AS
SELECT
  granularity,
  COUNT(*) as total_plans,
  AVG(total_steps) as avg_total_steps,
  AVG(business_steps) as avg_business_steps,
  AVG(technical_steps) as avg_technical_steps,
  AVG(execution_steps) as avg_execution_steps,
  AVG(planning_duration) as avg_planning_duration,
  AVG(estimated_duration) as avg_estimated_duration,
  SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) as execution_successes,
  CAST(SUM(CASE WHEN execution_success = 1 THEN 1 ELSE 0 END) AS REAL) /
    NULLIF(SUM(CASE WHEN execution_success IS NOT NULL THEN 1 ELSE 0 END), 0) as execution_success_rate
FROM hierarchical_planning_history
GROUP BY granularity;

-- ========================================
-- 6. P1优化综合统计视图
-- ========================================

CREATE VIEW IF NOT EXISTS v_p1_optimization_summary AS
SELECT
  'multi_intent' as feature,
  COUNT(*) as total_uses,
  SUM(CASE WHEN is_multi_intent = 1 THEN 1 ELSE 0 END) as feature_activated,
  AVG(recognition_duration) as avg_duration,
  CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
FROM multi_intent_history
WHERE created_at > (strftime('%s', 'now') - 7 * 24 * 60 * 60) * 1000

UNION ALL

SELECT
  'checkpoint_validation' as feature,
  COUNT(*) as total_uses,
  SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as feature_activated,
  NULL as avg_duration,
  CAST(SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
FROM checkpoint_validations
WHERE created_at > (strftime('%s', 'now') - 7 * 24 * 60 * 60) * 1000

UNION ALL

SELECT
  'self_correction' as feature,
  COUNT(*) as total_uses,
  SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) as feature_activated,
  NULL as avg_duration,
  CAST(SUM(CASE WHEN final_success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
FROM self_correction_history
WHERE created_at > (strftime('%s', 'now') - 7 * 24 * 60 * 60) * 1000;

-- ========================================
-- 7. 数据清理触发器（保留90天数据）
-- ========================================

-- 多意图识别历史清理
CREATE TRIGGER IF NOT EXISTS cleanup_multi_intent_history
AFTER INSERT ON multi_intent_history
BEGIN
  DELETE FROM multi_intent_history
  WHERE created_at < (strftime('%s', 'now') - 90 * 24 * 60 * 60) * 1000;
END;

-- 检查点校验记录清理
CREATE TRIGGER IF NOT EXISTS cleanup_checkpoint_validations
AFTER INSERT ON checkpoint_validations
BEGIN
  DELETE FROM checkpoint_validations
  WHERE created_at < (strftime('%s', 'now') - 90 * 24 * 60 * 60) * 1000;
END;

-- 自我修正历史清理
CREATE TRIGGER IF NOT EXISTS cleanup_self_correction_history
AFTER INSERT ON self_correction_history
BEGIN
  DELETE FROM self_correction_history
  WHERE created_at < (strftime('%s', 'now') - 90 * 24 * 60 * 60) * 1000;
END;

-- 分层规划历史清理
CREATE TRIGGER IF NOT EXISTS cleanup_hierarchical_planning_history
AFTER INSERT ON hierarchical_planning_history
BEGIN
  DELETE FROM hierarchical_planning_history
  WHERE created_at < (strftime('%s', 'now') - 90 * 24 * 60 * 60) * 1000;
END;
