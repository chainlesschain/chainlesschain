-- ChainlessChain 项目管理模块数据库表
-- 版本: V001
-- 创建时间: 2025-12-21
-- 描述: 创建12个核心项目管理表

-- ===========================================
-- 1. 项目表 (projects)
-- ===========================================
CREATE TABLE projects (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'web', 'document', 'data', 'presentation', 'video', 'image', 'code', 'mixed', 'custom'
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'archived', 'deleted'
    owner_did VARCHAR(255) NOT NULL, -- DID身份标识
    folder_path VARCHAR(500) NOT NULL, -- 项目文件夹路径（相对路径）
    git_repo_path VARCHAR(500), -- Git仓库路径
    metadata_json TEXT, -- 项目元数据（JSON格式）
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

);

COMMENT ON TABLE projects IS '项目表 - 存储项目基本信息';
COMMENT ON COLUMN projects.type IS '项目类型: web/document/data/presentation/video/image/code/mixed/custom';
COMMENT ON COLUMN projects.status IS '项目状态: active/archived/deleted';

-- ===========================================
-- 2. 项目文件表 (project_files)
-- ===========================================
CREATE TABLE project_files (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    file_path VARCHAR(500) NOT NULL, -- 文件相对路径
    file_type VARCHAR(50) NOT NULL, -- 'source', 'output', 'asset', 'doc'
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    git_commit_hash VARCHAR(40), -- Git提交hash
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_files IS '项目文件表 - 记录项目中的所有文件';
COMMENT ON COLUMN project_files.file_type IS '文件类型: source/output/asset/doc';

-- ===========================================
-- 3. 项目任务表 (project_tasks)
-- ===========================================
CREATE TABLE project_tasks (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    description TEXT NOT NULL, -- 任务描述
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
    assigned_to_agent VARCHAR(100), -- 分配给哪个AI Agent
    dependencies TEXT, -- 依赖的任务ID（JSON数组）
    result_path VARCHAR(500), -- 任务结果文件路径
    error_message TEXT, -- 错误信息
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_tasks IS '项目任务表 - AI执行的任务记录';
COMMENT ON COLUMN project_tasks.status IS '任务状态: pending/in_progress/completed/failed';

-- ===========================================
-- 4. 项目对话历史表 (project_conversations)
-- ===========================================
CREATE TABLE project_conversations (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    tool_calls TEXT, -- Function Calling工具调用（JSON格式）
    metadata_json TEXT, -- 额外元数据
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_conversations IS '项目对话历史表 - 用户与AI的对话记录';
COMMENT ON COLUMN project_conversations.role IS '角色: user/assistant/system';

-- ===========================================
-- 5. 项目协作者表 (project_collaborators)
-- ===========================================
CREATE TABLE project_collaborators (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    collaborator_did VARCHAR(255) NOT NULL, -- 协作者DID
    permissions VARCHAR(50) NOT NULL DEFAULT 'read', -- 'read', 'write', 'admin'
    invited_by VARCHAR(255) NOT NULL, -- 邀请人DID
    invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, collaborator_did)
);

COMMENT ON TABLE project_collaborators IS '项目协作者表 - 项目协作成员';
COMMENT ON COLUMN project_collaborators.permissions IS '权限: read/write/admin';

-- ===========================================
-- 6. 项目评论/批注表 (project_comments)
-- ===========================================
CREATE TABLE project_comments (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    file_path VARCHAR(500), -- 批注的文件路径（可为空表示项目级评论）
    line_number INT, -- 代码行号（仅代码文件）
    author_did VARCHAR(255) NOT NULL, -- 评论作者DID
    content TEXT NOT NULL,
    parent_comment_id VARCHAR(36), -- 回复的父评论ID
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES project_comments(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_comments IS '项目评论/批注表 - 协作评论';

-- ===========================================
-- 7. 项目模板表 (project_templates)
-- ===========================================
CREATE TABLE project_templates (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 与projects.type一致
    description TEXT,
    author_did VARCHAR(255), -- 模板作者DID
    config_json TEXT NOT NULL, -- 模板配置（JSON格式）
    preview_image_url VARCHAR(500),
    usage_count INT DEFAULT 0,
    is_builtin BOOLEAN DEFAULT FALSE, -- 是否内置模板
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

);

COMMENT ON TABLE project_templates IS '项目模板表 - 预定义项目模板';
COMMENT ON COLUMN project_templates.is_builtin IS '是否为系统内置模板';

-- ===========================================
-- 8. 项目市场商品表 (project_marketplace_listings)
-- ===========================================
CREATE TABLE project_marketplace_listings (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'CNY',
    license_type VARCHAR(50), -- 'free', 'paid', 'subscription'
    seller_did VARCHAR(255) NOT NULL,
    downloads INT DEFAULT 0,
    rating DECIMAL(3, 2), -- 1.00 ~ 5.00
    review_count INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'published', 'removed'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_marketplace_listings IS '项目市场商品表 - 项目市场化';
COMMENT ON COLUMN project_marketplace_listings.license_type IS '许可类型: free/paid/subscription';

-- ===========================================
-- 9. 项目知识关联表 (project_knowledge_links)
-- ===========================================
CREATE TABLE project_knowledge_links (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    knowledge_id VARCHAR(36) NOT NULL, -- 知识库条目ID
    link_type VARCHAR(50) NOT NULL, -- 'reference', 'template', 'example', 'output'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, knowledge_id, link_type)
);

COMMENT ON TABLE project_knowledge_links IS '项目知识关联表 - 项目与知识库关联';
COMMENT ON COLUMN project_knowledge_links.link_type IS '关联类型: reference/template/example/output';

-- ===========================================
-- 10. 项目自动化规则表 (project_automation_rules)
-- ===========================================
CREATE TABLE project_automation_rules (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    trigger_event VARCHAR(100) NOT NULL, -- 'file_created', 'file_modified', 'task_completed', 'schedule'
    action_type VARCHAR(100) NOT NULL, -- 'generate_file', 'send_notification', 'git_commit', 'run_script'
    config_json TEXT NOT NULL, -- 规则配置（JSON格式）
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_automation_rules IS '项目自动化规则表 - 工作流自动化';
COMMENT ON COLUMN project_automation_rules.trigger_event IS '触发事件: file_created/file_modified/task_completed/schedule';

-- ===========================================
-- 11. 项目统计表 (project_stats)
-- ===========================================
CREATE TABLE project_stats (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    total_files INT DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,
    total_tasks INT DEFAULT 0,
    completed_tasks INT DEFAULT 0,
    total_conversations INT DEFAULT 0,
    last_activity_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id)
);

COMMENT ON TABLE project_stats IS '项目统计表 - 项目统计信息';

-- ===========================================
-- 12. 项目操作日志表 (project_logs)
-- ===========================================
CREATE TABLE project_logs (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    user_did VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'create', 'update', 'delete', 'generate_file', etc.
    description TEXT,
    metadata_json TEXT, -- 日志元数据（JSON格式）
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE project_logs IS '项目操作日志表 - 审计日志';

-- ===========================================
-- 初始化数据
-- ===========================================

-- 插入内置项目模板
INSERT INTO project_templates (id, name, type, description, config_json, is_builtin) VALUES
('tpl_web_blog', 'Blog网站', 'web', '响应式个人博客网站模板', '{"style": "modern", "pages": ["index", "about", "posts"]}', TRUE),
('tpl_web_portfolio', '作品集网站', 'web', '展示个人作品的作品集网站', '{"style": "creative", "sections": ["hero", "projects", "contact"]}', TRUE),
('tpl_web_landing', '落地页', 'web', '产品营销落地页模板', '{"style": "minimal", "cta": true}', TRUE),
('tpl_doc_report', '工作报告', 'document', 'Word工作报告模板', '{"sections": ["summary", "details", "conclusion"], "style": "professional"}', TRUE),
('tpl_doc_manual', '产品手册', 'document', '产品使用手册模板', '{"toc": true, "style": "technical"}', TRUE),
('tpl_doc_contract', '合同文档', 'document', '商务合同模板', '{"sections": ["parties", "terms", "signatures"], "legal": true}', TRUE),
('tpl_data_sales', '销售数据分析', 'data', '销售数据可视化模板', '{"charts": ["line", "bar", "pie"], "metrics": ["revenue", "growth"]}', TRUE),
('tpl_data_financial', '财务报表', 'data', '财务数据分析模板', '{"sheets": ["balance", "income", "cashflow"]}', TRUE),
('tpl_data_dashboard', '数据仪表盘', 'data', '可视化数据仪表盘', '{"widgets": ["kpi", "chart", "table"]}', TRUE);

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有表添加更新时间触发器
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_files_updated_at BEFORE UPDATE ON project_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_comments_updated_at BEFORE UPDATE ON project_comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_templates_updated_at BEFORE UPDATE ON project_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_marketplace_listings_updated_at BEFORE UPDATE ON project_marketplace_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_automation_rules_updated_at BEFORE UPDATE ON project_automation_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_stats_updated_at BEFORE UPDATE ON project_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 完成


-- Indexes
CREATE INDEX idx_projects_idx_owner_did ON projects (owner_did);
CREATE INDEX idx_projects_idx_type ON projects (type);
CREATE INDEX idx_projects_idx_status ON projects (status);
CREATE INDEX idx_projects_idx_created_at ON projects (created_at);
CREATE INDEX idx_project_files_idx_project_id ON project_files (project_id);
CREATE INDEX idx_project_files_idx_file_type ON project_files (file_type);
CREATE INDEX idx_project_tasks_idx_project_id ON project_tasks (project_id);
CREATE INDEX idx_project_tasks_idx_status ON project_tasks (status);
CREATE INDEX idx_project_conversations_idx_project_id ON project_conversations (project_id);
CREATE INDEX idx_project_conversations_idx_role ON project_conversations (role);
CREATE INDEX idx_project_conversations_idx_created_at ON project_conversations (created_at);
CREATE INDEX idx_project_collaborators_idx_project_id ON project_collaborators (project_id);
CREATE INDEX idx_project_collaborators_idx_collaborator_did ON project_collaborators (collaborator_did);
CREATE INDEX idx_project_comments_idx_project_id ON project_comments (project_id);
CREATE INDEX idx_project_comments_idx_file_path ON project_comments (file_path);
CREATE INDEX idx_project_comments_idx_author_did ON project_comments (author_did);
CREATE INDEX idx_project_templates_idx_type ON project_templates (type);
CREATE INDEX idx_project_templates_idx_is_builtin ON project_templates (is_builtin);
CREATE INDEX idx_project_templates_idx_usage_count ON project_templates (usage_count);
CREATE INDEX idx_project_marketplace_listings_idx_project_id ON project_marketplace_listings (project_id);
CREATE INDEX idx_project_marketplace_listings_idx_seller_did ON project_marketplace_listings (seller_did);
CREATE INDEX idx_project_marketplace_listings_idx_status ON project_marketplace_listings (status);
CREATE INDEX idx_project_marketplace_listings_idx_rating ON project_marketplace_listings (rating);
CREATE INDEX idx_project_knowledge_links_idx_project_id ON project_knowledge_links (project_id);
CREATE INDEX idx_project_knowledge_links_idx_knowledge_id ON project_knowledge_links (knowledge_id);
CREATE INDEX idx_project_automation_rules_idx_project_id ON project_automation_rules (project_id);
CREATE INDEX idx_project_automation_rules_idx_is_enabled ON project_automation_rules (is_enabled);
CREATE INDEX idx_project_logs_idx_project_id ON project_logs (project_id);
CREATE INDEX idx_project_logs_idx_user_did ON project_logs (user_did);
CREATE INDEX idx_project_logs_idx_action ON project_logs (action);
CREATE INDEX idx_project_logs_idx_created_at ON project_logs (created_at);

