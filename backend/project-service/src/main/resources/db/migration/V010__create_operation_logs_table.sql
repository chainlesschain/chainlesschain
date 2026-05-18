-- V010: 创建操作日志表
-- 操作日志和审计系统

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64),
    username VARCHAR(50),
    module VARCHAR(50),
    operation_type VARCHAR(20),
    description TEXT,
    request_method VARCHAR(10),
    request_url VARCHAR(500),
    request_params TEXT,
    response_result TEXT,
    status VARCHAR(20),
    error_message TEXT,
    execution_time BIGINT,
    client_ip VARCHAR(50),
    user_agent VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_operation_logs_user_id ON operation_logs(user_id);
CREATE INDEX idx_operation_logs_module ON operation_logs(module);
CREATE INDEX idx_operation_logs_operation_type ON operation_logs(operation_type);
CREATE INDEX idx_operation_logs_status ON operation_logs(status);
CREATE INDEX idx_operation_logs_created_at ON operation_logs(created_at);
CREATE INDEX idx_operation_logs_client_ip ON operation_logs(client_ip);
