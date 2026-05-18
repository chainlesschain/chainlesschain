-- ChainlessChain 修复缺失的user_id和device_id字段
-- 版本: V006
-- 描述: 为project_collaborators和project_comments添加user_id列，为project_tasks等表添加device_id和deleted列

-- ===========================================
-- 1. 为 project_collaborators 表添加 user_id 字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='user_id') THEN
        ALTER TABLE project_collaborators ADD COLUMN user_id VARCHAR(100);
        COMMENT ON COLUMN project_collaborators.user_id IS '用户ID（本地用户标识）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_collaborators' AND column_name='device_id') THEN
        ALTER TABLE project_collaborators ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN project_collaborators.device_id IS '设备ID（用于多设备同步）';
    END IF;
END $$;

-- ===========================================
-- 2. 为 project_comments 表添加 user_id 字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_comments' AND column_name='user_id') THEN
        ALTER TABLE project_comments ADD COLUMN user_id VARCHAR(100);
        COMMENT ON COLUMN project_comments.user_id IS '用户ID（本地用户标识）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_comments' AND column_name='device_id') THEN
        ALTER TABLE project_comments ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN project_comments.device_id IS '设备ID（用于多设备同步）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_comments' AND column_name='deleted') THEN
        ALTER TABLE project_comments ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
        COMMENT ON COLUMN project_comments.deleted IS '软删除标记: 0=未删除, 1=已删除';
    END IF;
END $$;

-- ===========================================
-- 3. 为 project_tasks 表添加缺失字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_tasks' AND column_name='device_id') THEN
        ALTER TABLE project_tasks ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN project_tasks.device_id IS '设备ID（用于多设备同步）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_tasks' AND column_name='deleted') THEN
        ALTER TABLE project_tasks ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
        COMMENT ON COLUMN project_tasks.deleted IS '软删除标记: 0=未删除, 1=已删除';
    END IF;
END $$;

-- ===========================================
-- 4. 为 project_conversations 表添加缺失字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_conversations' AND column_name='device_id') THEN
        ALTER TABLE project_conversations ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN project_conversations.device_id IS '设备ID（用于多设备同步）';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_conversations' AND column_name='deleted') THEN
        ALTER TABLE project_conversations ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
        COMMENT ON COLUMN project_conversations.deleted IS '软删除标记: 0=未删除, 1=已删除';
    END IF;
END $$;

-- ===========================================
-- 5. 为 knowledge_items 表添加缺失字段（如果存在）
-- ===========================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='knowledge_items') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_items' AND column_name='device_id') THEN
            ALTER TABLE knowledge_items ADD COLUMN device_id VARCHAR(100);
            COMMENT ON COLUMN knowledge_items.device_id IS '设备ID（用于多设备同步）';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_items' AND column_name='deleted') THEN
            ALTER TABLE knowledge_items ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
            COMMENT ON COLUMN knowledge_items.deleted IS '软删除标记: 0=未删除, 1=已删除';
        END IF;
    END IF;
END $$;

-- ===========================================
-- 6. 为 conversations 表添加缺失字段（如果存在）
-- ===========================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='conversations') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='device_id') THEN
            ALTER TABLE conversations ADD COLUMN device_id VARCHAR(100);
            COMMENT ON COLUMN conversations.device_id IS '设备ID（用于多设备同步）';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='deleted') THEN
            ALTER TABLE conversations ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
            COMMENT ON COLUMN conversations.deleted IS '软删除标记: 0=未删除, 1=已删除';
        END IF;
    END IF;
END $$;

-- ===========================================
-- 7. 为 messages 表添加缺失字段（如果存在）
-- ===========================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='messages') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='device_id') THEN
            ALTER TABLE messages ADD COLUMN device_id VARCHAR(100);
            COMMENT ON COLUMN messages.device_id IS '设备ID（用于多设备同步）';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='deleted') THEN
            ALTER TABLE messages ADD COLUMN deleted INTEGER DEFAULT 0 NOT NULL;
            COMMENT ON COLUMN messages.deleted IS '软删除标记: 0=未删除, 1=已删除';
        END IF;
    END IF;
END $$;

-- ===========================================
-- 8. 添加索引以提高查询性能
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_device_id ON project_collaborators(device_id);

CREATE INDEX IF NOT EXISTS idx_project_comments_user_id ON project_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_device_id ON project_comments(device_id);
CREATE INDEX IF NOT EXISTS idx_project_comments_deleted ON project_comments(deleted);

CREATE INDEX IF NOT EXISTS idx_project_tasks_device_id ON project_tasks(device_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_deleted ON project_tasks(deleted);

CREATE INDEX IF NOT EXISTS idx_project_conversations_device_id ON project_conversations(device_id);
CREATE INDEX IF NOT EXISTS idx_project_conversations_deleted ON project_conversations(deleted);

-- ===========================================
-- 9. 更新现有数据的默认值
-- ===========================================
UPDATE project_comments SET deleted = 0 WHERE deleted IS NULL;
UPDATE project_tasks SET deleted = 0 WHERE deleted IS NULL;
UPDATE project_conversations SET deleted = 0 WHERE deleted IS NULL;
