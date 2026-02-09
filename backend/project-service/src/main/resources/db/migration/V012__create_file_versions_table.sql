-- 创建文件版本历史表
-- 用于存储项目文件的版本快照，支持版本回滚功能

CREATE TABLE IF NOT EXISTS file_versions (
    id VARCHAR(36) PRIMARY KEY,
    file_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    version INTEGER NOT NULL,
    content TEXT,
    content_hash VARCHAR(64),
    file_size BIGINT,
    commit_hash VARCHAR(40),
    created_by VARCHAR(50) DEFAULT 'user',
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_id VARCHAR(100),

    -- 索引
    CONSTRAINT fk_file_versions_file FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
    CONSTRAINT fk_file_versions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_project_id ON file_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_file_version ON file_versions(file_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_file_versions_created_at ON file_versions(created_at DESC);

-- 添加唯一约束：同一文件的版本号不能重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_versions_unique ON file_versions(file_id, version);

COMMENT ON TABLE file_versions IS '文件版本历史表';
COMMENT ON COLUMN file_versions.id IS '版本记录ID';
COMMENT ON COLUMN file_versions.file_id IS '关联的文件ID';
COMMENT ON COLUMN file_versions.project_id IS '关联的项目ID';
COMMENT ON COLUMN file_versions.version IS '版本号';
COMMENT ON COLUMN file_versions.content IS '文件内容快照';
COMMENT ON COLUMN file_versions.content_hash IS '内容SHA256哈希';
COMMENT ON COLUMN file_versions.file_size IS '文件大小（字节）';
COMMENT ON COLUMN file_versions.commit_hash IS 'Git提交哈希';
COMMENT ON COLUMN file_versions.created_by IS '创建者类型（user/auto/ai）';
COMMENT ON COLUMN file_versions.message IS '版本备注/提交信息';
COMMENT ON COLUMN file_versions.created_at IS '创建时间';
COMMENT ON COLUMN file_versions.device_id IS '创建设备ID';
