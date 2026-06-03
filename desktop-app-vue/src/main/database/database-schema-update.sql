-- 数据库Schema更新脚本
-- 为project_templates表添加新字段以支持技能和工具关联

-- 版本：v1.0
-- 日期：2025-12-31
-- 说明：添加 required_skills, required_tools, execution_engine 字段

-- 检查并添加 required_skills 字段
-- 存储模板所需的技能ID列表（JSON数组格式）
ALTER TABLE project_templates ADD COLUMN required_skills TEXT DEFAULT '[]';

-- 检查并添加 required_tools 字段
-- 存储模板所需的工具ID列表（JSON数组格式）
ALTER TABLE project_templates ADD COLUMN required_tools TEXT DEFAULT '[]';

-- 检查并添加 execution_engine 字段
-- 存储模板的执行引擎类型
-- 可选值: 'default', 'word', 'excel', 'ppt', 'code', 'ml', 'web', 'video', 'audio', 'design'
ALTER TABLE project_templates ADD COLUMN execution_engine TEXT DEFAULT 'default';

-- 为新字段创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_project_templates_execution_engine ON project_templates(execution_engine);

-- 验证更新
SELECT
    name,
    type,
    [notnull],
    dflt_value
FROM pragma_table_info('project_templates')
WHERE name IN ('required_skills', 'required_tools', 'execution_engine');
