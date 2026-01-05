-- 交互式任务规划系统相关表

-- 任务规划反馈表
CREATE TABLE IF NOT EXISTS task_plan_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  rating INTEGER,  -- 1-5星评分
  comment TEXT,    -- 文字评论
  issues TEXT,     -- JSON数组：遇到的问题
  suggestions TEXT, -- JSON数组：改进建议
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES project_task_plans(id)
);

-- 任务规划调整历史表
CREATE TABLE IF NOT EXISTS task_plan_adjustments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,  -- parameter_change, template_applied, regenerate
  old_value TEXT,  -- JSON
  new_value TEXT,  -- JSON
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES project_task_plans(id)
);

-- 模板使用统计表
CREATE TABLE IF NOT EXISTS template_usage_stats (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  used_at INTEGER NOT NULL,
  success BOOLEAN,
  quality_score INTEGER,  -- 0-100
  FOREIGN KEY (template_id) REFERENCES templates(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 技能使用统计表
CREATE TABLE IF NOT EXISTS skill_usage_stats (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  used_at INTEGER NOT NULL,
  success BOOLEAN,
  execution_time INTEGER,  -- 毫秒
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_feedback_session ON task_plan_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON task_plan_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_adjustments_session ON task_plan_adjustments(session_id);
CREATE INDEX IF NOT EXISTS idx_template_usage_template ON template_usage_stats(template_id);
CREATE INDEX IF NOT EXISTS idx_template_usage_project ON template_usage_stats(project_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage_stats(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_project ON skill_usage_stats(project_id);
