-- =============================================================================
-- 错误分析和 AI 诊断系统数据库表
-- =============================================================================
-- 版本: 1.0.0
-- 创建时间: 2026-01-16
-- 说明: 支持 ErrorMonitor 的 AI 诊断功能和错误分析历史管理
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 错误分析记录表
-- -----------------------------------------------------------------------------
-- 存储每次错误的详细分析结果，包括 AI 诊断和修复建议
CREATE TABLE IF NOT EXISTS error_analysis (
  -- 主键和外键
  id TEXT PRIMARY KEY,                      -- 分析记录唯一标识 (UUID)
  error_id TEXT,                             -- 关联的错误 ID（如果有）

  -- 错误基本信息
  error_message TEXT NOT NULL,              -- 错误消息
  error_stack TEXT,                          -- 错误堆栈跟踪
  error_type TEXT,                           -- 错误类型 (Error, TypeError, ReferenceError 等)

  -- 错误分类和严重程度
  classification TEXT,                       -- 错误分类 (DATABASE, NETWORK, FILESYSTEM, VALIDATION, etc.)
  severity TEXT,                             -- 严重程度 (low, medium, high, critical)

  -- 上下文信息
  context TEXT,                              -- 错误发生时的上下文 (JSON 格式)
  keywords TEXT,                             -- 提取的关键词列表 (JSON 数组)

  -- 自动修复结果
  auto_fix_attempted INTEGER DEFAULT 0,    -- 是否尝试自动修复 (0=否, 1=是)
  auto_fix_success INTEGER DEFAULT 0,       -- 自动修复是否成功 (0=失败, 1=成功)
  auto_fix_strategy TEXT,                    -- 使用的自动修复策略
  auto_fix_result TEXT,                      -- 自动修复结果详情 (JSON 格式)

  -- AI 诊断结果
  ai_diagnosis_enabled INTEGER DEFAULT 1,   -- 是否启用 AI 诊断
  ai_diagnosis TEXT,                         -- AI 诊断结果 (JSON 格式)
  ai_root_cause TEXT,                        -- AI 识别的根本原因
  ai_fix_suggestions TEXT,                   -- AI 提供的修复建议 (JSON 数组)
  ai_best_practices TEXT,                    -- AI 提供的最佳实践建议
  ai_related_docs TEXT,                      -- AI 推荐的相关文档链接 (JSON 数组)

  -- 相关问题
  related_issues TEXT,                       -- 相关历史错误 (JSON 数组, 包含 ID 和相似度)
  related_issues_count INTEGER DEFAULT 0,   -- 相关问题数量

  -- 处理状态
  status TEXT DEFAULT 'new',                 -- 状态: new, analyzing, analyzed, fixing, fixed, ignored
  resolution TEXT,                            -- 解决方案描述
  resolved_at INTEGER,                        -- 解决时间戳

  -- 元数据
  created_at INTEGER NOT NULL,              -- 创建时间戳
  updated_at INTEGER NOT NULL,              -- 更新时间戳

  -- 索引键
  UNIQUE(id)
);

-- 为常用查询字段创建索引
CREATE INDEX IF NOT EXISTS idx_error_analysis_classification
  ON error_analysis(classification);

CREATE INDEX IF NOT EXISTS idx_error_analysis_severity
  ON error_analysis(severity);

CREATE INDEX IF NOT EXISTS idx_error_analysis_status
  ON error_analysis(status);

CREATE INDEX IF NOT EXISTS idx_error_analysis_created_at
  ON error_analysis(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_analysis_error_id
  ON error_analysis(error_id);

-- 为关键词搜索创建全文索引（如果 SQLite 支持 FTS5）
-- CREATE VIRTUAL TABLE IF NOT EXISTS error_analysis_fts USING fts5(
--   error_message,
--   error_stack,
--   ai_root_cause,
--   content=error_analysis,
--   content_rowid=rowid
-- );

-- -----------------------------------------------------------------------------
-- 2. 错误统计视图
-- -----------------------------------------------------------------------------
-- 提供错误分类和严重程度的统计信息
CREATE VIEW IF NOT EXISTS error_stats_by_classification AS
SELECT
  classification,
  COUNT(*) as total_count,
  SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
  SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
  SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium_count,
  SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low_count,
  SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count,
  SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as resolved_count,
  MAX(created_at) as last_occurrence
FROM error_analysis
GROUP BY classification
ORDER BY total_count DESC;

-- 按严重程度统计
CREATE VIEW IF NOT EXISTS error_stats_by_severity AS
SELECT
  severity,
  COUNT(*) as total_count,
  SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count,
  SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as resolved_count,
  AVG(CASE WHEN resolved_at IS NOT NULL
      THEN (resolved_at - created_at) / 1000.0
      ELSE NULL
    END) as avg_resolution_time_seconds,
  MAX(created_at) as last_occurrence
FROM error_analysis
GROUP BY severity
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END;

-- 每日错误趋势
CREATE VIEW IF NOT EXISTS error_daily_trend AS
SELECT
  DATE(created_at / 1000, 'unixepoch') as error_date,
  COUNT(*) as total_count,
  SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
  SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
  SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count
FROM error_analysis
GROUP BY error_date
ORDER BY error_date DESC
LIMIT 30;

-- -----------------------------------------------------------------------------
-- 3. 错误诊断配置表
-- -----------------------------------------------------------------------------
-- 存储 AI 诊断的配置和偏好设置
CREATE TABLE IF NOT EXISTS error_diagnosis_config (
  id TEXT PRIMARY KEY DEFAULT 'default',

  -- AI 诊断配置
  enable_ai_diagnosis INTEGER DEFAULT 1,    -- 是否启用 AI 诊断
  llm_provider TEXT DEFAULT 'ollama',       -- LLM 提供商
  llm_model TEXT DEFAULT 'qwen2:7b',        -- LLM 模型
  llm_temperature REAL DEFAULT 0.1,         -- LLM 温度参数

  -- 自动修复配置
  enable_auto_fix INTEGER DEFAULT 1,        -- 是否启用自动修复
  auto_fix_strategies TEXT,                  -- 启用的修复策略列表 (JSON 数组)

  -- 诊断偏好
  analysis_depth TEXT DEFAULT 'standard',   -- 分析深度: quick, standard, deep
  include_context INTEGER DEFAULT 1,        -- 是否包含上下文信息
  include_related_issues INTEGER DEFAULT 1, -- 是否查找相关问题
  related_issues_limit INTEGER DEFAULT 5,   -- 相关问题数量限制

  -- 清理策略
  retention_days INTEGER DEFAULT 30,        -- 保留天数（旧记录会被清理）
  auto_cleanup INTEGER DEFAULT 1,           -- 是否自动清理旧记录

  -- 元数据
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 插入默认配置
INSERT OR IGNORE INTO error_diagnosis_config (
  id,
  enable_ai_diagnosis,
  llm_provider,
  llm_model,
  llm_temperature,
  enable_auto_fix,
  auto_fix_strategies,
  analysis_depth,
  include_context,
  include_related_issues,
  related_issues_limit,
  retention_days,
  auto_cleanup,
  created_at,
  updated_at
) VALUES (
  'default',
  1,
  'ollama',
  'qwen2:7b',
  0.1,
  1,
  '["retry", "timeout_increase", "fallback", "validation"]',
  'standard',
  1,
  1,
  5,
  30,
  1,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

-- =============================================================================
-- 迁移完成
-- =============================================================================
