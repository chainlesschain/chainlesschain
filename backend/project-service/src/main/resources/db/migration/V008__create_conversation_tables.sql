-- V008: 创建对话和消息表
-- 用于支持AI对话功能

-- 创建对话表
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    project_id VARCHAR(36),
    user_id VARCHAR(36) NOT NULL,
    context_mode VARCHAR(20) DEFAULT 'global',
    context_data TEXT,
    message_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'synced',
    synced_at TIMESTAMP,
    device_id VARCHAR(100),
    deleted INT DEFAULT 0
);

-- 创建对话表索引
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_deleted ON conversations(deleted);

-- 创建对话表更新时间触发器
CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_conversations_updated_at();

-- 创建对话消息表
CREATE TABLE IF NOT EXISTS conversation_messages (
    id VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text',
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'synced',
    synced_at TIMESTAMP,
    device_id VARCHAR(100),
    deleted INT DEFAULT 0,
    CONSTRAINT fk_conversation_messages_conversation_id
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE
);

-- 创建对话消息表索引
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_deleted ON conversation_messages(deleted);

-- 添加表注释
COMMENT ON TABLE conversations IS '对话表';
COMMENT ON TABLE conversation_messages IS '对话消息表';
