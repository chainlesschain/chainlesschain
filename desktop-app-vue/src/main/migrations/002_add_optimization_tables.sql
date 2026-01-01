-- =====================================================
-- AI Pipeline 优化数据库表
-- 版本: v0.16.1
-- 日期: 2026-01-01
-- 功能: 槽位填充历史、工具执行日志、性能监控
-- =====================================================

-- =====================================================
-- 表1: 槽位填充历史 (Slot Filling History)
-- 用途: 学习用户偏好，个性化参数推断
-- =====================================================
CREATE TABLE IF NOT EXISTS slot_filling_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,              -- 用户ID
  intent_type TEXT NOT NULL,          -- 意图类型 (create_file, edit_file, etc.)
  entities TEXT NOT NULL,             -- 填充后的实体 (JSON格式)
  user_input TEXT,                    -- 原始用户输入
  filled_slots TEXT,                  -- 已填充的槽位列表 (JSON数组)
  missing_slots TEXT,                 -- 缺失的槽位列表 (JSON数组)
  completeness REAL,                  -- 完整度百分比 (0-100)
  success INTEGER DEFAULT 1,          -- 是否成功 (1=成功, 0=失败)
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  -- 索引
  -- 按用户ID和意图类型查询（用于学习用户偏好）
  -- 按创建时间查询（获取最近的记录）
  CONSTRAINT chk_success CHECK (success IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_slot_user_intent
ON slot_filling_history(user_id, intent_type, success);

CREATE INDEX IF NOT EXISTS idx_slot_created
ON slot_filling_history(created_at DESC);

-- =====================================================
-- 表2: 工具执行日志 (Tool Execution Logs)
-- 用途: 记录工具调用情况，分析成功率和错误模式
-- =====================================================
CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,            -- 工具名称
  params TEXT,                        -- 调用参数 (JSON格式)
  success INTEGER NOT NULL,           -- 是否成功 (1=成功, 0=失败)
  duration REAL NOT NULL,             -- 执行耗时 (毫秒)
  error_type TEXT,                    -- 错误类型 (timeout, network, validation, etc.)
  error_message TEXT,                 -- 错误详细信息
  retry_count INTEGER DEFAULT 0,      -- 重试次数
  session_id TEXT,                    -- 会话ID
  user_id TEXT,                       -- 用户ID
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  CONSTRAINT chk_tool_success CHECK (success IN (0, 1)),
  CONSTRAINT chk_retry_count CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tool_name
ON tool_execution_logs(tool_name, success);

CREATE INDEX IF NOT EXISTS idx_tool_created
ON tool_execution_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_session
ON tool_execution_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_tool_error
ON tool_execution_logs(error_type) WHERE error_type IS NOT NULL;

-- =====================================================
-- 表3: 性能监控指标 (Performance Metrics)
-- 用途: 记录各阶段性能数据，生成P50/P90/P95报告
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL,                -- 阶段名称 (intent_recognition, task_planning, etc.)
  duration REAL NOT NULL,             -- 耗时 (毫秒)
  metadata TEXT,                      -- 元数据 (JSON格式，存储额外信息)
  user_id TEXT,                       -- 用户ID
  session_id TEXT,                    -- 会话ID
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  CONSTRAINT chk_duration CHECK (duration >= 0)
);

CREATE INDEX IF NOT EXISTS idx_perf_phase_created
ON performance_metrics(phase, created_at);

CREATE INDEX IF NOT EXISTS idx_perf_session
ON performance_metrics(session_id);

CREATE INDEX IF NOT EXISTS idx_perf_created
ON performance_metrics(created_at DESC);

-- =====================================================
-- 表4: 意图识别历史 (Intent Recognition History)
-- 用途: 动态Few-shot学习，记录成功的意图识别
-- =====================================================
CREATE TABLE IF NOT EXISTS intent_recognition_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,              -- 用户ID
  user_input TEXT NOT NULL,           -- 用户输入
  intent TEXT NOT NULL,               -- 识别的意图
  entities TEXT,                      -- 提取的实体 (JSON格式)
  confidence REAL NOT NULL,           -- 置信度 (0-1)
  classifier_type TEXT,               -- 识别器类型 (keyword, fewshot, llm)
  success INTEGER DEFAULT 1,          -- 是否成功 (1=成功, 0=失败)
  user_confirmed INTEGER DEFAULT 0,   -- 用户是否确认 (1=确认, 0=未确认)
  session_id TEXT,                    -- 会话ID
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  CONSTRAINT chk_intent_confidence CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT chk_intent_success CHECK (success IN (0, 1)),
  CONSTRAINT chk_user_confirmed CHECK (user_confirmed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_intent_user_intent
ON intent_recognition_history(user_id, intent, success);

CREATE INDEX IF NOT EXISTS idx_intent_created
ON intent_recognition_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intent_confidence
ON intent_recognition_history(confidence DESC);

-- =====================================================
-- 表5: 任务执行历史 (Task Execution History)
-- 用途: 记录完整的任务执行过程，用于反馈学习
-- =====================================================
CREATE TABLE IF NOT EXISTS task_execution_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_input TEXT NOT NULL,           -- 原始用户输入
  intent_type TEXT NOT NULL,          -- 意图类型
  task_plan TEXT,                     -- 任务计划 (JSON格式)
  execution_steps TEXT,               -- 执行步骤详情 (JSON数组)
  success INTEGER NOT NULL,           -- 整体是否成功 (1=成功, 0=失败)
  total_duration REAL NOT NULL,       -- 总耗时 (毫秒)
  failed_step_index INTEGER,          -- 失败步骤索引 (如果有)
  error_message TEXT,                 -- 错误信息
  retry_count INTEGER DEFAULT 0,      -- 重试次数
  user_id TEXT,                       -- 用户ID
  session_id TEXT,                    -- 会话ID
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  CONSTRAINT chk_task_success CHECK (success IN (0, 1)),
  CONSTRAINT chk_task_retry CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_task_user_intent
ON task_execution_history(user_id, intent_type, success);

CREATE INDEX IF NOT EXISTS idx_task_created
ON task_execution_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_session
ON task_execution_history(session_id);

-- =====================================================
-- 表6: 用户偏好设置 (User Preferences)
-- 用途: 存储用户的个性化配置和学习到的偏好
-- =====================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,              -- 用户ID
  preference_key TEXT NOT NULL,       -- 偏好键 (如: default_theme, default_platform)
  preference_value TEXT NOT NULL,     -- 偏好值
  intent_type TEXT,                   -- 关联的意图类型（可选）
  usage_count INTEGER DEFAULT 1,      -- 使用次数
  last_used_at INTEGER NOT NULL,      -- 最后使用时间
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)

  CONSTRAINT chk_usage_count CHECK (usage_count >= 1),
  UNIQUE(user_id, preference_key, intent_type)
);

CREATE INDEX IF NOT EXISTS idx_pref_user_key
ON user_preferences(user_id, preference_key);

CREATE INDEX IF NOT EXISTS idx_pref_intent
ON user_preferences(intent_type) WHERE intent_type IS NOT NULL;

-- =====================================================
-- 表7: 优化建议历史 (Optimization Suggestions)
-- 用途: 记录系统生成的优化建议和用户采纳情况
-- =====================================================
CREATE TABLE IF NOT EXISTS optimization_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL,                -- 优化阶段 (intent_recognition, task_planning, etc.)
  severity TEXT NOT NULL,             -- 严重程度 (low, medium, high, critical)
  issue TEXT NOT NULL,                -- 问题描述
  suggestions TEXT NOT NULL,          -- 建议措施 (JSON数组)
  priority TEXT NOT NULL,             -- 优先级 (low, medium, high, critical)
  user_action TEXT,                   -- 用户操作 (accepted, rejected, ignored)
  implemented INTEGER DEFAULT 0,      -- 是否已实施 (1=已实施, 0=未实施)
  result_description TEXT,            -- 实施结果描述
  created_at INTEGER NOT NULL,        -- 创建时间戳 (毫秒)
  updated_at INTEGER,                 -- 更新时间戳 (毫秒)

  CONSTRAINT chk_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_implemented CHECK (implemented IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_optim_phase
ON optimization_suggestions(phase, severity);

CREATE INDEX IF NOT EXISTS idx_optim_created
ON optimization_suggestions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_optim_priority
ON optimization_suggestions(priority, implemented);

-- =====================================================
-- 数据库版本信息
-- =====================================================
CREATE TABLE IF NOT EXISTS db_version (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO db_version (version, applied_at, description)
VALUES ('0.16.1', strftime('%s', 'now') * 1000, 'AI Pipeline 优化表');

-- =====================================================
-- 插入初始化数据（可选）
-- =====================================================

-- 默认性能阈值配置（可选，也可以在代码中定义）
-- 这里仅做记录，不实际使用
-- INSERT INTO system_config (key, value) VALUES
-- ('perf_threshold_intent_recognition', '{"warning": 1500, "critical": 3000}'),
-- ('perf_threshold_task_planning', '{"warning": 4000, "critical": 8000}');

-- =====================================================
-- 清理视图（用于快速查询）
-- =====================================================

-- 视图1: 工具执行成功率统计
CREATE VIEW IF NOT EXISTS v_tool_success_rate AS
SELECT
  tool_name,
  COUNT(*) as total_calls,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_calls,
  ROUND(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
  AVG(duration) as avg_duration,
  MAX(created_at) as last_called_at
FROM tool_execution_logs
GROUP BY tool_name;

-- 视图2: 用户意图偏好统计
CREATE VIEW IF NOT EXISTS v_user_intent_preference AS
SELECT
  user_id,
  intent,
  COUNT(*) as usage_count,
  AVG(confidence) as avg_confidence,
  MAX(created_at) as last_used_at
FROM intent_recognition_history
WHERE success = 1
GROUP BY user_id, intent
ORDER BY user_id, usage_count DESC;

-- 视图3: 性能瓶颈Top10
CREATE VIEW IF NOT EXISTS v_performance_bottlenecks AS
SELECT
  phase,
  duration,
  metadata,
  session_id,
  created_at
FROM performance_metrics
WHERE duration > 5000  -- 超过5秒
ORDER BY duration DESC
LIMIT 10;

-- =====================================================
-- 完成
-- =====================================================
-- 迁移脚本执行完成
-- 新增表: 7个
-- 新增索引: 20个
-- 新增视图: 3个
-- =====================================================
