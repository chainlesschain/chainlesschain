-- ChainlessChain 修复project_collaborators表缺失字段
-- 版本: V005
-- 描述: 为project_collaborators表添加deleted, role, status字段

-- ===========================================
-- 为 project_collaborators 表添加缺失字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='deleted') THEN
        ALTER TABLE project_collaborators ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
        COMMENT ON COLUMN project_collaborators.deleted IS '软删除标记: 0=未删除, 1=已删除';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='role') THEN
        ALTER TABLE project_collaborators ADD COLUMN role VARCHAR(50) DEFAULT 'viewer';
        COMMENT ON COLUMN project_collaborators.role IS '角色: owner/admin/developer/viewer';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='status') THEN
        ALTER TABLE project_collaborators ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
        COMMENT ON COLUMN project_collaborators.status IS '状态: pending/accepted/rejected';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='created_at') THEN
        ALTER TABLE project_collaborators ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='updated_at') THEN
        ALTER TABLE project_collaborators ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- ===========================================
-- 添加索引
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_project_collaborators_deleted ON project_collaborators(deleted);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_role ON project_collaborators(role);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_status ON project_collaborators(status);

-- ===========================================
-- 更新现有数据的默认值
-- ===========================================
UPDATE project_collaborators SET deleted = 0 WHERE deleted IS NULL;
UPDATE project_collaborators SET role = 'viewer' WHERE role IS NULL;
UPDATE project_collaborators SET status = 'accepted' WHERE status IS NULL;
