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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'synced',
    synced_at TIMESTAMP,
    device_id VARCHAR(100),
    deleted INT DEFAULT 0,
    INDEX idx_user_id (user_id),
    INDEX idx_project_id (project_id),
    INDEX idx_updated_at (updated_at),
    INDEX idx_deleted (deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话表';

-- 创建对话消息表
CREATE TABLE IF NOT EXISTS conversation_messages (
    id VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,
    content LONGTEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text',
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'synced',
    synced_at TIMESTAMP,
    device_id VARCHAR(100),
    deleted INT DEFAULT 0,
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_created_at (created_at),
    INDEX idx_deleted (deleted),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';
