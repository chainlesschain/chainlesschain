-- ==========================================
-- 用户反馈收集系统数据库迁移
-- 版本: v0.20.1
-- 日期: 2026-01-02
-- ==========================================

-- 1. 用户反馈表
-- 记录用户对P0/P1/P2优化功能的反馈
CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 反馈基本信息
  user_id TEXT,
  session_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK(feedback_type IN ('bug', 'feature', 'performance', 'experience', 'other')),

  -- 反馈内容
  title TEXT NOT NULL,
  description TEXT,
  rating INTEGER CHECK(rating >= 1 AND rating <= 5),  -- 1-5星评分

  -- 关联的优化功能
  related_feature TEXT CHECK(related_feature IN (
    'slot_filling',           -- P0: 槽位填充
    'tool_sandbox',           -- P0: 工具沙箱
    'performance_monitor',    -- P0: 性能监控
    'multi_intent',           -- P1: 多意图识别
    'dynamic_fewshot',        -- P1: 动态Few-shot
    'hierarchical_planning',  -- P1: 分层规划
    'checkpoint_validation',  -- P1: 检查点校验
    'self_correction',        -- P1: 自我修正
    'intent_fusion',          -- P2: 意图融合
    'knowledge_distillation', -- P2: 知识蒸馏
    'streaming_response',     -- P2: 流式响应
    'general'                 -- 通用反馈
  )),

  -- 元数据
  user_agent TEXT,
  app_version TEXT,
  platform TEXT,

  -- 状态追踪
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved', 'closed')),
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'critical')),

  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

-- 2. 满意度调查表
-- 定期收集用户对整体系统的满意度
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id TEXT,
  session_id TEXT NOT NULL,

  -- 各功能满意度评分 (1-5分)
  p0_satisfaction INTEGER CHECK(p0_satisfaction >= 1 AND p0_satisfaction <= 5),
  p1_satisfaction INTEGER CHECK(p1_satisfaction >= 1 AND p1_satisfaction <= 5),
  p2_satisfaction INTEGER CHECK(p2_satisfaction >= 1 AND p2_satisfaction <= 5),
  overall_satisfaction INTEGER CHECK(overall_satisfaction >= 1 AND overall_satisfaction <= 5),

  -- 体验指标
  perceived_speed INTEGER CHECK(perceived_speed >= 1 AND perceived_speed <= 5),  -- 感知速度
  task_success_rate INTEGER CHECK(task_success_rate >= 1 AND task_success_rate <= 5),  -- 任务成功率感知
  ease_of_use INTEGER CHECK(ease_of_use >= 1 AND ease_of_use <= 5),  -- 易用性

  -- 开放式反馈
  likes TEXT,          -- 喜欢的功能
  dislikes TEXT,       -- 不喜欢的功能
  suggestions TEXT,    -- 改进建议

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 功能使用情况追踪表
-- 记录用户实际使用各功能的频率
CREATE TABLE IF NOT EXISTS feature_usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id TEXT,
  session_id TEXT NOT NULL,
  feature_name TEXT NOT NULL,

  -- 使用统计
  usage_count INTEGER DEFAULT 1,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  -- 性能统计
  avg_duration_ms REAL,
  min_duration_ms REAL,
  max_duration_ms REAL,

  -- 用户行为
  user_interrupted INTEGER DEFAULT 0,  -- 用户是否中断操作
  user_retried INTEGER DEFAULT 0,      -- 用户是否重试

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. 性能问题报告表
-- 自动记录性能异常
CREATE TABLE IF NOT EXISTS performance_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  session_id TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK(issue_type IN (
    'timeout',
    'high_latency',
    'memory_leak',
    'crash',
    'error',
    'other'
  )),

  -- 问题详情
  error_message TEXT,
  stack_trace TEXT,
  duration_ms REAL,
  memory_usage_mb REAL,

  -- 环境信息
  platform TEXT,
  app_version TEXT,
  node_version TEXT,

  -- 修复状态
  auto_recovered INTEGER DEFAULT 0,
  reported_to_user INTEGER DEFAULT 0,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 索引创建
-- ==========================================

-- 用户反馈索引
CREATE INDEX IF NOT EXISTS idx_feedback_user ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON user_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_feature ON user_feedback(related_feature);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON user_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON user_feedback(created_at);

-- 满意度调查索引
CREATE INDEX IF NOT EXISTS idx_survey_user ON satisfaction_surveys(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_created ON satisfaction_surveys(created_at);

-- 功能使用追踪索引
CREATE INDEX IF NOT EXISTS idx_usage_feature ON feature_usage_tracking(feature_name);
CREATE INDEX IF NOT EXISTS idx_usage_user ON feature_usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_session ON feature_usage_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON feature_usage_tracking(created_at);

-- 性能问题索引
CREATE INDEX IF NOT EXISTS idx_perf_issue_feature ON performance_issues(feature_name);
CREATE INDEX IF NOT EXISTS idx_perf_issue_type ON performance_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_perf_issue_created ON performance_issues(created_at);

-- ==========================================
-- 视图创建
-- ==========================================

-- 反馈统计视图
CREATE VIEW IF NOT EXISTS v_feedback_stats AS
SELECT
  related_feature,
  COUNT(*) as total_feedback,
  AVG(rating) as avg_rating,
  SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as positive_rate,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
  COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count
FROM user_feedback
GROUP BY related_feature;

-- 满意度趋势视图
CREATE VIEW IF NOT EXISTS v_satisfaction_trends AS
SELECT
  DATE(created_at) as date,
  AVG(p0_satisfaction) as avg_p0,
  AVG(p1_satisfaction) as avg_p1,
  AVG(p2_satisfaction) as avg_p2,
  AVG(overall_satisfaction) as avg_overall,
  AVG(perceived_speed) as avg_speed,
  COUNT(*) as survey_count
FROM satisfaction_surveys
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- 功能使用热度视图
CREATE VIEW IF NOT EXISTS v_feature_popularity AS
SELECT
  feature_name,
  SUM(usage_count) as total_usage,
  SUM(success_count) as total_success,
  SUM(failure_count) as total_failure,
  ROUND(SUM(success_count) * 100.0 / NULLIF(SUM(success_count) + SUM(failure_count), 0), 2) as success_rate,
  AVG(avg_duration_ms) as avg_duration
FROM feature_usage_tracking
GROUP BY feature_name
ORDER BY total_usage DESC;

-- 性能问题热点视图
CREATE VIEW IF NOT EXISTS v_performance_hotspots AS
SELECT
  feature_name,
  issue_type,
  COUNT(*) as issue_count,
  AVG(duration_ms) as avg_duration,
  SUM(auto_recovered) as auto_recovered_count,
  MAX(created_at) as last_occurrence
FROM performance_issues
WHERE created_at >= datetime('now', '-7 days')
GROUP BY feature_name, issue_type
HAVING issue_count > 0
ORDER BY issue_count DESC;

-- ==========================================
-- 触发器：自动清理过期数据
-- ==========================================

-- 清理90天前的已解决反馈
CREATE TRIGGER IF NOT EXISTS cleanup_old_feedback
AFTER INSERT ON user_feedback
BEGIN
  DELETE FROM user_feedback
  WHERE status IN ('resolved', 'closed')
    AND resolved_at < datetime('now', '-90 days');
END;

-- 清理180天前的满意度调查
CREATE TRIGGER IF NOT EXISTS cleanup_old_surveys
AFTER INSERT ON satisfaction_surveys
BEGIN
  DELETE FROM satisfaction_surveys
  WHERE created_at < datetime('now', '-180 days');
END;

-- 清理30天前的功能使用记录
CREATE TRIGGER IF NOT EXISTS cleanup_old_usage
AFTER INSERT ON feature_usage_tracking
BEGIN
  DELETE FROM feature_usage_tracking
  WHERE created_at < datetime('now', '-30 days');
END;

-- 清理30天前的性能问题（已修复的）
CREATE TRIGGER IF NOT EXISTS cleanup_old_perf_issues
AFTER INSERT ON performance_issues
BEGIN
  DELETE FROM performance_issues
  WHERE auto_recovered = 1
    AND created_at < datetime('now', '-30 days');
END;
