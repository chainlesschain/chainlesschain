-- 知识库条目表
CREATE TABLE IF NOT EXISTS knowledge_items (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL,
    content TEXT,
    content_path VARCHAR(1000),
    embedding_path VARCHAR(1000),
    user_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    git_commit_hash VARCHAR(64),
    sync_status VARCHAR(20) DEFAULT 'synced',
    synced_at TIMESTAMP,
    device_id VARCHAR(100),
    deleted INTEGER DEFAULT 0
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_knowledge_items_user_id ON knowledge_items(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_sync_status ON knowledge_items(sync_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at ON knowledge_items(updated_at);
