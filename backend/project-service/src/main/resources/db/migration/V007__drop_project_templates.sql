-- 删除项目模板表
-- 该功能已废弃，不再使用

-- 删除触发器
DROP TRIGGER IF EXISTS update_project_templates_updated_at ON project_templates;

-- 删除索引
DROP INDEX IF EXISTS idx_project_templates_idx_type;
DROP INDEX IF EXISTS idx_project_templates_idx_is_builtin;
DROP INDEX IF EXISTS idx_project_templates_idx_usage_count;

-- 删除外键约束（如果projects表有template_id字段引用）
ALTER TABLE projects DROP COLUMN IF EXISTS template_id;

-- 删除project_templates表
DROP TABLE IF EXISTS project_templates;
