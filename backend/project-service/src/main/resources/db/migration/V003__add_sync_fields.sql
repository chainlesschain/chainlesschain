-- ChainlessChain 数据同步字段迁移（修复版）
-- 版本: V003_fixed
-- 描述: 为所有核心表添加同步相关字段，支持多设备数据同步和冲突检测
-- 修复: 使用IF NOT EXISTS确保幂等性

-- ===========================================
-- 1. 为 projects 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='sync_status') THEN
        ALTER TABLE projects ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN projects.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='synced_at') THEN
        ALTER TABLE projects ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN projects.synced_at IS '最后同步时间';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='device_id') THEN
        ALTER TABLE projects ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN projects.device_id IS '设备ID（用于多设备同步）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='deleted') THEN
        ALTER TABLE projects ADD COLUMN deleted INTEGER DEFAULT 0;
        COMMENT ON COLUMN projects.deleted IS '软删除标记: 0=未删除, 1=已删除';
    END IF;
END $$;

-- ===========================================
-- 2. 为 project_files 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_files' AND column_name='sync_status') THEN
        ALTER TABLE project_files ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN project_files.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_files' AND column_name='synced_at') THEN
        ALTER TABLE project_files ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN project_files.synced_at IS '最后同步时间';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_files' AND column_name='content_hash') THEN
        ALTER TABLE project_files ADD COLUMN content_hash VARCHAR(64);
        COMMENT ON COLUMN project_files.content_hash IS 'SHA256内容哈希（用于变更检测）';
    END IF;
END $$;

-- ===========================================
-- 3. 为 project_conversations 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_conversations' AND column_name='sync_status') THEN
        ALTER TABLE project_conversations ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN project_conversations.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_conversations' AND column_name='synced_at') THEN
        ALTER TABLE project_conversations ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN project_conversations.synced_at IS '最后同步时间';
    END IF;
END $$;

-- ===========================================
-- 4. 为 project_tasks 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_tasks' AND column_name='sync_status') THEN
        ALTER TABLE project_tasks ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN project_tasks.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_tasks' AND column_name='synced_at') THEN
        ALTER TABLE project_tasks ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN project_tasks.synced_at IS '最后同步时间';
    END IF;
END $$;

-- ===========================================
-- 5. 为 project_collaborators 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='sync_status') THEN
        ALTER TABLE project_collaborators ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN project_collaborators.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='synced_at') THEN
        ALTER TABLE project_collaborators ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN project_collaborators.synced_at IS '最后同步时间';
    END IF;
END $$;

-- ===========================================
-- 6. 为 project_comments 表添加同步字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_comments' AND column_name='sync_status') THEN
        ALTER TABLE project_comments ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
        COMMENT ON COLUMN project_comments.sync_status IS '同步状态: synced/pending/conflict';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_comments' AND column_name='synced_at') THEN
        ALTER TABLE project_comments ADD COLUMN synced_at TIMESTAMP;
        COMMENT ON COLUMN project_comments.synced_at IS '最后同步时间';
    END IF;
END $$;

-- ===========================================
-- 7. 创建同步日志表
-- ===========================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id VARCHAR(36) PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  device_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_description WHERE objoid = 'sync_logs'::regclass) THEN
        COMMENT ON TABLE sync_logs IS '数据同步日志表';
        COMMENT ON COLUMN sync_logs.table_name IS '表名';
        COMMENT ON COLUMN sync_logs.record_id IS '记录ID';
        COMMENT ON COLUMN sync_logs.operation IS '操作类型: create/update/delete';
        COMMENT ON COLUMN sync_logs.direction IS '同步方向: upload/download';
        COMMENT ON COLUMN sync_logs.status IS '同步状态: success/failed/pending';
        COMMENT ON COLUMN sync_logs.error_message IS '错误信息（如果失败）';
        COMMENT ON COLUMN sync_logs.device_id IS '设备ID';
    END IF;
END $$;

-- 创建触发器自动更新 updated_at
CREATE OR REPLACE FUNCTION update_sync_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sync_logs_updated_at ON sync_logs;
CREATE TRIGGER update_sync_logs_updated_at
    BEFORE UPDATE ON sync_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_logs_updated_at();

-- ===========================================
-- 8. 添加索引以提高查询性能
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status);
CREATE INDEX IF NOT EXISTS idx_projects_synced_at ON projects(synced_at);
CREATE INDEX IF NOT EXISTS idx_projects_device_id ON projects(device_id);
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted);

CREATE INDEX IF NOT EXISTS idx_project_files_sync_status ON project_files(sync_status);
CREATE INDEX IF NOT EXISTS idx_project_files_synced_at ON project_files(synced_at);
CREATE INDEX IF NOT EXISTS idx_project_files_content_hash ON project_files(content_hash);

CREATE INDEX IF NOT EXISTS idx_project_conversations_sync_status ON project_conversations(sync_status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_sync_status ON project_tasks(sync_status);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_sync_status ON project_collaborators(sync_status);
CREATE INDEX IF NOT EXISTS idx_project_comments_sync_status ON project_comments(sync_status);

CREATE INDEX IF NOT EXISTS idx_sync_logs_device_id ON sync_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_table_name ON sync_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);

-- ===========================================
-- 9. 为现有数据设置默认值
-- ===========================================
UPDATE projects SET sync_status = 'synced' WHERE sync_status IS NULL;
UPDATE projects SET deleted = 0 WHERE deleted IS NULL;

UPDATE project_files SET sync_status = 'synced' WHERE sync_status IS NULL;
UPDATE project_conversations SET sync_status = 'synced' WHERE sync_status IS NULL;
UPDATE project_tasks SET sync_status = 'synced' WHERE sync_status IS NULL;
UPDATE project_collaborators SET sync_status = 'synced' WHERE sync_status IS NULL;
UPDATE project_comments SET sync_status = 'synced' WHERE sync_status IS NULL;
