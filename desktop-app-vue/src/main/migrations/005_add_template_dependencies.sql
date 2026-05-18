-- ============================================
-- 模板依赖关系扩展迁移脚本
-- 版本: v0.18.0
-- 创建日期: 2026-01-01
-- 依赖: 004_add_p2_optimization_tables.sql (可选)
-- ============================================
--
-- 功能：
-- 1. 为 project_templates 表添加技能/工具依赖字段
-- 2. 添加执行引擎类型、难度级别、预计耗时字段
-- 3. 创建模板-技能-工具关联映射表
-- 4. 添加相关索引和视图
--
-- 目标：
-- - 建立模板与技能/工具之间的明确依赖关系
-- - 支持模板执行前的自动依赖检查
-- - 便于追踪和管理模板能力需求
-- ============================================

-- ============================================
-- 第一部分：扩展 project_templates 表
-- ============================================

-- 添加技能/工具依赖字段
ALTER TABLE project_templates ADD COLUMN required_skills TEXT DEFAULT '[]';
ALTER TABLE project_templates ADD COLUMN required_tools TEXT DEFAULT '[]';

-- 添加执行引擎类型
-- 可选值: default, word, excel, ppt, code, ml, video, audio, web
ALTER TABLE project_templates ADD COLUMN execution_engine TEXT DEFAULT 'default';

-- 添加难度级别
-- 可选值: easy, medium, hard, expert
ALTER TABLE project_templates ADD COLUMN difficulty_level TEXT DEFAULT 'medium';

-- 添加预计执行时长（秒）
ALTER TABLE project_templates ADD COLUMN estimated_duration INTEGER DEFAULT 0;

-- 添加模板版本号（便于后续升级）
ALTER TABLE project_templates ADD COLUMN template_version TEXT DEFAULT '1.0.0';

-- 添加最后使用时间（用于统计）
ALTER TABLE project_templates ADD COLUMN last_used_at INTEGER;

-- 添加使用次数（用于统计）
ALTER TABLE project_templates ADD COLUMN usage_count INTEGER DEFAULT 0;

-- ============================================
-- 第二部分：创建索引
-- ============================================

-- 类别索引
CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category);

-- 难度级别索引
CREATE INDEX IF NOT EXISTS idx_templates_difficulty ON project_templates(difficulty_level);

-- 执行引擎索引
CREATE INDEX IF NOT EXISTS idx_templates_engine ON project_templates(execution_engine);

-- 项目类型索引
CREATE INDEX IF NOT EXISTS idx_templates_project_type ON project_templates(project_type);

-- 启用状态索引
CREATE INDEX IF NOT EXISTS idx_templates_enabled ON project_templates(enabled);

-- 使用频率索引（倒序，便于查询热门模板）
CREATE INDEX IF NOT EXISTS idx_templates_usage ON project_templates(usage_count DESC);

-- 最后使用时间索引
CREATE INDEX IF NOT EXISTS idx_templates_last_used ON project_templates(last_used_at DESC);

-- ============================================
-- 第三部分：创建模板-技能-工具关联映射表
-- ============================================

CREATE TABLE IF NOT EXISTS template_skill_tool_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 关联ID
  template_id TEXT NOT NULL,
  skill_id TEXT,
  tool_id TEXT,

  -- 关联类型
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('requires_skill', 'requires_tool')),

  -- 是否可选（0=必需，1=可选）
  is_optional INTEGER DEFAULT 0 CHECK (is_optional IN (0, 1)),

  -- 优先级（1-5，1最高）
  priority INTEGER DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),

  -- 备注说明
  notes TEXT,

  -- 时间戳
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- 约束：至少要有 skill_id 或 tool_id 之一
  CHECK (skill_id IS NOT NULL OR tool_id IS NOT NULL)
);

-- 映射表索引
CREATE INDEX IF NOT EXISTS idx_mapping_template ON template_skill_tool_mapping(template_id);
CREATE INDEX IF NOT EXISTS idx_mapping_skill ON template_skill_tool_mapping(skill_id);
CREATE INDEX IF NOT EXISTS idx_mapping_tool ON template_skill_tool_mapping(tool_id);
CREATE INDEX IF NOT EXISTS idx_mapping_type ON template_skill_tool_mapping(relationship_type);
CREATE INDEX IF NOT EXISTS idx_mapping_optional ON template_skill_tool_mapping(is_optional);

-- ============================================
-- 第四部分：扩展 builtin_tools 表（可选字段）
-- ============================================

-- 添加反向关联字段（记录哪些技能使用了此工具）
ALTER TABLE builtin_tools ADD COLUMN used_by_skills TEXT DEFAULT '[]';

-- 添加使用统计
ALTER TABLE builtin_tools ADD COLUMN usage_count INTEGER DEFAULT 0;
ALTER TABLE builtin_tools ADD COLUMN last_used_at INTEGER;

-- 添加工具版本号
ALTER TABLE builtin_tools ADD COLUMN tool_version TEXT DEFAULT '1.0.0';

-- 工具表索引
CREATE INDEX IF NOT EXISTS idx_tools_category ON builtin_tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_usage ON builtin_tools(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON builtin_tools(enabled);

-- ============================================
-- 第五部分：扩展 builtin_skills 表（可选字段）
-- ============================================

-- 添加使用统计
ALTER TABLE builtin_skills ADD COLUMN usage_count INTEGER DEFAULT 0;
ALTER TABLE builtin_skills ADD COLUMN last_used_at INTEGER;

-- 添加技能级别（初级/中级/高级）
ALTER TABLE builtin_skills ADD COLUMN skill_level TEXT DEFAULT 'intermediate';

-- 添加技能版本号
ALTER TABLE builtin_skills ADD COLUMN skill_version TEXT DEFAULT '1.0.0';

-- 技能表索引
CREATE INDEX IF NOT EXISTS idx_skills_category ON builtin_skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_usage ON builtin_skills(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON builtin_skills(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_level ON builtin_skills(skill_level);

-- ============================================
-- 第六部分：创建统计视图
-- ============================================

-- 视图1: 模板能力需求统计
CREATE VIEW IF NOT EXISTS v_template_capability_stats AS
SELECT
  category,
  COUNT(*) as total_templates,
  AVG(json_array_length(required_skills)) as avg_skills_required,
  AVG(json_array_length(required_tools)) as avg_tools_required,
  COUNT(CASE WHEN difficulty_level = 'easy' THEN 1 END) as easy_count,
  COUNT(CASE WHEN difficulty_level = 'medium' THEN 1 END) as medium_count,
  COUNT(CASE WHEN difficulty_level = 'hard' THEN 1 END) as hard_count,
  COUNT(CASE WHEN difficulty_level = 'expert' THEN 1 END) as expert_count,
  AVG(estimated_duration) as avg_duration_seconds
FROM project_templates
WHERE enabled = 1
GROUP BY category
ORDER BY total_templates DESC;

-- 视图2: 最常用模板排行
CREATE VIEW IF NOT EXISTS v_popular_templates AS
SELECT
  id,
  name,
  display_name,
  category,
  usage_count,
  last_used_at,
  difficulty_level,
  execution_engine,
  datetime(last_used_at / 1000, 'unixepoch') as last_used_datetime
FROM project_templates
WHERE enabled = 1 AND usage_count > 0
ORDER BY usage_count DESC
LIMIT 50;

-- 视图3: 技能使用频率统计
CREATE VIEW IF NOT EXISTS v_skill_usage_stats AS
SELECT
  s.id,
  s.name,
  s.display_name,
  s.category,
  s.usage_count,
  COUNT(DISTINCT m.template_id) as used_by_templates_count,
  json_array_length(s.tools) as tools_count
FROM builtin_skills s
LEFT JOIN template_skill_tool_mapping m ON s.id = m.skill_id
WHERE s.enabled = 1
GROUP BY s.id
ORDER BY s.usage_count DESC;

-- 视图4: 工具使用频率统计
CREATE VIEW IF NOT EXISTS v_tool_usage_stats AS
SELECT
  t.id,
  t.name,
  t.display_name,
  t.category,
  t.usage_count,
  COUNT(DISTINCT m.template_id) as used_by_templates_count,
  json_array_length(t.used_by_skills) as used_by_skills_count
FROM builtin_tools t
LEFT JOIN template_skill_tool_mapping m ON t.id = m.tool_id
WHERE t.enabled = 1
GROUP BY t.id
ORDER BY t.usage_count DESC;

-- 视图5: 模板-技能-工具完整关联视图
CREATE VIEW IF NOT EXISTS v_template_dependencies AS
SELECT
  pt.id as template_id,
  pt.name as template_name,
  pt.category,
  pt.difficulty_level,
  pt.execution_engine,
  pt.required_skills,
  pt.required_tools,
  GROUP_CONCAT(DISTINCT m.skill_id) as mapped_skills,
  GROUP_CONCAT(DISTINCT m.tool_id) as mapped_tools
FROM project_templates pt
LEFT JOIN template_skill_tool_mapping m ON pt.id = m.template_id
WHERE pt.enabled = 1
GROUP BY pt.id;

-- 视图6: 缺少依赖声明的模板
CREATE VIEW IF NOT EXISTS v_templates_missing_dependencies AS
SELECT
  id,
  name,
  display_name,
  category,
  project_type,
  CASE
    WHEN required_skills = '[]' AND required_tools = '[]' THEN 'both_missing'
    WHEN required_skills = '[]' THEN 'skills_missing'
    WHEN required_tools = '[]' THEN 'tools_missing'
    ELSE 'complete'
  END as dependency_status
FROM project_templates
WHERE enabled = 1
  AND (required_skills = '[]' OR required_tools = '[]');

-- ============================================
-- 第七部分：创建自动更新触发器
-- ============================================

-- 触发器1: 自动更新 updated_at 时间戳（mapping表）
CREATE TRIGGER IF NOT EXISTS update_mapping_timestamp
AFTER UPDATE ON template_skill_tool_mapping
BEGIN
  UPDATE template_skill_tool_mapping
  SET updated_at = strftime('%s', 'now') * 1000
  WHERE id = NEW.id;
END;

-- 触发器2: 自动更新模板使用统计
CREATE TRIGGER IF NOT EXISTS increment_template_usage
AFTER INSERT ON project_executions
BEGIN
  UPDATE project_templates
  SET
    usage_count = usage_count + 1,
    last_used_at = strftime('%s', 'now') * 1000
  WHERE id = NEW.template_id;
END;

-- 触发器3: 自动更新技能使用统计（当模板被执行时）
-- 注意：需要解析 project_templates.required_skills JSON数组
-- 由于SQLite触发器限制，此逻辑需在应用层实现

-- 触发器4: 自动更新工具使用统计（当模板被执行时）
-- 注意：需要解析 project_templates.required_tools JSON数组
-- 由于SQLite触发器限制，此逻辑需在应用层实现

-- ============================================
-- 第八部分：数据验证约束
-- ============================================

-- 创建验证函数（通过CHECK约束实现）
-- 注意：SQLite不支持自定义函数，这些验证需在应用层实现

-- 验证项清单（应用层实现）:
-- 1. required_skills 必须是有效的JSON数组
-- 2. required_tools 必须是有效的JSON数组
-- 3. execution_engine 必须是预定义值之一
-- 4. difficulty_level 必须是 easy/medium/hard/expert
-- 5. estimated_duration 必须 >= 0
-- 6. template_version 必须符合语义化版本格式

-- ============================================
-- 第九部分：初始数据填充（示例）
-- ============================================

-- 为现有模板添加默认依赖（示例）
-- 实际数据需要根据模板审计结果批量更新

-- 示例1: Business类别模板的默认技能
UPDATE project_templates
SET
  required_skills = '["skill_content_creation", "skill_document_processing"]',
  required_tools = '["tool_word_generator", "tool_template_renderer"]',
  execution_engine = 'word',
  difficulty_level = 'medium',
  estimated_duration = 300
WHERE category = 'business' AND required_skills = '[]';

-- 示例2: Code-project类别模板的默认技能
UPDATE project_templates
SET
  required_skills = '["skill_code_development", "skill_project_management"]',
  required_tools = '["tool_file_writer", "tool_git_init", "tool_create_project_structure"]',
  execution_engine = 'code',
  difficulty_level = 'medium',
  estimated_duration = 600
WHERE category = 'code-project' AND required_skills = '[]';

-- 示例3: Data-science类别模板的默认技能
UPDATE project_templates
SET
  required_skills = '["skill_data_analysis", "skill_code_development"]',
  required_tools = '["tool_python_project_setup", "tool_data_preprocessor"]',
  execution_engine = 'ml',
  difficulty_level = 'hard',
  estimated_duration = 900
WHERE category = 'data-science' AND required_skills = '[]';

-- ============================================
-- 第十部分：迁移完成标记
-- ============================================

-- 确保 schema_migrations 表存在
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- 记录迁移信息
INSERT OR IGNORE INTO schema_migrations (version, description, applied_at)
VALUES (
  5,
  'Add template dependencies (required_skills, required_tools, execution_engine, difficulty_level)',
  strftime('%s', 'now') * 1000
);

-- ============================================
-- 迁移脚本完成
-- ============================================

-- 使用说明:
-- 1. 执行此脚本前请备份数据库
-- 2. 执行后运行 run-migration-005.js 验证
-- 3. 使用 verify-template-dependencies.js 检查依赖完整性
-- 4. 逐步为313个模板添加依赖声明（参考 TEMPLATE_SKILLS_TOOLS_AUDIT_REPORT_2026-01-01.md）

-- 回滚脚本（如需回滚）:
-- 详见 rollback-005.sql

-- 预期效果:
-- ✅ 模板可声明所需技能和工具
-- ✅ 支持模板执行前自动依赖检查
-- ✅ 提供使用统计和热门模板排行
-- ✅ 便于追踪技能/工具的使用情况
